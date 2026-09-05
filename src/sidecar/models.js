/**
 * `amicus models` (F5) — list/search the catalog, refresh it, audit aliases.
 *
 *   amicus models                  list (effective aliases marked)
 *   amicus models --search <q>     substring filter over id+name
 *   amicus models --refresh        force-refresh the cache
 *   amicus models --check          stale-alias audit (exit = stale count, max 100)
 *   amicus models --check --live   + probe every stored alias with a real leg (spends)
 *   --json on all of the above     versioned documents (result-schema)
 *
 * Returns an exit code; bin/amicus.js plumbs it like fanout's.
 */

'use strict';

const { getCatalogInfo, refreshCatalog, catalogPath } = require('../utils/model-catalog');
const { collectAliasSources, findStaleAliases, findDriftedStoredAliases, suggestReplacements } = require('../utils/alias-audit');
const { auditGatewayRoutes } = require('../utils/gateway-route-audit');
const { buildCatalogDoc, buildAuditDoc } = require('../utils/result-schema');
const { getFamilies } = require('../utils/curated-models');
const { pickCurrent } = require('../utils/quick-picks');
const { probeStoredAliases, selectStoredAliases } = require('./models-probe');
const { DEFAULT_MAX_LEGS } = require('./fanout-validate');
const { fmtRow, fmtGatewayFinding, fmtProbeLine, fmtProviderFailure } = require('./models-render');
const { fmtCeilingLine } = require('./models-ceiling-line');

const CHECK_EXIT_CAP = 100;



/** alias marks: id → comma-joined alias names (effective user aliases) */
function aliasMarks() {
  const { getEffectiveAliases } = require('../utils/config');
  const map = new Map();
  for (const [alias, model] of Object.entries(getEffectiveAliases())) {
    map.set(model, map.has(model) ? `${map.get(model)},${alias}` : alias);
  }
  return map;
}

/**
 * #13: a one-line honest memo when the last refresh attempt on record failed
 * AFTER the data currently being shown was fetched — i.e. the cache is stale
 * because refreshing keeps failing, not just because nobody's refreshed lately.
 * @returns {string|null}
 */
function staleMemo(fetchedAt, lastRefreshAttempt, lastRefreshError) {
  if (!lastRefreshAttempt || !lastRefreshError) { return null; }
  if (fetchedAt && lastRefreshAttempt <= fetchedAt) { return null; }
  const attemptWhen = new Date(lastRefreshAttempt).toISOString();
  const fetchedWhen = fetchedAt ? new Date(fetchedAt).toISOString() : 'never';
  return `⚠ catalog may be stale: last refresh attempt failed ${attemptWhen} (${lastRefreshError}); showing data fetched ${fetchedWhen}`;
}

async function runList(args) {
  const { models, fetchedAt, lastRefreshAttempt, lastRefreshError } = await getCatalogInfo();
  const q = typeof args.search === 'string' ? args.search.toLowerCase() : null;
  const filtered = q
    ? models.filter(m => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
    : models;
  if (args.json) {
    process.stdout.write(JSON.stringify(buildCatalogDoc({
      models: filtered, fetchedAt, search: q, lastRefreshAttempt, lastRefreshError
    }), null, 2) + '\n');
    return 0;
  }
  const marks = aliasMarks();
  // Effective aliases (alias-marked) rows first, then the rest.
  const marked = filtered.filter(m => marks.has(m.id));
  const rest = filtered.filter(m => !marks.has(m.id));
  for (const m of [...marked, ...rest]) {
    process.stdout.write(fmtRow(m, marks) + '\n');
  }
  const when = fetchedAt ? new Date(fetchedAt).toISOString() : 'never';
  process.stdout.write(`(${filtered.length} models, catalog fetched ${when})\n`);
  if (filtered.length === 0 && models.length === 0) {
    process.stdout.write('Catalog unavailable (offline or first run) — try: amicus models --refresh\n');
  }
  const memo = staleMemo(fetchedAt, lastRefreshAttempt, lastRefreshError);
  if (memo) { process.stdout.write(memo + '\n'); }
  return 0;
}

// v4.6.2 PR3 Task 4: shared --live skip line; reason doubles as the JSON probeSkipped slug.
function fmtLiveSkipped(reason) {
  return `--live skipped: ${reason} — nothing was probed`;
}

async function runRefresh(args) {
  const models = await refreshCatalog();
  const { fetchedAt, lastRefreshAttempt, lastRefreshError, ceilingEnrichment } = await getCatalogInfo({ maxAgeMs: Number.POSITIVE_INFINITY });
  // --refresh short-circuits --check below (args.check is guaranteed true here) — must announce, not silently skip.
  if (args.live) {
    const line = fmtLiveSkipped('refresh-precedes-check');
    (args.json ? process.stderr : process.stdout).write(line + '\n');
  }
  if (args.json) {
    process.stdout.write(JSON.stringify(buildCatalogDoc({
      models, fetchedAt, refreshed: true, lastRefreshAttempt, lastRefreshError, ceilingEnrichment
    }), null, 2) + '\n');
    return models.length === 0 && !fetchedAt ? 1 : 0;
  }
  if (models.length === 0 && lastRefreshError) {
    // Honest failure report — never claim "Refreshed catalog: 0 models" when
    // the refresh actually failed and an old (or no) cache was retained.
    if (fetchedAt) {
      const when = new Date(fetchedAt).toISOString();
      process.stdout.write(`refresh failed (${lastRefreshError}); keeping catalog from ${when}\n`);
      process.stdout.write(`Cache: ${catalogPath()}\n`);
      return 0; // stale-but-served: a warning, not a command failure
    }
    process.stdout.write(`refresh failed (${lastRefreshError}); no cache available\n`);
    return 1; // no cache at all: a real failure
  }
  process.stdout.write(`Refreshed catalog: ${models.length} models.\n`);
  process.stdout.write(fmtCeilingLine(ceilingEnrichment) + '\n');
  process.stdout.write(`Cache: ${catalogPath()}\n`);
  return 0;
}





async function runCheck(args) {
  // v4.9 W13 Task B (BACKLOG C5). FIRST — ahead of the catalog-unavailable return
  // below, exactly when an offline user most needs to know what their aliases bind
  // to. No name list, so the subject is curated ∩ configured — NOT "the whole
  // configured set", the overstatement round 3's B2 struck from findAliasShadows'
  // docstring and whose twin here outlived it (round 5, D2). stderr only, so
  // `--json` stays byte-clean; `audit…` opens a fresh scope (PR #203 A5).
  require('../utils/alias-shadow').auditAliasShadows();
  const catalogInfo = await getCatalogInfo();
  const catalog = catalogInfo.models;
  const providerFailures = Array.isArray(catalogInfo.providerFailures) ? catalogInfo.providerFailures : [];
  if (!catalog || catalog.length === 0) {
    const probeSkipped = args.live ? 'catalog-unavailable' : null;
    if (args.json) {
      process.stdout.write(JSON.stringify(buildAuditDoc({
        stale: [], catalogAvailable: false, probeSkipped, providerFailures
      }), null, 2) + '\n');
    } else {
      // Council C2 (PR 215): "catalog unavailable" is precisely when the user
      // needs to know WHICH provider refused them.
      for (const f of providerFailures) { process.stdout.write(fmtProviderFailure(f) + '\n'); }
      process.stdout.write('Catalog unavailable (offline or no providers reachable); cannot check.\n');
      if (probeSkipped) { process.stdout.write(fmtLiveSkipped(probeSkipped) + '\n'); }
    }
    return 0;
  }
  const sources = collectAliasSources();
  const stale = findStaleAliases(sources, catalog)
    .map(s => ({ ...s, suggestions: suggestReplacements(s.model, catalog) }));
  const drifted = findDriftedStoredAliases(sources, catalogInfo);
  // Task 6 (#gwid): per-gateway-form audit of the curated DEFAULTS
  // (toGatewayRoutes()) — additive to the flat audit above. Informational by
  // default; --strict promotes it to a build-breaking exit code (CI gate).
  const gatewayFindings = auditGatewayRoutes(catalogInfo);
  const legacyExitCode = Math.min(stale.length, CHECK_EXIT_CAP);
  let exitCode = args.strict
    ? Math.max(legacyExitCode, Math.min(gatewayFindings.length, CHECK_EXIT_CAP))
    : legacyExitCode;

  // v4.6.2 PR3 (spec §6, D5): opt-in --live probe of stored aliases with real
  // engine legs. Never spends without --live — probeStoredAliases is only
  // ever called inside this block (regression-tested: a mocked module must
  // see zero calls when the flag is absent). The cap pre-check runs BEFORE
  // the call so a doomed wave never spends a token (Task 2 review carry-in:
  // without it, runFanout fails wave-creation and models-probe.js degrades
  // every row to a generic error, losing the real reason).
  let probeResults = [];
  if (args.live) {
    const storedCount = selectStoredAliases(sources).length;
    const envCap = Number(process.env.AMICUS_FANOUT_MAX_LEGS);
    const maxLegs = (Number.isInteger(envCap) && envCap > 0) ? envCap : DEFAULT_MAX_LEGS;
    if (storedCount > maxLegs) {
      process.stderr.write(`Error: --live would probe ${storedCount} stored aliases, exceeding the `
        + `fan-out cap of ${maxLegs} (set AMICUS_FANOUT_MAX_LEGS to raise)\n`);
      return 1;
    }
    const probe = await probeStoredAliases({ project: args.cwd || process.cwd() });
    probeResults = probe.results;
    const nonServed = probeResults.filter(r => r.outcome !== 'served').length;
    exitCode = Math.max(exitCode, Math.min(nonServed, CHECK_EXIT_CAP));
  }

  if (args.json) {
    process.stdout.write(JSON.stringify(buildAuditDoc({
      stale, catalogAvailable: true, gatewayFindings, drifted, probe: probeResults, providerFailures
    }), null, 2) + '\n');
    return exitCode;
  }
  // issue 209: report REJECTED provider fetches before the alias findings -- an
  // empty namespace explains stale/absent aliases downstream, and staying
  // silent about it is the original defect.
  for (const f of providerFailures) { process.stdout.write(fmtProviderFailure(f) + '\n'); }
  const driftLines = buildFallbackDriftReport(catalog);
  if (stale.length === 0 && drifted.length === 0) {
    process.stdout.write(`All aliases resolve to catalog models (${sources.length} checked).\n`);
  } else if (stale.length > 0) {
    for (const s of stale) {
      process.stdout.write(`STALE: ${s.alias} -> ${s.model} (${s.source})\n`);
      if (s.suggestions.length > 0) {
        process.stdout.write(`  candidates: ${s.suggestions.join(', ')}\n`);
        process.stdout.write(`  fix: amicus setup --add-alias ${s.alias}=${s.suggestions[0]}\n`);
      } else {
        process.stdout.write('  no same-vendor candidates in catalog\n');
      }
    }
  }
  for (const dr of drifted) {
    process.stdout.write(`DRIFTED: ${dr.alias} -> ${dr.stored} (stored; current resolution: ${dr.current})\n`);
    process.stdout.write(`  stored aliases don't follow catalog updates — refresh: amicus setup --add-alias ${dr.alias}=${dr.current}\n`);
  }
  if (driftLines.length > 0) {
    process.stdout.write('Pinned fallback drift:\n');
    for (const l of driftLines) { process.stdout.write(l + '\n'); }
  }
  if (args.live) {
    if (probeResults.length === 0) {
      process.stdout.write('Live probe: no stored aliases to probe\n');
    } else {
      process.stdout.write(`Live probe (${probeResults.length} stored aliases):\n`);
      for (const r of probeResults) { process.stdout.write(fmtProbeLine(r) + '\n'); }
    }
  }
  if (gatewayFindings.length > 0) {
    process.stdout.write('Per-gateway route audit (curated defaults):\n');
    for (const f of gatewayFindings) { process.stdout.write(fmtGatewayFinding(f) + '\n'); }
  }
  return exitCode;
}

/**
 * Non-blocking drift report: pinned family fallbacks vs live resolution.
 * Empty catalog → [] (cannot check). Never affects the exit code.
 * @param {Array<{id:string}>} catalog
 * @returns {string[]} human-readable warning lines
 */
function buildFallbackDriftReport(catalog) {
  if (!catalog || catalog.length === 0) { return []; }
  const lines = [];
  for (const f of getFamilies()) {
    const live = pickCurrent(catalog, 'openrouter/', f.vendorPath, f.idPattern);
    if (live && f.fallback.openrouter && live !== f.fallback.openrouter) {
      lines.push(
        `  pinned fallback drift: ${f.alias} → ${f.fallback.openrouter} (live: ${live}) — update curated-models.js`);
    }
  }
  return lines;
}

/** @param {object} args parsed CLI args @returns {Promise<number>} exit code */
async function handleModels(args) {
  if (args.search === true) {
    process.stderr.write('Error: --search requires a value\n');
    return 1;
  }
  if (args.live && !args.check) {
    process.stderr.write('Error: --live requires --check\n');
    return 1;
  }
  if (args.refresh) { return runRefresh(args); }
  if (args.check) { return runCheck(args); }
  return runList(args);
}

module.exports = { handleModels, buildFallbackDriftReport };

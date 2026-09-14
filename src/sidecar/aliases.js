/**
 * @module sidecar/aliases
 * `amicus aliases` (#238 D4) — the user's alias map as a standing command.
 *
 *   amicus aliases            list: following / pinned, grouped by vendor
 *   amicus aliases --review   picker over every proposal (aliases-review.js)
 *   amicus aliases --json     versioned document: rows + proposals
 *
 * The LIST reads the catalog CACHE at any age and never networks (§5 display
 * gate); the picker refreshes inline when the cache is stale (write gate).
 * Every form normalizes the config on entry (D6), best-effort.
 */

'use strict';

const { SCHEMA_VERSION } = require('../utils/result-schema-version');
const { DEFAULT_MAX_AGE_MS } = require('../utils/model-catalog');

/** @returns {object} this module's collaborators, gathered so a caller can override them in tests */
function loadDeps() {
  const config = require('../utils/config');
  return {
    config,
    normalizeAliases: require('../utils/alias-state').normalizeAliases,
    listAliasRows: require('../utils/alias-state').listAliasRows,
    buildAliasProposals: require('../utils/alias-proposals').buildAliasProposals,
    readDismissals: require('../utils/alias-store').readDismissals,
    getCatalogInfo: require('../utils/model-catalog').getCatalogInfo,
    readCache: require('../utils/model-catalog').readCache,
    groupAliases: require('../utils/alias-groups').groupAliases,
  };
}

/**
 * Normalize on entry (D6), best-effort: a read-only config dir never blocks a
 * listing — the in-memory normalized view is used and the failure announced.
 * @returns {object} the user alias map after normalization
 */
function normalizeOnEntry(d) {
  const cfg = d.config.loadConfig();
  const defaults = d.config.getDefaultAliases();
  if (!cfg || !cfg.aliases || typeof cfg.aliases !== 'object') { return {}; }
  const probe = d.normalizeAliases(cfg.aliases, defaults);
  if (probe.removed.length > 0) {
    try { d.config.saveConfig(cfg); }                              // saveConfig prints the Notices
    catch (err) { process.stderr.write(`Notice: could not normalize aliases (${err.message}) — keys left on disk; every alias still resolves to the same id\n`); }
  }
  return probe.aliases;
}

/**
 * @param {{maxAgeMs?: number}} [opts] `Number.POSITIVE_INFINITY` = cache only
 * @returns {Promise<{rows: Array, proposals: Array, catalogInfo: object, catalogAvailable: boolean}>}
 */
async function collectAliasView(opts = {}, d = loadDeps()) {
  const userAliases = normalizeOnEntry(d);
  const defaults = d.config.getDefaultAliases();
  let catalogInfo = { models: [], fetchedAt: null, providerFailures: [] };
  try {
    if (opts.maxAgeMs === Number.POSITIVE_INFINITY) {
      // Display gate (§5): the LIST never networks, even to fill an empty or
      // v1 cache — read whatever is on disk, verbatim, with no freshness
      // check at all. `getCatalogInfo` cannot be reused here: it always
      // calls `getCatalog`, which refreshes (a real fetch) the moment
      // `readCache()` returns null, regardless of `maxAgeMs`.
      const c = d.readCache();
      catalogInfo = {
        models: (c && Array.isArray(c.models)) ? c.models : [],
        fetchedAt: c && typeof c.fetchedAt === 'number' ? c.fetchedAt : null,
        providerFailures: (c && Array.isArray(c.providerFailures)) ? c.providerFailures : [],
      };
    } else {
      // The picker's default-age path (Task 8): a stale cache refreshes inline.
      catalogInfo = await d.getCatalogInfo(opts.maxAgeMs === undefined ? {} : { maxAgeMs: opts.maxAgeMs });
    }
  } catch (err) { process.stderr.write(`Notice: catalog unavailable (${err.message}) — no proposals\n`); }
  const rows = d.listAliasRows(userAliases, defaults);
  const proposals = d.buildAliasProposals({ userAliases, defaults, catalogInfo, dismissed: d.readDismissals() });
  return { rows, proposals, catalogInfo, catalogAvailable: (catalogInfo.models || []).length > 0 };
}

/**
 * F2: the per-row flag names the SPECIFIC reason a proposal exists, instead
 * of a blanket "newer available" that was wrong for two of the three kinds —
 * an ahead-of-shipped pin with no sibling only differs from the shipped pin,
 * and a stale pin with no catalog match at all is gone from the catalog
 * outright, neither of which is "newer available".
 * @param {string[]} reasons a proposal's `reasons` array
 * @returns {string} the row suffix, or '' when called with no reasons
 */
function rowFlag(reasons) {
  if (!reasons || reasons.length === 0) { return ''; }
  if (reasons.includes('newer-sibling')) { return '   ⚠ newer available'; }
  if (reasons.includes('stale')) { return '   ⚠ gone from catalog'; }
  return '   differs from shipped';
}

/** @param {{rows: Array, proposals: Array}} view @param {Function} [groupAliases] injectable for tests; defaults to loadDeps().groupAliases so the published `(view) => string` signature works standalone @returns {string} */
function renderAliasList(view, groupAliases = loadDeps().groupAliases) {
  const byAlias = new Map(view.rows.map(r => [r.alias, r]));
  const proposalByAlias = new Map(view.proposals.map(p => [p.alias, p]));
  const map = { __proto__: null };
  for (const r of view.rows) { map[r.alias] = r.id; }
  const width = Math.max(6, ...view.rows.map(r => r.alias.length));
  const lines = [];
  for (const g of groupAliases(map)) {
    lines.push(`  ${g.label}`);
    for (const key of g.keys) {
      const r = byAlias.get(key);
      const p = proposalByAlias.get(key);
      const flag = p ? rowFlag(p.reasons) : '';
      lines.push(`    ${key.padEnd(width)}  → ${r.id.padEnd(44)} ${r.state}${flag}`);
    }
  }
  lines.push('');
  // F1: an unavailable catalog cannot be checked for updates at all -- that is
  // a different fact from "checked, nothing found" and must not print the
  // reassuring "nothing to review" line.
  if (!view.catalogAvailable) {
    lines.push('  catalog unavailable — cannot check for updates (amicus models --refresh)');
    return lines.join('\n') + '\n';
  }
  const n = view.proposals.length;
  lines.push(n === 0
    ? '  nothing to review — amicus aliases --review'
    : `  ${n} to review — amicus aliases --review`);
  // F1: the catalog is available but stale -- name its age so a user who
  // never runs --review still learns the background refresh isn't keeping up.
  const fetchedAt = view.catalogInfo && view.catalogInfo.fetchedAt;
  if (typeof fetchedAt === 'number' && (Date.now() - fetchedAt) > DEFAULT_MAX_AGE_MS) {
    const days = Math.floor((Date.now() - fetchedAt) / DEFAULT_MAX_AGE_MS);
    lines.push(`  (catalog is ${days} day${days === 1 ? '' : 's'} old — amicus models --refresh)`);
  }
  return lines.join('\n') + '\n';
}

/** @returns {object} the `--json` document (fields only ever ADDED within SCHEMA_VERSION) */
function buildAliasesDoc(view) {
  return {
    schemaVersion: SCHEMA_VERSION,
    type: 'aliases',
    catalogAvailable: view.catalogAvailable,
    catalogFetchedAt: view.catalogInfo.fetchedAt || null,
    aliasCount: view.rows.length,
    aliases: view.rows,
    proposalCount: view.proposals.length,
    proposals: view.proposals,
  };
}

/**
 * `amicus aliases --unpin <name>` (#238 F6, R1): "unpin" and "delete" are one
 * operation -- remove the key -- whose meaning is decided by whether the
 * name is curated (D1).
 * @param {string} name @returns {number} exit code
 */
function handleUnpin(name) {
  const { removeAlias } = require('../utils/alias-store');
  const { isCurated } = require('../utils/alias-state');
  const defaults = require('../utils/config').getDefaultAliases();
  if (!removeAlias(name)) {
    process.stderr.write(`Error: '${name}' is not pinned (see: amicus aliases)\n`);
    return 1;
  }
  process.stdout.write(isCurated(name, defaults)
    ? `✓ ${name} now follows the shipped recommendation (${defaults[name]})\n`
    : `✓ ${name} removed\n`);
  return 0;
}

/** @param {object} args parsed CLI args @returns {Promise<number>} exit code */
async function handleAliases(args) {
  if (args.review && (args.json || args.quiet)) {
    process.stderr.write('Error: --review is interactive; use `amicus aliases --json` for machine output\n');
    return 1;
  }
  if (args.unpin !== undefined) {
    if (args.review || args.json) {
      process.stderr.write('Error: --unpin cannot be combined with --review or --json\n');
      return 1;
    }
    if (typeof args.unpin !== 'string') {
      process.stderr.write('Error: --unpin requires an alias name\n');
      return 1;
    }
    return handleUnpin(args.unpin);
  }
  if (args.review) { return require('./aliases-review').runReview(args); }
  const d = loadDeps();
  const view = await collectAliasView({ maxAgeMs: Number.POSITIVE_INFINITY }, d);
  if (args.json) {
    process.stdout.write(JSON.stringify(buildAliasesDoc(view), null, 2) + '\n');
    return 0;
  }
  process.stdout.write(renderAliasList(view, d.groupAliases));
  return 0;
}

module.exports = { handleAliases, collectAliasView, renderAliasList, buildAliasesDoc, loadDeps };

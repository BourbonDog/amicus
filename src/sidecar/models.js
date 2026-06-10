/**
 * `amicus models` (F5) — list/search the catalog, refresh it, audit aliases.
 *
 *   amicus models                  list (curated aliases marked)
 *   amicus models --search <q>     substring filter over id+name
 *   amicus models --refresh        force-refresh the cache
 *   amicus models --check          stale-alias audit (exit = stale count, max 100)
 *   --json on all of the above     versioned documents (result-schema)
 *
 * Returns an exit code; bin/amicus.js plumbs it like fanout's.
 */

'use strict';

const { getCatalogInfo, refreshCatalog, catalogPath } = require('../utils/model-catalog');
const { collectAliasSources, findStaleAliases, suggestReplacements } = require('../utils/alias-audit');
const { buildCatalogDoc, buildAuditDoc } = require('../utils/result-schema');

const CHECK_EXIT_CAP = 100;

/** '0.000003' per token → '3.00' per Mtok; '—' when unknown */
function perMtok(perToken) {
  if (perToken === null || perToken === undefined) { return '—'; }
  const n = Number(perToken);
  return Number.isNaN(n) ? '—' : (n * 1e6).toFixed(2);
}

function fmtRow(m, aliasesById) {
  const alias = aliasesById.get(m.id);
  const aliasCol = alias ? `[${alias}] ` : '';
  const ctx = m.contextLength ?? '—';
  const pIn = perMtok(m.pricing && m.pricing.prompt);
  const pOut = perMtok(m.pricing && m.pricing.completion);
  return `${aliasCol}${m.id}\n    ${m.name}  ctx ${ctx}  $/Mtok in ${pIn} out ${pOut}`;
}

/** alias marks: id → comma-joined alias names (defaults only — the curated view) */
function aliasMarks() {
  const { getDefaultAliases } = require('../utils/config');
  const map = new Map();
  for (const [alias, model] of Object.entries(getDefaultAliases())) {
    map.set(model, map.has(model) ? `${map.get(model)},${alias}` : alias);
  }
  return map;
}

async function runList(args) {
  const { models, fetchedAt } = await getCatalogInfo();
  const q = typeof args.search === 'string' ? args.search.toLowerCase() : null;
  const filtered = q
    ? models.filter(m => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
    : models;
  if (args.json) {
    process.stdout.write(JSON.stringify(buildCatalogDoc({
      models: filtered, fetchedAt, search: q
    }), null, 2) + '\n');
    return 0;
  }
  const marks = aliasMarks();
  // Curated (alias-marked) rows first, then the rest.
  const curated = filtered.filter(m => marks.has(m.id));
  const rest = filtered.filter(m => !marks.has(m.id));
  for (const m of [...curated, ...rest]) {
    process.stdout.write(fmtRow(m, marks) + '\n');
  }
  const when = fetchedAt ? new Date(fetchedAt).toISOString() : 'never';
  process.stdout.write(`(${filtered.length} models, catalog fetched ${when})\n`);
  if (filtered.length === 0 && models.length === 0) {
    process.stdout.write('Catalog unavailable (offline or first run) — try: amicus models --refresh\n');
  }
  return 0;
}

async function runRefresh(args) {
  const models = await refreshCatalog();
  if (args.json) {
    process.stdout.write(JSON.stringify(buildCatalogDoc({
      models, fetchedAt: Date.now(), refreshed: true
    }), null, 2) + '\n');
    return 0;
  }
  process.stdout.write(`Refreshed catalog: ${models.length} models.\n`);
  process.stdout.write(`Cache: ${catalogPath()}\n`);
  return 0;
}

async function runCheck(args) {
  const { models: catalog } = await getCatalogInfo();
  if (!catalog || catalog.length === 0) {
    if (args.json) {
      process.stdout.write(JSON.stringify(buildAuditDoc({
        stale: [], catalogAvailable: false
      }), null, 2) + '\n');
    } else {
      process.stdout.write('Catalog unavailable (offline or no providers reachable); cannot check.\n');
    }
    return 0;
  }
  const sources = collectAliasSources();
  const stale = findStaleAliases(sources, catalog)
    .map(s => ({ ...s, suggestions: suggestReplacements(s.model, catalog) }));
  if (args.json) {
    process.stdout.write(JSON.stringify(buildAuditDoc({
      stale, catalogAvailable: true
    }), null, 2) + '\n');
    return Math.min(stale.length, CHECK_EXIT_CAP);
  }
  if (stale.length === 0) {
    process.stdout.write(`All aliases resolve to catalog models (${sources.length} checked).\n`);
    return 0;
  }
  for (const s of stale) {
    process.stdout.write(`STALE: ${s.alias} -> ${s.model} (${s.source})\n`);
    if (s.suggestions.length > 0) {
      process.stdout.write(`  candidates: ${s.suggestions.join(', ')}\n`);
      process.stdout.write(`  fix: amicus setup --add-alias ${s.alias}=${s.suggestions[0]}\n`);
    } else {
      process.stdout.write('  no same-vendor candidates in catalog\n');
    }
  }
  return Math.min(stale.length, CHECK_EXIT_CAP);
}

/** @param {object} args parsed CLI args @returns {Promise<number>} exit code */
async function handleModels(args) {
  if (args.refresh) { return runRefresh(args); }
  if (args.check) { return runCheck(args); }
  return runList(args);
}

module.exports = { handleModels };

#!/usr/bin/env node
/**
 * Refresh / inspect the OpenRouter model catalog (F3 #18, backs the
 * `refresh-models`, `models:info`, `models:check` npm scripts).
 *
 *   node scripts/refresh-model-capabilities.js          # refresh the cache
 *   node scripts/refresh-model-capabilities.js --info    # print cached models
 *   node scripts/refresh-model-capabilities.js --check    # report stale aliases
 */

const { refreshCatalog, getCatalog } = require('../src/utils/model-catalog');
const { getDefaultAliases } = require('../src/utils/config');

/** @returns {Promise<number>} count of models refreshed */
async function runRefresh() {
  const models = await refreshCatalog();
  process.stdout.write(`Refreshed catalog: ${models.length} models.\n`);
  return models.length;
}

/** Print the cached catalog. */
async function runInfo() {
  const models = await getCatalog();
  for (const m of models) { process.stdout.write(`${m.id}\n`); }
  process.stdout.write(`(${models.length} models)\n`);
}

/**
 * Find aliases whose model is absent from the catalog.
 * @param {Object<string,string>} aliases
 * @param {Array<{id:string}>} catalog
 * @returns {Array<{alias:string, model:string}>}
 */
function findStaleAliases(aliases, catalog) {
  const ids = new Set(catalog.map(m => m.id));
  const stale = [];
  for (const [alias, model] of Object.entries(aliases)) {
    if (model.startsWith('openrouter/') && !ids.has(model)) { stale.push({ alias, model }); }
  }
  return stale;
}

/** @returns {Promise<number>} number of stale aliases (process exit code) */
async function runCheck() {
  const catalog = await getCatalog();
  if (catalog.length === 0) {
    process.stdout.write('Catalog unavailable (no API key or offline); cannot check.\n');
    return 0;
  }
  const stale = findStaleAliases(getDefaultAliases(), catalog);
  if (stale.length === 0) {
    process.stdout.write('All default aliases resolve to catalog models.\n');
    return 0;
  }
  for (const s of stale) { process.stdout.write(`STALE: ${s.alias} -> ${s.model}\n`); }
  return stale.length;
}

async function main() {
  const arg = process.argv[2];
  if (arg === '--info') { await runInfo(); return 0; }
  if (arg === '--check') { return runCheck(); }
  await runRefresh();
  return 0;
}

if (require.main === module) {
  main().then((code) => process.exit(code || 0)).catch((err) => {
    process.stderr.write(`refresh-model-capabilities failed: ${err.message}\n`);
    process.exit(1);
  });
}

module.exports = { runRefresh, runInfo, runCheck, findStaleAliases };

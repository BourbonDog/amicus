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
    groupAliases: require('../../electron/setup-ui-alias-groups').groupAliases,
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
    catch (err) { process.stderr.write(`Notice: could not normalize aliases (${err.message}) — continuing with the normalized view\n`); }
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
  try { catalogInfo = await d.getCatalogInfo(opts.maxAgeMs === undefined ? {} : { maxAgeMs: opts.maxAgeMs }); }
  catch (err) { process.stderr.write(`Notice: catalog unavailable (${err.message}) — no proposals\n`); }
  const rows = d.listAliasRows(userAliases, defaults);
  const proposals = d.buildAliasProposals({ userAliases, defaults, catalogInfo, dismissed: d.readDismissals() });
  return { rows, proposals, catalogInfo, catalogAvailable: (catalogInfo.models || []).length > 0 };
}

/** @param {{rows: Array, proposals: Array}} view @param {Function} groupAliases @returns {string} */
function renderAliasList(view, groupAliases) {
  const byAlias = new Map(view.rows.map(r => [r.alias, r]));
  const flagged = new Set(view.proposals.map(p => p.alias));
  const map = { __proto__: null };
  for (const r of view.rows) { map[r.alias] = r.id; }
  const width = Math.max(6, ...view.rows.map(r => r.alias.length));
  const lines = [];
  for (const g of groupAliases(map)) {
    lines.push(`  ${g.label}`);
    for (const key of g.keys) {
      const r = byAlias.get(key);
      const flag = flagged.has(key) ? '   ⚠ newer available' : '';
      lines.push(`    ${key.padEnd(width)}  → ${r.id.padEnd(44)} ${r.state}${flag}`);
    }
  }
  lines.push('');
  const n = view.proposals.length;
  lines.push(n === 0
    ? '  nothing to review — amicus aliases --review'
    : `  ${n} update${n === 1 ? '' : 's'} available — amicus aliases --review`);
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

/** @param {object} args parsed CLI args @returns {Promise<number>} exit code */
async function handleAliases(args) {
  if (args.review && (args.json || args.quiet)) {
    process.stderr.write('Error: --review is interactive; use `amicus aliases --json` for machine output\n');
    return 1;
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

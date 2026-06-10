/**
 * Alias Audit (F5) — report + suggest, never auto-repair.
 *
 * Finds aliases/routes pointing at models absent from the catalog and
 * suggests current same-vendor replacements. Pure functions over inputs;
 * collectAliasSources() does the gathering. Consumed by `amicus models
 * --check` and the npm wrapper scripts.
 */

'use strict';

/** @returns {Array<{alias,model,source}>} every alias mapping we ship or the user set */
function collectAliasSources() {
  const { getDefaultAliases, loadConfig } = require('./config');
  const { listCuratedRoutes } = require('./curated-models');
  const out = [];
  for (const [alias, model] of Object.entries(getDefaultAliases())) {
    out.push({ alias, model, source: 'defaults' });
  }
  const cfg = loadConfig();
  for (const [alias, model] of Object.entries((cfg && cfg.aliases) || {})) {
    if (typeof model === 'string' && model) {
      out.push({ alias, model, source: 'user-config' });
    }
  }
  for (const r of listCuratedRoutes()) {
    out.push({ alias: r.alias, model: r.model, source: `curated-route (${r.provider})` });
  }
  return out;
}

/** Catalog ids grouped by leading provider segment, e.g. 'openrouter', 'google'. */
function idsByProvider(catalog) {
  const map = new Map();
  for (const m of catalog) {
    const provider = m.id.split('/')[0];
    if (!map.has(provider)) { map.set(provider, new Set()); }
    map.get(provider).add(m.id);
  }
  return map;
}

/**
 * Entries whose model is absent from the catalog. A model is only checkable
 * when its provider has rows in the catalog (unkeyed providers never produce
 * false stales). Empty catalog → [] (cannot check).
 * @param {Array<{alias,model,source}>} sources
 * @param {Array<{id:string}>} catalog
 */
function findStaleAliases(sources, catalog) {
  if (!catalog || catalog.length === 0) { return []; }
  const byProvider = idsByProvider(catalog);
  return sources.filter(({ model }) => {
    const provider = model.split('/')[0];
    const ids = byProvider.get(provider);
    if (!ids) { return false; } // provider unverifiable
    return !ids.has(model);
  });
}

/**
 * Same-vendor replacement candidates for a stale model id, ranked by
 * shared-prefix length with the stale id (desc), then id descending so
 * higher version numbers sort first. Deterministic; max n.
 * @param {string} staleModel - e.g. 'openrouter/x-ai/grok-4.1-fast'
 * @param {Array<{id:string}>} catalog
 * @param {number} [n=3]
 * @returns {string[]} candidate ids
 */
function suggestReplacements(staleModel, catalog, n = 3) {
  const vendorPrefix = staleModel.split('/').slice(0, -1).join('/') + '/';
  const sharedLen = (a, b) => {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) { i++; }
    return i;
  };
  return catalog
    .map(m => m.id)
    .filter(id => id.startsWith(vendorPrefix) && id !== staleModel)
    .sort((a, b) =>
      (sharedLen(b, staleModel) - sharedLen(a, staleModel)) || b.localeCompare(a))
    .slice(0, n);
}

module.exports = { collectAliasSources, findStaleAliases, suggestReplacements };

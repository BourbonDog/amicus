/**
 * Quick-pick resolution (wizard Step 2) — resolves each curated family to
 * the current catalog flagship. Setup-time only; runtime alias resolution
 * stays on the static DEFAULT_ALIASES (see curated-models.js).
 *
 * Ranking: numeric-descending over ids; a marker-suffixed variant
 * (-preview/-exp/-beta/-latest/:free) loses ONLY to its own unmarked base,
 * so gemini-3.1-pro-preview still beats the older stable gemini-2.5-pro.
 */

'use strict';

const { getFamilies, toDefaultAliases, toCanonicalDefault, DIVERGENT_VENDORS } = require('./curated-models');

const MARKER_RE = /(-preview|-exp|-beta|-latest|:free)+$/;

/** Numeric-desc comparator; same-base marker variant sorts after its base. */
function compareIdsDesc(a, b) {
  const aBase = a.replace(MARKER_RE, '');
  const bBase = b.replace(MARKER_RE, '');
  if (aBase === bBase && a !== b) {
    if (a === aBase) { return -1; }
    if (b === bBase) { return 1; }
    return a.localeCompare(b, 'en', { numeric: true });
  }
  return b.localeCompare(a, 'en', { numeric: true });
}

/**
 * Newest catalog id under `<nsPrefix><vendorPath>/` whose model segment
 * matches idPattern. nsPrefix is 'openrouter/' or '' (direct rows).
 * @param {string} vendorPath - vendor segment in the OpenRouter namespace,
 *   or the provider name when matching direct-namespace rows (nsPrefix '').
 * @returns {string|null} full catalog id
 */
function pickCurrent(catalog, nsPrefix, vendorPath, idPattern) {
  const prefix = `${nsPrefix}${vendorPath}/`;
  const ids = (Array.isArray(catalog) ? catalog : [])
    .map(m => m && m.id)
    .filter(id => typeof id === 'string' && id.startsWith(prefix))
    .filter(id => idPattern.test(id.slice(prefix.length)));
  if (ids.length === 0) { return null; }
  return ids.sort(compareIdsDesc)[0];
}

/**
 * @param {Array<{id:string}>} catalog
 * @returns {Array<{alias,label,blurb,vendorPath,source:'live'|'fallback',routes:Object<string,string>}>}
 * `routes` may be empty if a family defines no fallback and the catalog has no match.
 */
function resolveQuickPicks(catalog) {
  return getFamilies().map(f => {
    const routes = {};
    let live = false;
    const orPick = pickCurrent(catalog, 'openrouter/', f.vendorPath, f.idPattern);
    if (orPick) { routes.openrouter = orPick; live = true; }
    else if (f.fallback.openrouter) { routes.openrouter = f.fallback.openrouter; }
    for (const p of f.directProviders) {
      const direct = pickCurrent(catalog, '', p, f.idPattern);
      if (direct) { routes[p] = direct; live = true; }
      else if (f.fallback[p]) { routes[p] = f.fallback[p]; }
    }
    return { alias: f.alias, label: f.label, blurb: f.blurb, vendorPath: f.vendorPath, routes,
             source: live ? 'live' : 'fallback' };
  });
}

/**
 * The single route value a wizard may STORE for a resolved quick pick.
 *
 * For a direct-capable vendor the OpenRouter pick is canonicalised to bare
 * `vendor/model` so it stays direct-first via the gateway router — otherwise a
 * fresh `amicus setup` with a live catalog would silently defeat the
 * direct-first default `toDefaultAliases()` establishes.
 *
 * For a DIVERGENT vendor the direct id is never DERIVED from the OpenRouter
 * one: they are different strings, not differently prefixed (OpenRouter serves
 * `anthropic/claude-opus-4.8`, the direct API `anthropic/claude-opus-4-8`).
 * Stripping the prefix there fabricates an id the direct API rejects, which
 * `amicus doctor` then reports as a stale alias. The row's own direct route is
 * used verbatim, falling back to the intact `openrouter/` form when the
 * catalog offered no direct pick. Mirrors the guard already used at
 * `provider-default-picker.js:82,143,220`.
 * @param {{vendorPath?:string, routes?:Object<string,string>}} pick
 * @returns {string|undefined}
 */
function toStorableRoute(pick) {
  const routes = (pick && pick.routes) || {};
  if (pick && DIVERGENT_VENDORS.has(pick.vendorPath)) {
    return routes[pick.vendorPath] || routes.openrouter;
  }
  return toCanonicalDefault(routes.openrouter || Object.values(routes)[0]);
}

/**
 * Seed map for fresh configs: static defaults overlaid with live family
 * routes (cardless aliases stay pinned). See `toStorableRoute` for why the
 * overlaid value is not a raw prefix strip.
 * @returns {Object<string,string>}
 */
function toLiveSeedAliases(catalog) {
  const seeds = toDefaultAliases();
  for (const r of resolveQuickPicks(catalog || [])) {
    if (r.source === 'live' && r.routes.openrouter) {
      const stored = toStorableRoute(r);
      if (stored) { seeds[r.alias] = stored; }
    }
  }
  return seeds;
}

module.exports = { compareIdsDesc, pickCurrent, resolveQuickPicks, toLiveSeedAliases, toStorableRoute };

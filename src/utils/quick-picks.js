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

const { getFamilies, toDefaultAliases } = require('./curated-models');

const MARKER_RE = /(-preview|-exp|-beta|-latest|:free)$/;

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
 * @returns {Array<{alias,label,blurb,source:'live'|'fallback',routes:Object<string,string>}>}
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
    return { alias: f.alias, label: f.label, blurb: f.blurb, routes,
             source: live ? 'live' : 'fallback' };
  });
}

/**
 * Seed map for fresh configs: static defaults overlaid with live family
 * openrouter routes (cardless aliases stay pinned).
 * @returns {Object<string,string>}
 */
function toLiveSeedAliases(catalog) {
  const seeds = toDefaultAliases();
  for (const r of resolveQuickPicks(catalog || [])) {
    if (r.source === 'live' && r.routes.openrouter) { seeds[r.alias] = r.routes.openrouter; }
  }
  return seeds;
}

module.exports = { compareIdsDesc, pickCurrent, resolveQuickPicks, toLiveSeedAliases };

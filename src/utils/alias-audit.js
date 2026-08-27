/**
 * Alias Audit (F5) — report + suggest for most classes; doctor --fix auto-repairs one narrow, mechanically-unambiguous class (B3).
 *
 * Finds aliases/routes pointing at models absent from the catalog and
 * suggests current same-vendor replacements. Pure functions over inputs;
 * collectAliasSources() does the gathering. Consumed by `amicus models
 * --check` and the npm wrapper scripts.
 *
 * `findFabricatedAliasRepairs()` (B3, council review of PR 198) is the one
 * exception to "never auto-repair": it detects the single class `doctor
 * --fix` can safely rewrite unattended -- a bare id `classifyModel` proves
 * `invalid` on the `direct` gateway AND for which the catalog holds an
 * unambiguous OpenRouter twin (`pairAcrossGateways`, never string
 * concatenation) -- still pure detection here; the actual write lives in
 * `doctor-alias-check.js`'s `repairAlias()`. Every OTHER class this module
 * finds (typo, retired model, ambiguous twin, drifted-but-live) stays
 * report-and-suggest only, same as before -- this module does not become a
 * general auto-repair tool.
 */

'use strict';

/**
 * @returns {Array<{alias,model,source}>} every alias mapping we ship or the user set
 * Identical (alias, model) pairs are deduped, first source wins — defaults derive from curated
 * routes, so every default would otherwise double-report. A user --add-alias override creates a
 * distinct user-config row; shipped defaults/curated routes stay audited until curated-models.js
 * itself is updated.
 */
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
  const seen = new Set();
  return out.filter(({ alias, model }) => {
    const key = `${alias} ${model}`;
    if (seen.has(key)) { return false; }
    seen.add(key);
    return true;
  });
}

/** Catalog ids grouped by leading provider segment, e.g. 'openrouter', 'google'. */
function idsByProvider(catalog) {
  const map = new Map();
  for (const m of catalog) {
    if (!(m && typeof m.id === 'string')) { continue; }
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
 *
 * Stale curated-route entries are suppressed when the same alias already has
 * at least one live resolution from any other source. This ensures the
 * suggested `--add-alias` fix actually clears the warning, and prevents
 * permanently unclearable noise when the default openrouter route is live.
 *
 * A stale 'defaults' entry is additionally suppressed when it is the alias's
 * DERIVED direct-form pin (per curated-models.directFormProvenance()) and the
 * alias is either covered live from another source or declares gatewayOnly
 * (v4.6.3 PR1, spec D2) — an AUTHORED defaults pin and user-config rows are
 * never suppressed this way.
 * @param {Array<{alias,model,source}>} sources
 * @param {Array<{id:string}>} catalog
 */
function findStaleAliases(sources, catalog) {
  if (!catalog || catalog.length === 0) { return []; }
  const byProvider = idsByProvider(catalog);
  const isLive = model => {
    const ids = byProvider.get(model.split('/')[0]);
    return ids ? ids.has(model) : null;
  };
  const covered = new Set(
    sources.filter(({ model }) => isLive(model) === true).map(({ alias }) => alias)
  );
  // v4.6.3 PR1 (spec D2). Lazy-required so suites that doMock curated-models
  // for other cases keep working; a stub without the accessor simply gets no
  // suppression (fail-open toward reporting).
  const cm = require('./curated-models');
  const provenance = typeof cm.directFormProvenance === 'function' ? (cm.directFormProvenance() || {}) : {};
  return sources.filter(({ alias, model, source }) => {
    const ids = byProvider.get(model.split('/')[0]);
    if (!ids) { return false; } // provider unverifiable
    if (ids.has(model)) { return false; } // live
    if (source.startsWith('curated-route') && covered.has(alias)) { return false; }
    // A 'defaults' pin that is the alias's DERIVED direct form: its absence
    // from the direct namespace is a routing fact, not staleness, while the
    // alias has live coverage (or declares gatewayOnly). The fix: suggestion
    // this row would otherwise print is a retarget nobody should run — the
    // 2026-08-05 release-gate false positive (v4.6.3 spec §3).
    const prov = provenance[alias];
    if (source === 'defaults' && prov && prov.directForm === 'derived' &&
        (prov.gatewayOnly || covered.has(alias))) { return false; }
    return true;
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
    .filter(m => m && typeof m.id === 'string').map(m => m.id)
    .filter(id => id.startsWith(vendorPrefix) && id !== staleModel)
    .sort((a, b) =>
      (sharedLen(b, staleModel) - sharedLen(a, staleModel)) || b.localeCompare(a, 'en', { numeric: true }))
    .slice(0, n);
}

/**
 * Stored aliases whose target is LIVE in the catalog but no longer what a
 * fresh `amicus setup` would seed today — the v4.6.1 release-gate class
 * (stored `gemini` -> 3.1-flash-lite-preview: still catalog-listed so
 * findStaleAliases passes it, no longer what the family resolves to).
 * Report + suggest only -- unlike `findFabricatedAliasRepairs` below (B3's
 * narrow, mechanically-unambiguous exception), THIS function never
 * auto-repairs: a drifted-but-live target has no single unambiguous
 * "correct" answer to converge on the way a fabricated id does.
 *
 * Only user-config rows are checked (defaults/curated follow the catalog by
 * construction), only for aliases that are quick-pick families (a custom
 * alias has no "current" to drift from), and only when the stored target is
 * itself catalog-live (a dead target is findStaleAliases's finding, not
 * ours). The `current` display value goes through toStorableRoute() — the
 * guarded 4.1.2 helper — never a bare prefix strip (spec D3).
 *
 * Drift membership, however, is NOT a raw compare against that single
 * canonicalized display string. toStorableRoute() canonicalizes a
 * direct-capable vendor's OpenRouter pick down to the bare direct form
 * (e.g. 'google/gemini-3.6-flash'), but a stored alias may legitimately hold
 * the gateway-prefixed form of that SAME model ('openrouter/google/gemini-
 * 3.6-flash' — the exact route pickCurrent/resolveQuickPicks resolves live,
 * and what a STALE fix's own suggestion may have pointed a user to store).
 * Comparing only against the canonicalized string would false-positive that
 * as drift. Instead, a stored row only counts as drift when its model is
 * absent from the family's FULL live route-value set (every value in that
 * family's `routes` map — openrouter form and any direct form together, per
 * resolveQuickPicks) — i.e. it names a genuinely different model, not the
 * same model under a different gateway form.
 * @param {Array<{alias:string,model:string,source:string}>} sources
 * @param {Array<{id:string}>} catalog
 * @returns {Array<{alias:string,stored:string,current:string}>}
 */
function findDriftedStoredAliases(sources, catalogOrInfo) {
  // Council #216 A1/B2/C1: accepts catalogInfo (or a bare array, for existing
  // callers). Passing models WITHOUT providerFailures made this compute the bare
  // direct form for a REJECTED namespace while sidecar/setup.js persists the
  // gateway form -- reporting drift that does not exist, and suggesting a repair
  // that writes back the unservable direct id issue 208 removed.
  const info = Array.isArray(catalogOrInfo) ? { models: catalogOrInfo } : (catalogOrInfo || { models: [] });
  const catalog = info.models || [];
  if (catalog.length === 0) { return []; }
  const { resolveQuickPicks, toStorableRoute } = require('./quick-picks');
  const current = new Map();
  for (const r of resolveQuickPicks(catalog)) {
    if (r.source !== 'live') { continue; }
    const stored = toStorableRoute(r, info);
    if (stored) { current.set(r.alias, { display: stored, routeValues: new Set(Object.values(r.routes)) }); }
  }
  const byProvider = idsByProvider(catalog);
  return sources
    .filter(({ source }) => source === 'user-config')
    .filter(({ model }) => {
      const ids = byProvider.get(model.split('/')[0]);
      return !!(ids && ids.has(model));
    })
    .filter(({ alias, model }) => current.has(alias) && !current.get(alias).routeValues.has(model))
    .map(({ alias, model }) => ({ alias, stored: model, current: current.get(alias).display }));
}

/**
 * B3 (council review of PR 198, issue 195): the narrow, mechanically-
 * unambiguous class of stored alias `doctor --fix` may repair -- a bare
 * `<vendor>/<model>` id in a 'user-config' row (what's actually persisted to
 * `config.aliases`, the only source a repair can rewrite) that
 * `classifyModel` proves `invalid` on the `direct` gateway AND for which the
 * catalog contains an unambiguous OpenRouter twin (`pairAcrossGateways` --
 * never string-concatenation). This is exactly the class the pre-fix
 * v4.8.0 `chooseRowId`/`applyProviderDefault` could persist (an unconditional
 * `openrouter/` strip with no catalog evidence); PR 198's
 * `directFormIfProven` (model-canonicalization.js) now refuses to write it
 * going forward, so this function finds the ones already ON DISK and
 * converges them onto the same OpenRouter-prefixed answer the picker would
 * offer today, rather than inventing a third one.
 *
 * Deliberately narrower than findStaleAliases: a typo'd, retired, or
 * user-invented id also classifies `invalid`, but `pairAcrossGateways` can
 * only find a twin when the extracted vendor + version token names a REAL
 * model that still exists, under that exact normalized name, in the
 * catalog's OpenRouter namespace -- a typo or a genuinely dead model can
 * never satisfy that. Ambiguous (>1 match) or absent twins are left
 * untouched -- still reported as stale by findStaleAliases, never repaired.
 *
 * DIVERGENT_VENDORS (e.g. anthropic) are excluded on purpose:
 * model-canonicalization.js gates that set FIRST and unconditionally, so its
 * predicates never strip a divergent vendor's prefix in the first place --
 * a bare divergent-vendor alias could not have been produced by the bug
 * this repairs, so treating one as fabricated here would be inventing a new
 * class, not converging on the picker's own answer.
 *
 * Empty/absent catalog -> [] : classifyModel can only return 'unknown' with
 * no catalog rows, and 'unknown' never authorises a repair -- no positive
 * evidence, no write.
 * @param {Array<{alias:string,model:string,source:string}>} sources
 * @param {Array<{id:string}>} catalog
 * @returns {Array<{alias:string,oldId:string,newId:string}>}
 */
function findFabricatedAliasRepairs(sources, catalog) {
  if (!catalog || catalog.length === 0) { return []; }
  const { classifyModel } = require('./model-classification');
  const { pairAcrossGateways } = require('./gateway-route-catalog');
  const { DIVERGENT_VENDORS } = require('./curated-models');
  const catalogInfo = { models: catalog };

  const out = [];
  for (const { alias, model, source } of sources) {
    if (source !== 'user-config') { continue; }
    if (typeof model !== 'string' || model.startsWith('openrouter/')) { continue; } // not bare
    const parts = model.split('/');
    if (parts.length < 2) { continue; } // not a <vendor>/<model> shape
    const vendor = parts[0];
    if (DIVERGENT_VENDORS.has(vendor)) { continue; }
    const versionToken = parts.slice(1).join('/');
    if (classifyModel(model, 'direct', catalogInfo) !== 'invalid') { continue; }
    const paired = pairAcrossGateways(vendor, versionToken, catalogInfo);
    if (!paired.openrouter) { continue; } // ambiguous or absent twin -- leave as a warning
    out.push({ alias, oldId: model, newId: paired.openrouter });
  }
  return out;
}

module.exports = {
  collectAliasSources, findStaleAliases, findDriftedStoredAliases, suggestReplacements,
  findFabricatedAliasRepairs,
};

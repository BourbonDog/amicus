'use strict';

/**
 * Suggestion-building for `selection_required` RouteResults, split out of
 * route-launch.js (B2/D3 — the 300-line gate). Pure: no I/O, no requires.
 */

/**
 * Build up to ~6 labeled alternatives for a `selection_required` RouteResult
 * (#61 Task 6.3, spec Decision 10). Pure: reads only the already-parsed
 * descriptor plus the live keys/catalogInfo/gatewayIds the caller already
 * assembled.
 *
 * Two categories, in order:
 *  1. The SAME model via OpenRouter — only when an OpenRouter key is present
 *     AND the OR-namespaced id is actually present in the catalog (never
 *     suggest an id we can't confirm exists). For divergent vendors (e.g.
 *     Anthropic) `descriptor.model` may be the DASH-form direct id, so a
 *     reconstructed `openrouter/<vendor>/<model>` would never match the
 *     catalog's dot-form OR id -- when the caller's `gatewayIds.openrouter`
 *     is available (the catalog-correct form), it is used instead of
 *     reconstructing. Falls back to reconstruction when `gatewayIds` is
 *     absent (non-alias / full-id / non-divergent requests), so behavior
 *     there is unchanged.
 *  2. Up to 5 OTHER models in the same direct vendor namespace (ids starting
 *     `<vendor>/`, excluding the requested id itself and excluding any
 *     `openrouter/`-prefixed rows, which share the `<vendor>/` prefix check
 *     only when vendor === 'openrouter' and are filtered out defensively).
 *
 * @param {{vendor?: string, model?: string}} descriptor parsed Descriptor for
 *   the request that produced the selection_required (canonical or
 *   openrouter-literal — both carry vendor/model)
 * @param {Object<string,boolean>} keys per-provider key-presence map (buildLaunchKeys() shape)
 * @param {{models: Array<{id:string}>}} catalogInfo
 * @param {{direct?: string, openrouter?: string}} [gatewayIds] the same
 *   per-gateway id map resolveRouteForLaunch threads through resolveRoute
 *   (Task 3's bridge for divergent curated aliases); absent for non-alias /
 *   full-id / non-divergent requests
 * @returns {Array<{model:string, gateway:string, note:string}>}
 */
function buildSuggestions(descriptor, keys, catalogInfo, gatewayIds) {
  const suggestions = [];
  const vendor = descriptor && descriptor.vendor;
  const model = descriptor && descriptor.model;
  if (!vendor || !model) { return suggestions; }

  const models = (catalogInfo && Array.isArray(catalogInfo.models)) ? catalogInfo.models : [];
  const requestedDirectId = `${vendor}/${model}`;

  if (keys && keys.openrouter) {
    const orId = (gatewayIds && gatewayIds.openrouter) || `openrouter/${vendor}/${model}`;
    if (models.some(m => m && m.id === orId)) {
      suggestions.push({ model: orId, gateway: 'openrouter', note: 'same model via OpenRouter' });
    }
  }

  const nsPrefix = `${vendor}/`;
  const sameVendor = models.filter(m =>
    m && typeof m.id === 'string' &&
    m.id.startsWith(nsPrefix) &&
    !m.id.startsWith('openrouter/') &&
    m.id !== requestedDirectId
  ).slice(0, 5);
  for (const m of sameVendor) {
    suggestions.push({ model: m.id, gateway: 'direct', note: `${vendor} model` });
  }

  return suggestions.slice(0, 6);
}

/**
 * v4.2 (D10/M24): apply catalog-derived suggestions to a `selection_required`
 * result — EXCEPT for a local vendor, whose suggestions the router already
 * built from the live probe (spec §4.2 point 4: "suggestions = the live list,
 * capped at 6"). buildSuggestions reads only `catalogInfo.models` (the 24 h
 * cache, never `req.localLive`) and hardcodes `gateway:'direct'`, so letting it
 * overwrite a local result ships stale-or-empty rows under the wrong label.
 * @param {Object} result the `selection_required` RouteResult, mutated in place
 */
function applySuggestions(result, { descriptor, keys, catalogInfo, gatewayIds, localProviders }) {
  if (localProviders && descriptor && Object.prototype.hasOwnProperty.call(localProviders, descriptor.vendor)) { return; }
  result.suggestions = buildSuggestions(descriptor, keys, catalogInfo, gatewayIds);
}

module.exports = { buildSuggestions, applySuggestions };

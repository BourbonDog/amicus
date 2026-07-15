/**
 * Tri-state catalog classification (#61).
 * Turns the combined catalog + refresh outcome into valid|invalid|unknown for a
 * (model, gateway) pair. `unknown` NEVER rejects a route — it preserves the
 * existing "empty catalog cannot validate, never block a launch" contract.
 * Pure: the caller passes catalogInfo (from model-catalog.getCatalogInfo()).
 */
'use strict';

/**
 * @param {string} id       exact model id as the user gave it
 * @param {'direct'|'openrouter'} gateway  which namespace to match against
 * @param {{models: Array<{id:string}>, lastRefreshError?: string|null}} catalogInfo
 * @returns {'valid'|'invalid'|'unknown'}
 */
function classifyModel(id, gateway, catalogInfo) {
  const models = (catalogInfo && Array.isArray(catalogInfo.models)) ? catalogInfo.models : [];
  if (models.length === 0) { return 'unknown'; }

  const inOpenRouterNs = (mid) => typeof mid === 'string' && mid.startsWith('openrouter/');
  const namespaceRows = models.filter(m => m && typeof m.id === 'string' &&
    (gateway === 'openrouter' ? inOpenRouterNs(m.id) : !inOpenRouterNs(m.id)));

  // No rows for this namespace -> we cannot assert absence (e.g. provider key
  // absent so its rows were never fetched, or a partial refresh). Unknown.
  if (namespaceRows.length === 0) { return 'unknown'; }

  const present = namespaceRows.some(m => m.id === id);
  return present ? 'valid' : 'invalid';
}

module.exports = { classifyModel };

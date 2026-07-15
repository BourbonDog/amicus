/**
 * Tri-state catalog classification (#61).
 * Turns the combined catalog + refresh outcome into valid|invalid|unknown for a
 * (model, gateway) pair. `unknown` NEVER rejects a route — it preserves the
 * existing "empty catalog cannot validate, never block a launch" contract.
 *
 * Namespace matching is scoped PER-VENDOR, not by a flat openrouter/direct
 * split. The combined catalog always contains a hardcoded Anthropic floor, so
 * a flat "direct" namespace is never empty even when a specific vendor's rows
 * were never fetched (e.g. that provider's /models call was stale or failed).
 * Matching per-vendor means a missing vendor's rows correctly yield `unknown`
 * instead of being masked by the always-present floor rows of another vendor.
 *
 * - gateway === 'direct': vendor = id.split('/')[0]; namespace prefix is
 *   `${vendor}/`, restricted to rows NOT under `openrouter/`.
 * - gateway === 'openrouter': id looks like `openrouter/<vendor>/<model>`, so
 *   vendor = id.split('/')[1]; namespace prefix is `openrouter/${vendor}/`.
 *
 * Pure: the caller passes catalogInfo (from model-catalog.getCatalogInfo()).
 * @param {string} id       exact model id as the user gave it
 * @param {'direct'|'openrouter'} gateway  which namespace to match against
 * @param {{models: Array<{id:string}>, lastRefreshError?: string|null}} catalogInfo
 * @returns {'valid'|'invalid'|'unknown'}
 */
function classifyModel(id, gateway, catalogInfo) {
  const models = (catalogInfo && Array.isArray(catalogInfo.models)) ? catalogInfo.models : [];
  if (models.length === 0) { return 'unknown'; }

  const idParts = typeof id === 'string' ? id.split('/') : [];
  const isOpenRouter = gateway === 'openrouter';
  const vendor = isOpenRouter ? idParts[1] : idParts[0];
  const nsPrefix = isOpenRouter ? `openrouter/${vendor}/` : `${vendor}/`;

  const inNamespace = (mid) => {
    if (typeof mid !== 'string' || !mid.startsWith(nsPrefix)) { return false; }
    return isOpenRouter ? true : !mid.startsWith('openrouter/');
  };
  const namespaceRows = models.filter(m => m && typeof m.id === 'string' && inNamespace(m.id));

  // No rows for this vendor's namespace -> we cannot assert absence (e.g. that
  // provider's key is absent so its rows were never fetched, or a partial
  // refresh). Unknown — never block on a namespace we couldn't populate.
  if (namespaceRows.length === 0) { return 'unknown'; }

  const present = namespaceRows.some(m => m.id === id);
  return present ? 'valid' : 'invalid';
}

module.exports = { classifyModel };

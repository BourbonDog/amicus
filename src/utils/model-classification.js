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
 * Non-authoritative rows (`authoritative: false`, e.g. the hardcoded Anthropic
 * floor-fallback tagged by model-fetcher.js when a keyed live fetch fails or no
 * key is present — see fetchModelsFromProvider('anthropic', key)) cannot assert
 * absence either: if EVERY row in the matched namespace is non-authoritative and
 * the exact id is not among them, a miss returns `unknown`, not `invalid` — the
 * floor is a stale/synthesized list, not a confirmed model roster, so it must
 * never hard-block a launch (#61 4.3). A namespace containing at least one
 * authoritative (live-fetched) row still yields `invalid` on a genuine miss.
 *
 * Pure: the caller passes catalogInfo (from model-catalog.getCatalogInfo()).
 * @param {string} id       exact model id as the user gave it
 * @param {'direct'|'openrouter'} gateway  which namespace to match against
 * @param {{models: Array<{id:string, authoritative?: boolean}>, lastRefreshError?: string|null}} catalogInfo
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
  if (present) { return 'valid'; }

  // Every matched row is a non-authoritative floor-fallback row (never live-
  // fetched) -> a miss cannot be trusted as a confirmed absence. Never block.
  const allNonAuthoritative = namespaceRows.every(m => m.authoritative === false);
  if (allNonAuthoritative) { return 'unknown'; }

  return 'invalid';
}

module.exports = { classifyModel };

/**
 * Direct-first id canonicalization, guarded by `classifyModel`
 * (model-classification.js). Extracted out of `provider-default-picker.js`
 * (issue 195 follow-up, F1/B4 -- council review of PR 198) purely to keep
 * that file under the 300-line size gate; the two function bodies below are
 * an unmodified move, not a rewrite.
 *
 * Two call sites, same predicate (`classifyModel`), opposite defaults --
 * named separately on purpose so neither behavior can be reached by
 * accident (e.g. forgetting to pass an option):
 *
 * - `directFormIfSafe` -- LIST-BUILDING (`chooseRowId`/`canonicalizeResolved`
 *   in provider-default-picker.js, building the picker's row list). With no
 *   catalog evidence either way, a bare policy-routed id is a reasonable
 *   GUESS to offer: optimistic, strips the `openrouter/` prefix unless
 *   `classifyModel` can prove the bare form `invalid`.
 * - `directFormIfProven` -- PERSISTENCE (`applyProviderDefault`, writing
 *   `config.aliases[vendor]`). By the time an id is persisted, the caller
 *   has already handed in whatever prefix it decided on -- that prefix IS
 *   the user's choice, carrying information an empty or absent catalog does
 *   not contradict. Strips only on POSITIVE evidence (`classifyModel`
 *   returns `valid`, i.e. the bare id is an actual catalog row); anything
 *   else -- `unknown` (including a failed/absent catalog fetch, which is
 *   exactly the case that used to silently re-fabricate the id issue 195
 *   fixed) or `invalid` -- preserves the id exactly as given.
 *
 * Both gate `DIVERGENT_VENDORS` FIRST and internally, always returning the
 * input unchanged for one of those vendors (dot vs. dash direct ids, e.g.
 * anthropic) -- a caller cannot reach the optimistic OR the proven strip for
 * a divergent vendor by forgetting to check the set itself.
 */

'use strict';

/*
 * Why `stripGatewayPrefix` (curated-models.js) is not the function to reach for:
 * under its old name `toCanonicalDefault` it read as the CORRECT answer, and three
 * callers took it at its word and persisted ids the direct API may not serve — the
 * wizard's hand-copy `toBareIfDirect`, `toStorableRoute`, and `toDefaultAliases`
 * before it was rewritten. Issue 214 renamed it rather than giving it a
 * `catalogInfo` parameter, because that is circular: it PRODUCES the candidate id
 * that `classifyModel` then checks against the catalog. The evidence check belongs
 * one level up, here. Direct use of the primitive is correct only when normalising
 * two strings before COMPARING them (alias-shadow.js).
 */

const { stripGatewayPrefix, DIVERGENT_VENDORS } = require('./curated-models');
const { classifyModel } = require('./model-classification');

/**
 * @param {string} vendor
 * @param {string} orId an `openrouter/<vendor>/<rest>` id (or already-bare)
 * @param {{models: Array<{id:string, authoritative?: boolean}>}} catalogInfo
 * @returns {string} the bare direct id when not proven invalid, else `orId` unchanged
 */
/**
 * #208: did THIS vendor's direct namespace get ATTEMPTED and REJECTED for the
 * catalog in hand? An empty namespace has two causes and `classifyModel`
 * cannot tell them apart -- it returns 'unknown' for both. "Never fetched"
 * (offline, no key) leaves optimism reasonable; "fetched and refused" means we
 * know nothing about the namespace, and synthesising a direct id out of no
 * knowledge is exactly how `deepseek/deepseek-v4-flash-0731` -- an id no
 * gateway serves -- reached a real user config. Keyed on the VENDOR, never on
 * "any failure": one provider's 401 says nothing about another's namespace.
 * @param {string} vendor
 * @param {{providerFailures?: Array<{provider: string}>}} catalogInfo
 * @returns {boolean}
 */
function namespaceFetchFailed(vendor, catalogInfo) {
  const failures = catalogInfo && catalogInfo.providerFailures;
  return Array.isArray(failures) && failures.some(f => f && f.provider === vendor);
}

/**
 * Vendor segment of an executable id: `openrouter/<vendor>/<rest>` or
 * `<vendor>/<rest>`. Council #216 (A2/B1): both guards below used to key on the
 * CALLER's `vendor` argument while classifyModel derived its own from the id, so
 * a caller passing none -- which toStorableRoute's JSDoc permits
 * (`vendorPath?:string`) -- silently lost the DIVERGENT and namespace-rejection
 * checks while the catalog check kept working. Deriving closes that asymmetry.
 * @param {*} id @returns {string} '' when the id carries no vendor segment
 */
function vendorOfId(id) {
  if (typeof id !== 'string') { return ''; }
  const rest = id.startsWith('openrouter/') ? id.slice('openrouter/'.length) : id;
  const idx = rest.indexOf('/');
  return idx > 0 ? rest.slice(0, idx) : '';
}

function directFormIfSafe(vendor, orId, catalogInfo) {
  const v = vendor || vendorOfId(orId);
  if (DIVERGENT_VENDORS.has(v)) { return orId; }
  const bare = stripGatewayPrefix(orId);
  if (bare === orId) { return orId; } // gateway-only vendor -- no direct integration at all
  // Optimism is only justified when the namespace was never attempted.
  if (namespaceFetchFailed(v, catalogInfo)) { return orId; }
  return classifyModel(bare, 'direct', catalogInfo) === 'invalid' ? orId : bare;
}

/**
 * @param {string} vendor
 * @param {string} orId an `openrouter/<vendor>/<rest>` id (or already-bare)
 * @param {{models: Array<{id:string, authoritative?: boolean}>}} catalogInfo
 * @returns {string} the bare direct id only when PROVEN valid, else `orId` unchanged
 */
function directFormIfProven(vendor, orId, catalogInfo) {
  if (DIVERGENT_VENDORS.has(vendor || vendorOfId(orId))) { return orId; }
  const bare = stripGatewayPrefix(orId);
  if (bare === orId) { return orId; }
  return classifyModel(bare, 'direct', catalogInfo) === 'valid' ? bare : orId;
}

module.exports = { directFormIfSafe, directFormIfProven, namespaceFetchFailed, vendorOfId };

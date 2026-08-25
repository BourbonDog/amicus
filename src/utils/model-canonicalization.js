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

const { toCanonicalDefault, DIVERGENT_VENDORS } = require('./curated-models');
const { classifyModel } = require('./model-classification');

/**
 * @param {string} vendor
 * @param {string} orId an `openrouter/<vendor>/<rest>` id (or already-bare)
 * @param {{models: Array<{id:string, authoritative?: boolean}>}} catalogInfo
 * @returns {string} the bare direct id when not proven invalid, else `orId` unchanged
 */
function directFormIfSafe(vendor, orId, catalogInfo) {
  if (DIVERGENT_VENDORS.has(vendor)) { return orId; }
  const bare = toCanonicalDefault(orId);
  if (bare === orId) { return orId; } // gateway-only vendor -- no direct integration at all
  return classifyModel(bare, 'direct', catalogInfo) === 'invalid' ? orId : bare;
}

/**
 * @param {string} vendor
 * @param {string} orId an `openrouter/<vendor>/<rest>` id (or already-bare)
 * @param {{models: Array<{id:string, authoritative?: boolean}>}} catalogInfo
 * @returns {string} the bare direct id only when PROVEN valid, else `orId` unchanged
 */
function directFormIfProven(vendor, orId, catalogInfo) {
  if (DIVERGENT_VENDORS.has(vendor)) { return orId; }
  const bare = toCanonicalDefault(orId);
  if (bare === orId) { return orId; }
  return classifyModel(bare, 'direct', catalogInfo) === 'valid' ? bare : orId;
}

module.exports = { directFormIfSafe, directFormIfProven };

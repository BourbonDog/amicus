/**
 * @module council/verdict-seats-reviewed
 * #202: the bench-seat census for verdict.json, as a spreadable fragment.
 *
 * ⚠️ EXTRACTED, not shaved — release Constraint 6, and the same 300-line gate
 * that put `verdict-seat-loss.js` in its own leaf: adding this to verdict.js
 * took that file to 313/300. It could not join verdict-seat-loss.js either —
 * that module is pinned to export EXACTLY its two functions.
 *
 * This is the ONE place that decides what "a bench seat" means, so the
 * emit-when-set rule and the role filter cannot drift apart. `of` is every
 * `role:'seat'` row — one per bench seat POST-retry, so a healed seat counts
 * once while its first attempt is `role:'superseded'`; judges, chair and
 * repairs are not bench seats. `reviewed` is those whose leg completed: a
 * `timeout` is not a review any more than an `error` is.
 *
 * A LEAF: it requires nothing, matching its seat-loss sibling.
 */

'use strict';

/**
 * @param {Array<object>|undefined} runStats
 * @returns {{seatsReviewed?: {reviewed: number, of: number}}}
 */
function seatsReviewedOf(runStats) {
  // ⚠️ `Array.isArray`, NOT `runStats || []`. buildVerdict is reachable on
  // externally-supplied records that never touched tally() in-process — the MCP
  // `record` param of mcp-tools.js :: amicus_verdict is `z.record(z.any())`,
  // fully permissive — and this file's own tests hand it `runStats: {}`. A
  // truthy non-array sails past `||` and throws on `.filter`, turning a missing
  // census into a crashed verdict build. The closed-literal comment further down
  // makes the same argument about the same caller.
  const seats = (Array.isArray(runStats) ? runStats : []).filter(r => r && r.role === 'seat');
  if (seats.length === 0) { return {}; }
  return { seatsReviewed: {
    reviewed: seats.filter(r => r.status === 'complete').length,
    of: seats.length,
  } };
}

module.exports = { seatsReviewedOf };

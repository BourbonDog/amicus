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
/**
 * Is this runStats row a BENCH seat — something that was asked to review?
 *
 * ⚠️ These are exactly the three roles `seats.js :: buildSeats` mints, and that
 * is the point: it is the producer, so this mirrors it rather than guessing.
 * `role === 'seat'` alone (#219) counted ZERO on a `--lenses` run, where every
 * seat carries `lens:<slug>` — so emit-when-set silently omitted the census from
 * the runs using the richest bench. A critic counts too: it is an adversarial
 * seat, but it reviews.
 *
 * An ALLOWLIST, not a denylist of judge/chair/repair/superseded: a new
 * non-bench role added later must not silently inflate the denominator.
 */
function isBenchRole(role) {
  return role === 'seat' || role === 'critic'
    || (typeof role === 'string' && role.startsWith('lens:'));
}

function seatsReviewedOf(runStats) {
  // ⚠️ `Array.isArray`, NOT `runStats || []`. buildVerdict is reachable on
  // externally-supplied records that never touched tally() in-process — the MCP
  // `record` param of mcp-tools.js :: amicus_verdict is `z.record(z.any())`,
  // fully permissive — and this file's own tests hand it `runStats: {}`. A
  // truthy non-array sails past `||` and throws on `.filter`, turning a missing
  // census into a crashed verdict build. The closed-literal comment further down
  // makes the same argument about the same caller.
  const seats = (Array.isArray(runStats) ? runStats : []).filter(r => r && isBenchRole(r.role));
  if (seats.length === 0) { return {}; }
  return { seatsReviewed: {
    reviewed: seats.filter(r => r.status === 'complete').length,
    of: seats.length,
  } };
}

module.exports = { seatsReviewedOf };

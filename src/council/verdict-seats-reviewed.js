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
 * `unverified` (#242 / spec §5, v4.9.8) is those bench seats whose findings came from a
 * repair of a response with no parseable findings block — the LC-11 flag
 * run-stages.js :: runStage1 sets on the row. The seat stays in `reviewed` (its leg
 * completed) and is counted here too. ALWAYS written once the census is: 0 is a
 * measurement, absence keeps its one meaning. Key order is reviewed / unverified / of —
 * the shape spec §5 names and the council-review check title prints. Not a stub count
 * (study run B2: a real 19,064-byte review with a malformed trailing block carried the
 * flag). A refused repair (`repairRefused`) is NOT counted: that seat tallied no findings
 * at all, and the report's `repair-refused` row says so.
 *
 * `unverified ⊆ reviewed` and "bench rows only" are STRUCTURAL (council #248 round 1, B1/C2/D2):
 * `isUnverifiedSeat` requires a bench role, `status: 'complete'` and the literal `true`, and
 * report-lost-rows.js :: lostRowsOf uses that same function — so the census and the report agree
 * on every input, engine-written or hand-assembled, and `unverified` can never exceed `reviewed`.
 * On engine-written records the gate is a no-op: run-launch.js :: materializeReviews drops every
 * non-complete leg before a repair can run, and seats.js :: buildSeats / run-stages.js :: roleFor
 * mint only bench roles (V6/V14 show why hand-assembled records reach buildVerdict at all).
 *
 * A LEAF: it requires nothing, matching its seat-loss sibling.
 */

'use strict';

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

/**
 * The ONE predicate for "this row is an unverified review", shared with
 * report-lost-rows.js :: lostRowsOf so the census and the report can never disagree
 * (council #248 round 1, B1/C2/D2: `unverified` counted flagged rows regardless of
 * status, so a hand-assembled or MCP record could publish `reviewed 0 · unverified 1`
 * and CI would print `seats 0/1 (1 unverified)`). STRUCTURAL, not producer trust: a
 * bench role, a COMPLETED leg, and the literal `true` tally.js emits. A flagged row that
 * is not a completed bench seat is an unverified review of nothing — counted nowhere and
 * rendered nowhere; a real dead leg has the sink's own dead-leg row. `unverified` can
 * therefore never exceed `reviewed` (V15/V16). Named mutant: SUBSETBLIND
 * (`&& r.status === 'complete'` deleted from this function).
 */
function isUnverifiedSeat(r) {
  return !!r && typeof r === 'object' && isBenchRole(r.role)
    && r.status === 'complete' && r.findingsUnverified === true;
}

/** Its sibling for a refused repair: the same gate, and `repairRefused` a plain object. */
function isRefusedSeat(r) {
  return !!r && typeof r === 'object' && isBenchRole(r.role) && r.status === 'complete'
    && !!r.repairRefused && typeof r.repairRefused === 'object' && !Array.isArray(r.repairRefused);
}

/**
 * @param {Array<object>|undefined} runStats
 * @returns {{seatsReviewed?: {reviewed: number, unverified: number, of: number}}}
 */
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
    // The shared predicate (isUnverifiedSeat above): `=== true` matching tally.js's
    // emit-when-true (V14), a completed leg (V15/V16). Named mutants: CENSUSZERO
    // (`unverified: 0`) and SUBSETBLIND — tests/council/verdict.test.js.
    unverified: seats.filter(isUnverifiedSeat).length,
    of: seats.length,
  } };
}

module.exports = { seatsReviewedOf, isBenchRole, isUnverifiedSeat, isRefusedSeat };

// src/council/run-retry-keys.js
'use strict';
// The Stage-1 loss KEYSPACE: seatKey + twinAliases + legLossKey + srcLegClaimer.
// Moved verbatim from run-retry-group.js:23-86 AT 3d8f9d38 (v4.8 Phase 2 T-A1 size-gate
// split, zero behavior). REQUIRE-FREE by design, like ./seats and ./run-stats-entry — it is
// the leaf the loss keyspace hangs from, so no consumer can land on an import cycle.
// run-retry-group.js re-exports all four, so no import path in the tree moved.

/**
 * The one seat-key rule: a seat's id when it was identified, its alias otherwise. Exported
 * so `run-retry-group.js :: recordFailure`, run-retry.js and — since v4.9 W3 (SI-DUP
 * disposition b) — run.js, run-debate-revote.js and run-stage1-rows.js all consume it
 * rather than re-spelling it: readers of one rule that drift apart is how it splits.
 */
const seatKey = (s, alias) => (s ? s.id : alias);

/**
 * The aliases this run's roster proves are REPEATED, mapped to the COUNT of seats holding
 * each — the only evidence that two losses on one alias are two seats and not one seat
 * losing twice, and the BOUND on the slots they mint. No roster means no proof: empty Map.
 *
 * ⚠️ Deliberately NOT `run-retry-group.js :: planStillDeadSources`' own
 * `seatsPerAlias.get(alias) === 1`, and the difference is load-bearing. That rule gates an
 * ANNOUNCEMENT — being wrong costs a duplicate note a reader can see — so with no roster it
 * errs toward announcing. This one gates a RETRY SLOT and a runStats row — being wrong buys
 * a leg for a seat that may not exist — so with no roster it errs toward collapsing, as HEAD
 * always did. ⚠️ That default is the CONSUMER's, not this filter's — with NO roster BOTH spellings
 * give an empty Map. Pinned: run-retry-roster-bound.test.js :: "control: NO roster at all…".
 */
function twinAliases(roster) {
  const n = new Map();
  for (const s of roster || []) { if (s && s.alias) { n.set(s.alias, (n.get(s.alias) || 0) + 1); } }
  return new Map([...n].filter(([, c]) => c > 1));
}

/**
 * A dead LEG's key where `seatKey` alone names N seats at once: an alias the roster
 * repeats, on a leg no binding could identify. v4.8 T2.2 ruling R2 — MINT a
 * distinguisher where one exists, and the leg arms have one: the leg's own `taskId`
 * (`${waveId}-${n}`, src/sidecar/leg-ids.js:15), stamped even on a leg that never
 * routed (`fanout-leg.js:61`), surviving the disk round-trip, distinct through three
 * of the four ways a leg is orphaned. The fourth — NO `taskId` at all — has genuinely
 * nothing and keeps the collapsing key: that is the honest floor, and inventing one
 * would be the guess this keyspace exists to reject.
 *
 * ⚠️ INTERNAL, never rendered: it joins the dead-seat rows, `attemptedSeats` and
 * `deadLegs0`, nothing else. `ff.seat`/`ff.seatId` stay ALIAS-valued — they become
 * `data.seat` / `data.firstFailure.seatId`, which verdict.js compares to `o.critic`
 * and the Workspace renders as a seat id.
 */
function legLossKey(seatObj, alias, leg, twins) {
  const key = seatKey(seatObj, alias);
  if (seatObj || !twins || !twins.has(alias) || !leg || !leg.taskId) { return key; }
  return `${key}\u0000${leg.taskId}`;   // NUL: impossible in an alias, id or taskId
}

/**
 * A STATEFUL claimer over `srcLegs` — build ONE per unit, never reuse it: each call CONSUMES
 * and returns one leg whose key matches, never hands the same leg out twice, and returns null
 * once that key is exhausted (`(key) => leg | null`). It replaces `srcLegs.find(...)`, which
 * returned the FIRST match every time, so two unattributable twins on one alias both recorded
 * the SAME source and the second seat — a leg the run paid for — vanished from stillDeadLegs.
 * Which dead source pairs with which dead outcome is unknowable AND immaterial: every candidate
 * is still dead after its retry, so one apiece yields the exact SET (their rows carry no seat).
 */
function srcLegClaimer(srcLegs, keyOfSrc) {
  const pool = new Set(srcLegs);
  return (key) => {
    for (const l of pool) { if (keyOfSrc(l) === key) { pool.delete(l); return l; } }  // exits on the delete
    return null;
  };
}

module.exports = { seatKey, twinAliases, legLossKey, srcLegClaimer };

// src/council/run-stage1-rows.js
'use strict';
// Superseded-seat rows + primary-error dead-seat rows (v4.7 D2/E4), moved
// verbatim from run-stages.js:230-279 (v4.8 PR0 size-gate split, zero
// behavior). The code ran inline in runStage1; it is now a function.
// roleFor, roleAt and seatOf are PARAMETERS, not requires — requiring them
// back from run-stages would recreate the parent-child cycle that file's tail
// comment documents eliminating (v4.4.1 F5).
const { buildRunStatsEntry } = require('./run-assemble');

/**
 * Push superseded-seat and primary-error dead-seat rows onto extraRows.
 *
 * v4.8 PR2b Task 8: every alias->leg join below is SEAT-keyed. An alias is not
 * a seat identity: two dead twins used to collapse into ONE dead-seat row, and
 * one twin's first leg could be handed to the other twin as its "final" leg.
 *
 * ⚠️ `seatOf` MUST be the Stage-1 ∪ retry union (run-stages.js's `allSeatOf`).
 * `retry.recoveredLegs` and `retry.stillDeadRetryLegs` are RETRY-wave leg
 * objects that Stage-1's own object-keyed map has never seen, so a Stage-1-only
 * map makes every lookup here return undefined and the whole re-key inert.
 *
 * ⚠️ The row's `model` stays the ALIAS (spec §4.7): a seat id must never appear
 * in a ledger row, because pickFallbackChair launches `top.aliases[0]` and
 * 'deepseek#2' is not routable. Two rows both reading `model: 'deepseek'` is
 * the CORRECT outcome for two dead twins; the ledger's (model, resolvedModel)
 * grouping is PR4's job, not this function's.
 */
function pushDeadSeatRows({ o, retry, deadLegs0, stillDeadLegs, stillDeadWaves, extraRows,
  roleFor, roleAt, seatOf }) {
  // A leg's join key: its bound seat's id, else its alias — the same fallback
  // run-retry.js's `seatKey` uses for a roster slot it could not identify, so
  // the two sides of every lookup below agree by construction.
  const keyOf = (leg) => { const s = seatOf.get(leg); return s ? s.id : (leg.modelInput || leg.model); };

  // v4.7 D2/E4 — superseded rows: a leg-origin seat's FIRST leg stops being
  // primary the moment a retry was actually attempted for it, healed or not
  // (deadLegs0 × recovered-or-still-dead seats — mirrors the healed-set idiom
  // above, extended to the still-dead half E4 also requires). A skipped seat
  // (cost ceiling / unmappable — never got a second leg) keeps NO superseded
  // row: nothing replaced it. Wave-origin seats never had a first leg at all,
  // so they can never appear here regardless of healed/dead outcome (E4).
  const supersededKeys = new Set([
    ...retry.recoveredLegs.map(keyOf),
    ...retry.stillDeadLegs.map(keyOf),
  ]);
  for (const dead of deadLegs0) {
    if (supersededKeys.has(keyOf(dead))) {
      extraRows.push(buildRunStatsEntry({ leg: dead, model: dead.modelInput || dead.model,
        role: 'superseded', wasChair: false }));
    }
  }

  // v4.7 D2/E4 — primary error rows: one per SEAT with NO surviving review
  // (every seat still in stillDeadLegs/stillDeadWaves after retry). E5 amended
  // (Task-4 review, owner-ruled): run-retry.js surfaces the real retry leg
  // (stillDeadRetryLegs), from the ONE branch it exists in —
  // retryLegStillDeadNote, a retry leg that came back unusable. Prefer that
  // REAL leg: status/waveId/usage/duration all real, all from the SAME attempt
  // (no more pairing a retry's waveId with a different attempt's status). The
  // other two dead classes — the retry wave died wholesale (srcLegStillDead),
  // and a partial return that never named this seat (missingLegStillDead) —
  // never get a real leg, so `leg: null` (no phantom waveId: one must never
  // appear without a real billed leg).
  const retryLegBySeat = new Map();
  for (const leg of retry.stillDeadRetryLegs) { retryLegBySeat.set(keyOf(leg), leg); }

  const deadSeats = new Map();   // seat key -> { seat, alias }
  for (const l of stillDeadLegs) {
    deadSeats.set(keyOf(l), { seat: seatOf.get(l) || null, alias: l.modelInput || l.model });
  }
  for (const w of stillDeadWaves) {
    // `models` and `seats` are narrowed in LOCKSTEP by run-retry.js's
    // reconcile, so index-zipping them is safe here and nowhere else.
    (w.models || []).forEach((alias, i) => {
      const s = (w.seats || [])[i] || null;
      deadSeats.set(s ? s.id : alias, { seat: s, alias });
    });
  }

  for (const [key, { seat, alias }] of deadSeats) {
    let finalLeg = retryLegBySeat.get(key);
    if (!finalLeg) {
      // `retry.attemptedSeats` — never a scan of stillDeadNotes. Those notes'
      // `data.seat` is ALIAS-valued by contract, so no twin's seat id could
      // ever match one, and this fallback would re-attach a first-attempt leg
      // to a seat that WAS retried. It is also channel-blind on purpose: a
      // still-dead seat rides `dead-leg`, `dead-wave` OR `seat-unbound`
      // depending on how it was lost, and all three mean "we retried it".
      finalLeg = retry.attemptedSeats.has(key)
        ? null                                                    // retried; no leg at all for this seat
        : (deadLegs0.find(l => keyOf(l) === key) || null);        // never retried
    }
    // Seat-space role (spec §4.5), matching the review push in run-stages.js:
    // roleFor's o.models.indexOf hands both lens twins the FIRST twin's lens,
    // buildSeats is positional and does not. An unidentified seat falls back to
    // the alias-space shim, which is what it got before this rev.
    extraRows.push(buildRunStatsEntry({ leg: finalLeg, model: alias,
      role: seat ? roleAt(o.seats, seat.id) : roleFor(o, alias), wasChair: false }));
  }
}

module.exports = { pushDeadSeatRows };

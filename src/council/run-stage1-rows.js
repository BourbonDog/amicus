// src/council/run-stage1-rows.js
'use strict';
// Superseded-seat rows + primary-error dead-seat rows (v4.7 D2/E4), moved
// verbatim from run-stages.js:230-279 (v4.8 PR0 size-gate split, zero
// behavior). The code ran inline in runStage1; it is now a function.
// roleFor and seatOf are PARAMETERS, not requires — requiring them back from
// run-stages would recreate the parent-child cycle that file's tail comment
// documents eliminating (v4.4.1 F5).
const { buildRunStatsEntry } = require('./run-assemble');
// The one keyspace. run-retry-group.js is require-free, so this is a leaf import and
// cannot re-create the parent-child cycle the header above documents eliminating.
const { twinAliases, legLossKey } = require('./run-retry-group');

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
 * 'deepseek#2' is not routable. Two RUNSTATS rows both reading
 * `model: 'deepseek'` remains the CORRECT outcome for two dead twins — runStats
 * is row-per-launch and both seats were paid for. What changed in v4.8 PR4b is
 * downstream: the ledger now groups by (model, resolvedModel), so the LEDGER row
 * count for two dead twins depends on whether their seats produced a leg at all.
 * Two dead twins whose seats produced NO leg (`finalLeg` null — the srcLegStillDead
 * and missingLegStillDead classes below) share the empty resolved key and collapse
 * into ONE ledger row. Two whose still-dead RETRY legs came back resolved
 * DIFFERENTLY still produce TWO, keyed by executable: retryLegBySeat (below)
 * surfaces a real leg, and buildRunStatsEntry stamps `resolvedModel` from
 * `leg.model` whether that leg succeeded or not. Either way runStats keeps two rows.
 */
function pushDeadSeatRows({ o, retry, deadLegs0, stillDeadLegs, stillDeadWaves, extraRows,
  roleFor, seatOf }) {
  // A leg's join key: its bound seat's id, else its alias — the same fallback
  // run-retry.js's `seatKey` uses for a roster slot it could not identify, so
  // the two sides of every lookup below agree by construction.
  const keyOf = (leg) => { const s = seatOf.get(leg); return s ? s.id : (leg.modelInput || leg.model); };
  // v4.8 T2.2 ruling R2, the LEG arms' MINT branch: on an alias the roster repeats, an
  // unbound leg's `keyOf` names BOTH twins, so N dead legs collapsed into ONE row.
  // `legLossKey` falls back to the leg's own taskId there — a real per-leg id, not an
  // inferred seat. It is identical to `keyOf` everywhere else, so only the twin case
  // moves. Deliberately NOT used for supersededKeys or retryLegBySeat above/below:
  // those join FIRST-attempt legs against RETRY legs, two different leg populations
  // whose taskIds can never match, and minting there would silently drop the
  // superseded row of every twin whose retry healed.
  const twins = twinAliases(o.seats);
  const rowKeyOf = (l) => legLossKey(seatOf.get(l) || null, l.modelInput || l.model, l, twins);

  // v4.7 D2/E4 — superseded rows: a leg-origin seat's FIRST leg stops being
  // primary the moment a retry was actually attempted for it, healed or not
  // (deadLegs0 × recovered-or-still-dead seats — mirrors the healed-set idiom
  // above, extended to the still-dead half E4 also requires). A skipped seat
  // (cost ceiling / unmappable — never got a second leg) keeps NO superseded
  // row: nothing replaced it. Wave-origin seats never had a first leg at all,
  // so they can never appear here regardless of healed/dead outcome (E4).
  // ⚠️ v4.8 T2.2 — this is the ONE join in this function still in the ALIAS-granular
  // keyspace, and it stays safe only while a twin alias cannot produce one RETRIED and one
  // SKIPPED leg. Both sides of the join are LEG-origin (`deadLegs0` below, and retry's
  // recovered/still-dead LEG arrays above — a wave-origin seat has no first leg at all and
  // reaches neither), so the shape to rule out is two UNBOUND LEG-origin twins in different
  // retry units. Two facts, read off run-retry.js and run-retry-group.js rather than
  // inferred: (1) skipping is all-or-nothing per UNIT — every skip branch pushes
  // `...unit.srcWaves`/`...unit.srcLegs` wholesale and `continue`s; (2) such twins always
  // share a unit — bench and critic are one unit each, and the deadLegs loop calls
  // `lensIndexOf(o, null, alias, seatObj)` with `seatObj` null when unbound, falling through
  // to `o.models.indexOf(alias)`, first-match, so both resolve to the SAME lens index.
  // (BOUND twins never needed this: their `keyOf` values already differ. And a wave-origin
  // twin CAN land in a different lens unit than its leg-origin sibling — that split is real,
  // it just cannot reach this join.) Break either fact and the skipped twin takes its own
  // first leg as a primary row AND gets a superseded row for it: one billed leg counted
  // twice. Recorded so the next reader need not re-derive it.
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
  // v4.8 T2.2: a still-dead RETRY leg that named no seat on a twin alias cannot be
  // MATCHED to a row — but it was billed, and dropping it hides the spend that this
  // whole change exists to record. Every unattributed row on that alias is equally
  // dead, so they are handed out one apiece below: the SET of billed legs on the
  // record is exact, and no row claims a seat identity (all carry seat: null).
  const retryLegBySeat = new Map();
  const spareRetryLegs = new Map();   // alias -> still-dead retry legs naming no seat
  for (const leg of retry.stillDeadRetryLegs) {
    const alias = leg.modelInput || leg.model;
    if (seatOf.get(leg) || !twins.has(alias)) { retryLegBySeat.set(keyOf(leg), leg); continue; }
    if (!spareRetryLegs.has(alias)) { spareRetryLegs.set(alias, []); }
    spareRetryLegs.get(alias).push(leg);
  }

  // `exact` says the key names ONE seat; `join` is what the lookups below ask with.
  const deadSeats = new Map();   // row key -> { seat, alias, exact, join }
  for (const l of stillDeadLegs) {
    const seat = seatOf.get(l) || null;
    const alias = l.modelInput || l.model;
    const key = rowKeyOf(l);
    deadSeats.set(key, { seat, alias, exact: !!seat || !twins.has(alias), join: key });
  }
  for (const w of stillDeadWaves) {
    // `models` and `seats` are narrowed in LOCKSTEP by run-retry.js's
    // reconcile, so index-zipping them is safe here and nowhere else.
    (w.models || []).forEach((alias, i) => {
      const s = (w.seats || [])[i] || null;
      const join = s ? s.id : alias;
      // R2's MARK branch. This arm has no leg to mint from, and `(waveId, i)` is
      // measurably NOT unique — missingSeatDeadWave emits several records under one
      // waveId each with i === 0, and run-retry.js re-indexes when it narrows a
      // partially healed wave — so inventing an id here would silently merge two
      // distinct seats. A Symbol marks the slot instead: it cannot be joined,
      // compared to a seat id, or mistaken for one, and the row it makes attributes
      // nothing. The ANNOUNCEMENT is the wave's own dead-wave note, whose
      // `data.models`/`data.seats` already carry one entry per slot (PR5c), null for
      // the unnamed ones — which is what a reader sees instead of an id.
      const exact = !!s || !twins.has(alias);
      deadSeats.set(exact ? join : Symbol('unattributed-seat'), { seat: s, alias, exact, join });
    });
  }

  for (const [, { seat, alias, exact, join }] of deadSeats) {
    let finalLeg = exact ? retryLegBySeat.get(join) : undefined;
    if (!finalLeg) {
      // `retry.attemptedSeats` — never a scan of stillDeadNotes. Those notes'
      // `data.seat` is ALIAS-valued by contract, so no twin's seat id could
      // ever match one, and this fallback would re-attach a first-attempt leg
      // to a seat that WAS retried. It is also channel-blind on purpose: a
      // still-dead seat rides `dead-leg`, `dead-wave` OR `seat-unbound`
      // depending on how it was lost, and all three mean "we retried it".
      // ⚠️ v4.8 T2.2: `join` and `attemptedSeats` MUST move in lockstep. run-retry.js
      // adds BOTH spellings (the seat key AND legLossKey's), so a minted row asks a
      // question this Set can answer. Mint here alone and the predicate flips: every
      // retried twin re-acquires its own first-attempt leg — which already has its
      // own `superseded` row above, so that leg's cost lands in runStats twice.
      finalLeg = retry.attemptedSeats.has(join)
        ? (exact ? null : (spareRetryLegs.get(alias) || []).shift() || null)
        : (deadLegs0.find(l => rowKeyOf(l) === join) || null);    // never retried
    }
    // Seat-space role (spec §4.5), matching the review push in run-stages.js:
    // the SEAT's own role, NOT roleAt(o.seats, seat.id) — o.seats is absent on
    // the buildSeats fallback path while the seat is not, so roleAt's unknown-id
    // 'seat' collapses every critic/lens role. Unidentified seats keep the shim.
    // v4.8 PR4c §3.1: `seat` is the seat OBJECT (buildRunStatsEntry compares
    // its id to its own alias) — never `seat.id`, which would make both sides
    // of that comparison undefined and the stamp silently inert. Null here is an
    // orphaned seat: since v4.8 T2.2 two orphaned twins get TWO rows (they are two
    // seats the run paid for), and each correctly carries no seat at all.
    extraRows.push(buildRunStatsEntry({ leg: finalLeg, model: alias, seat,
      role: seat ? seat.role : roleFor(o, alias), wasChair: false }));
  }
}

module.exports = { pushDeadSeatRows };

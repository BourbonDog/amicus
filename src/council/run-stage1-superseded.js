// src/council/run-stage1-superseded.js
'use strict';
// The SUPERSEDED half of the Stage-1 extra rows, lifted out of
// `run-stage1-rows.js :: pushDeadSeatRows` (v4.8 T-A6 size-gate split, zero behaviour): which
// FIRST-attempt legs stop being primary, and the one invariant that join can check for itself.
// A CLOSURE LIFT, not a byte-for-byte move — `keyOf` and `rowKeyOf` stay with the caller,
// because the dead-seat half left behind needs both, so they ride in as parameters. And it
// RETURNS its rows rather than pushing onto the caller's `extraRows`: an extracted helper that
// mutates its caller's accumulator is the shape this release ruled out.
// Its two requires are the two the moved block already had — ./run-assemble and
// ../utils/degrade — so the split added no import edge the tree did not already carry.
// MEASURED, not argued: their eager require closure is 13 first-party modules and contains
// neither run-stages.js nor run-stage1-rows.js nor this file, so the parent-child cycle
// run-stage1-rows.js's own header documents eliminating stays eliminated on this path too.
const { buildRunStatsEntry } = require('./run-assemble');
// v4.8 T-A5: the ONE voice, for the one thing this file can now detect and refuse (below).
// ../utils/degrade requires nothing at all, so this is a leaf import and the cycle the
// header above documents eliminating stays eliminated.
const { formatDegrade } = require('../utils/degrade');
// The announcement must not be defeatable by the caller's sink, so anything that cannot carry it
// falls back to the same sentence on stderr — resolved inside `supersededRows` (see `sink` there),
// never by a parameter default, which substitutes only for `undefined`.
// Nothing on this path may throw — it runs after a whole council has
// already been paid for — so BOTH halves are covered: `formatDegrade` is pure interpolation, and
// the sink's validating `makeDegrade` is deliberately not called; and the write itself is wrapped,
// because a stream can fail even when the string cannot. Same guard, same reason, as the real sink
// (`run-degrade.js :: createDegradeSink`'s `safeEmit` — anchored by symbol; it is the only one).
const STDERR_NOTICE = { note: (r) => {
  try { process.stderr.write(formatDegrade({ ...r, kind: 'degrade' })); } catch { /* EPIPE etc */ }
} };

/**
 * The `superseded` rows for one Stage-1 pass, in `deadLegs0` order.
 *
 * `keyOf` and `rowKeyOf` are the CALLER's — passed in, never re-derived here, and that is the
 * point: this join and the dead-seat rows must ask the SAME keyspace the SAME question. A second
 * spelling of either, or a second `twinAliases` behind `rowKeyOf`, is the desync the mutants
 * DESYNCLEG and DESYNCPLAN pin (see `run-retry-keys.js :: legLossKey` for what the mint buys).
 *
 * @param {object} a.retry      the `retryStage1Losses` return value
 * @param {Array} a.deadLegs0   Stage-1's first-attempt dead legs, in their original order
 * @param {Function} a.keyOf    leg -> its bound seat's id, else its alias (the caller's)
 * @param {Function} a.rowKeyOf leg -> its ROW key, `legLossKey`-minted (the caller's)
 * @param {object} [a.degrade]  the one voice; anything without a callable `.note` — omitted,
 *   null, or malformed — falls back to the stderr notice above
 * @returns {Array<object>} rows for the caller to append — this function appends nothing.
 */
function supersededRows({ retry, deadLegs0, keyOf, rowKeyOf, degrade }) {
  // ⚠️ v4.8 council C1 — resolved HERE, by testing the METHOD, not by a destructuring default.
  // A parameter default substitutes only for `undefined`, so `degrade: null` and `degrade: {}`
  // both reached `degrade.note(...)` and threw a TypeError. MEASURED through this function in
  // the refusal shape below before this line existed: omitted and a real sink returned 1 row,
  // null and a `.note`-less object threw. That was the SECOND throw path in this one guard
  // (round 1 closed the first, an EPIPE from the sink's own write) and it is the one the
  // channel choice at the loop below rules out in words: a throw here aborts a council that
  // has already been paid for, over a row miscount. Not reachable in production — run-stages.js
  // passes `ctx.degrade`, which `run.js` builds with `createDegradeSink`, PROBED to be a
  // `{note, all}` object with a callable `note` — but reachable from any fixture or future
  // caller, which is the only reason a fallback sink exists at all.
  const sink = degrade && typeof degrade.note === 'function' ? degrade : STDERR_NOTICE;
  const rows = [];
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
  // twice.
  // ⚠️ v4.8 T-A5 — and the paragraph above is now the DERIVATION, not the safety. Both facts
  // exist to make ONE statement true: no first leg is SKIPPED while its alias key is superseded.
  // `retry.skippedDeadLegs` states that directly, in leg OBJECTS — the very members of
  // `deadLegs0` the retry declined to attempt — so the test below asks IDENTITY, which no
  // keyspace can blur, at the one place the alias key is relied on. Unreachable while either fact
  // holds (measured over 4000 fuzzed retry runs, 993 of them with skips: 0 hits on the whole
  // shipped condition, all three conjuncts, and 0 on the SKIPPED-and-superseded test alone), so
  // every correct input is byte-identical — and the double count the paragraph above ends on no
  // longer FOLLOWS from breaking a fact: it is refused and announced. Under mutant GUESSPOS the
  // same fuzz hits 85 on both counts; its legs carry taskIds, so row keys are distinct there.
  const skippedLegs = new Set(retry.skippedDeadLegs || []);
  const supersededKeys = new Set([
    ...retry.recoveredLegs.map(keyOf),
    ...retry.stillDeadLegs.map(keyOf),
  ]);
  // Refusing the row is the repair — but ONLY for a leg the dead-seat loop would hand back as its
  // own primary row, which is what `willTakeItsOwnLeg` decides. Since v4.8 T-A6 that loop is the
  // CALLER's (`run-stage1-rows.js :: pushDeadSeatRows`), not this file's — so any "below" naming
  // THAT LOOP points across the boundary (the other two still point inside). run-stages.js merges `skippedDeadLegs`
  // into the `stillDeadLegs` it hands that caller, so a skipped leg IS a still-dead seat there,
  // and that loop's `deadLegs0.find` fallback runs for exactly the keys `attemptedSeats` does NOT
  // hold — and returns ONE leg per key.
  // ⚠️ BOTH conjuncts are load-bearing and BOTH were learned by MEASUREMENT, not argument. The
  // first version of this comment argued the second was unreachable; it was wrong, and the guard
  // built on it lost billed spend (T-A5 rounds 1-3).
  //   `attemptedSeats` half: where the key IS held, R2's taskId-less floor has collapsed the twins
  //   onto one LEG-LESS row, so the superseded row is the only place that leg's `usage` survives.
  //   `=== dead` half: where the key is free but `find` would hand the row a DIFFERENT leg, this
  //   leg gets no row of its own and refusing drops its `usage` entirely. Reachable by breaking
  //   invariant 2 ALONE — `supersededKeys` also draws from `retry.recoveredLegs` just above, and NO
  //   writer of `attemptedSeats` sits on run-retry.js's HEAL branch (they are all on still-dead
  //   paths), so a healed twin supersedes the alias while `attemptedSeats` stays empty.
  // Measured end to end, 3 unbound twins in one lens with invariant 2 broken: row keys COLLIDING —
  // billed 0.60, recorded 0.70 both with this guard and without any guard, nothing lost; row keys
  // DISTINCT — 1.10 without the guard against 0.60 with it, the whole 0.50 double count removed
  // and nothing lost. Dropping either conjunct is a named mutant: WIDEGUARD and KEYNOTLEG.
  // ⚠️ The 0.10 surviving on the COLLIDING shape is the R2 collapse floor, NOT a borrow —
  // INSTRUMENTED, because two earlier versions of this sentence named a path that cannot execute
  // here. The twins share ONE `deadSeats` entry and `attemptedSeats` is empty, so `deadLegs0.find`
  // hands that row the HEALED twin's first leg, which already carries a superseded row: one leg,
  // two rows. Probed at the push site — `finalLeg` is that leg (not null), `borrowed` null, spare
  // pool empty. A borrow needs `attemptedSeats.has(join)` TRUE: the negation of this shape.
  // It is announced either way, because a silently corrected number is the failure mode this join
  // is watched for; a THROW would be wrong here, aborting a paid-for council over a row miscount.
  // Channel `internal` — the runtime disagreed with itself, which is not a seat loss. All FOUR
  // readers of a note's `data.seat` (verdict.js, workspace-seats.js, live-dead-seats.js,
  // workspace/seat-space.js) gate on dead-leg/dead-wave/seat-unbound first, so it reaches none, and it cannot
  // move the exit code either: run-stages.js notes a `dead-leg` degrade for every skipped leg
  // before this function is called, so the run is already degraded whenever this can fire.
  const willTakeItsOwnLeg = (dead) => !retry.attemptedSeats.has(rowKeyOf(dead))
    && deadLegs0.find(l => rowKeyOf(l) === rowKeyOf(dead)) === dead;
  const refuseSupersede = (dead) => {
    const alias = dead.modelInput || dead.model;
    sink.note({ channel: 'internal',
      what: `a superseded row for seat ${alias} was refused`,
      why: 'the retry both SKIPPED this first-attempt leg and superseded its alias key, which the '
        + 'two invariants above forbid — so that key no longer names one outcome',
      effect: 'the leg keeps its primary row and is counted once; the run continues, but the '
        + `superseded/primary split for '${alias}' is no longer trustworthy`,
      data: { seat: alias, taskId: dead.taskId || null } });
  };
  for (const dead of deadLegs0) {
    if (!supersededKeys.has(keyOf(dead))) { continue; }
    if (skippedLegs.has(dead) && willTakeItsOwnLeg(dead)) { refuseSupersede(dead); continue; }
    rows.push(buildRunStatsEntry({ leg: dead, model: dead.modelInput || dead.model,
      role: 'superseded', wasChair: false }));
  }
  return rows;
}

module.exports = { supersededRows };

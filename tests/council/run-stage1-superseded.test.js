// tests/council/run-stage1-superseded.test.js
'use strict';

const rows = require('../../src/council/run-stage1-rows');
const sup = require('../../src/council/run-stage1-superseded');
const { buildSeats } = require('../../src/council/seats');
const { legLossKey } = require('../../src/council/run-retry-keys');

describe('run-stage1-superseded — extraction pins (v4.8 Phase 2 T-A6)', () => {
  test('P1 — the re-export is the SAME function object as the leaf module\'s, not a copy', () => {
    // `supersededRows` was lifted out of `run-stage1-rows.js :: pushDeadSeatRows` and is
    // required back and re-exported, so this file has two independently-reachable import
    // paths for one function and the identity check is not vacuous.
    //
    // Named mutant "COPYSUPERSEDE": in run-stage1-rows.js, drop the
    // `require('./run-stage1-superseded')` and paste the function body back in as a local
    // `supersededRows`. Every behaviour suite in this repo stays green under it — a
    // byte-identical copy is exactly what an identity pin catches and a
    // `typeof === 'function'` check does not. RUN, not asserted: RED on this test alone over
    // `tests/council` (1 failed / 1287 passed / 75 of 76 suites green), reverse-edited by hand
    // and byte-verified against `git show HEAD:src/council/run-stage1-rows.js`.
    //
    // The T-A5 battery was re-run against the MOVED code in the same way, because a lift can
    // silently disarm the guard it carries. All five still RED, each on its own pins, over
    // `tests/council`: TRUSTALIAS 8 tests / 3 suites, WIDEGUARD 2, KEYNOTLEG 1 (the SPEND
    // assertion), MUTESINK 2, NOSAFEEMIT 1 — the same red sets T-A5 recorded before the move.
    expect(rows.supersededRows).toBe(sup.supersededRows);
  });

  test('P2 — the caller appends what the helper RETURNS, in order, ahead of the dead-seat rows', () => {
    // The lift is a closure lift, not a byte-for-byte move: the helper returns its rows and
    // `pushDeadSeatRows` appends them. Two things the split could have broken silently, and
    // neither is visible to a row-count assertion: (a) the superseded rows must still be
    // appended BEFORE the dead-seat rows, because a `superseded` row and its seat's primary
    // row are read positionally nowhere but read in order everywhere a run is rendered; and
    // (b) they must be APPENDED to whatever the caller already had, never replace it —
    // run-stages.js hands in an `extraRows` that already carries the repair rows.
    const SEATS = buildSeats(['deepseek', 'deepseek', 'gpt'], null, null);
    const roleFor = () => 'seat';
    // A test-authored Set, as this file's siblings build one: `legLossKey`'s predicate is
    // `.has()`-shaped, so this is the row key production computes for an unattributable twin.
    const rowKey = (leg) => legLossKey(null, 'deepseek', leg, new Set(['deepseek']));
    const legFor = (slot, amount) => ({ taskId: `r1-s1-${slot}`, waveId: 'r1-s1',
      model: 'deepseek', modelInput: 'deepseek', status: 'error', summary: '', durationMs: null,
      usage: { cost: { amount, source: 'reported' } } });
    const legA = legFor(1, 0.03);
    const legB = legFor(2, 0.05);
    const retry = { recoveredLegs: [], stillDeadLegs: [legA, legB], stillDeadRetryLegs: [],
      skippedDeadLegs: [], attemptedSeats: new Set([rowKey(legA), rowKey(legB)]) };
    const sentinel = { role: 'repair', model: 'gpt' };
    const extraRows = [sentinel];
    rows.pushDeadSeatRows({ o: { seats: SEATS }, retry, deadLegs0: [legA, legB],
      stillDeadLegs: [legA, legB], stillDeadWaves: [], seatOf: new Map(), roleFor, extraRows });
    // The caller's own row is still first and untouched…
    expect(extraRows[0]).toBe(sentinel);
    // …then BOTH superseded rows, in deadLegs0 order, then the dead-seat rows.
    expect(extraRows.map(r => r.role)).toEqual(['repair', 'superseded', 'superseded', 'seat', 'seat']);
    expect(extraRows.slice(1, 3).map(r => r.usage)).toEqual([legA.usage, legB.usage]);
    // Non-vacuity, and the property the lift actually has to keep: calling the helper
    // directly with the SAME keyspace the caller builds returns rows equal to the ones the
    // caller appended — so the helper is what produced them, not a second code path.
    const keyOf = (leg) => leg.modelInput || leg.model;
    const direct = sup.supersededRows({ retry, deadLegs0: [legA, legB], keyOf, rowKeyOf: rowKey });
    expect(direct).toEqual(extraRows.slice(1, 3));
  });
});

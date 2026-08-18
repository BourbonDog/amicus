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

  test('P3 — a null or method-less `degrade` falls back to stderr instead of throwing', () => {
    // Council C1. A destructuring default substitutes only for `undefined`, so `degrade: null`
    // and `degrade: {}` both reached `degrade.note(...)`. MEASURED at 6709ac78 through this very
    // function in the shape below, before the fix: `TypeError: Cannot read properties of null
    // (reading 'note')` and `TypeError: degrade.note is not a function`, against `rows = 1` for
    // an omitted sink and for a real one. A throw HERE is the outcome this guard's own channel
    // choice exists to rule out — see the `internal` paragraph in run-stage1-superseded.js: it
    // would abort a council that has already been paid for, over a row miscount. It was also the
    // SECOND throw path in this one guard; round 1 closed the first (EPIPE from the sink's own
    // write), pinned by NOSAFEEMIT in run-stages.test.js.
    //
    // Named mutant "NULLSINK": in `run-stage1-superseded.js`, delete the `sink` line, put
    // `degrade = STDERR_NOTICE` back in the destructuring default, and restore `degrade.note(`
    // in `refuseSupersede`. RUN, not asserted: RED on this test alone over `tests/council`
    // (1 failed / 1295 passed / 76 of 77 suites green), failing on `TypeError: Cannot read
    // properties of null (reading 'note')` at the `refuseSupersede` call — reverse-edited by hand
    // and byte-verified against `git show HEAD:src/council/run-stage1-superseded.js`.
    // MUTESINK was re-run against this same tree while its prescription was being re-spelled by
    // symbol: 3 failed / 1293 passed — the two T-A5 sink tests plus THIS one, because the stderr
    // half below is exactly what a muted `STDERR_NOTICE` destroys.
    const rowKey = (leg) => legLossKey(null, 'deepseek', leg, new Set(['deepseek']));
    const keyOf = (leg) => leg.modelInput || leg.model;
    const usageA = { cost: { amount: 0.03, source: 'reported' } };
    const usageB = { cost: { amount: 0.05, source: 'reported' } };
    const legFor = (slot, usage) => ({ taskId: `r1-s1-${slot}`, waveId: 'r1-s1',
      model: 'deepseek', modelInput: 'deepseek', status: 'error', summary: '', durationMs: null,
      usage });
    // The T-A5 refusal shape: twin A was SKIPPED while twin B was retried, so the loop refuses
    // A's superseded row and ANNOUNCES — which is what makes `.note` reachable at all here.
    const refusalShape = () => {
      const legA = legFor(1, usageA);
      const legB = legFor(2, usageB);
      return { retry: { recoveredLegs: [], stillDeadLegs: [legB], stillDeadRetryLegs: [],
        skippedDeadLegs: [legA], attemptedSeats: new Set([rowKey(legB)]) },
      deadLegs0: [legA, legB], keyOf, rowKeyOf: rowKey };
    };
    const spy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      // Non-vacuity for every case below: with a REAL sink the refusal really fires, so `.note`
      // really is called on whatever the function resolved — this is not passing on a dead path.
      const noted = [];
      expect(sup.supersededRows({ ...refusalShape(), degrade: { note: (r) => noted.push(r) } })
        .map(r => r.usage)).toEqual([usageB]);
      expect(noted).toHaveLength(1);
      for (const bad of [null, {}, { note: 'not a function' }]) {
        spy.mockClear();
        // The rows are unaffected — a caller's broken sink never costs the repair…
        expect(sup.supersededRows({ ...refusalShape(), degrade: bad }).map(r => r.usage))
          .toEqual([usageB]);
        // …and the announcement is not merely swallowed: it lands in the project's one voice.
        expect(spy.mock.calls.map(c => String(c[0])).join(''))
          .toContain('Notice: a superseded row for seat deepseek was refused');
      }
      // …and the same holds through the CALLER, which forwards `degrade` unchanged — the
      // property run-stage1-rows.js's import comment now claims for a null.
      spy.mockClear();
      const extraRows = [];
      const shape = refusalShape();
      rows.pushDeadSeatRows({ o: { seats: buildSeats(['deepseek', 'deepseek'], null, null) },
        deadLegs0: shape.deadLegs0, stillDeadLegs: shape.deadLegs0, stillDeadWaves: [],
        seatOf: new Map(), roleFor: () => 'seat', extraRows, retry: shape.retry, degrade: null });
      expect(extraRows.filter(r => r.role === 'superseded').map(r => r.usage)).toEqual([usageB]);
      expect(spy.mock.calls.map(c => String(c[0])).join(''))
        .toContain('Notice: a superseded row for seat deepseek was refused');
    } finally { spy.mockRestore(); }
  });
});

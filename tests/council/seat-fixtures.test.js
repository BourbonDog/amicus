// tests/council/seat-fixtures.test.js
'use strict';
// v4.8 PR2a Task 1 Step 5: this suite is the task's real gate — proof that a
// leg shaped like run-stages.test.js's stamped fixtures actually BINDS under
// bindSeats, for both a unique-alias bench and a twin bench. Counting legs or
// asserting only the bind result is not enough: seats.js:133's `mine` filter
// admits a leg with NO waveId field at all (it matches "any" wave), and its
// taskId-prefix match alone can bind it — so a fixture that got taskId right
// but forgot the waveId field would still pass a bind-only check. Each bench
// below asserts `leg.waveId === waveId` explicitly, BEFORE calling bindSeats,
// so a missing waveId is caught here rather than silently passing.
//
// The leg shape is copied verbatim from run-stages.test.js's mkLeg
// (// mirrors run-stages.test.js:23-26) rather than required — local builders
// in a sibling .test.js file are not exported, and importing test internals
// across suites is exactly the coupling this file exists to avoid.
const { buildSeats, bindSeats } = require('../../src/council/seats');

let legSeq = 0;
// mirrors run-stages.test.js:23-26 (mkLeg, post-Task-1 shape: explicit
// waveId/slot -> taskId `${waveId}-${slot}` plus a waveId field; the
// undefined-waveId fallback is unused here — every fixture in this file
// stamps both explicitly, which is the entire point of the gate.
const mkLeg = (model, summary, status, waveId, slot) => ({
  taskId: waveId != null ? `${waveId}-${slot}` : `${model}-${++legSeq}`,
  model, modelInput: model, status, summary,
  durationMs: 1000, usage: { cost: { amount: 0.01, source: 'reported' } },
  ...(waveId != null ? { waveId } : {}),
});

describe('seat-fixtures: engine-shaped legs bind under bindSeats (v4.8 PR2a Task 1 gate)', () => {
  describe('unique-alias bench', () => {
    const models = ['gemini', 'gpt', 'qwen'];
    const seats = buildSeats(models, null, null);
    const waveId = 'abc123-s1';
    // roster order === bench order (run-stage1-launch.js:47), so slot i+1
    // matches seats[i] directly for a unique-alias, critic-free bench.
    const legs = models.map((m, i) => mkLeg(m, `review by ${m}`, 'complete', waveId, i + 1));

    test('every fixture leg carries leg.waveId === waveId (asserted before binding)', () => {
      for (const leg of legs) { expect(leg.waveId).toBe(waveId); }
    });

    test('bindSeats(waveId, roster, legs): full clean bind, no unbound, no orphans', () => {
      const { bound, unbound, orphanLegs } = bindSeats(waveId, seats, legs);
      expect(bound).toHaveLength(seats.length);
      expect(unbound).toEqual([]);
      expect(orphanLegs).toEqual([]);
      expect(bound.map(b => b.seat.alias).sort()).toEqual(['gemini', 'gpt', 'qwen']);
    });

    test('a leg whose taskId names a different wave lands in orphanLegs', () => {
      // seats.js:133's `mine` filter drops a leg stamped with a DIFFERENT
      // waveId entirely — it belongs to that other wave's own bindSeats call,
      // never this one's orphanLegs. To land HERE, taskId must name a foreign
      // wave while the leg carries no waveId field at all — the disk-rebuilt,
      // taskId-only shape seats.js's own doc comment describes.
      const foreign = { ...mkLeg('gemini', 'from the retry wave', 'complete'), taskId: 'abc123-s1r1-1' };
      const { bound, unbound, orphanLegs } = bindSeats(waveId, seats, [...legs, foreign]);
      expect(bound).toHaveLength(seats.length);      // the real roster still binds in full
      expect(unbound).toEqual([]);
      expect(orphanLegs).toEqual([foreign]);          // the foreign-wave leg is the only orphan
    });
  });

  describe('twin bench (deepseek, deepseek)', () => {
    const models = ['deepseek', 'deepseek'];
    const seats = buildSeats(models, null, null); // ids: deepseek#1, deepseek#2
    const waveId = 'abc123-s1';
    const legs = models.map((m, i) => mkLeg(m, `review by ${m} #${i + 1}`, 'complete', waveId, i + 1));

    test('every fixture leg carries leg.waveId === waveId (asserted before binding)', () => {
      for (const leg of legs) { expect(leg.waveId).toBe(waveId); }
    });

    test('bindSeats(waveId, roster, legs): full clean bind, no unbound, no orphans', () => {
      const { bound, unbound, orphanLegs } = bindSeats(waveId, seats, legs);
      expect(bound).toHaveLength(seats.length);
      expect(unbound).toEqual([]);
      expect(orphanLegs).toEqual([]);
    });

    test('the two twin legs bind to DISTINCT seat ids — slot correctness, not alias, separates them', () => {
      // seats.js:141-145's alias fallback fires only when the alias holds
      // EXACTLY ONE seat in the roster; a twin alias holds two, so that path
      // can never resolve either leg. Both legs here bind purely off their
      // taskId's roster-slot suffix — this is the twin case Task 1 exists for.
      const { bound } = bindSeats(waveId, seats, legs);
      const ids = bound.map(b => b.seat.id).sort();
      expect(ids).toEqual(['deepseek#1', 'deepseek#2']);
      expect(new Set(ids).size).toBe(2);
    });

    test('a leg whose taskId names a different wave lands in orphanLegs', () => {
      // Same reasoning as the unique-alias case above: no waveId field, so it
      // is not silently excluded by the `mine` filter before orphaning can see it.
      const foreign = { ...mkLeg('deepseek', 'from the retry wave', 'complete'), taskId: 'abc123-s1r1-1' };
      const { bound, unbound, orphanLegs } = bindSeats(waveId, seats, [...legs, foreign]);
      expect(bound).toHaveLength(seats.length);
      expect(unbound).toEqual([]);
      expect(orphanLegs).toEqual([foreign]);
    });
  });
});

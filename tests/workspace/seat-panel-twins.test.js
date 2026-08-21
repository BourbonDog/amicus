'use strict';

/**
 * v4.8 PR5b — the terminal seat path on a bench that repeats an alias.
 *
 * Since PR1, `--models "deepseek,deepseek"` creates two distinct SEATS (`deepseek#1`,
 * `deepseek#2`). PR5a plumbed the seat through to `derived.cost.rows` (run-detail.js:82,
 * emit-when-set) and left a written handoff naming PR5b as its consumer. This file pins that
 * consumer.
 *
 * ⚠️ Task 1's tests need NO DOM — they call `seatsFromRunStats` directly. The fake-DOM harness
 * belongs to Task 3, which is the only task that renders.
 */

const LS = require('../../electron/workspace-ui/live-seats');

describe('T1 — twin-bench row identity', () => {
  // `seat` is emit-when-set upstream: src/council/run-stats-entry.js :: buildRunStatsEntry stamps
  // it only when `seat.id !== seat.alias`, which seats.js:67 makes true exactly when the bench
  // repeats that alias. So a twin bench carries it and a unique bench does not.
  const twinRows = [
    { model: 'deepseek', seat: 'deepseek#1', role: 'seat', status: 'ok', costDisplay: '$0.01' },
    { model: 'deepseek', seat: 'deepseek#2', role: 'seat', status: 'error', costDisplay: '$0.02' },
  ];

  test('two seats of one alias get DISTINCT ids', () => {
    const ids = LS.seatsFromRunStats(twinRows).map(r => r.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  test('the seat rides through for the Task 2 badge join', () => {
    expect(LS.seatsFromRunStats(twinRows).map(r => r.seat)).toEqual(['deepseek#1', 'deepseek#2']);
  });

  const uniqueRows = [
    { model: 'a', role: 'seat', costDisplay: '$0.01' },
    { model: 'b', role: 'seat', costDisplay: '$0.02' },
  ];

  // CONTROL (preservation) — a distinct-alias bench must stay behaviourally identical, so this is
  // GREEN AT HEAD by construction and its passing is not progress. What makes it a pin rather
  // than decoration is Task 1 Step 5's Mutant 2: dropping the `|| r.model` fallback collapses
  // every id on this bench to `[null,"seat"]` and turns it red. That fallback is the clause
  // keeping unique benches byte-identical (src/council/run-stats-entry.js :: buildRunStatsEntry
  // emits `seat` only for twins).
  //
  // ⚠️ This assertion deliberately does NOT include `seat === null`. Rev 3's first draft folded
  // that in and the "control" went red at HEAD — a preservation pin asserting new behaviour is
  // not a preservation pin. Caught by running it; the two properties live apart now.
  test('CONTROL: a distinct-alias bench keeps injective ids', () => {
    expect(new Set(LS.seatsFromRunStats(uniqueRows).map(r => r.id)).size).toBe(2);
  });

  test('a distinct-alias bench carries no seat (new: the field is emit-when-set upstream)', () => {
    expect(LS.seatsFromRunStats(uniqueRows).map(r => r.seat)).toEqual([null, null]);
  });

  // The F37 debate-role guard is NOT re-tested here — it already exists twice, at
  // tests/workspace/live-model.test.js:99 and tests/workspace/workspace-render.test.js:354.
  // Task 1 Step 6 updates both to the new id spelling. Do not add a third copy.
});

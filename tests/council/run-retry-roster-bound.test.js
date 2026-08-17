'use strict';
// v4.8 Phase 2 T-A3 (round-2 B1) — the retry-slot mint is BOUNDED by the roster.
//
// `recordFailure` minted one retry slot per unattributable loss on a twin alias with no
// upper bound from the roster, so N losses on a 2-seat alias bought N billed retry legs
// for 2 seats. Neither over-count is reachable end-to-end today — a first-pass dead wave
// always carries real seats, and a wave cannot return more legs than it launched — but
// the safety rested entirely on those two facts, which the code never stated or checked.
// Each extra slot buys a real, billed leg for a seat that may not exist.
//
// Every measurement here runs through the REAL `groupStage1Losses` with a roster built by
// the REAL `buildSeats`: a hand-built `o.seats` can pass for the wrong reason (it can hold
// a shape `buildSeats` never produces), and a hand-built unit skips the guard entirely.
//
// Named mutant "NOBOUND": in `run-retry-group.js :: recordFailure`, replace the inexact
// arm `unit.models.filter(m => m === seat).length >= twins.get(seat)` with `false` — the
// pre-T-A3 behaviour. Shapes A and B below go RED at 3 and 4 slots; the three controls
// stay green, which is what makes them controls.
const { groupStage1Losses } = require('../../src/council/run-retry-group');
const { buildSeats } = require('../../src/council/seats');

const TWIN_MODELS = ['deepseek', 'deepseek', 'gpt'];
const twinSeats = () => buildSeats(TWIN_MODELS, null, null);
const twinO = () => ({ runId: 'r1', models: TWIN_MODELS, critic: null, lenses: null,
  seats: twinSeats() });
/** An UNBOUND dead leg on the twin alias — no entry in `seatOf`, so no seat identity. */
const deadTwinLeg = (n) => ({ modelInput: 'deepseek', status: 'error', error: `boom-${n}`,
  taskId: `orphan-${n}` });

describe('T-A3 — the retry-slot mint is bounded by the roster count for the alias', () => {
  test('shape A: 3 unbound dead legs on a 2-seat twin alias mint 2 slots, not 3', () => {
    // Measured before the fix: 3 slots, `['deepseek','deepseek','deepseek']` — a third
    // billed retry leg for a bench that holds exactly two `deepseek` seats.
    const [bench] = groupStage1Losses(twinO(), [],
      [deadTwinLeg('a'), deadTwinLeg('b'), deadTwinLeg('c')], new Map());
    expect(bench.unit).toBe('bench');
    expect(bench.models).toEqual(['deepseek', 'deepseek']);          // 2 seats => 2 slots
    expect(bench.seats).toEqual([null, null]);                       // neither seat is guessed
    expect(bench.firstFailures.map(f => f.reason)).toEqual(['boom-a', 'boom-b']);
    // The SOURCE record is never deduped — srcLegs is the audit trail, and this asserts the
    // bound dropped a SLOT rather than losing the third leg's record outright.
    expect(bench.srcLegs).toHaveLength(3);
  });

  test('shape B: a null-seat dead wave naming the alias twice + 2 unbound legs mint 2 slots, not 4',
    () => {
      // Measured before the fix: 4 slots. The wave arm and the leg arm each minted
      // unbounded on the same alias, so the two carriers summed instead of sharing a bound.
      const w = { waveId: 'r1-s1', models: ['deepseek', 'deepseek'], reason: 'died' };
      const [bench] = groupStage1Losses(twinO(), [w],
        [deadTwinLeg('a'), deadTwinLeg('b')], new Map());
      expect(bench.models).toEqual(['deepseek', 'deepseek']);
      expect(bench.firstFailures.map(f => f.reason)).toEqual(['died', 'died']);
      expect(bench.srcWaves).toHaveLength(1);
      expect(bench.srcLegs).toHaveLength(2);                         // both leg records kept
    });

  test('control: 2 unbound legs on the 2-seat twin alias still mint 2 slots — at the bound, not over it',
    () => {
      // The bound is `>=`, so this is the boundary case in the direction that matters here:
      // unmoved at 2, the shape T2.2 shipped for. If this moved, the fix would have re-collapsed
      // real twins.
      // ⚠️ It does NOT discriminate `>=` from `>` — measured 2026-08-17 (T-A8). Named mutant
      // OFFBYONE (spell the guard `> twins.get(seat)`) reds shape A and shape B above and leaves
      // THIS test green: with only 2 legs for a 2-seat alias the third mint never happens, so both
      // spellings agree. Shape A is what kills the off-by-one; this is the no-regression control.
      const [bench] = groupStage1Losses(twinO(), [], [deadTwinLeg('a'), deadTwinLeg('b')],
        new Map());
      expect(bench.models).toEqual(['deepseek', 'deepseek']);
      expect(bench.firstFailures.map(f => f.reason)).toEqual(['boom-a', 'boom-b']);
    });

  test('control: a UNIQUE alias with 2 losses still mints 1 slot — identity is exact, so it dedups',
    () => {
      const uniq = { runId: 'r1', models: ['a', 'b'], critic: null, lenses: null,
        seats: buildSeats(['a', 'b'], null, null) };
      const l1 = { modelInput: 'a', status: 'error', error: 'boom' };
      const l2 = { modelInput: 'a', status: 'timeout', error: null };
      const [bench] = groupStage1Losses(uniq, [], [l1, l2], new Map());
      expect(bench.models).toEqual(['a']);
      expect(bench.firstFailures.map(f => f.seatId)).toEqual(['a']);
    });

  test('control: NO roster at all, 2 losses on one alias, still mints 1 slot', () => {
    // ⚠️ Load-bearing. With no `o.seats` the Map is empty, `twins.has(alias)` is false,
    // identity is EXACT and the bounded arm is unreachable — so `twins.get(alias)` is never
    // read as `undefined`. `twinAliases`' deliberate "no proof, err toward collapsing" is
    // what this pins: erring the other way would buy a leg for a seat that may not exist.
    const noRoster = { runId: 'r1', models: ['a', 'b'], critic: null, lenses: null };
    const l1 = { modelInput: 'a', status: 'error', error: 'boom' };
    const l2 = { modelInput: 'a', status: 'timeout', error: null };
    const [bench] = groupStage1Losses(noRoster, [], [l1, l2], new Map());
    expect(bench.models).toEqual(['a']);
    expect(bench.firstFailures.map(f => f.seatId)).toEqual(['a']);
  });
});

describe('T-A3 — twinAliases carries the COUNT the bound is stated in', () => {
  test('it maps each repeated alias to its roster count, and holds nothing for a unique one', () => {
    // The Set threw this count away, and without it `recordFailure` cannot state a bound at
    // all. `.has()` is unchanged by the swap, which is why no consumer moved.
    const { twinAliases } = require('../../src/council/run-retry-keys');
    const twins = twinAliases(buildSeats(['deepseek', 'deepseek', 'deepseek', 'gpt'], null, null));
    expect(twins.get('deepseek')).toBe(3);
    expect(twins.has('gpt')).toBe(false);       // unique aliases are absent, as under the Set
    expect(twinAliases(undefined).has('deepseek')).toBe(false);   // no roster, no proof
  });
});

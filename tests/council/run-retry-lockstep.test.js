'use strict';
// v4.8 Phase 2 (PR #171 council round, finding B1) — the retry-slot mint's LOCKSTEP.
//
// `run-retry.js :: retryStage1Losses` mints one launch record per `unit.models[i]` and reads
// `unit.firstFailures[i]` beside it, so slot i must be ONE seat's whole record. The comment at
// that site used to say `recordFailure` "pushes all three together". IT DOES NOT: it pushes
// `unit.firstFailures` UNCONDITIONALLY and `unit.models`/`unit.seats` only `if (trackModel)`
// (`run-retry-group.js :: recordFailure`). The lockstep is EMERGENT, resting on two facts that
// nothing in the code stated or checked — the same objection T-A5 accepted for `supersededKeys`:
//
//   F1  No unit MIXES `trackModel`. Every bench and lens call site passes true; both critic call
//       sites pass false. So a tracking unit grows all three arrays on one call, and the critic
//       unit's `models` never grows at all — it is fixed at creation, length <= 1.
//   F2  The critic unit's INEXACT dedup arm is unreachable, so its `firstFailures` caps at 1.
//       That arm needs a null `criticSeatObj` TOGETHER WITH `twins.has(o.critic)`; `twins` is
//       `twinAliases(o.seats)` and `criticSeatObj` is `(o.seats||[]).find(s => s.alias === o.critic)`,
//       so the same array that proves an alias REPEATED is the one that makes the `find` hit.
//
// MEASURED, never argued. F2's implication is re-measured EXHAUSTIVELY by the last test below on
// every run. F1 and the pairing were measured by instrumenting `recordFailure` across 8000 fuzzed
// rosters: 10561 units, 0 mixed the flag, and all 7085 that survive run-retry.js's skip gate had
// `firstFailures[i].seat === models[i]` and `firstFailures[i].seatId === seatKey(seats[i], ...)`.
//
// (!) The lockstep is NOT universal, and the `-c1` test below pins the counterexample so nobody
// "strengthens" this file into a false claim. With NO `o.critic`, `isCriticWave`'s FIRST disjunct
// still routes a `runId`-suffixed `-c1` wave to the critic unit, whose `models` is
// `o.critic ? [o.critic] : []` — ff 1, models 0. It is the only break 8000 fuzzed rosters
// produced, and it never reaches the mint: run-retry.js skips any unit whose `models.length === 0`.
//
// Named mutants in `run-retry-group.js`, each run against the WHOLE unit tier (538 suites), not
// just this file — the uniqueness claims below are measured, not assumed:
//   MIXFLAG-WAVE   flip the `recordFailure(criticUnit, o.critic, ...)` WAVE call's `trackModel`
//                  false -> true. Breaks F1: `models` grows past `firstFailures`. RED HERE ONLY.
//   MIXFLAG-LEG    the same flip on the `recordFailure(criticUnit, seat, ff, ...)` LEG call. RED
//                  here AND in `run-retry.test.js :: "dead bench legs batch into ONE bench unit;
//                  the critic leg gets its own solo unit"` — this one arm was already covered.
//   INEXACTCRITIC  pass `null` for `criticSeatObj` at both critic calls. Breaks F2: the inexact
//                  arm opens and `firstFailures` grows per unattributable loss. RED HERE ONLY.
const { groupStage1Losses, seatKey, twinAliases } = require('../../src/council/run-retry-group');
const { buildSeats } = require('../../src/council/seats');

const CRITIC = 'deepseek';
const TWIN_MODELS = ['deepseek', 'deepseek', 'gpt'];
const twinCriticO = () => ({ runId: 'r1', models: TWIN_MODELS, critic: CRITIC, lenses: null,
  seats: buildSeats(TWIN_MODELS, CRITIC, null) });
/** An UNBOUND dead leg on the critic's REPEATED alias — no entry in `seatOf`, so no identity. */
const deadCriticLeg = (n) => ({ modelInput: CRITIC, status: 'error', error: `boom-${n}`,
  taskId: `orphan-${n}` });
const criticUnitOf = (units) => units.find(u => u.unit === 'critic');

/** The mint's own read (run-retry.js): slot i's record must be slot i's seat. */
const expectLockstep = (u) => {
  expect(u.firstFailures).toHaveLength(u.models.length);
  u.models.forEach((m, i) => {
    expect(u.firstFailures[i].seat).toBe(m);
    expect(u.firstFailures[i].seatId).toBe(seatKey(u.seats[i] || null, m));
  });
};

describe('B1 — firstFailures stays index-parallel to models/seats for every unit the mint reads', () => {
  test('F2: 3 unbound losses on a REPEATED critic alias mint 1 slot and 1 firstFailure', () => {
    // The exact shape finding B1 alleged could over-append. It cannot: `criticSeatObj` is
    // non-null precisely BECAUSE the roster repeats the alias, so the EXACT arm dedups.
    const units = groupStage1Losses(twinCriticO(), [],
      [deadCriticLeg('a'), deadCriticLeg('b'), deadCriticLeg('c')], new Map());
    const critic = criticUnitOf(units);
    expect(critic.models).toEqual([CRITIC]);
    expect(critic.seats.map(s => s && s.id)).toEqual(['deepseek#1']);
    expect(critic.firstFailures.map(f => f.seatId)).toEqual(['deepseek#1']);   // 1, not 3
    expect(critic.srcLegs).toHaveLength(3);   // the audit trail is never deduped
    expectLockstep(critic);
  });

  test('F2 control: with NO roster the same three losses still mint 1 slot and 1 firstFailure', () => {
    // `twins` is empty with no roster, so this takes the EXACT arm by the other route
    // (`!twins.has(seat)`), keyed by ALIAS. Different reason, same lockstep.
    const o = { runId: 'r1', models: TWIN_MODELS, critic: CRITIC, lenses: null };   // no o.seats
    const critic = criticUnitOf(groupStage1Losses(o, [],
      [deadCriticLeg('a'), deadCriticLeg('b'), deadCriticLeg('c')], new Map()));
    expect(critic.models).toEqual([CRITIC]);
    expect(critic.firstFailures.map(f => f.seatId)).toEqual([CRITIC]);
    expectLockstep(critic);
  });

  test('F1: a critic dead WAVE and a critic dead LEG together still mint 1 slot', () => {
    const wave = { waveId: 'r1-c1', models: [CRITIC], seats: [null], reason: 'no legs' };
    const critic = criticUnitOf(groupStage1Losses(twinCriticO(), [wave],
      [deadCriticLeg('a')], new Map()));
    expect(critic.models).toEqual([CRITIC]);
    expect(critic.srcWaves).toHaveLength(1);
    expect(critic.srcLegs).toHaveLength(1);
    expectLockstep(critic);
  });

  test('F1: bench and lens units grow all three arrays together', () => {
    const seats = buildSeats(TWIN_MODELS, null, null);
    const boundLeg = { modelInput: 'gpt', status: 'error', error: 'boom-g', taskId: 'orphan-g' };
    const seatOf = new Map([[boundLeg, seats[2]]]);
    const wave = { waveId: 'r1-s1', models: ['deepseek', 'gpt'], seats: [seats[0], seats[2]],
      reason: 'no legs' };
    const losses = [deadCriticLeg('a'), boundLeg];
    const [bench] = groupStage1Losses(
      { runId: 'r1', models: TWIN_MODELS, critic: null, lenses: null, seats }, [wave], losses, seatOf);
    expect(bench.unit).toBe('bench');
    expect(bench.models).toEqual(['deepseek', 'gpt', 'deepseek']);   // twin's 2nd slot is minted
    expectLockstep(bench);

    const lenses = ['fast', 'deep', 'cheap'];
    const lensUnits = groupStage1Losses({ runId: 'r1', models: TWIN_MODELS, critic: null, lenses,
      seats: buildSeats(TWIN_MODELS, null, lenses) }, [wave], losses, seatOf);
    expect(lensUnits.every(u => u.unit === 'lens')).toBe(true);
    expect(lensUnits.length).toBeGreaterThan(1);
    for (const u of lensUnits) { expectLockstep(u); }
  });

  test('the ONE measured break: a `-c1` wave with no `o.critic` is ff 1 / models 0', () => {
    // `isCriticWave`'s first disjunct is NOT gated on `o.critic`, so this wave reaches the
    // critic unit whose `models` stayed `[]`. Pinned as-is: run-retry.js's `models.length === 0`
    // skip eats the unit BEFORE the mint reads `firstFailures[i]`. Do NOT "restore symmetry"
    // by seeding `models` — a `[null]` slot would clear that gate and launch a solo with no model.
    const o = { runId: 'r1', models: ['gpt'], critic: null, lenses: null,
      seats: buildSeats(['gpt'], null, null) };
    const critic = criticUnitOf(groupStage1Losses(o,
      [{ waveId: 'r1-c1', models: ['gpt'], reason: 'no legs' }], [], new Map()));
    expect(critic.models).toHaveLength(0);
    expect(critic.firstFailures).toHaveLength(1);
  });

  test('F2 root: no roster gives `twins.has(o.critic)` with a null `criticSeatObj`', () => {
    // EXHAUSTIVE over every roster `buildSeats` mints from a bench of length 0..4 over three
    // aliases, crossed with seven critic values. Both reads below are the LITERAL source
    // expressions from `groupStage1Losses`, so this re-measures F2's implication every run.
    const ALIASES = ['a', 'b', 'c'];
    const benches = [[]];
    for (let len = 1; len <= 4; len++) {
      for (const b of benches.filter(x => x.length === len - 1)) {
        for (const a of ALIASES) { benches.push([...b, a]); }
      }
    }
    let twinCriticCases = 0;
    for (const bench of benches) {
      for (const critic of ['a', 'b', 'c', 'z', undefined, null, '']) {
        const seats = buildSeats(bench, critic, null);
        if (!twinAliases(seats).has(critic)) { continue; }
        twinCriticCases++;
        expect(seats.find(s => s.alias === critic) || null).not.toBeNull();
      }
    }
    expect(benches).toHaveLength(121);        // 1 + 3 + 9 + 27 + 81
    expect(twinCriticCases).toBe(123);        // control: the arm's precondition really does fire
  });
});

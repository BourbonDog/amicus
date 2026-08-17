// tests/council/run-retry-twins-threading.test.js
'use strict';

// v4.8 T-A6 (BACKLOG.md :: SI-TWINS). `twinAliases(o.seats)` used to be derived independently at
// FOUR sites across THREE files. It is now derived ONCE, in `run-retry.js :: retryStage1Losses`,
// and threaded to the other three. Every test below pins the same property from a different
// side: each consumer must USE the collection it is handed, never re-derive one of its own.
//
// ⚠️ Why this needs its own pins at all. A re-derivation from the same roster is EQUAL to the
// threaded value, so on correct input the two are indistinguishable — no fixture can separate
// them. What these tests do instead is hand each consumer a `twins` that DISAGREES with
// `o.seats`, which is exactly the desync shape mutants DESYNCLEG and DESYNCPLAN produce from the
// producer side (defined in run-stages.test.js). A consumer that re-derives ignores the argument
// and its behaviour does not move; a consumer that threads follows the argument.
const { runStage1 } = require('../../src/council/run-stages');
const { retryStage1Losses } = require('../../src/council/run-retry');
const { groupStage1Losses, planStillDeadSources } = require('../../src/council/run-retry-group');
const { pushDeadSeatRows } = require('../../src/council/run-stage1-rows');
const { twinAliases, legLossKey } = require('../../src/council/run-retry-keys');
const { buildSeats } = require('../../src/council/seats');

const SEATS = buildSeats(['deepseek', 'deepseek', 'gpt'], null, null);
const roleFor = () => 'seat';
const orphanLeg = (taskId) => ({ taskId, model: 'deepseek', modelInput: 'deepseek',
  status: 'error', summary: '', durationMs: null, usage: null });

describe('v4.8 T-A6 — one twinAliases derivation, threaded (SI-TWINS)', () => {
  test('pushDeadSeatRows USES the twins it is handed, and still derives one when it is not', () => {
    // Named mutant "THREADDROP": drop `twins` from `pushDeadSeatRows`' destructure and put
    // `const twins = twinAliases(o.seats);` back in the body. The first assertion goes RED —
    // the re-derivation ignores the empty Map and keeps the two rows apart.
    const legs = [orphanLeg('orphan-a'), orphanLeg('orphan-b')];
    const run = (extra) => {
      const extraRows = [];
      pushDeadSeatRows({ o: { seats: SEATS }, deadLegs0: [], stillDeadLegs: legs,
        stillDeadWaves: [], seatOf: new Map(), roleFor, extraRows,
        retry: { recoveredLegs: [], stillDeadLegs: [], stillDeadRetryLegs: [],
          attemptedSeats: new Set() },
        ...extra });
      return extraRows;
    };
    // An EMPTY twins says "this roster repeats no alias", so both unbound legs key by the bare
    // alias and collapse onto ONE row — the pre-T2.2 behaviour, reached only through the
    // argument, because `o.seats` here says the opposite.
    expect(run({ twins: new Map() })).toHaveLength(1);
    // The roster's real answer keeps them apart: two seats the run paid for, two rows.
    expect(run({ twins: twinAliases(SEATS) })).toHaveLength(2);
    // …and omitting it derives the same answer from `o.seats`, for the suites that do.
    expect(run({})).toHaveLength(2);
  });

  test('groupStage1Losses USES the twins it is handed when minting retry slots', () => {
    // Named mutant "THREADDROP-GROUP": re-derive inside `groupStage1Losses` and the first
    // assertion goes RED — the roster-bounded inexact arm mints two slots again.
    const o = { runId: 'r1', seats: SEATS, models: ['deepseek', 'deepseek', 'gpt'] };
    const legs = [orphanLeg('orphan-a'), orphanLeg('orphan-b')];
    const slots = (twins) => {
      const args = [o, [], legs, new Map()];
      const [bench] = groupStage1Losses(...(twins === undefined ? args : [...args, twins]));
      return bench.models.length;
    };
    expect(slots(new Map())).toBe(1);          // "no repeated alias" => the two losses dedup
    expect(slots(twinAliases(SEATS))).toBe(2); // the roster proves two seats => two slots
    expect(slots(undefined)).toBe(2);          // the default derives the same thing
  });

  test('planStillDeadSources USES the twins it is handed when minting the legLossKey spelling', () => {
    // The `attempted` Set is what `run-stage1-rows.js`'s `finalLeg` fallback asks; if its minted
    // spelling is built from a different collection than the row key's, a retried twin
    // re-acquires its own first leg. Named mutant "THREADDROP-PLAN": re-derive inside the
    // function and the second assertion goes RED.
    const leg = orphanLeg('orphan-a');
    const unit = { srcWaves: [], srcLegs: [leg] };
    const twins = twinAliases(SEATS);
    const minted = legLossKey(null, 'deepseek', leg, twins);
    // The NUL is written as the six-character escape, never as a raw byte: one raw NUL turns
    // the whole file into 'Binary file ... matches' for grep -r, which is how a repo-wide
    // phrase sweep was lost earlier in this release.
    expect(minted).toContain('\u0000');        // non-vacuity: the mint really fires here
    expect(planStillDeadSources(unit, new Map(), SEATS, twins).attempted.has(minted)).toBe(true);
    expect(planStillDeadSources(unit, new Map(), SEATS, new Map()).attempted.has(minted))
      .toBe(false);                            // the handed-in collection, not the roster
    expect(planStillDeadSources(unit, new Map(), SEATS).attempted.has(minted)).toBe(true);
  });

  test('the `=== 1` announce rule is NOT the `> 1` twins rule — an off-roster alias still announces', () => {
    // ⚠️ THE DIVERGENCE THIS CONSOLIDATION HAD TO PRESERVE. `planStillDeadSources` keeps its own
    // `seatsPerAlias.get(alias) === 1` and does NOT read `twins` for it. The two rules disagree
    // on an alias the roster does not mention at all — count 0 — where `!twins.has(alias)` is
    // TRUE (no proof of repetition) but `=== 1` is FALSE (no proof of uniqueness either). Here
    // 'ghost' is such an alias: a wave slot and a leg both name it, identity is NOT exact, so
    // the leg is announced rather than deduped against the wave's slot.
    // Named mutant "MERGERULE": replace `seatsPerAlias.get(alias) === 1` with
    // `!twins.has(alias)` — the "just pass one collection in" merge the BACKLOG entry warns
    // about — and this goes RED with `legs` empty: a dead seat silently stops being announced.
    const ghost = { taskId: 'ghost-1', model: 'ghost', modelInput: 'ghost', status: 'error' };
    const unit = { srcWaves: [{ waveId: 'r1-s1', models: ['ghost'], seats: [null] }],
      srcLegs: [ghost] };
    const plan = planStillDeadSources(unit, new Map(), SEATS, twinAliases(SEATS));
    expect(plan.legs.map(x => x.leg)).toEqual([ghost]);
    // Control, same fixture shape on an alias the roster DOES hold exactly once: identity is
    // exact there, so the wave's slot covers it and the leg is deduped away.
    const gpt = { taskId: 'gpt-1', model: 'gpt', modelInput: 'gpt', status: 'error' };
    const unitGpt = { srcWaves: [{ waveId: 'r1-s1', models: ['gpt'], seats: [null] }],
      srcLegs: [gpt] };
    expect(planStillDeadSources(unitGpt, new Map(), SEATS, twinAliases(SEATS)).legs).toEqual([]);
  });

  test('retryStage1Losses publishes its twins, and runStage1 asks with THAT one', () => {
    const o = { runId: 'r1', runDir: '/tmp/nope', seats: SEATS,
      models: ['deepseek', 'deepseek', 'gpt'] };
    return retryStage1Losses({ o, launchers: {} }, {}).then((out) => {
      expect(out.twins).toEqual(twinAliases(SEATS));
      expect(out.twins.get('deepseek')).toBe(2);
      // …and the row side asks with that exact object. This half is a SOURCE pin on purpose and
      // the limitation is disclosed rather than papered over: a re-derivation from the same
      // `o.seats` is EQUAL to `retry.twins`, so no fixture can tell the two apart from outside.
      // Scoped to `runStage1`'s own text (the idiom at run-retry-group-seatkey.test.js :: "P2"),
      // not a whole-file scan, so it is immune to comments and strings elsewhere in the module.
      expect(runStage1.toString()).toMatch(/twins:\s*retry\.twins/);
    });
  });
});

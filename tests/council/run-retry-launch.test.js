// tests/council/run-retry-launch.test.js
'use strict';

const launch = require('../../src/council/run-retry-launch');

describe('run-retry-launch — extraction pins (v4.8 Phase 2 T-A2)', () => {
  test('P1 — retryStage1Losses CALLS this module\'s two exports; an inlined copy would not', async () => {
    // ⚠️ The T-A1 idiom (`expect(grp.seatKey).toBe(keys.seatKey)`) needs TWO independently
    // resolved import paths, and it had one because run-retry-group.js re-exports what it
    // moved. Here there is none: briefingFor and bindRetryWave are private helpers that
    // run-retry.js does NOT re-export, so `require(x) === require(x)` would only pin
    // CommonJS caching — vacuous, green against any copy. The equivalent-strength pin is
    // therefore identity BY EXECUTION: substitute this module on run-retry.js's own
    // require edge and prove the substitute is what actually ran.
    //
    // Named mutant "COPYBRIEF": in run-retry.js drop briefingFor from the require and
    // re-inline the moved definition (restoring `const briefings = require('./briefings')`)
    // — RED here, `calls` loses 'briefingFor'. Named mutant "COPYBIND": re-inline the
    // pad/bind block at the call site — RED here, `calls` loses 'bindRetryWave'. Both
    // mutants leave every behaviour suite in the repo green, which is the whole point.
    //
    // Driven with a retry wave that returns ZERO legs: that path reaches both calls and
    // touches no filesystem (materializeReviews is never entered).
    const calls = [];
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../../src/council/run-retry-launch', () => {
        const real = jest.requireActual('../../src/council/run-retry-launch');
        return {
          briefingFor: (...a) => { calls.push('briefingFor'); return real.briefingFor(...a); },
          bindRetryWave: (...a) => { calls.push('bindRetryWave'); return real.bindRetryWave(...a); },
        };
      });
      jest.doMock('../../src/council/run-state', () => ({ appendStageWave: jest.fn() }));
      const { retryStage1Losses } = require('../../src/council/run-retry');
      const { buildSeats } = require('../../src/council/seats');
      const o = { runId: 'r1', runDir: '/nonexistent-by-design', models: ['a', 'b'],
        critic: null, lenses: null, briefing: 'B', date: 'D', timeout: 5 };
      o.seats = buildSeats(o.models, null, null);
      const ctx = { o, degrade: { note: () => {} }, addWave: () => {}, overBudget: () => false,
        launchers: { launchWave: async () => ({ wave: { waveId: 'r1-s1r1', legs: [] }, exitCode: 0 }),
          launchSolo: async () => ({ wave: { legs: [] }, exitCode: 0 }) } };
      const r = await retryStage1Losses(ctx,
        { deadWaves: [{ waveId: 'r1-s1', models: ['a', 'b'], reason: 'server never started' }] });
      expect(r.stillDeadWaves).toHaveLength(1);   // the drive really ran the unit
    });
    expect(calls).toEqual(['briefingFor', 'bindRetryWave']);
  });

  test('P2 — run-retry.js redeclares neither symbol, so no second copy can drift in', () => {
    // A source-level backstop for the same two mutants, independent of the module
    // graph: the requirer must name this module and must not define its own
    // `briefingFor` or its own `placeholders` Set.
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../../src/council/run-retry.js'), 'utf8');
    expect(src).toContain('} = require(\'./run-retry-launch\');');
    expect(src).not.toMatch(/function briefingFor\s*\(/);
    expect(src).not.toMatch(/const placeholders = new Set\(\)/);
  });

  test('C1a — two unidentified roster slots mint DISTINCT placeholders, so neither leg orphans', () => {
    // Half one of the C1 conjunction (BACKLOG.md's PR #170 round-2 C1). The roster is
    // internal and every placeholder bind is dropped by half two, so uniqueness is
    // observed by its one outward effect: bindSeats dedups on `seat.id`, so a shared id
    // collapses two slots into one and the second leg comes back an ORPHAN.
    // Measured directly against bindSeats before this pin was written:
    // distinct ids -> {bound: 2, orphans: 0}; one shared id -> {bound: 1, orphans: 1}.
    // Named mutant "COLLIDEID": in run-retry-launch.js make the placeholder id
    // `__unbound-${unit.waveId}` (drop the `-${i + 1}` slot suffix) and this goes RED
    // with one orphan; every behaviour suite in the repo stays green.
    const legs = [
      { legId: 'w-1', modelInput: 'deepseek' },
      { legId: 'w-2', modelInput: 'deepseek' },
    ];
    const res = launch.bindRetryWave(
      { seats: [null, null], models: ['deepseek', 'deepseek'], waveId: 'w' }, legs);
    expect(res.orphanLegs).toEqual([]);
    expect(res.retrySeatOf.size).toBe(0);   // both binds are placeholders; both dropped
  });

  test('C1a — padding is POSITION-STABLE: a real seat after a null slot keeps its slot', () => {
    // The other reason the pad exists. seats.js filters falsy roster entries internally,
    // so passing `unit.seats` raw (or a falsy sentinel) slides slot 2 into slot 1 and
    // leg `w-1` binds to the seat that launched in slot 2. Mutant "RAWROSTER": pass
    // `unit.seats` straight to bindSeats — RED here, `retrySeatOf.get(legs[0]) === real`.
    const real = { id: 'gpt', alias: 'gpt', role: 'seat', lens: null, position: 2 };
    const legs = [
      { legId: 'w-1', modelInput: 'deepseek' },
      { legId: 'w-2', modelInput: 'gpt' },
    ];
    const { retrySeatOf } = launch.bindRetryWave(
      { seats: [null, real], models: ['deepseek', 'gpt'], waveId: 'w' }, legs);
    expect(retrySeatOf.get(legs[1])).toBe(real);
    expect(retrySeatOf.get(legs[0])).toBeUndefined();
  });

  test('C1b — placeholder binds NEVER appear in the returned retrySeatOf', () => {
    // Half two of the conjunction. A real seat's bind survives; the placeholder slot's
    // does not, so `retrySeatOf.get(leg)` is always either undefined or a REAL
    // unit.seats entry — never a synthetic `__unbound-` object.
    // Named mutant "NOPLACEHOLDERFILTER": delete the
    // `.filter(b => !placeholders.has(b.seat))` line in run-retry-launch.js and this
    // goes RED with size 2 and an `__unbound-w-2` seat id.
    const real = { id: 'gpt', alias: 'gpt', role: 'seat', lens: null, position: 1 };
    const legs = [
      { legId: 'w-1', modelInput: 'gpt' },
      { legId: 'w-2', modelInput: 'deepseek' },
    ];
    const { retrySeatOf } = launch.bindRetryWave(
      { seats: [real, null], models: ['gpt', 'deepseek'], waveId: 'w' }, legs);
    expect(retrySeatOf.size).toBe(1);
    expect(retrySeatOf.get(legs[0])).toBe(real);
    expect(retrySeatOf.get(legs[1])).toBeUndefined();
    for (const seat of retrySeatOf.values()) { expect(seat.id).not.toMatch(/^__unbound-/); }
  });

  test('C1 — a bench alias literally spelled `__unbound-…` still binds, by IDENTITY', () => {
    // The placeholder set is keyed by object identity, never by an id-name prefix test.
    // A real seat whose id begins `__unbound-` is adversarial but legal, and dropping
    // its bind would be a name-collision channel inside the one mechanism whose whole
    // contract is "never guess". Mutant: swap the filter for
    // `.filter(b => !String(b.seat.id).startsWith('__unbound-'))` — RED here, green
    // everywhere else.
    const real = { id: '__unbound-x#1', alias: '__unbound-x', role: 'seat', lens: null, position: 1 };
    const legs = [{ legId: 'w-1', modelInput: '__unbound-x' }];
    const { retrySeatOf } = launch.bindRetryWave(
      { seats: [real], models: ['__unbound-x'], waveId: 'w' }, legs);
    expect(retrySeatOf.get(legs[0])).toBe(real);
  });

  test('bindRetryWave returns orphan legs instead of mutating a caller accumulator', () => {
    // The signature constraint, pinned: a leg matching no roster slot comes back on the
    // return value, un-wrapped. run-retry.js is what attaches the waveId and pushes.
    const real = { id: 'gpt', alias: 'gpt', role: 'seat', lens: null, position: 1 };
    const legs = [{ legId: 'w-9', modelInput: 'gpt' }];
    const res = launch.bindRetryWave(
      { seats: [real], models: ['gpt'], waveId: 'w' }, legs);
    expect(res.orphanLegs).toEqual([legs[0]]);
    expect(res.retrySeatOf.size).toBe(0);
  });
});

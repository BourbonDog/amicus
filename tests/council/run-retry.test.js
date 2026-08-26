'use strict';
jest.mock('../../src/council/run-state', () => ({ appendStageWave: jest.fn() }));
const runState = require('../../src/council/run-state');
const { groupStage1Losses, retryStage1Losses } = require('../../src/council/run-retry');
const { buildSeats } = require('../../src/council/seats');

// Coordinator-review MINOR-6: the shared mock's call history and any
// per-test mockImplementation (see the 'appendStageWave is called BEFORE...'
// test below) must not leak into the next test.
beforeEach(() => { runState.appendStageWave.mockReset(); });

const O = { runId: 'r1', models: ['a', 'b', 'crit'], critic: 'crit', lenses: null };

describe('groupStage1Losses (SL-2 Task 3)', () => {
  test('empty losses -> no units', () => {
    expect(groupStage1Losses(O, [], [])).toEqual([]);
  });

  test('a dead bench wave becomes one bench retry unit with per-seat wave-class firstFailures', () => {
    const w = { waveId: 'r1-s1', models: ['a', 'b'], reason: 'server never started' };
    const [u] = groupStage1Losses(O, [w], []);
    expect(u).toMatchObject({ unit: 'bench', waveId: 'r1-s1r1', retryOfWaveId: 'r1-s1',
      models: ['a', 'b'], srcWaves: [w], srcLegs: [] });
    // toEqual is exact: every seatId here equals its alias, which IS the
    // byte-identity claim for a unique-alias bench (H4). Pinned, not loosened.
    expect(u.firstFailures).toEqual([
      { seat: 'a', class: 'wave', waveId: 'r1-s1', reason: 'server never started', seatId: 'a' },
      { seat: 'b', class: 'wave', waveId: 'r1-s1', reason: 'server never started', seatId: 'b' },
    ]);
  });

  test('dead bench legs batch into ONE bench unit; the critic leg gets its own solo unit', () => {
    const la = { modelInput: 'a', status: 'error', error: 'boom' };
    const lc = { modelInput: 'crit', status: 'timeout', error: null };
    const units = groupStage1Losses(O, [], [la, lc]);
    expect(units.map(u => u.unit)).toEqual(['bench', 'critic']); // stable order
    expect(units[0]).toMatchObject({ waveId: 'r1-s1r1', retryOfWaveId: 'r1-s1', models: ['a'], srcLegs: [la] });
    expect(units[1]).toMatchObject({ waveId: 'r1-c1r1', retryOfWaveId: 'r1-c1', models: ['crit'], srcLegs: [lc] });
    expect(units[1].firstFailures).toEqual([
      { seat: 'crit', class: 'leg', status: 'timeout', reason: null, seatId: 'crit' }]);
  });

  test('a dead critic WAVE maps to the critic unit by waveId or by model (both carriers)', () => {
    const byId = groupStage1Losses(O, [{ waveId: 'r1-c1', models: ['crit'], reason: 'x' }], []);
    const byModel = groupStage1Losses(O, [{ waveId: 'weird', models: ['crit'], reason: 'x' }], []);
    expect(byId[0].unit).toBe('critic');
    expect(byModel[0].unit).toBe('critic');
  });

  test('lens mode: each dead lens solo retries as its own unit, ascending', () => {
    const OL = { runId: 'r1', models: ['m1', 'm2'], critic: null, lenses: ['security', 'perf'] };
    const units = groupStage1Losses(OL,
      [{ waveId: 'r1-l2', models: ['m2'], reason: 'x' }],
      [{ modelInput: 'm1', status: 'error', error: 'e' }]);
    expect(units.map(u => [u.unit, u.lensIndex, u.waveId, u.retryOfWaveId])).toEqual([
      ['lens', 1, 'r1-l1r1', 'r1-l1'], ['lens', 2, 'r1-l2r1', 'r1-l2']]);
  });
});

const fs = require('fs');
const os = require('os');
const path = require('path');

// Coordinator-review MINOR-6: fakeCtx mints a real tmpdir per call (needed —
// materializeReviews writes review-*.md files into it); track every one so
// they can be swept up after the file's tests finish instead of accumulating
// on disk across runs.
const createdRunDirs = [];
afterAll(() => {
  for (const dir of createdRunDirs) { fs.rmSync(dir, { recursive: true, force: true }); }
});

function fakeCtx(oOverrides = {}, opts = {}) {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl2-'));
  createdRunDirs.push(runDir);
  const notes = [];
  const o = { runId: 'r1', runDir, models: ['a', 'b', 'crit'], critic: 'crit', lenses: null,
    briefing: 'B', date: 'D', timeout: 5, gateway: undefined, noValidateModel: false,
    noCostGate: false, councilName: null, fallback: null, catalog: null, ...oOverrides };
  // Production sets these at run.js:142. Without them, PR2b's twin tests would
  // pass through a buildSeats fallback — green for the wrong reason.
  o.seats = buildSeats(o.models, o.critic, o.lenses);
  o.criticSeat = (o.seats.find(s => s.alias === o.critic) || {}).id || null;
  return {
    o,
    launchers: { launchWave: opts.launchWave || jest.fn(), launchSolo: opts.launchSolo || jest.fn() },
    degrade: { note: (r) => notes.push(r) },
    addWave: jest.fn(),
    overBudget: opts.overBudget || (() => false),
    _notes: notes,
  };
}
// v4.8 PR2a Task 1 fix-wave (coordinator review): both builders now take the
// same trailing (waveId, slot) pair as run-stages.test.js's pair. A bare call
// (no waveId) keeps this file's pre-existing shape — no taskId/waveId field
// at all — so any call site not explicitly touched is unchanged.
const usableLeg = (m, waveId, slot) => ({
  modelInput: m, status: 'complete', summary: `review by ${m}`,
  ...(waveId != null ? { taskId: `${waveId}-${slot}`, waveId } : {}),
});
// CI council finding on PR #152: every status this file's deadLeg call sites
// actually pass (default 'error', plus explicit 'error'/'timeout'/'timed-out').
const DEAD_LEG_STATUSES = new Set(['error', 'timeout', 'timed-out']);
const deadLeg = (m, status = 'error', error = 'boom', waveId, slot) => {
  // waveId/slot trail two DEFAULTED params, so `deadLeg('b', 'r1-s1', 2)` would
  // silently land the wave id in `status`. Fail loudly instead: the binding gate
  // cannot see a bogus status, only a bogus id.
  if (!DEAD_LEG_STATUSES.has(status)) {
    throw new Error(`deadLeg: status '${status}' is not a leg status — did you mean deadLeg(model, status, error, waveId, slot)?`);
  }
  return {
    modelInput: m, status, error,
    ...(waveId != null ? { taskId: `${waveId}-${slot}`, waveId } : {}),
  };
};
const COUNTS = { reviewed: 1, total: 3 };

describe('deadLeg fixture guard (CI council finding, PR #152)', () => {
  test('a misordered call — waveId landing in the status slot — throws loudly instead of silently corrupting the leg', () => {
    expect(() => deadLeg('b', 'r1-s1', 2)).toThrow(/not a leg status/);
  });
});

describe('retryStage1Losses (SL-2 Task 4)', () => {
  test('recovery: heal per seat, recovered legs returned, no still-dead output', async () => {
    // retry roster (r1-s1r1): whole first wave died naming ['a','b'] -> a=slot1, b=slot2.
    const launchWave = jest.fn().mockResolvedValue(
      { wave: { waveId: 'r1-s1r1', legs: [usableLeg('a', 'r1-s1r1', 1), usableLeg('b', 'r1-s1r1', 2)] }, exitCode: 0 });
    const ctx = fakeCtx({}, { launchWave });
    const r = await retryStage1Losses(ctx, {
      deadWaves: [{ waveId: 'r1-s1', models: ['a', 'b'], reason: 'died' }], deadLegs: [], counts: COUNTS });
    expect(r.aborted).toBeNull();
    expect(r.recoveredLegs).toHaveLength(2);
    expect(r.stillDeadNotes).toEqual([]);
    expect(r.stillDeadWaves).toEqual([]);
    expect(ctx._notes).toHaveLength(2);
    expect(ctx._notes[0]).toMatchObject({ channel: 'stage1-retry', kind: 'heal',
      what: 'seat a reviewed on retry',
      why: 'its first wave r1-s1 produced no legs (died) and was relaunched once',
      effect: 'The seat is in this council; nothing was lost' });
    expect(ctx._notes[0].data).toMatchObject({ seat: 'a', retryWaveId: 'r1-s1r1', retryOfWaveId: 'r1-s1' });
    // budget + abort-cascade wiring
    // Adaptation (brief wrinkle): the brief's inline `await` inside
    // `toHaveBeenCalledWith(...)` was awkward — captured the resolved wave in
    // a local first instead. Same assertion, cleaner plumbing.
    const wave = (await launchWave.mock.results[0].value).wave;
    expect(ctx.addWave).toHaveBeenCalledWith(wave);
    expect(runState.appendStageWave).toHaveBeenCalledWith(ctx.o.runDir, 'stage1', 'r1-s1r1');
    expect(launchWave.mock.calls[0][0].retryOfWaveId).toBe('r1-s1');
  });

  test('appendStageWave is called BEFORE the launcher (abort cascade reaches the retry)', async () => {
    const order = [];
    runState.appendStageWave.mockImplementation(() => order.push('append'));
    // retry roster (r1-s1r1): whole first wave died naming ['a'] alone -> a=slot1.
    const launchWave = jest.fn().mockImplementation(async () => { order.push('launch');
      return { wave: { waveId: 'r1-s1r1', legs: [usableLeg('a', 'r1-s1r1', 1)] }, exitCode: 0 }; });
    const ctx = fakeCtx({}, { launchWave });
    await retryStage1Losses(ctx, { deadWaves: [{ waveId: 'r1-s1', models: ['a'], reason: 'x' }],
      deadLegs: [], counts: COUNTS });
    expect(order).toEqual(['append', 'launch']);
  });

  test('retry wave dies wholesale (wave-origin): wave-granularity note, enriched why, original texts preserved', async () => {
    const launchWave = jest.fn().mockResolvedValue({ wave: { waveId: 'r1-s1r1', legs: [] }, exitCode: 0 });
    const ctx = fakeCtx({}, { launchWave });
    const r = await retryStage1Losses(ctx, {
      deadWaves: [{ waveId: 'r1-s1', models: ['a', 'b'], reason: 'died' }], deadLegs: [], counts: COUNTS });
    expect(ctx._notes).toEqual([]); // NEVER notes degrades itself
    expect(r.stillDeadNotes).toHaveLength(1);
    expect(r.stillDeadNotes[0]).toMatchObject({ channel: 'dead-wave',
      what: 'Stage-1 wave r1-s1 (a, b) produced NO legs',
      why: 'died; the once-only retry wave also produced no legs' });
    expect(r.stillDeadWaves).toEqual([{ waveId: 'r1-s1', models: ['a', 'b'], reason: 'died' }]);
  });

  test('leg-origin, retry leg dies: dead-leg note names BOTH attempts; recovered sibling heals', async () => {
    // input deadLegs (r1-s1, the ORIGINAL wave): bench roster ['a','b'] -> a=slot1, b=slot2.
    // retry roster (r1-s1r1): both a and b lost their leg, grouped in that order -> a=slot1, b=slot2.
    const launchWave = jest.fn().mockResolvedValue(
      { wave: { waveId: 'r1-s1r1', legs: [usableLeg('a', 'r1-s1r1', 1), deadLeg('b', 'timeout', null, 'r1-s1r1', 2)] }, exitCode: 0 });
    const ctx = fakeCtx({}, { launchWave });
    const r = await retryStage1Losses(ctx, { deadWaves: [],
      deadLegs: [deadLeg('a', undefined, undefined, 'r1-s1', 1), deadLeg('b', undefined, undefined, 'r1-s1', 2)], counts: COUNTS });
    expect(r.recoveredLegs.map(l => l.modelInput)).toEqual(['a']);
    expect(ctx._notes).toHaveLength(1); // a's heal
    // Coordinator-review IMPORTANT-3b: explicit heal-why text for the
    // leg-origin class (previously only asserted implicitly by count).
    expect(ctx._notes[0].why).toBe("its first leg ended 'error' with no usable output and was relaunched once");
    expect(r.stillDeadNotes).toHaveLength(1);
    expect(r.stillDeadNotes[0]).toMatchObject({ channel: 'dead-leg', what: 'seat b did not review',
      why: "the leg ended 'error': boom with no usable output; its once-only retry also ended 'timeout'",
      effect: '1 of 3 seats reviewed; the run continues with the bench that did and will exit degraded (2)' });
    expect(r.stillDeadLegs.map(l => l.modelInput)).toEqual(['b']);
  });

  test('wave-origin seat whose retry LEG dies: dead-leg granularity naming both attempts (D5)', async () => {
    // retry roster (r1-s1r1): whole first wave died naming ['a'] alone -> a=slot1.
    const launchWave = jest.fn().mockResolvedValue(
      { wave: { waveId: 'r1-s1r1', legs: [deadLeg('a', 'error', 'again', 'r1-s1r1', 1)] }, exitCode: 0 });
    const ctx = fakeCtx({}, { launchWave });
    // v4.8 PR2b: a real dead wave carries its launch roster (run-stage1-launch.js:103),
    // and stillDeadWaves narrows `seats` in lockstep with `models`.
    const r = await retryStage1Losses(ctx, {
      deadWaves: [{ waveId: 'r1-s1', models: ['a'], seats: [ctx.o.seats[0]], reason: 'died' }],
      deadLegs: [], counts: COUNTS });
    expect(r.stillDeadNotes[0]).toMatchObject({ channel: 'dead-leg',
      why: "its first wave r1-s1 produced no legs (died); its once-only retry leg ended 'error' with no usable output" });
    expect(r.stillDeadWaves).toEqual([
      { waveId: 'r1-s1', models: ['a'], seats: [ctx.o.seats[0]], reason: 'died' }]);
  });

  test('critic retries as a SOLO with launchSolo; heal keys deriveSeatLoss-compatible data', async () => {
    // input deadLeg (r1-c1, the ORIGINAL critic wave): a one-seat roster, slot always 1.
    // retry roster (r1-c1r1): also a one-seat roster, slot always 1.
    const launchSolo = jest.fn().mockResolvedValue(
      { wave: { waveId: 'r1-c1r1', legs: [usableLeg('crit', 'r1-c1r1', 1)] }, exitCode: 0, leg: usableLeg('crit', 'r1-c1r1', 1) });
    const ctx = fakeCtx({}, { launchSolo });
    const r = await retryStage1Losses(ctx, { deadWaves: [],
      deadLegs: [deadLeg('crit', undefined, undefined, 'r1-c1', 1)], counts: COUNTS });
    expect(launchSolo).toHaveBeenCalledTimes(1);
    expect(launchSolo.mock.calls[0][0]).toMatchObject({ model: 'crit', waveId: 'r1-c1r1', retryOfWaveId: 'r1-c1' });
    expect(r.recoveredLegs).toHaveLength(1);
    expect(ctx._notes[0].data.seat).toBe('crit');
  });

  test('sequential launch: the critic solo launches only after the bench retry settles', async () => {
    // Coordinator-review IMPORTANT-2: the original version pushed 'bench'
    // synchronously before any await, so it couldn't tell sequential await
    // apart from a concurrent Promise.all — 'bench' would land first either
    // way as long as launchWave was merely CALLED before launchSolo. Deferring
    // the bench mock's resolution to a macrotask means a concurrency bug
    // would let 'critic' (a microtask-resolved mock) land BEFORE
    // 'bench-done', which this asserts against.
    // input deadLegs (r1-s1 / r1-c1, the ORIGINAL waves): bench roster ['a','b'] -> a=slot1
    // (only 'a' failed here, but the ORIGINAL wave's full roster is still ['a','b']);
    // critic is a one-seat roster, slot always 1.
    // retry rosters: bench retry (r1-s1r1) is ['a'] alone (only 'a' failed) -> slot1;
    // critic retry (r1-c1r1) is the usual one-seat roster -> slot1.
    const order = [];
    const launchWave = jest.fn().mockImplementation(() => {
      order.push('bench');
      return new Promise((resolve) => {
        setTimeout(() => {
          order.push('bench-done');
          resolve({ wave: { waveId: 'r1-s1r1', legs: [usableLeg('a', 'r1-s1r1', 1)] }, exitCode: 0 });
        }, 0);
      });
    });
    const launchSolo = jest.fn().mockImplementation(async () => { order.push('critic');
      return { wave: { waveId: 'r1-c1r1', legs: [usableLeg('crit', 'r1-c1r1', 1)] }, exitCode: 0 }; });
    const ctx = fakeCtx({}, { launchWave, launchSolo });
    await retryStage1Losses(ctx, { deadWaves: [],
      deadLegs: [deadLeg('a', undefined, undefined, 'r1-s1', 1), deadLeg('crit', undefined, undefined, 'r1-c1', 1)],
      counts: COUNTS });
    expect(order).toEqual(['bench', 'bench-done', 'critic']);
  });

  test('overBudget pre-gate (D7): unit skipped, original entries routed back untouched, no launch', async () => {
    const launchWave = jest.fn();
    const ctx = fakeCtx({}, { launchWave, overBudget: () => true });
    const w = { waveId: 'r1-s1', models: ['a'], reason: 'died' };
    // input deadLeg (r1-c1, the ORIGINAL critic wave): a one-seat roster, slot always 1.
    const l = deadLeg('crit', undefined, undefined, 'r1-c1', 1);
    const r = await retryStage1Losses(ctx, { deadWaves: [w], deadLegs: [l], counts: COUNTS });
    expect(launchWave).not.toHaveBeenCalled();
    expect(r.skippedDeadWaves).toEqual([w]);
    expect(r.skippedDeadLegs).toEqual([l]);
    expect(r.stillDeadNotes).toEqual([]);
    expect(ctx._notes).toEqual([]);
  });

  test('an abort exit from a retry propagates immediately', async () => {
    const launchWave = jest.fn().mockResolvedValue({ wave: null, exitCode: 130 });
    const ctx = fakeCtx({}, { launchWave });
    const r = await retryStage1Losses(ctx, {
      deadWaves: [{ waveId: 'r1-s1', models: ['a'], reason: 'x' }], deadLegs: [], counts: COUNTS });
    expect(r.aborted).toBe(130);
    expect(ctx._notes).toEqual([]);
  });
});

describe('groupStage1Losses hardening (SL-2 Task 4 review)', () => {
  test('seat dedup: two deadLegs naming the same seat collapse to one models/firstFailures entry; both srcLegs kept', () => {
    const l1 = { modelInput: 'a', status: 'error', error: 'boom' };
    const l2 = { modelInput: 'a', status: 'timeout', error: null };
    const [u] = groupStage1Losses(O, [], [l1, l2]);
    expect(u.unit).toBe('bench');
    expect(u.models).toEqual(['a']);
    expect(u.firstFailures).toHaveLength(1);
    expect(u.firstFailures[0]).toEqual({ seat: 'a', class: 'leg', status: 'error', reason: 'boom', seatId: 'a' });
    expect(u.srcLegs).toEqual([l1, l2]);
  });

  test('seat dedup across carriers: a dead bench wave and a dead leg naming the same seat still collapse to one', () => {
    const w = { waveId: 'r1-s1', models: ['a'], reason: 'died' };
    const l = { modelInput: 'a', status: 'error', error: 'boom' };
    const [u] = groupStage1Losses(O, [w], [l]);
    expect(u.models).toEqual(['a']);
    expect(u.firstFailures).toHaveLength(1);
    expect(u.firstFailures[0]).toMatchObject({ seat: 'a', class: 'wave', waveId: 'r1-s1' }); // first occurrence (the wave) wins
    expect(u.srcWaves).toEqual([w]);
    expect(u.srcLegs).toEqual([l]);
  });

  test('a zero-model dead wave still groups (so it can route to skipped) instead of vanishing', () => {
    const w = { waveId: 'r1-s1', models: [], reason: 'died' };
    const units = groupStage1Losses(O, [w], []);
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({ unit: 'bench', models: [], firstFailures: [], srcWaves: [w], srcLegs: [] });
  });

  test('an unmappable lens loss groups under lensIndex: null without manufacturing a "-lnullr1" waveId', () => {
    const OL = { runId: 'r1', models: ['m1', 'm2'], critic: null, lenses: ['security', 'perf'] };
    const ghost = { modelInput: 'ghost', status: 'error', error: 'e' }; // not in OL.models
    const units = groupStage1Losses(OL, [], [ghost]);
    expect(units).toHaveLength(1);
    expect(units[0].lensIndex).toBeNull();
    expect(units[0].waveId).toBeNull();
    expect(units[0].retryOfWaveId).toBeNull();
    expect(units[0].srcLegs).toEqual([ghost]);
  });
});

describe('retryStage1Losses hardening (SL-2 Task 4 review)', () => {
  test('a zero-model dead wave is skipped: no launch, entry lands in skippedDeadWaves, nothing vanishes', async () => {
    const launchWave = jest.fn();
    const launchSolo = jest.fn();
    const ctx = fakeCtx({}, { launchWave, launchSolo });
    const w = { waveId: 'r1-s1', models: [], reason: 'died' };
    const r = await retryStage1Losses(ctx, { deadWaves: [w], deadLegs: [], counts: COUNTS });
    expect(launchWave).not.toHaveBeenCalled();
    expect(launchSolo).not.toHaveBeenCalled();
    expect(r.skippedDeadWaves).toEqual([w]);
    expect(r.skippedDeadLegs).toEqual([]);
    expect(r.stillDeadNotes).toEqual([]);
    expect(ctx._notes).toEqual([]);
  });

  test('an unmappable lens dead leg (model not in o.models) is skipped: no launch, lands in skippedDeadLegs', async () => {
    const launchWave = jest.fn();
    const launchSolo = jest.fn();
    const ctx = fakeCtx({ models: ['m1', 'm2'], critic: null, lenses: ['security', 'perf'] },
      { launchWave, launchSolo });
    // roster-defying fixture (the stray-1 class from CODE FIX 2 in run-stages.test.js):
    // 'ghost' names a model that isn't on the bench at all, so no real engine wave
    // could ever produce this leg — an intentionally non-conforming id, not a stamp.
    const ghost = { ...deadLeg('ghost'), taskId: 'stray-1' }; // not in o.models -> lensIndexOf returns null
    const r = await retryStage1Losses(ctx, { deadWaves: [], deadLegs: [ghost], counts: COUNTS });
    expect(launchWave).not.toHaveBeenCalled();
    expect(launchSolo).not.toHaveBeenCalled();
    expect(r.skippedDeadLegs).toEqual([ghost]);
    expect(r.skippedDeadWaves).toEqual([]);
    expect(r.stillDeadNotes).toEqual([]);
    expect(ctx._notes).toEqual([]);
  });
});

describe('retryStage1Losses fix-wave (coordinator review)', () => {
  test('CRITICAL: bench partial return (leg-origin) — a seat with NO leg record at all in the ' +
    'retry response still gets a still-dead note, never vanishes', async () => {
    // unit models ['a','b']; the retry wave comes back naming ONLY 'a' —
    // 'b' has no leg record whatsoever (not even an error/timeout leg).
    // input deadLegs (r1-s1, the ORIGINAL wave): bench roster ['a','b'] -> a=slot1, b=slot2.
    // retry roster (r1-s1r1): both a and b lost their leg -> a=slot1, b=slot2; only a's leg
    // comes back (the partial-return fixture this test is named for) — slot1 is correct for
    // a here, but the identical single-leg shape naming b alone would need slot2, not slot1.
    const launchWave = jest.fn().mockResolvedValue(
      { wave: { waveId: 'r1-s1r1', legs: [usableLeg('a', 'r1-s1r1', 1)] }, exitCode: 0 });
    const ctx = fakeCtx({}, { launchWave });
    const r = await retryStage1Losses(ctx, { deadWaves: [],
      deadLegs: [deadLeg('a', undefined, undefined, 'r1-s1', 1), deadLeg('b', undefined, undefined, 'r1-s1', 2)],
      counts: COUNTS });
    expect(r.recoveredLegs.map(l => l.modelInput)).toEqual(['a']);
    expect(r.stillDeadNotes).toHaveLength(1);
    expect(r.stillDeadNotes[0]).toMatchObject({ channel: 'dead-leg', what: 'seat b did not review',
      why: "the leg ended 'error': boom with no usable output; its once-only retry produced no leg for this seat" });
    expect(r.stillDeadLegs.map(l => l.modelInput)).toEqual(['b']);
  });

  test('CRITICAL: wave-origin partial return — an unseen seat lands in stillDeadWaves with reduced ' +
    'models, never vanishes', async () => {
    // deadWave names ['a','b']; the retry wave comes back naming ONLY 'a'.
    // retry roster (r1-s1r1): whole first wave died naming ['a','b'] -> a=slot1, b=slot2.
    const launchWave = jest.fn().mockResolvedValue(
      { wave: { waveId: 'r1-s1r1', legs: [usableLeg('a', 'r1-s1r1', 1)] }, exitCode: 0 });
    const ctx = fakeCtx({}, { launchWave });
    // v4.8 PR2b: the fixture carries the real -s1 roster (a, b — the critic is
    // filtered out of that wave), so the narrowed entry must name seat 'b' and
    // ONLY seat 'b' — index-zipped against the narrowed models, never the
    // original roster.
    const r = await retryStage1Losses(ctx, {
      deadWaves: [{ waveId: 'r1-s1', models: ['a', 'b'], seats: ctx.o.seats.slice(0, 2), reason: 'died' }],
      deadLegs: [], counts: COUNTS });
    expect(r.recoveredLegs.map(l => l.modelInput)).toEqual(['a']);
    expect(r.stillDeadWaves).toEqual([
      { waveId: 'r1-s1', models: ['b'], seats: [ctx.o.seats[1]], reason: 'died' }]);
    expect(r.seatOf.get(r.recoveredLegs[0]).id).toBe('a'); // the healed leg is bound and published
    const note = r.stillDeadNotes.find(n => n.data && n.data.seat === 'b');
    expect(note).toMatchObject({ channel: 'dead-leg', what: 'seat b did not review',
      why: 'its first wave r1-s1 produced no legs (died); its once-only retry produced no leg for this seat' });
  });

  test('every input seat lands in exactly one of recovered / still-dead / skipped (invariant, mixed unit)', async () => {
    // bench unit ['a','b','c']: 'a' comes back usable, 'b' comes back but
    // unusable (per-leg still-dead), 'c' has no leg record at all (the
    // CRITICAL reconciliation path) -- every seat must be accounted for
    // exactly once across the three buckets.
    // Reconciliation: 'c' is not on fakeCtx's default bench (['a','b','crit']) —
    // for its input deadLeg to name a real ORIGINAL wave roster, the bench here
    // must actually include it. models: ['a','b','c','crit'] -> bench roster
    // ['a','b','c'] (a=slot1, b=slot2, c=slot3); o.models is otherwise inert for
    // this code path (groupStage1Losses/retryStage1Losses never read it outside
    // lens mode), so this changes no other behavior in the test.
    // retry roster (r1-s1r1): all three lost their leg, grouped in that order ->
    // a=slot1, b=slot2, c=slot3; only a and b come back (c entirely absent).
    const launchWave = jest.fn().mockResolvedValue({ wave: { waveId: 'r1-s1r1',
      legs: [usableLeg('a', 'r1-s1r1', 1), deadLeg('b', 'timeout', null, 'r1-s1r1', 2)] }, exitCode: 0 }); // 'c' entirely absent
    const ctx = fakeCtx({ models: ['a', 'b', 'c', 'crit'] }, { launchWave });
    const r = await retryStage1Losses(ctx, { deadWaves: [],
      deadLegs: [deadLeg('a', undefined, undefined, 'r1-s1', 1), deadLeg('b', undefined, undefined, 'r1-s1', 2),
        deadLeg('c', undefined, undefined, 'r1-s1', 3)], counts: COUNTS });
    expect(r.recoveredLegs.map(l => l.modelInput)).toEqual(['a']);
    expect(r.stillDeadLegs.map(l => l.modelInput).sort()).toEqual(['b', 'c']);
    expect(r.skippedDeadLegs).toEqual([]);
    // exactly one still-dead note per lost seat -- no double, no omission
    const seatsNoted = r.stillDeadNotes.map(n => n.data.seat).sort();
    expect(seatsNoted).toEqual(['b', 'c']);
  });

  test('IMPORTANT-3a: leg-origin retry wave dies wholesale — srcLegStillDeadNote fires, why names both attempts', async () => {
    const launchWave = jest.fn().mockResolvedValue({ wave: { waveId: 'r1-s1r1', legs: [] }, exitCode: 0 });
    const ctx = fakeCtx({}, { launchWave });
    // input deadLegs (r1-s1, the ORIGINAL wave): bench roster ['a','b'] -> a=slot1, b=slot2.
    const r = await retryStage1Losses(ctx, { deadWaves: [],
      deadLegs: [deadLeg('a', undefined, undefined, 'r1-s1', 1), deadLeg('b', undefined, undefined, 'r1-s1', 2)],
      counts: COUNTS });
    expect(ctx._notes).toEqual([]);
    expect(r.stillDeadNotes).toHaveLength(2);
    expect(r.stillDeadNotes).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: 'dead-leg', what: 'seat a did not review',
        why: "the leg ended 'error': boom with no usable output; its once-only retry wave produced no legs" }),
      expect.objectContaining({ channel: 'dead-leg', what: 'seat b did not review',
        why: "the leg ended 'error': boom with no usable output; its once-only retry wave produced no legs" }),
    ]));
    expect(r.stillDeadLegs.map(l => l.modelInput).sort()).toEqual(['a', 'b']);
  });

  test('MINOR-4: wholesale death does not double-announce a seat present in both a srcWave and a srcLeg', async () => {
    const launchWave = jest.fn().mockResolvedValue({ wave: { waveId: 'r1-s1r1', legs: [] }, exitCode: 0 });
    const ctx = fakeCtx({}, { launchWave });
    const w = { waveId: 'r1-s0', models: ['a'], reason: 'died' };
    // 'a' arrives via BOTH carriers here — the synthetic wave id 'r1-s0' (distinct
    // from the usual r1-s1, chosen by this test to probe dedup, not a real bench
    // wave) is the only coherent ORIGINAL-wave id to stamp the paired leg with;
    // roster is w.models = ['a'] alone, slot1.
    const l = deadLeg('a', 'timeout', null, 'r1-s0', 1);
    const r = await retryStage1Losses(ctx, { deadWaves: [w], deadLegs: [l], counts: COUNTS });
    // seat 'a' arrived via both a srcWave and a srcLeg (grouping keeps both
    // sources — Task-4 hardening item 1) -- the wholesale-death path must
    // still announce it exactly once, not twice. First source (the wave) wins.
    expect(r.stillDeadNotes).toHaveLength(1);
    expect(r.stillDeadNotes[0].channel).toBe('dead-wave');
    expect(r.stillDeadWaves).toEqual([w]);
    expect(r.stillDeadLegs).toEqual([]); // the leg source is superseded, not double-counted
  });

  test('MINOR-7b: an out-of-range lensIndex (waveId names a lens beyond o.lenses.length) is treated as unmappable', async () => {
    const launchWave = jest.fn();
    const launchSolo = jest.fn();
    const ctx = fakeCtx({ models: ['m1', 'm2'], critic: null, lenses: ['security', 'perf'] },
      { launchWave, launchSolo });
    const w = { waveId: 'r1-l5', models: ['m1'], reason: 'died' }; // only 2 lenses exist
    const r = await retryStage1Losses(ctx, { deadWaves: [w], deadLegs: [], counts: COUNTS });
    expect(launchWave).not.toHaveBeenCalled();
    expect(launchSolo).not.toHaveBeenCalled();
    expect(r.skippedDeadWaves).toEqual([w]);
  });

  test('MINOR-7c: waveStillDeadNote renders a missing w.reason as "no reason recorded"', async () => {
    const launchWave = jest.fn().mockResolvedValue({ wave: { waveId: 'r1-s1r1', legs: [] }, exitCode: 0 });
    const ctx = fakeCtx({}, { launchWave });
    const r = await retryStage1Losses(ctx, {
      deadWaves: [{ waveId: 'r1-s1', models: ['a'], reason: undefined }], deadLegs: [], counts: COUNTS });
    expect(r.stillDeadNotes[0].why).toBe('no reason recorded; the once-only retry wave also produced no legs');
  });
});

describe('retryStage1Losses fix-wave (SL-2 Task 5 coordinator review)', () => {
  test('CODE FIX 2: a retry leg for a seat with no firstFailures entry is skipped — not healed, not returned', async () => {
    // unit models ['a']; the (mocked) retry response also names 'ghost', who
    // never lost its seat in the first place. Before the fix this fabricated
    // a bogus heal for 'ghost' (ff===null -> "ended 'unknown'") and pushed a
    // duplicate leg into recoveredLegs alongside whatever 'ghost' already had.
    // retry roster (r1-s1r1): only 'a' lost its seat -> ['a'] alone, slot1. 'ghost'
    // is a roster-defying fixture (the stray-1 class from CODE FIX 2 in
    // run-stages.test.js) — no real retry roster could ever include it, so it
    // gets an intentionally non-conforming id instead of a real stamp.
    const launchWave = jest.fn().mockResolvedValue(
      { wave: { waveId: 'r1-s1r1',
        legs: [usableLeg('a', 'r1-s1r1', 1), { ...usableLeg('ghost'), taskId: 'stray-1' }] }, exitCode: 0 });
    const ctx = fakeCtx({}, { launchWave });
    const r = await retryStage1Losses(ctx, {
      deadWaves: [{ waveId: 'r1-s1', models: ['a'], reason: 'died' }], deadLegs: [], counts: COUNTS });
    expect(r.recoveredLegs.map(l => l.modelInput)).toEqual(['a']);
    expect(ctx._notes).toHaveLength(1); // only a's heal — no bogus heal for 'ghost'
    expect(ctx._notes[0].data.seat).toBe('a');
  });
});

describe('v4.8 PR2b Task 5: retry units carry a seat roster and publish their bindings', () => {
  test('a retry unit carries seats parallel to models, in launch order', () => {
    const seats = buildSeats(['a', 'b'], null, null);
    const o = { runId: 'r1', models: ['a', 'b'], critic: null, lenses: null, seats };
    const units = groupStage1Losses(o, [{ waveId: 'r1-s1', models: ['a', 'b'],
      seats, reason: 'x' }], [], new Map());
    expect(units[0].models).toEqual(['a', 'b']);
    expect(units[0].seats.map(s => s.id)).toEqual(['a', 'b']);
  });

  test('a dead LEG contributes its BOUND seat, taken from seatOf', () => {
    const seats = buildSeats(['a', 'b'], null, null);
    const o = { runId: 'r1', models: ['a', 'b'], critic: null, lenses: null, seats };
    const dead = { modelInput: 'b', status: 'error', error: 'boom' };
    const units = groupStage1Losses(o, [], [dead], new Map([[dead, seats[1]]]));
    expect(units[0].seats.map(s => s.id)).toEqual(['b']);
  });

  test('unit.seats is index-parallel to unit.models and a hole never shifts a slot', () => {
    const seats = buildSeats(['a', 'b'], null, null);
    const o = { runId: 'r1', models: ['a', 'b'], critic: null, lenses: null, seats };
    // The UNIDENTIFIED loss is deliberately FIRST: a roster hole that shifts
    // later slots only mis-attributes when something identified follows it.
    const unidentified = { modelInput: 'a', status: 'error', error: 'boom' }; // no seatOf entry
    const dead = { modelInput: 'b', status: 'error', error: 'boom' };
    const units = groupStage1Losses(o, [], [unidentified, dead], new Map([[dead, seats[1]]]));
    expect(units[0].models).toEqual(['a', 'b']);
    expect(units[0].seats).toHaveLength(units[0].models.length);
    expect(units[0].seats[0]).toBeNull();       // unidentified — never guessed
    expect(units[0].seats[1].id).toBe('b');     // position preserved despite the hole
  });

  test('the retry wave binds its own legs, names files by seat, and publishes seatOf', async () => {
    const launchWave = jest.fn().mockResolvedValue(
      { wave: { waveId: 'r1-s1r1', legs: [usableLeg('a', 'r1-s1r1', 1)] }, exitCode: 0 });
    const ctx = fakeCtx({ models: ['a'], critic: null }, { launchWave });
    const out = await retryStage1Losses(ctx, {
      deadWaves: [{ waveId: 'r1-s1', models: ['a'], seats: ctx.o.seats, reason: 'x' }],
      deadLegs: [], counts: { reviewed: 0, total: 1 } });
    expect(out.recoveredLegs).toHaveLength(1);
    expect(out.seatOf.get(out.recoveredLegs[0]).id).toBe('a');
    expect(fs.existsSync(path.join(ctx.o.runDir, 'review-a.md'))).toBe(true);
  });

  test('a hole in the retry roster never shifts a bind, and the unidentified slot is never guessed', async () => {
    // Roster [null, seatB]: 'a' lost its leg without ever having been bound, so
    // its slot is a hole. Handing bindSeats the roster unpadded (or filtered —
    // seats.js:131 filters internally, so those two spellings are identical)
    // slides slot 2 into slot 1 and binds a's retry leg to seat b.
    const launchWave = jest.fn().mockResolvedValue({ wave: { waveId: 'r1-s1r1',
      legs: [usableLeg('a', 'r1-s1r1', 1), usableLeg('b', 'r1-s1r1', 2)] }, exitCode: 0 });
    const ctx = fakeCtx({ models: ['a', 'b'], critic: null }, { launchWave });
    const la = deadLeg('a', undefined, undefined, 'r1-s1', 1);
    const lb = deadLeg('b', undefined, undefined, 'r1-s1', 2);
    const out = await retryStage1Losses(ctx, { deadWaves: [], deadLegs: [la, lb],
      counts: COUNTS, seatOf: new Map([[lb, ctx.o.seats[1]]]) });
    const [healedA, healedB] = out.recoveredLegs;
    expect([healedA.modelInput, healedB.modelInput]).toEqual(['a', 'b']);
    expect(out.seatOf.get(healedB).id).toBe('b');    // slot preserved despite the hole
    expect(out.seatOf.get(healedA)).toBeUndefined(); // unidentified — never guessed
    expect(out.orphanLegs).toEqual([]);              // the placeholder held the slot open
  });

  test('a retry leg that matches no roster slot is reported as an orphan, not guessed', async () => {
    // PR2a planted this fixture's non-conforming id for exactly this assertion.
    const launchWave = jest.fn().mockResolvedValue({ wave: { waveId: 'r1-s1r1',
      legs: [{ ...usableLeg('a'), taskId: 'stray-1' }] }, exitCode: 0 });
    const ctx = fakeCtx({ models: ['b'], critic: null }, { launchWave });
    const out = await retryStage1Losses(ctx, {
      deadWaves: [{ waveId: 'r1-s1', models: ['b'], seats: ctx.o.seats, reason: 'x' }],
      deadLegs: [], counts: { reviewed: 0, total: 1 } });
    expect(out.orphanLegs).toHaveLength(1);
    expect(out.orphanLegs[0].leg.taskId).toBe('stray-1');
    expect(out.orphanLegs[0].waveId).toBe('r1-s1r1');
    expect(out.seatOf.size).toBe(0);          // nothing was guessed
    expect(ctx._notes).toEqual([]);           // and this module never notes a degrade
  });

  test('bindings ACCUMULATE across retry units — later units never overwrite earlier ones', async () => {
    // Every other test here drives ONE unit, which leaves "assign instead of
    // accumulate" (out.seatOf = retrySeatOf) green. Lens mode makes each dead
    // solo its own unit, so two units run in one pass and both must land — in
    // out.seatOf AND, for their strays, in out.orphanLegs under their OWN waveId.
    const launchSolo = jest.fn().mockImplementation(async (opts) => ({
      wave: { waveId: opts.waveId, legs: [
        usableLeg(opts.model, opts.waveId, 1),
        { ...usableLeg(`stray-${opts.model}`), taskId: `stray-${opts.waveId}` },
      ] },
      exitCode: 0,
    }));
    const ctx = fakeCtx({ models: ['m1', 'm2'], critic: null, lenses: ['security', 'perf'] },
      { launchSolo });
    const out = await retryStage1Losses(ctx, { deadWaves: [
      { waveId: 'r1-l1', models: ['m1'], seats: [ctx.o.seats[0]], reason: 'x' },
      { waveId: 'r1-l2', models: ['m2'], seats: [ctx.o.seats[1]], reason: 'x' },
    ], deadLegs: [], counts: COUNTS });
    expect(launchSolo).toHaveBeenCalledTimes(2);
    expect(out.recoveredLegs.map(l => l.modelInput)).toEqual(['m1', 'm2']);
    expect(out.seatOf.size).toBe(2);                                     // accumulated, not overwritten
    expect(out.recoveredLegs.map(l => out.seatOf.get(l).id)).toEqual(['m1', 'm2']);
    expect(out.orphanLegs.map(x => x.waveId)).toEqual(['r1-l1r1', 'r1-l2r1']);
    expect(out.orphanLegs.map(x => x.leg.taskId)).toEqual(['stray-r1-l1r1', 'stray-r1-l2r1']);
  });
});

describe('v4.8 PR2b Task 6 (H4): twin seats retry as TWO seats, never collapsed into one', () => {
  test('H4: two dead twin seats retry as two legs, not one', () => {
    const seats = buildSeats(['deepseek', 'deepseek'], null, null);
    const o = { runId: 'r1', models: ['deepseek', 'deepseek'], critic: null, lenses: null, seats };
    const d1 = { modelInput: 'deepseek', status: 'error', error: 'a' };
    const d2 = { modelInput: 'deepseek', status: 'error', error: 'b' };
    const units = groupStage1Losses(o, [], [d1, d2], new Map([[d1, seats[0]], [d2, seats[1]]]));
    expect(units[0].models).toEqual(['deepseek', 'deepseek']);
    expect(units[0].seats.map(s => s.id)).toEqual(['deepseek#1', 'deepseek#2']);
    // The dedup key is the NEW field. `ff.seat` must stay ALIAS-valued: verdict.js
    // (`legs.find(l => l.data.seat === critic)`) compares data.seat against
    // o.critic, an alias, and workspace-seats.js / live-seats.js read it too.
    expect(units[0].firstFailures.map(f => f.seatId)).toEqual(['deepseek#1', 'deepseek#2']);
    expect(units[0].firstFailures.map(f => f.seat)).toEqual(['deepseek', 'deepseek']);
  });

  test('T2.2: two UNIDENTIFIED losses on a TWIN alias get TWO retry slots — the roster proves two seats', () => {
    // REPLACES PR2b's 'H4: two UNIDENTIFIED losses on one alias still collapse — nothing
    // distinguishes them', which pinned the collapse as CORRECT by name. It is not: the
    // roster REPEATS `deepseek`, so two dead legs on it are two seats the run already
    // paid for, and one retry slot bought one leg for both. Something does distinguish
    // them — each leg's own taskId — and the roster is what proves there are two.
    const seats = buildSeats(['deepseek', 'deepseek'], null, null);
    const o = { runId: 'r1', models: ['deepseek', 'deepseek'], critic: null, lenses: null, seats };
    const d1 = { modelInput: 'deepseek', status: 'error', error: 'a' };
    const d2 = { modelInput: 'deepseek', status: 'error', error: 'b' };
    const units = groupStage1Losses(o, [], [d1, d2], new Map()); // no bindings at all
    expect(units[0].models).toEqual(['deepseek', 'deepseek']);   // TWO paid legs, not one
    expect(units[0].seats).toEqual([null, null]);                // and neither seat is guessed
    expect(units[0].firstFailures.map(f => f.reason)).toEqual(['a', 'b']); // the second is KEPT
    // ⚠️ seatId stays ALIAS-valued on BOTH entries and that is deliberate: it is rendered
    // (data.firstFailure.seatId), so minting one here would put a fabricated seat identity
    // on screen. The distinguisher rides the ROW key (run-stage1-rows.js), not this one.
    expect(units[0].firstFailures.map(f => f.seatId)).toEqual(['deepseek', 'deepseek']);
  });

  test('T2.2 control: two UNIDENTIFIED losses on a UNIQUE alias still collapse — one seat', () => {
    // The half of the old H4 that was right, kept by name. Two spellings of "the roster
    // does not prove a repeat": no `o.seats` at all (also the buildSeats-fallback shape —
    // run-stage1-launch.js re-derives the table locally and never writes it back), and a
    // roster that names exactly one seat for the alias. Both must stay ONE slot.
    const l1 = { modelInput: 'a', status: 'error', error: 'boom' };
    const l2 = { modelInput: 'a', status: 'timeout', error: null };
    const [noRoster] = groupStage1Losses(O, [], [l1, l2], new Map());
    expect(noRoster.models).toEqual(['a']);
    expect(noRoster.firstFailures.map(f => f.seatId)).toEqual(['a']);
    const uniq = { runId: 'r1', models: ['a', 'b'], critic: null, lenses: null,
      seats: buildSeats(['a', 'b'], null, null) };
    const [withRoster] = groupStage1Losses(uniq, [], [l1, l2], new Map());
    expect(withRoster.models).toEqual(['a']);
    expect(withRoster.firstFailures.map(f => f.seatId)).toEqual(['a']);
  });

  test('H4: twin LENS seats get separate units — lensIndexOf must not use indexOf', () => {
    const seats = buildSeats(['deepseek', 'deepseek'], null, ['risk', 'cost']);
    const o = { runId: 'r1', models: ['deepseek', 'deepseek'], critic: null,
      lenses: ['risk', 'cost'], seats };
    const d1 = { modelInput: 'deepseek', status: 'error' };
    const d2 = { modelInput: 'deepseek', status: 'error' };
    const units = groupStage1Losses(o, [], [d1, d2], new Map([[d1, seats[0]], [d2, seats[1]]]));
    expect(units.map(u => u.waveId)).toEqual(['r1-l1r1', 'r1-l2r1']);
  });

  test('H4: both twins heal — two paid legs, two heals, and NO phantom still-dead seat', async () => {
    // retry roster (r1-s1r1): the whole first wave died naming both twins ->
    // deepseek#1=slot1, deepseek#2=slot2.
    const launchWave = jest.fn().mockResolvedValue({ wave: { waveId: 'r1-s1r1',
      legs: [usableLeg('deepseek', 'r1-s1r1', 1), usableLeg('deepseek', 'r1-s1r1', 2)] }, exitCode: 0 });
    const ctx = fakeCtx({ models: ['deepseek', 'deepseek'], critic: null }, { launchWave });
    const r = await retryStage1Losses(ctx, {
      deadWaves: [{ waveId: 'r1-s1', models: ['deepseek', 'deepseek'], seats: ctx.o.seats, reason: 'died' }],
      deadLegs: [], counts: COUNTS });
    expect(launchWave.mock.calls[0][0].models).toEqual(['deepseek', 'deepseek']); // TWO paid legs
    expect(r.recoveredLegs).toHaveLength(2);
    expect(r.recoveredLegs.map(l => r.seatOf.get(l).id)).toEqual(['deepseek#1', 'deepseek#2']);
    // The reconcile's launched-seat set must be seat-keyed THROUGHOUT. Leaving
    // any feeder alias-keyed makes it a mix (['deepseek#1','deepseek#2','deepseek'])
    // that the seat-keyed `seen` set can never match, so a fully recovered run
    // emits a phantom dead-leg degrade and exits 2.
    expect(r.stillDeadNotes).toEqual([]);
    expect(r.stillDeadWaves).toEqual([]);
    expect(ctx._notes).toHaveLength(2);
  });

  test('H4: both twins stay lost — each keeps its OWN seat, never the LAST twin’s', async () => {
    const launchWave = jest.fn().mockResolvedValue({ wave: { waveId: 'r1-s1r1',
      legs: [deadLeg('deepseek', 'error', 'again', 'r1-s1r1', 1),
        deadLeg('deepseek', 'error', 'again', 'r1-s1r1', 2)] }, exitCode: 0 });
    const ctx = fakeCtx({ models: ['deepseek', 'deepseek'], critic: null }, { launchWave });
    const r = await retryStage1Losses(ctx, {
      deadWaves: [{ waveId: 'r1-s1', models: ['deepseek', 'deepseek'], seats: ctx.o.seats, reason: 'died' }],
      deadLegs: [], counts: COUNTS });
    // An alias-keyed `new Map(unit.models.map(...))` lookup overwrites the
    // duplicate key, so BOTH still-lost twins would be affirmatively
    // mis-attributed to deepseek#2 — strictly worse than null.
    expect(r.stillDeadWaves).toEqual([{ waveId: 'r1-s1', models: ['deepseek', 'deepseek'],
      seats: [ctx.o.seats[0], ctx.o.seats[1]], reason: 'died' }]);
    expect(r.stillDeadNotes).toHaveLength(2);
  });

  test('H4: a twin whose retry produced NO leg reconciles to its OWN seat, slot-indexed', async () => {
    // slot 1 comes back dead; slot 2 has no leg record at all — the CRITICAL
    // reconciliation path, where there is no leg to read a binding off.
    const launchWave = jest.fn().mockResolvedValue({ wave: { waveId: 'r1-s1r1',
      legs: [deadLeg('deepseek', 'error', 'again', 'r1-s1r1', 1)] }, exitCode: 0 });
    const ctx = fakeCtx({ models: ['deepseek', 'deepseek'], critic: null }, { launchWave });
    const r = await retryStage1Losses(ctx, {
      deadWaves: [{ waveId: 'r1-s1', models: ['deepseek', 'deepseek'], seats: ctx.o.seats, reason: 'died' }],
      deadLegs: [], counts: COUNTS });
    expect(r.stillDeadNotes).toHaveLength(2); // neither twin vanishes
    expect(r.stillDeadWaves).toEqual([{ waveId: 'r1-s1', models: ['deepseek', 'deepseek'],
      seats: [ctx.o.seats[0], ctx.o.seats[1]], reason: 'died' }]);
  });
});

describe('SL-2 Task 6: sink invariant (source pin)', () => {
  test('run-retry.js never touches degraded.value (sink invariant, source pin)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'council', 'run-retry.js'), 'utf-8');
    // Deviation from the brief's literal regex: a bare /degraded\s*\.\s*value/
    // substring match false-positives on this module's OWN docstring, which
    // explains the invariant in prose ("...never touches `degraded.value`...").
    // Anchored to an assignment instead (`(?!=)` excludes ===/==) — the same
    // pattern tests/council/degrade-invariant.test.js already uses for its
    // repo-wide scan — so the pin catches a real `degraded.value = ...`
    // mutation without breaking on prose that documents the very invariant
    // it guards. Root-caused and verified: the loose pattern matches this
    // file's source today (docstring only); the anchored one does not.
    expect(src).not.toMatch(/degraded\s*\.\s*value\s*=(?!=)/);
  });
});

describe('v4.6.2 PR2 Task 3: backstop reason inherits the SL-2 retry + degrade chain (pin)', () => {
  // Consumes the reason-string contract from PR2 Task 2 (src/headless.js's
  // no-output backstop, 300s default). This suite is generic over error
  // strings (see the 'leg dies' tests above, which use short fixtures like
  // 'boom') -- this pin proves that genericity holds for the real backstop
  // text end to end: the SL-2 retry launch, the enriched both-attempts
  // dead-leg record, and degraded.value (exit-2 semantics). No production
  // code is touched by this task.
  const BACKSTOP = 'NO_OUTPUT_BACKSTOP: model produced no output, reasoning, or tool calls '
    + 'in 120s — likely a listed-but-not-serving model or a dead endpoint';

  test('a leg dead with the NO_OUTPUT_BACKSTOP reason retries once (SL-2); the retry also dies; ' +
    'the dead-leg note carries the reason; degraded.value flips (exit-2)', async () => {
    // input deadLeg (r1-s1, the ORIGINAL wave): bench roster ['a','b'] -> b=slot2.
    // retry roster (r1-s1r1): only 'b' failed -> ['b'] alone, slot1.
    const launchWave = jest.fn().mockResolvedValue(
      { wave: { waveId: 'r1-s1r1', legs: [deadLeg('b', 'error', BACKSTOP, 'r1-s1r1', 1)] }, exitCode: 0 });
    const ctx = fakeCtx({}, { launchWave });
    const r = await retryStage1Losses(ctx, { deadWaves: [],
      deadLegs: [deadLeg('b', 'error', BACKSTOP, 'r1-s1', 2)], counts: COUNTS });

    // (1) the SL-2 retry launches (existing retry-fired assertion pattern).
    expect(launchWave).toHaveBeenCalledTimes(1);
    expect(launchWave.mock.calls[0][0]).toMatchObject(
      { waveId: 'r1-s1r1', retryOfWaveId: 'r1-s1', models: ['b'] });

    // (2) the retry also dies -> the enriched both-attempts dead-leg record's
    // why carries the backstop reason verbatim.
    expect(ctx._notes).toEqual([]); // NEVER notes degrades itself (sink invariant)
    expect(r.recoveredLegs).toEqual([]);
    expect(r.stillDeadLegs.map(l => l.modelInput)).toEqual(['b']);
    expect(r.stillDeadNotes).toHaveLength(1);
    expect(r.stillDeadNotes[0]).toMatchObject({ channel: 'dead-leg', what: 'seat b did not review' });
    expect(r.stillDeadNotes[0].why).toContain('NO_OUTPUT_BACKSTOP');
    expect(r.stillDeadNotes[0].why).toBe(
      `the leg ended 'error': ${BACKSTOP} with no usable output; its once-only retry also ended 'error'`);
    expect(r.stillDeadNotes[0].data.reason).toBe(BACKSTOP);

    // (3) degraded.value flips (exit-2 semantics). run-retry.js never notes a
    // degrade itself (see the sink-invariant pin above); in production
    // run-stages.js :: runStage1 feeds stillDeadNotes to the REAL degrade sink (cited `:175`
    // until the v4.9 W9 fix round re-opened it: that line was already prose about the repair
    // loop, and the gate cannot catch a citation that merely stays IN RANGE). Wire
    // that same sink here (not the fakeCtx stub) to prove the chain actually
    // reaches exit-2, not just that the note LOOKS right.
    const { createDegradeSink } = require('../../src/council/run-degrade');
    const degraded = { value: false };
    const sink = createDegradeSink({ runDir: ctx.o.runDir, degraded, write: () => {} });
    for (const rec of r.stillDeadNotes) { sink.note(rec); }
    expect(degraded.value).toBe(true);
  });
});

describe('Task 5 (#129): escalate the no-output backstop 2x on retry, clamped', () => {
  // Built on the same harness as the PR2 Task 3 suite above (fakeCtx +
  // launchWave mock + a single dead bench leg) rather than inventing a new
  // one — it drives the real retryStage1Losses bench path and reads back
  // what run-retry.js actually handed to launchWave.
  // noOutputBackstopMs is accepted alongside timeout (fix-wave addition) so
  // callers below can drive the Number.isFinite(o.noOutputBackstopMs) TRUE
  // branch — fakeCtx's own oOverrides spread already threads it onto `o`,
  // but this helper previously destructured only `{ timeout }` and silently
  // dropped it.
  async function runRetryCapturingLaunchOpts({ timeout, noOutputBackstopMs }) {
    // input deadLeg (r1-s1, the ORIGINAL wave): bench roster ['a','b'] -> b=slot2.
    // retry roster (r1-s1r1): only 'b' failed -> ['b'] alone, slot1.
    const launchWave = jest.fn().mockResolvedValue(
      { wave: { waveId: 'r1-s1r1', legs: [deadLeg('b', 'error', 'boom', 'r1-s1r1', 1)] }, exitCode: 0 });
    const ctx = fakeCtx({ timeout, noOutputBackstopMs }, { launchWave });
    await retryStage1Losses(ctx, { deadWaves: [],
      deadLegs: [deadLeg('b', undefined, undefined, 'r1-s1', 2)], counts: COUNTS });
    return launchWave.mock.calls[0][0];
  }

  const ORIGINAL_ENV = process.env.AMICUS_NO_OUTPUT_BACKSTOP_MS;
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) { delete process.env.AMICUS_NO_OUTPUT_BACKSTOP_MS; }
    else { process.env.AMICUS_NO_OUTPUT_BACKSTOP_MS = ORIGINAL_ENV; }
  });

  test('retries with double the resolved backstop window', async () => {
    // Council never sets the field, so there is nothing on `o` to double —
    // the retry resolves it itself. Must be COMPUTED: hardcoding 600000 would
    // make AMICUS_NO_OUTPUT_BACKSTOP_MS stop applying to retries, so an operator
    // who set 900000 would get a SHORTER retry window than the first attempt.
    delete process.env.AMICUS_NO_OUTPUT_BACKSTOP_MS;
    const launched = await runRetryCapturingLaunchOpts({ timeout: 15 });
    expect(launched.noOutputBackstopMs).toBe(600000);
  });

  test('honours AMICUS_NO_OUTPUT_BACKSTOP_MS when doubling', async () => {
    process.env.AMICUS_NO_OUTPUT_BACKSTOP_MS = '300000';
    const launched = await runRetryCapturingLaunchOpts({ timeout: 15 });
    expect(launched.noOutputBackstopMs).toBe(600000);
  });

  test('preserves the disable hatch: 2 * 0 === 0', async () => {
    process.env.AMICUS_NO_OUTPUT_BACKSTOP_MS = '0';
    const launched = await runRetryCapturingLaunchOpts({ timeout: 15 });
    expect(launched.noOutputBackstopMs).toBe(0);
  });

  test('clamps the doubled window to the leg timeout', async () => {
    // At --timeout 3 (180_000ms) an unclamped 600_000 can never fire, so the
    // retry would silently reclassify from NO_OUTPUT_BACKSTOP to an ordinary
    // timeout — a different diagnosis, arrived at silently.
    delete process.env.AMICUS_NO_OUTPUT_BACKSTOP_MS;
    const launched = await runRetryCapturingLaunchOpts({ timeout: 3 });
    expect(launched.noOutputBackstopMs).toBe(180000);
  });

  // Fix-wave regression guard: legTimeoutMs = (o.timeout || 15) * 60 * 1000 —
  // every test above passes an explicit timeout, and fakeCtx's own default is
  // timeout:5, so nothing previously drove o.timeout actually being unset.
  // If `|| 15` were ever dropped, o.timeout undefined -> legTimeoutMs is NaN
  // -> Math.min(600000, NaN) is NaN -> headless.js's Number.isFinite check
  // rejects it -> silent fallback to the 300000 default, with every other
  // test in this describe block still green (they all pin an explicit
  // timeout, never the default).
  test('an unset o.timeout falls back to the 15-minute leg default', async () => {
    // 600000 (the doubled default backstop) < 900000 (15min leg timeout), so
    // the clamp does not bind here — this isolates the `|| 15` default itself.
    delete process.env.AMICUS_NO_OUTPUT_BACKSTOP_MS;
    const launched = await runRetryCapturingLaunchOpts({ timeout: undefined });
    expect(launched.noOutputBackstopMs).toBe(600000);
  });

  // Companion: the Number.isFinite(o.noOutputBackstopMs) TRUE branch at :154
  // is also uncovered above — council never populates o.noOutputBackstopMs,
  // so every prior test in this file takes the FALSE branch (resolved from
  // env/default). Drive it directly via the helper's new pass-through.
  test('Number.isFinite(o.noOutputBackstopMs) true branch: an explicit value on o is doubled directly, not re-resolved from env', async () => {
    const launched = await runRetryCapturingLaunchOpts({ timeout: 15, noOutputBackstopMs: 50000 });
    expect(launched.noOutputBackstopMs).toBe(100000);
  });
});

// ---- v4.8 PR2b Task 8: `attemptedSeats` is the seat-keyed retry gate ----
// run-stage1-rows.js reads this to decide whether a still-dead seat may fall
// back to its FIRST-attempt leg. Derived from stillDeadNotes instead it could
// not work: `data.seat` is alias-valued by contract, so no twin's seat id would
// ever match, and every twin's row would re-attach a first leg it never earned.
describe('v4.8 PR2b Task 8: retryStage1Losses publishes attemptedSeats, seat-keyed', () => {
  const TWINS = { models: ['deepseek', 'deepseek'], critic: null };
  const twinLegs = (ctx) => {
    const d1 = deadLeg('deepseek', undefined, undefined, 'r1-s1', 1);
    const d2 = deadLeg('deepseek', undefined, undefined, 'r1-s1', 2);
    return { d1, d2, seatOf: new Map([[d1, ctx.o.seats[0]], [d2, ctx.o.seats[1]]]) };
  };

  test('retryLegStillDead (both retry legs came back unusable): BOTH twins are marked', async () => {
    const launchWave = jest.fn().mockResolvedValue({ wave: { waveId: 'r1-s1r1',
      legs: [deadLeg('deepseek', 'timed-out', null, 'r1-s1r1', 1),
        deadLeg('deepseek', 'timed-out', null, 'r1-s1r1', 2)] }, exitCode: 0 });
    const ctx = fakeCtx(TWINS, { launchWave });
    const { d1, d2, seatOf } = twinLegs(ctx);
    const out = await retryStage1Losses(ctx, { deadWaves: [], deadLegs: [d1, d2], counts: COUNTS, seatOf });
    expect([...out.attemptedSeats].sort()).toEqual(['deepseek#1', 'deepseek#2']);
  });

  test('srcLegStillDead (the retry wave died wholesale): BOTH twins are marked', async () => {
    const launchWave = jest.fn().mockResolvedValue({ wave: { waveId: 'r1-s1r1', legs: [] }, exitCode: 0 });
    const ctx = fakeCtx(TWINS, { launchWave });
    const { d1, d2, seatOf } = twinLegs(ctx);
    const out = await retryStage1Losses(ctx, { deadWaves: [], deadLegs: [d1, d2], counts: COUNTS, seatOf });
    expect([...out.attemptedSeats].sort()).toEqual(['deepseek#1', 'deepseek#2']);
  });

  test('waveStillDead (a dead twin WAVE whose retry also died): BOTH twins are marked', async () => {
    const launchWave = jest.fn().mockResolvedValue({ wave: { waveId: 'r1-s1r1', legs: [] }, exitCode: 0 });
    const ctx = fakeCtx(TWINS, { launchWave });
    const out = await retryStage1Losses(ctx, { counts: COUNTS, deadLegs: [],
      deadWaves: [{ waveId: 'r1-s1', models: ['deepseek', 'deepseek'], seats: ctx.o.seats, reason: 'x' }] });
    expect([...out.attemptedSeats].sort()).toEqual(['deepseek#1', 'deepseek#2']);
  });

  test('missingLegStillDead: only the twin the partial return never named — a HEALED seat is not marked', async () => {
    const launchWave = jest.fn().mockResolvedValue({ wave: { waveId: 'r1-s1r1',
      legs: [usableLeg('deepseek', 'r1-s1r1', 1)] }, exitCode: 0 });
    const ctx = fakeCtx(TWINS, { launchWave });
    const out = await retryStage1Losses(ctx, { counts: COUNTS, deadLegs: [],
      deadWaves: [{ waveId: 'r1-s1', models: ['deepseek', 'deepseek'], seats: ctx.o.seats, reason: 'x' }] });
    expect(out.recoveredLegs).toHaveLength(1);
    expect([...out.attemptedSeats]).toEqual(['deepseek#2']);   // #1 healed — nothing to gate
  });
});

// ---- v4.8 T2.2 council review: the contracts a COMMENT was not enough for ----
// Two findings, both "a future change that breaks this must go RED, not merely disagree with a
// paragraph". Nothing below changes behaviour; every assertion holds at the commit that shipped
// T2.2 and is pinned against a named mutant instead of a RED-before-GREEN cycle.
const { srcLegClaimer, legLossKey, twinAliases } = require('../../src/council/run-retry-group');

describe('v4.8 T2.2 review A2: srcLegClaimer\'s single-use-per-leg contract', () => {
  // The finding: the helper is STATEFUL and EXPORTED, and `srcLegClaimer(srcLegs, keyOfSrc)`
  // returning a bare `(key) => …` shows none of that at the call site. The docblock now leads
  // with the contract; these pin it, so the next reader can check the claim rather than trust it.
  const legs = [{ id: 'L1', k: 'deepseek' }, { id: 'L2', k: 'deepseek' }, { id: 'L3', k: 'gpt' }];
  const keyOf = l => l.k;

  test('each leg is handed out AT MOST ONCE, then the key is exhausted', () => {
    // Named mutant "FIND": drop the `pool.delete(l)` (i.e. go back to `srcLegs.find(...)`) and the
    // second call returns L1 again — the exact defect T2.2 shipped this helper to fix: two
    // unattributable twins recorded the SAME source and the second billed leg left no record.
    const claim = srcLegClaimer(legs, keyOf);
    expect(claim('deepseek').id).toBe('L1');
    expect(claim('deepseek').id).toBe('L2');   // a DIFFERENT leg, not L1 again
    expect(claim('deepseek')).toBeNull();      // and then nothing is left to claim
  });

  test('a claim consumes the leg for EVERY later call, not just for its own key', () => {
    // The pool is one shared set, so a leg claimed under one key can never resurface under
    // another. Pinned because `keyOfSrc` is a caller-supplied function: two spellings of the
    // same leg's key must still yield one hand-out.
    const claim = srcLegClaimer(legs, l => (l.id === 'L1' ? 'x' : keyOf(l)));
    expect(claim('x').id).toBe('L1');
    expect(claim('x')).toBeNull();
    expect(claim('deepseek').id).toBe('L2');   // L1 is gone from the pool entirely
    expect(claim('gpt').id).toBe('L3');
  });

  test('one claimer per unit: a fresh claimer starts from a FULL pool', () => {
    // "build ONE per unit, never reuse it" is only safe because the state is per-claimer. A
    // module-level or memoised pool would make the second unit's first claim return null.
    const first = srcLegClaimer(legs, keyOf);
    expect(first('deepseek').id).toBe('L1');
    expect(srcLegClaimer(legs, keyOf)('deepseek').id).toBe('L1');
    expect(legs.map(l => l.id)).toEqual(['L1', 'L2', 'L3']);   // and the caller's array is untouched
  });
});

describe('v4.8 T2.2 review C1/D4: the two invariants supersededKeys rests on', () => {
  // `supersededKeys` (run-stage1-superseded.js :: supersededRows — it was in
  // `run-stage1-rows.js :: pushDeadSeatRows` until the v4.8 T-A6 split) is the ONE join left in the
  // ALIAS-granular keyspace while the dead-seat rows and `attemptedSeats` moved to `rowKeyOf`.
  // Two independent reviewers said the comment ARGUING it safe — (1) skipping is all-or-nothing
  // per UNIT, (2) two UNBOUND LEG-origin twins always share a unit — was not enough, so since v4.8
  // T-A5 that join also CHECKS the one statement both facts exist to make true. These two pins
  // stay: they are WHY the check never fires, and run-stages.test.js pins the check itself.
  const TWIN_MODELS = ['deepseek', 'deepseek'];
  const unboundTwinLegs = () => [deadLeg('deepseek', undefined, undefined, 'r1-s1', 1),
    deadLeg('deepseek', undefined, undefined, 'r1-s1', 2)];

  test('invariant 2: two UNBOUND leg-origin twins group into ONE unit — bench AND lens mode', () => {
    // Lens mode is the load-bearing half: `lensIndexOf(o, null, alias, null)` finds no waveId and
    // no seat object, so it falls through to `o.models.indexOf(alias)` — first-match — and both
    // unbound twins resolve to the SAME lens index. Give an unbound leg a per-leg lens index and
    // this goes RED.
    const seats = buildSeats(TWIN_MODELS, null, null);
    const bench = { runId: 'r1', models: TWIN_MODELS, critic: null, lenses: null, seats };
    const [d1, d2] = unboundTwinLegs();
    const benchUnits = groupStage1Losses(bench, [], [d1, d2], new Map());
    expect(benchUnits).toHaveLength(1);
    expect(benchUnits[0].srcLegs).toEqual([d1, d2]);

    const lensSeats = buildSeats(TWIN_MODELS, null, ['risk', 'cost']);
    const lens = { runId: 'r1', models: TWIN_MODELS, critic: null, lenses: ['risk', 'cost'],
      seats: lensSeats };
    const lensUnits = groupStage1Losses(lens, [], [d1, d2], new Map());
    expect(lensUnits).toHaveLength(1);
    expect(lensUnits[0].srcLegs).toEqual([d1, d2]);
  });

  test('invariant 2, scope: BOUND twins DO split across lens units — and that is safe', () => {
    // The comment's scope is exact and this pins the exact boundary. Bound twins take
    // `seatObj.position`, so they land in DIFFERENT lens units — but they never needed the
    // invariant, because `supersededKeys`' own `keyOf` already tells them apart by seat id.
    const seats = buildSeats(TWIN_MODELS, null, ['risk', 'cost']);
    const o = { runId: 'r1', models: TWIN_MODELS, critic: null, lenses: ['risk', 'cost'], seats };
    const [d1, d2] = unboundTwinLegs();
    const units = groupStage1Losses(o, [], [d1, d2], new Map([[d1, seats[0]], [d2, seats[1]]]));
    expect(units).toHaveLength(2);                                   // the split is REAL
    expect(seats[0].id).not.toBe(seats[1].id);                       // …and keyOf separates them
  });

  test('invariant 1: skipping is all-or-nothing — two unbound twins are BOTH skipped or NEITHER', () => {
    // The property `supersededKeys` actually needs, asserted directly at the retry boundary
    // rather than derived from the two facts.
    // ⚠️ SCOPE, MEASURED 2026-08-17 (T-A8) — the earlier wording here said "mutate ANY skip branch
    // … and this goes RED", and that is FALSE. run-retry.js has TWO wholesale-skip branches and the
    // three shapes below reach only one of them. Mutant PARTIALSKIP (`...unit.srcLegs.slice(0, 1)`),
    // applied to each branch separately and reverse-edited byte-exactly:
    //   OVER-BUDGET branch  -> RED on this test alone (shape (a)); 1 failed of 1289 council tests.
    //   UNMAPPABLE branch (lensIndex null / lens out of range / zero models)
    //                       -> RED on NOTHING. Run against the FULL suite: 537 suites / 7531 passed
    //                          / 8 skipped, entire repo green. No shape HERE builds an unmappable
    //                          unit, so nothing pins the ALL-OR-NOTHING property on that branch.
    // ⚠️ That is a gap in THIS pin, not in the branch's coverage: all three unmappable triggers
    // have behavioural coverage in this same file — zero models, `lensIndex === null` and an
    // out-of-range lensIndex each have their own "is skipped: no launch" test above. What no
    // test builds is an unmappable unit with >=2 `srcLegs`, which is what PARTIALSKIP needs to bite.
    // Both branches are load-bearing for `run-stage1-superseded.js :: supersededRows`' invariant 1,
    // so the uncovered half is a real gap — filed in BACKLOG.md's T-A8 entry. Closing it needs a
    // fourth shape (an unmappable lens unit with two unbound twins), not a change to this one.
    const bothOrNeither = (out, d1, d2) => {
      const skipped = new Set(out.skippedDeadLegs);
      expect([skipped.has(d1), skipped.has(d2)]).toEqual(
        skipped.size > 0 ? [true, true] : [false, false]);
    };

    // (a) over budget -> the whole unit is skipped, both legs together
    const overCtx = fakeCtx({ models: TWIN_MODELS, critic: null }, { overBudget: () => true });
    const [a1, a2] = unboundTwinLegs();
    return retryStage1Losses(overCtx, { deadWaves: [], deadLegs: [a1, a2], counts: COUNTS })
      .then(async (over) => {
        expect(over.skippedDeadLegs).toEqual([a1, a2]);
        expect(over.stillDeadLegs).toEqual([]);
        expect(over.recoveredLegs).toEqual([]);
        bothOrNeither(over, a1, a2);

        // (b) retried and still dead wholesale -> neither is skipped, both are recorded
        const deadCtx = fakeCtx({ models: TWIN_MODELS, critic: null },
          { launchWave: jest.fn().mockResolvedValue({ wave: { waveId: 'r1-s1r1', legs: [] }, exitCode: 0 }) });
        const [b1, b2] = unboundTwinLegs();
        const dead = await retryStage1Losses(deadCtx, { deadWaves: [], deadLegs: [b1, b2], counts: COUNTS });
        expect(dead.skippedDeadLegs).toEqual([]);
        expect(dead.stillDeadLegs).toEqual([b1, b2]);
        bothOrNeither(dead, b1, b2);

        // (c) retried and both healed -> neither skipped, neither still dead
        const healCtx = fakeCtx({ models: TWIN_MODELS, critic: null },
          { launchWave: jest.fn().mockResolvedValue({ wave: { waveId: 'r1-s1r1',
            legs: [usableLeg('deepseek', 'r1-s1r1', 1), usableLeg('deepseek', 'r1-s1r1', 2)] }, exitCode: 0 }) });
        const [c1, c2] = unboundTwinLegs();
        const healed = await retryStage1Losses(healCtx, { deadWaves: [], deadLegs: [c1, c2], counts: COUNTS });
        expect(healed.skippedDeadLegs).toEqual([]);
        expect(healed.recoveredLegs).toHaveLength(2);
        bothOrNeither(healed, c1, c2);
      });
  });
});

describe('v4.8 T2.2 review A1/D3: the minted key is internal — it reaches no NOTE', () => {
  test('attemptedSeats carries the minted key; no emitted still-dead note does', () => {
    // The row half of this pin lives in run-stages.test.js. This is the other serialized
    // surface: degrade notes are what a consumer parses, and `legLossKey`'s docblock claims the
    // key "joins the dead-seat rows, attemptedSeats and deadLegs0, nothing else".
    // Non-vacuity: attemptedSeats MUST contain a minted key, or the absence below proves nothing.
    // ⚠️ This is also the PRODUCER-side red of MUTANT DESYNCPLAN — defined in full at
    // run-stages.test.js :: *"T2.2 control: two orphaned twins whose retry wave dies wholesale
    // get TWO leg-less rows"*, which is its other red. Emptying
    // `run-retry-group.js :: planStillDeadSources`' `twins` puts the UNMINTED key into
    // `attemptedSeats`, so `has(minted)` below goes false. Measured at `9f460526` (RED on two
    // tests) and re-measured on the consolidated tree (RED on three — the third is T-A6's own
    // threading pin, so the red set only grew).
    const ctx = fakeCtx({ models: ['deepseek', 'deepseek'], critic: null },
      { launchWave: jest.fn().mockResolvedValue({ wave: { waveId: 'r1-s1r1', legs: [] }, exitCode: 0 }) });
    const d1 = { ...deadLeg('deepseek', undefined, undefined, 'r1-s1', 1), taskId: 'orphan-a' };
    const d2 = { ...deadLeg('deepseek', undefined, undefined, 'r1-s1', 2), taskId: 'orphan-b' };
    return retryStage1Losses(ctx, { deadWaves: [], deadLegs: [d1, d2], counts: COUNTS })
      .then((out) => {
        const twins = twinAliases(ctx.o.seats);
        const minted = legLossKey(null, 'deepseek', d1, twins);
        expect(minted).toContain('\u0000');                     // the mint fired
        expect(out.attemptedSeats.has(minted)).toBe(true);      // …and it IS the lockstep key
        const json = JSON.stringify(out.stillDeadNotes);
        expect(json).not.toContain('\u0000');
        expect(json).not.toContain('\\u0000');
        expect(json).not.toContain('orphan-a');
        // Every note still names the ALIAS, never a minted key — the contract verdict.js and
        // the Workspace read (`data.seat` compared against `o.critic`, an alias).
        expect(out.stillDeadNotes.map(n => n.data.seat)).toEqual(['deepseek', 'deepseek']);
        expect(out.stillDeadNotes.map(n => n.data.seatId)).toEqual([null, null]);
      });
  });
});

// ---- v4.8 T-A4 (round-1 B1 + B2): a launched KEY is a slot COUNT, not a presence ----
// Both halves ship together on purpose. Closing B1 alone would emit TWO notes that both read
// slot 0's firstFailure, and a duplicate that looks authoritative is worse than the one note
// it replaced. Every number below was measured against the real retryStage1Losses at the
// commit before the fix (roster ['deepseek','deepseek','gpt'], two UNATTRIBUTABLE dead twin
// legs `orphan-a`/`orphan-b`, reasons `boom-A`/`boom-B`).
describe('v4.8 T-A4: two unattributable twins are TWO slots on ONE key', () => {
  const TWIN3 = { models: ['deepseek', 'deepseek', 'gpt'], critic: null };
  // taskIds are overridden to the orphan ids the row keyspace mints from (legLossKey), so
  // these are the same fixtures the T2.2 A1/D3 pin above uses.
  const srcTwins = () => [
    { ...deadLeg('deepseek', 'error', 'boom-A', 'r1-s1', 1), taskId: 'orphan-a' },
    { ...deadLeg('deepseek', 'error', 'boom-B', 'r1-s1', 2), taskId: 'orphan-b' },
  ];
  const retryWave = (...legs) => jest.fn().mockResolvedValue(
    { wave: { waveId: 'r1-s1r1', legs }, exitCode: 0 });
  const firstFailureReasons = (out) => out.stillDeadNotes.map(n => (n.data.firstFailure || {}).reason);
  const runTwins = async (bound, ...legs) => {
    const ctx = fakeCtx(TWIN3, { launchWave: retryWave(...legs) });
    const [d1, d2] = srcTwins();
    const seatOf = bound ? new Map([[d1, ctx.o.seats[0]], [d2, ctx.o.seats[1]]]) : new Map();
    const out = await retryStage1Losses(ctx,
      { deadWaves: [], deadLegs: [d1, d2], counts: COUNTS, seatOf });
    return { ctx, d1, d2, out };
  };

  test('B1: a PARTIAL return announces both dead twins and returns both source legs', async () => {
    // ⚠️ Named mutant SLOTCOLLAPSE — revert the slot COUNT: spell the reconcile's upper bound
    // `1` in place of `Math.max(rec.slots, 1)`. That bound IS the presence test it replaced —
    // a key seen at all yields no note, a key never seen yields exactly one. Measured RED at
    // 1 note and 1 stillDeadLeg, which is exactly the base this fix closes: the run paid for
    // two retry legs and a reader was told ONE seat died.
    const { out, d1, d2 } = await runTwins(false, deadLeg('deepseek', 'error', 'again', 'r1-s1r1', 1));
    expect(out.stillDeadNotes).toHaveLength(2);
    expect(out.stillDeadLegs).toEqual([d1, d2]);   // the SET of sources, one apiece
    // The alias is still all any note names — no minted key, no guessed seat id.
    expect(out.stillDeadNotes.map(n => n.data.seat)).toEqual(['deepseek', 'deepseek']);
  });

  test('B2: on a FULL return each note carries its OWN slot\'s first-failure, not slot 0\'s', async () => {
    // ⚠️ Named mutant SLOTZERO — revert the per-slot firstFailure: spell the leg loop's lookup
    // `.ffs[0]` instead of `.ffs[slot]`. Measured RED at ['boom-A','boom-A'], the base where
    // the second twin's own failure reason reached no announcement anywhere.
    const { out } = await runTwins(false,
      deadLeg('deepseek', 'error', 'again', 'r1-s1r1', 1),
      deadLeg('deepseek', 'error', 'again', 'r1-s1r1', 2));
    expect(firstFailureReasons(out)).toEqual(['boom-A', 'boom-B']);
  });

  test('B1 + B2 control: BOUND twins are UNMOVED — 2 and 2 on a partial, own reasons on a full', async () => {
    // Both halves were already correct here (two seat ids are two keys), and the fix must not
    // disturb it: this is the shape that proves the change is about the KEYSPACE collapse.
    const partial = await runTwins(true, deadLeg('deepseek', 'error', 'again', 'r1-s1r1', 1));
    expect(partial.out.stillDeadNotes).toHaveLength(2);
    expect(partial.out.stillDeadLegs).toEqual([partial.d1, partial.d2]);
    const full = await runTwins(true,
      deadLeg('deepseek', 'error', 'again', 'r1-s1r1', 1),
      deadLeg('deepseek', 'error', 'again', 'r1-s1r1', 2));
    expect(firstFailureReasons(full.out)).toEqual(['boom-A', 'boom-B']);
  });

  test('B1, heal half: the twin a partial return never named is announced even when its twin HEALED', async () => {
    // The same lost seat, in the direction that is easiest to miss: at base this returned
    // 1 recovered / 0 notes / 0 stillDeadLegs, so the second twin vanished from EVERY array —
    // the exact invariant the fix-wave reconcile exists to hold. Its note reads slot 1's
    // reason, which is B2's half of the fix doing the work on the reconcile side.
    const { out } = await runTwins(false, usableLeg('deepseek', 'r1-s1r1', 1));
    expect(out.recoveredLegs).toHaveLength(1);
    expect(out.stillDeadNotes).toHaveLength(1);
    expect(out.stillDeadLegs).toHaveLength(1);
    expect(firstFailureReasons(out)).toEqual(['boom-B']);
  });

  test('wave-origin twins with NO seat identity: both slots reconcile, and neither seat is guessed', async () => {
    // The wave-origin flavour of B1 (base: 1 note, `models:['deepseek']`, `seats:[null]`).
    // It also pins that a multi-slot key's `seat` may be shared across its slots: a key can
    // only hold two slots when NEITHER was identified, so both are null here by construction.
    const ctx = fakeCtx(TWIN3, { launchWave: retryWave(deadLeg('deepseek', 'error', 'again', 'r1-s1r1', 1)) });
    const w = { waveId: 'r1-s1', models: ['deepseek', 'deepseek'], seats: [null, null], reason: 'died' };
    const out = await retryStage1Losses(ctx, { deadWaves: [w], deadLegs: [], counts: COUNTS });
    expect(out.stillDeadNotes).toHaveLength(2);
    expect(out.stillDeadWaves).toEqual([{ waveId: 'r1-s1', models: ['deepseek', 'deepseek'],
      seats: [null, null], reason: 'died' }]);
  });

  test('a retry leg beyond the key\'s LAST slot is skipped, not announced as a third dead seat', async () => {
    // The other side of the count: `slots` is an upper bound as well as a lower one. Three
    // legs came back for a two-slot key, and at base the third read slot 0's firstFailure and
    // announced a seat this unit never launched for — the module's own `if (!ff) continue`
    // rationale, now reachable per SLOT rather than only per key.
    const { out } = await runTwins(false,
      deadLeg('deepseek', 'error', 'again', 'r1-s1r1', 1),
      deadLeg('deepseek', 'error', 'again', 'r1-s1r1', 2),
      deadLeg('deepseek', 'error', 'again', 'r1-s1r1', 3));
    expect(out.stillDeadNotes).toHaveLength(2);
    expect(firstFailureReasons(out)).toEqual(['boom-A', 'boom-B']);
  });
});

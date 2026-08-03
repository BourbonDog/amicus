'use strict';
jest.mock('../../src/council/run-state', () => ({ appendStageWave: jest.fn() }));
const runState = require('../../src/council/run-state');
const { groupStage1Losses, retryStage1Losses } = require('../../src/council/run-retry');

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
    expect(u.firstFailures).toEqual([
      { seat: 'a', class: 'wave', waveId: 'r1-s1', reason: 'server never started' },
      { seat: 'b', class: 'wave', waveId: 'r1-s1', reason: 'server never started' },
    ]);
  });

  test('dead bench legs batch into ONE bench unit; the critic leg gets its own solo unit', () => {
    const la = { modelInput: 'a', status: 'error', error: 'boom' };
    const lc = { modelInput: 'crit', status: 'timeout', error: null };
    const units = groupStage1Losses(O, [], [la, lc]);
    expect(units.map(u => u.unit)).toEqual(['bench', 'critic']); // stable order
    expect(units[0]).toMatchObject({ waveId: 'r1-s1r1', retryOfWaveId: 'r1-s1', models: ['a'], srcLegs: [la] });
    expect(units[1]).toMatchObject({ waveId: 'r1-c1r1', retryOfWaveId: 'r1-c1', models: ['crit'], srcLegs: [lc] });
    expect(units[1].firstFailures).toEqual([{ seat: 'crit', class: 'leg', status: 'timeout', reason: null }]);
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
  return {
    o: { runId: 'r1', runDir, models: ['a', 'b', 'crit'], critic: 'crit', lenses: null,
      briefing: 'B', date: 'D', timeout: 5, gateway: undefined, noValidateModel: false,
      noCostGate: false, councilName: null, fallback: null, catalog: null, ...oOverrides },
    launchers: { launchWave: opts.launchWave || jest.fn(), launchSolo: opts.launchSolo || jest.fn() },
    degrade: { note: (r) => notes.push(r) },
    addWave: jest.fn(),
    overBudget: opts.overBudget || (() => false),
    _notes: notes,
  };
}
const usableLeg = (m) => ({ modelInput: m, status: 'complete', summary: `review by ${m}` });
const deadLeg = (m, status = 'error', error = 'boom') => ({ modelInput: m, status, error });
const COUNTS = { reviewed: 1, total: 3 };

describe('retryStage1Losses (SL-2 Task 4)', () => {
  test('recovery: heal per seat, recovered legs returned, no still-dead output', async () => {
    const launchWave = jest.fn().mockResolvedValue(
      { wave: { waveId: 'r1-s1r1', legs: [usableLeg('a'), usableLeg('b')] }, exitCode: 0 });
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
    const launchWave = jest.fn().mockImplementation(async () => { order.push('launch');
      return { wave: { waveId: 'r1-s1r1', legs: [usableLeg('a')] }, exitCode: 0 }; });
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
    const launchWave = jest.fn().mockResolvedValue(
      { wave: { waveId: 'r1-s1r1', legs: [usableLeg('a'), deadLeg('b', 'timeout', null)] }, exitCode: 0 });
    const ctx = fakeCtx({}, { launchWave });
    const r = await retryStage1Losses(ctx, { deadWaves: [],
      deadLegs: [deadLeg('a'), deadLeg('b')], counts: COUNTS });
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
    const launchWave = jest.fn().mockResolvedValue(
      { wave: { waveId: 'r1-s1r1', legs: [deadLeg('a', 'error', 'again')] }, exitCode: 0 });
    const ctx = fakeCtx({}, { launchWave });
    const r = await retryStage1Losses(ctx, {
      deadWaves: [{ waveId: 'r1-s1', models: ['a'], reason: 'died' }], deadLegs: [], counts: COUNTS });
    expect(r.stillDeadNotes[0]).toMatchObject({ channel: 'dead-leg',
      why: "its first wave r1-s1 produced no legs (died); its once-only retry leg ended 'error' with no usable output" });
    expect(r.stillDeadWaves).toEqual([{ waveId: 'r1-s1', models: ['a'], reason: 'died' }]);
  });

  test('critic retries as a SOLO with launchSolo; heal keys deriveSeatLoss-compatible data', async () => {
    const launchSolo = jest.fn().mockResolvedValue(
      { wave: { waveId: 'r1-c1r1', legs: [usableLeg('crit')] }, exitCode: 0, leg: usableLeg('crit') });
    const ctx = fakeCtx({}, { launchSolo });
    const r = await retryStage1Losses(ctx, { deadWaves: [], deadLegs: [deadLeg('crit')], counts: COUNTS });
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
    const order = [];
    const launchWave = jest.fn().mockImplementation(() => {
      order.push('bench');
      return new Promise((resolve) => {
        setTimeout(() => {
          order.push('bench-done');
          resolve({ wave: { waveId: 'r1-s1r1', legs: [usableLeg('a')] }, exitCode: 0 });
        }, 0);
      });
    });
    const launchSolo = jest.fn().mockImplementation(async () => { order.push('critic');
      return { wave: { waveId: 'r1-c1r1', legs: [usableLeg('crit')] }, exitCode: 0 }; });
    const ctx = fakeCtx({}, { launchWave, launchSolo });
    await retryStage1Losses(ctx, { deadWaves: [], deadLegs: [deadLeg('a'), deadLeg('crit')], counts: COUNTS });
    expect(order).toEqual(['bench', 'bench-done', 'critic']);
  });

  test('overBudget pre-gate (D7): unit skipped, original entries routed back untouched, no launch', async () => {
    const launchWave = jest.fn();
    const ctx = fakeCtx({}, { launchWave, overBudget: () => true });
    const w = { waveId: 'r1-s1', models: ['a'], reason: 'died' };
    const l = deadLeg('crit');
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
    expect(u.firstFailures[0]).toEqual({ seat: 'a', class: 'leg', status: 'error', reason: 'boom' });
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
    const ghost = deadLeg('ghost'); // not in o.models -> lensIndexOf returns null
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
    const launchWave = jest.fn().mockResolvedValue(
      { wave: { waveId: 'r1-s1r1', legs: [usableLeg('a')] }, exitCode: 0 });
    const ctx = fakeCtx({}, { launchWave });
    const r = await retryStage1Losses(ctx, { deadWaves: [],
      deadLegs: [deadLeg('a'), deadLeg('b')], counts: COUNTS });
    expect(r.recoveredLegs.map(l => l.modelInput)).toEqual(['a']);
    expect(r.stillDeadNotes).toHaveLength(1);
    expect(r.stillDeadNotes[0]).toMatchObject({ channel: 'dead-leg', what: 'seat b did not review',
      why: "the leg ended 'error': boom with no usable output; its once-only retry produced no leg for this seat" });
    expect(r.stillDeadLegs.map(l => l.modelInput)).toEqual(['b']);
  });

  test('CRITICAL: wave-origin partial return — an unseen seat lands in stillDeadWaves with reduced ' +
    'models, never vanishes', async () => {
    // deadWave names ['a','b']; the retry wave comes back naming ONLY 'a'.
    const launchWave = jest.fn().mockResolvedValue(
      { wave: { waveId: 'r1-s1r1', legs: [usableLeg('a')] }, exitCode: 0 });
    const ctx = fakeCtx({}, { launchWave });
    const r = await retryStage1Losses(ctx, {
      deadWaves: [{ waveId: 'r1-s1', models: ['a', 'b'], reason: 'died' }], deadLegs: [], counts: COUNTS });
    expect(r.recoveredLegs.map(l => l.modelInput)).toEqual(['a']);
    expect(r.stillDeadWaves).toEqual([{ waveId: 'r1-s1', models: ['b'], reason: 'died' }]);
    const note = r.stillDeadNotes.find(n => n.data && n.data.seat === 'b');
    expect(note).toMatchObject({ channel: 'dead-leg', what: 'seat b did not review',
      why: 'its first wave r1-s1 produced no legs (died); its once-only retry produced no leg for this seat' });
  });

  test('every input seat lands in exactly one of recovered / still-dead / skipped (invariant, mixed unit)', async () => {
    // bench unit ['a','b','c']: 'a' comes back usable, 'b' comes back but
    // unusable (per-leg still-dead), 'c' has no leg record at all (the
    // CRITICAL reconciliation path) -- every seat must be accounted for
    // exactly once across the three buckets.
    const launchWave = jest.fn().mockResolvedValue({ wave: { waveId: 'r1-s1r1',
      legs: [usableLeg('a'), deadLeg('b', 'timeout', null)] }, exitCode: 0 }); // 'c' entirely absent
    const ctx = fakeCtx({}, { launchWave });
    const r = await retryStage1Losses(ctx, { deadWaves: [],
      deadLegs: [deadLeg('a'), deadLeg('b'), deadLeg('c')], counts: COUNTS });
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
    const r = await retryStage1Losses(ctx, { deadWaves: [],
      deadLegs: [deadLeg('a'), deadLeg('b')], counts: COUNTS });
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
    const l = deadLeg('a', 'timeout', null);
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
    const launchWave = jest.fn().mockResolvedValue(
      { wave: { waveId: 'r1-s1r1', legs: [usableLeg('a'), usableLeg('ghost')] }, exitCode: 0 });
    const ctx = fakeCtx({}, { launchWave });
    const r = await retryStage1Losses(ctx, {
      deadWaves: [{ waveId: 'r1-s1', models: ['a'], reason: 'died' }], deadLegs: [], counts: COUNTS });
    expect(r.recoveredLegs.map(l => l.modelInput)).toEqual(['a']);
    expect(ctx._notes).toHaveLength(1); // only a's heal — no bogus heal for 'ghost'
    expect(ctx._notes[0].data.seat).toBe('a');
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

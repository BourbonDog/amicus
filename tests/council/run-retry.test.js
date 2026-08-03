'use strict';
jest.mock('../../src/council/run-state', () => ({ appendStageWave: jest.fn() }));
const runState = require('../../src/council/run-state');
const { groupStage1Losses, retryStage1Losses } = require('../../src/council/run-retry');

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

function fakeCtx(oOverrides = {}, opts = {}) {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl2-'));
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
    const order = [];
    const launchWave = jest.fn().mockImplementation(async () => { order.push('bench');
      return { wave: { waveId: 'r1-s1r1', legs: [usableLeg('a')] }, exitCode: 0 }; });
    const launchSolo = jest.fn().mockImplementation(async () => { order.push('critic');
      return { wave: { waveId: 'r1-c1r1', legs: [usableLeg('crit')] }, exitCode: 0 }; });
    const ctx = fakeCtx({}, { launchWave, launchSolo });
    await retryStage1Losses(ctx, { deadWaves: [], deadLegs: [deadLeg('a'), deadLeg('crit')], counts: COUNTS });
    expect(order).toEqual(['bench', 'critic']);
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

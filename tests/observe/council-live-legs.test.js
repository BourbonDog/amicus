'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * DE-ROT (F01): buildCouncilStatusPayload computes per-leg enriched usage
 * into a local `usageLegs` array, sums it into `payload.usage`, and discards
 * the rows — the live Seats panel has no data source. This test pins the fix:
 * one row per leg id (including legs that have not flushed usage yet), plus
 * a run-level stall rollup.
 */
describe('buildCouncilStatusPayload: legs[] + stall flags (DE-ROT F01)', () => {
  const runState = require('../../src/council/run-state');
  let projectDir;

  beforeEach(() => { jest.resetModules(); projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-legs-')); });
  afterEach(() => { jest.resetModules(); });

  /** A running council run with one active stage1 wave. @returns {string} runDir */
  function seedRun() {
    const runDir = path.join(projectDir, 'run1');
    runState.initRun(runDir, {
      schemaVersion: 2, type: 'council-run', runId: 'run1', status: 'running',
      stages: [{ name: 'stage1', status: 'running', waveId: 'run1-s1', project: runDir }],
      bench: ['gemini', 'gpt', 'deepseek'], chair: 'claude', critic: null, lenses: null, labelMap: null,
      options: { outDir: runDir }, usage: null, pid: process.pid,
      createdAt: new Date().toISOString(),
    });
    runState.writePointer(projectDir, 'run1', runDir);

    const waveDir = path.join(runDir, '.claude', 'amicus_sessions', 'run1-s1');
    fs.mkdirSync(waveDir, { recursive: true });
    fs.writeFileSync(path.join(waveDir, 'metadata.json'), JSON.stringify({
      taskId: 'run1-s1', type: 'wave', status: 'running',
      legs: ['run1-s1-1', 'run1-s1-2', 'run1-s1-3'],
    }));
    return runDir;
  }

  function legDir(runDir, legId) {
    const dir = path.join(runDir, '.claude', 'amicus_sessions', legId);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  test('one row per leg id — priced, not-yet-priced, and stalled all present', () => {
    const runDir = seedRun();
    const { writeProgress } = require('../../src/sidecar/progress');

    // leg1: already priced, fresh activity.
    const d1 = legDir(runDir, 'run1-s1-1');
    fs.writeFileSync(path.join(d1, 'metadata.json'), JSON.stringify({ taskId: 'run1-s1-1', status: 'running', model: 'gemini' }));
    writeProgress(d1, 'receiving', {
      usage: { tokens: { input: 40, output: 10, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, costReported: 0.02 },
    });

    // leg2: just started — metadata written, no progress.json yet (the trap
    // case: the naive `payload.legs = usageLegs` would drop this row entirely).
    const d2 = legDir(runDir, 'run1-s1-2');
    fs.writeFileSync(path.join(d2, 'metadata.json'), JSON.stringify({ taskId: 'run1-s1-2', status: 'running', model: 'gpt' }));

    // leg3: running, but its progress.json is stale past the stall threshold.
    const d3 = legDir(runDir, 'run1-s1-3');
    fs.writeFileSync(path.join(d3, 'metadata.json'), JSON.stringify({ taskId: 'run1-s1-3', status: 'running', model: 'deepseek' }));
    const staleTime = new Date(Date.now() - 3 * 60 * 1000);
    fs.writeFileSync(path.join(d3, 'progress.json'), JSON.stringify({
      stage: 'receiving', stageLabel: 'Generating response...', updatedAt: staleTime.toISOString(),
    }));

    const { buildCouncilStatusPayload } = require('../../src/mcp-council-awareness');
    const doc = buildCouncilStatusPayload(projectDir, 'run1');

    // Point 5: still a live doc for a non-terminal run.
    expect(doc.view).toBe('live');

    // Point 1: one row per leg id, including the not-yet-priced leg.
    expect(doc.legs).toHaveLength(3);
    const byId = Object.fromEntries(doc.legs.map((l) => [l.taskId, l]));

    // Point 2: taskId + model + status always present; usage only when priced.
    expect(byId['run1-s1-1'].model).toBe('gemini');
    expect(byId['run1-s1-1'].status).toBe('running');
    expect(byId['run1-s1-1'].usage).toBeDefined();
    expect(byId['run1-s1-1'].usage.cost.amount).toBeCloseTo(0.02);

    expect(byId['run1-s1-2'].model).toBe('gpt');
    expect(byId['run1-s1-2'].status).toBe('running');
    expect(byId['run1-s1-2'].usage).toBeUndefined();

    // Point 3: the stale leg flags itself, and the run-level rollup surfaces it.
    expect(byId['run1-s1-3'].stalled).toBe(true);
    expect(byId['run1-s1-1'].stalled).toBe(false);
    expect(doc.stalled).toBe(true);
    expect(typeof doc.stalledForSeconds).toBe('number');
    expect(doc.stalledForSeconds).toBeGreaterThanOrEqual(170);

    // Point 4: no regression — legsTotal/legsComplete computed exactly as before.
    expect(doc.legsTotal).toBe(3);
    expect(doc.legsComplete).toBe(0);
  });

  test('no active sub-wave yet: no legs key, no stalled key, matches pre-existing null behavior', () => {
    const runDir = path.join(projectDir, 'run2');
    runState.initRun(runDir, {
      schemaVersion: 2, type: 'council-run', runId: 'run2', status: 'running',
      stages: [{ name: 'stage1', status: 'running', waveId: null }],
      bench: ['gemini'], chair: 'claude', critic: null, lenses: null, labelMap: null,
      options: { outDir: runDir }, usage: null, pid: process.pid,
      createdAt: new Date().toISOString(),
    });
    runState.writePointer(projectDir, 'run2', runDir);

    const { buildCouncilStatusPayload } = require('../../src/mcp-council-awareness');
    const doc = buildCouncilStatusPayload(projectDir, 'run2');

    expect(doc.legsTotal).toBeNull();
    expect(doc.legsComplete).toBeNull();
    expect(doc.legs).toBeUndefined();
    expect(doc.stalled).toBeUndefined();
  });
});

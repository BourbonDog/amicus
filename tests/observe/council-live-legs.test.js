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
 *
 * DE-ROT (F34/F36): a live leg's `model` is the RESOLVED executable id
 * (metadata.model), never the council ALIAS that run.json's
 * bench/chair/critic/lenses and roleFor are keyed on. Every fixture below
 * deliberately uses a `model` string that looks nothing like its alias
 * (`google/gemini-2.5` vs `gemini`) so a regression that reads role/blind-name
 * off `model` instead of `modelInput` fails loudly instead of accidentally
 * passing.
 */
describe('buildCouncilStatusPayload: legs[] + stall flags (DE-ROT F01)', () => {
  const runState = require('../../src/council/run-state');
  let projectDir;

  beforeEach(() => { jest.resetModules(); projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-legs-')); });
  afterEach(() => { jest.resetModules(); });

  /** A running council run with one active stage1 wave; critic = 'deepseek'. @returns {string} runDir */
  function seedRun() {
    const runDir = path.join(projectDir, 'run1');
    runState.initRun(runDir, {
      schemaVersion: 2, type: 'council-run', runId: 'run1', status: 'running',
      stages: [{ name: 'stage1', status: 'running', waveId: 'run1-s1', project: runDir }],
      bench: ['gemini', 'gpt', 'deepseek'], chair: 'claude', critic: 'deepseek', lenses: null, labelMap: null,
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

    // leg1: bench seat 'gemini', already priced, fresh activity. Resolved
    // model id is deliberately unrelated to the alias.
    const d1 = legDir(runDir, 'run1-s1-1');
    fs.writeFileSync(path.join(d1, 'metadata.json'), JSON.stringify({
      taskId: 'run1-s1-1', status: 'running', model: 'google/gemini-2.5', modelInput: 'gemini',
    }));
    writeProgress(d1, 'receiving', {
      usage: { tokens: { input: 40, output: 10, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, costReported: 0.02 },
    });

    // leg2: bench seat 'gpt', just started — metadata written, no progress.json
    // yet (the trap case: the naive `payload.legs = usageLegs` would drop this
    // row entirely).
    const d2 = legDir(runDir, 'run1-s1-2');
    fs.writeFileSync(path.join(d2, 'metadata.json'), JSON.stringify({
      taskId: 'run1-s1-2', status: 'running', model: 'openai/gpt-5', modelInput: 'gpt',
    }));

    // leg3: the CRITIC ('deepseek'), running but stale past the stall
    // threshold. Its resolved model does NOT equal the alias 'deepseek' —
    // proves role is resolved against modelInput, not model.
    const d3 = legDir(runDir, 'run1-s1-3');
    fs.writeFileSync(path.join(d3, 'metadata.json'), JSON.stringify({
      taskId: 'run1-s1-3', status: 'running', model: 'deepseek/deepseek-v3', modelInput: 'deepseek',
    }));
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
    expect(byId['run1-s1-1'].model).toBe('google/gemini-2.5');
    expect(byId['run1-s1-1'].status).toBe('running');
    expect(byId['run1-s1-1'].usage).toBeDefined();
    expect(byId['run1-s1-1'].usage.cost.amount).toBeCloseTo(0.02);

    expect(byId['run1-s1-2'].model).toBe('openai/gpt-5');
    expect(byId['run1-s1-2'].status).toBe('running');
    expect(byId['run1-s1-2'].usage).toBeUndefined();

    // F36: modelInput carries the ALIAS (blind mode / labelOf keys on this).
    expect(byId['run1-s1-1'].modelInput).toBe('gemini');
    expect(byId['run1-s1-2'].modelInput).toBe('gpt');
    expect(byId['run1-s1-3'].modelInput).toBe('deepseek');

    // F34: role resolves via roleFor keyed on modelInput. leg3 is the load-
    // bearing assertion — its resolved `model` string ('deepseek/deepseek-v3')
    // does not equal run.critic ('deepseek'), so a buggy implementation that
    // matched role against `model` would return 'seat' here, not 'critic'.
    expect(byId['run1-s1-1'].role).toBe('seat');
    expect(byId['run1-s1-2'].role).toBe('seat');
    expect(byId['run1-s1-3'].role).toBe('critic');

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

  test('chair-stage legs get role "chair" regardless of which alias actually ran', () => {
    // Simulates run-chair.js's fallback chain: ch1/ch2 try run.chair's own
    // alias ('claude'); ch3 promotes a DIFFERENT, ledger-picked alias that can
    // coincide with a bench member ('gemini') — run.json's `chair` field is
    // only checkpointed once the whole chain resolves (run-chair.js:122), so
    // while ch3 is live, alias-matching against run.chair would miss it, and
    // matching against bench would wrongly call it a 'seat'. The stage name
    // ('chair') is the only reliable signal.
    const runDir = path.join(projectDir, 'run-chair');
    runState.initRun(runDir, {
      schemaVersion: 2, type: 'council-run', runId: 'run-chair', status: 'running',
      stages: [{ name: 'chair', status: 'running', waveId: 'run-chair-ch3', project: runDir }],
      bench: ['gemini', 'gpt'], chair: 'claude', critic: null, lenses: null, labelMap: null,
      options: { outDir: runDir }, usage: null, pid: process.pid,
      createdAt: new Date().toISOString(),
    });
    runState.writePointer(projectDir, 'run-chair', runDir);

    const waveDir = path.join(runDir, '.claude', 'amicus_sessions', 'run-chair-ch3');
    fs.mkdirSync(waveDir, { recursive: true });
    fs.writeFileSync(path.join(waveDir, 'metadata.json'), JSON.stringify({
      taskId: 'run-chair-ch3', type: 'wave', status: 'running', legs: ['run-chair-ch3-1'],
    }));
    const d = legDir(runDir, 'run-chair-ch3-1');
    fs.writeFileSync(path.join(d, 'metadata.json'), JSON.stringify({
      taskId: 'run-chair-ch3-1', status: 'running', model: 'google/gemini-2.5', modelInput: 'gemini',
    }));

    const { buildCouncilStatusPayload } = require('../../src/mcp-council-awareness');
    const doc = buildCouncilStatusPayload(projectDir, 'run-chair');

    expect(doc.legs).toHaveLength(1);
    expect(doc.legs[0].modelInput).toBe('gemini');
    expect(doc.legs[0].role).toBe('chair');
  });

  test('modelInput not yet written: row carries a truthful null, never a guessed role or the resolved model id', () => {
    const runDir = seedRun();
    // leg1 only — metadata written WITHOUT modelInput (the tiny window before
    // fanout-leg.js's writeLegPatch lands, or an older/foreign leg record).
    const d1 = legDir(runDir, 'run1-s1-1');
    fs.writeFileSync(path.join(d1, 'metadata.json'), JSON.stringify({
      taskId: 'run1-s1-1', status: 'running', model: 'google/gemini-2.5',
    }));

    const { buildCouncilStatusPayload } = require('../../src/mcp-council-awareness');
    const doc = buildCouncilStatusPayload(projectDir, 'run1');
    const row = doc.legs.find((l) => l.taskId === 'run1-s1-1');

    expect(row.modelInput).toBeNull();
    expect(row.role).toBeNull();
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

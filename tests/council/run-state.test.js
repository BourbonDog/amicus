// tests/council/run-state.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const rs = require('../../src/council/run-state');

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'council-state-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const runDirOf = () => path.join(tmp, 'council-abc123');

describe('run.json init + checkpoint', () => {
  test('initRun creates the dir and writes the seed', () => {
    const run = rs.initRun(runDirOf(), {
      schemaVersion: 2, type: 'council-run', runId: 'abc123', status: 'running',
      stages: [], createdAt: '2026-07-19T00:00:00.000Z',
    });
    expect(run.type).toBe('council-run');
    const onDisk = JSON.parse(fs.readFileSync(path.join(runDirOf(), 'run.json'), 'utf-8'));
    expect(onDisk.runId).toBe('abc123');
    expect(onDisk.schemaVersion).toBe(2);
  });

  test('initRun over an existing run.json preserves createdAt (MCP pre-seed then CLI child)', () => {
    rs.initRun(runDirOf(), { runId: 'abc123', status: 'running', createdAt: 'T0' });
    const run = rs.initRun(runDirOf(), { runId: 'abc123', status: 'running', createdAt: 'T1', pid: 42 });
    expect(run.createdAt).toBe('T0');
    expect(run.pid).toBe(42);
  });

  test('checkpoint merges and survives crash-resume reads', () => {
    rs.initRun(runDirOf(), { runId: 'abc123', status: 'running', stages: [] });
    rs.checkpoint(runDirOf(), { labelMap: { 'Review A': 'deepseek' } });
    const back = rs.readRun(runDirOf());
    expect(back.labelMap).toEqual({ 'Review A': 'deepseek' });
    expect(back.status).toBe('running');
  });

  test('abort-wins: a later checkpoint cannot demote status aborted', () => {
    rs.initRun(runDirOf(), { runId: 'abc123', status: 'running' });
    rs.checkpoint(runDirOf(), { status: 'aborted', exitCode: 130 });
    const run = rs.checkpoint(runDirOf(), { status: 'complete', usage: null });
    expect(run.status).toBe('aborted');
    expect(run.usage).toBeNull(); // non-status fields still merge
  });

  test('abort-wins: falsy status (null) cannot overwrite aborted', () => {
    rs.initRun(runDirOf(), { runId: 'abc123', status: 'running' });
    rs.checkpoint(runDirOf(), { status: 'aborted', exitCode: 130 });
    const run = rs.checkpoint(runDirOf(), { status: null, usage: { tokens: 5 } });
    expect(run.status).toBe('aborted');
    expect(run.usage).toEqual({ tokens: 5 });
  });

  test('abort-wins: omitted status cannot change aborted', () => {
    rs.initRun(runDirOf(), { runId: 'abc123', status: 'running' });
    rs.checkpoint(runDirOf(), { status: 'aborted', exitCode: 130 });
    const run = rs.checkpoint(runDirOf(), { usage: { tokens: 9 } }); // no status key
    expect(run.status).toBe('aborted');
    expect(run.usage).toEqual({ tokens: 9 });
  });

  test('abort-wins: initRun after aborted checkpoint keeps aborted', () => {
    rs.initRun(runDirOf(), { runId: 'abc123', status: 'running' });
    rs.checkpoint(runDirOf(), { status: 'aborted', exitCode: 130 });
    const run = rs.initRun(runDirOf(), { runId: 'abc123', status: 'complete', pid: 42 });
    expect(run.status).toBe('aborted');
    expect(run.pid).toBe(42);
  });

  // Whole-branch review FIX 3: abort-wins pinned only `status`; a later
  // (racing) success finalize's exitCode:0 still overwrote, yielding
  // {status:'aborted', exitCode:0}. Plan C's Action v2 branches on exitCode
  // (0 and 2 proceed), so an aborted run would be consumed as clean success.
  // exitCode must be pinned to a signal-abort code (130/143) too.
  test('abort-wins: a racing success finalize cannot demote exitCode 130 to 0', () => {
    rs.initRun(runDirOf(), { runId: 'abc123', status: 'running' });
    rs.checkpoint(runDirOf(), { status: 'aborted', exitCode: 130 });
    const run = rs.checkpoint(runDirOf(), { status: 'complete', exitCode: 0, usage: { cost: { amount: 1 } } });
    expect(run.status).toBe('aborted');
    expect(run.exitCode).toBe(130);
    expect(run.usage).toEqual({ cost: { amount: 1 } }); // non-exitCode fields still merge
  });

  test('abort-wins: no recorded abort exitCode defaults the pin to 143 (SIGTERM), never 0', () => {
    rs.initRun(runDirOf(), { runId: 'abc123', status: 'running' });
    rs.checkpoint(runDirOf(), { status: 'aborted' }); // no exitCode recorded on the abort itself
    const run = rs.checkpoint(runDirOf(), { status: 'complete', exitCode: 0 });
    expect(run.status).toBe('aborted');
    expect(run.exitCode).toBe(143);
  });

  test('abort-wins: FIRST write that sets status aborted WITHOUT exitCode pins exitCode to 143 (MF-3 fix)', () => {
    rs.initRun(runDirOf(), { runId: 'abc123', status: 'running' });
    // First write sets status to aborted without an exitCode (e.g. abortCouncilRun)
    const run = rs.checkpoint(runDirOf(), { status: 'aborted', completedAt: '2026-07-20T00:00:00.000Z' });
    expect(run.status).toBe('aborted');
    expect(run.exitCode).toBe(143); // must pin to canonical abort code, not undefined
  });

  /**
   * ⚠️ PR #200 round-3 finding C2 (MEASURED, then REFUTED — and the measurement
   * exposed this pin overclaiming). The finding was that the Stage-5 rebuild's
   * new `readRun(runDir)` call (cli-handlers-council.js :: runVerdict) is
   * unguarded while every sibling read is try/catch'd, so a malformed run.json
   * would throw out of it. It cannot: readRun's try encloses `runPath(runDir)`
   * as well as the read and the parse, so a bad path, a missing file and
   * unparseable bytes all return null — and the call site sits inside runVerdict's
   * own try/catch besides.
   *
   * But the pin that should have SAID so only ever passed a path with no file at
   * it: the name promised "corrupt" and the body tested "missing". Both cases
   * are exercised now, so the name is true and the no-throw contract the Stage-5
   * rebuild leans on is actually held down.
   *
   * Named mutant READRUNUNCAUGHT: drop the try/catch from run-state.js ::
   * readRun (`return JSON.parse(fs.readFileSync(runPath(runDir), 'utf-8'));`).
   */
  test('readRun returns null for a missing/corrupt file', () => {
    expect(rs.readRun(path.join(tmp, 'nope'))).toBeNull();
    const corrupt = path.join(tmp, 'corrupt-run');
    fs.mkdirSync(corrupt, { recursive: true });
    fs.writeFileSync(path.join(corrupt, 'run.json'), '{ "runId": "abc123", trunc');
    expect(rs.readRun(corrupt)).toBeNull();                 // unparseable → null, never a throw
    fs.writeFileSync(path.join(corrupt, 'run.json'), '');
    expect(rs.readRun(corrupt)).toBeNull();                 // empty file → null too
  });
});

// F1 (Task-5 review): initCouncilRun's `...(o.template ? { template: o.template } : {})`
// seed (line 106) had zero direct coverage — pin both the present and null cases.
describe('initCouncilRun template seeding (F9 v4.5)', () => {
  const baseOpts = () => ({
    runId: 'abc123', runDir: runDirOf(), project: tmp,
    models: ['gemini', 'gpt'], chair: 'deepseek', critic: null, lenses: null,
  });

  test('o.template present -> readRun(runDir).template deep-equals it', () => {
    rs.initCouncilRun({ ...baseOpts(), template: { name: 'x', hash: 'abcdef123456' } });
    expect(rs.readRun(runDirOf()).template).toEqual({ name: 'x', hash: 'abcdef123456' });
  });

  test('o.template null (the production shape run.js passes) -> "template" key is absent from run.json, not null', () => {
    rs.initCouncilRun({ ...baseOpts(), template: null });
    expect('template' in rs.readRun(runDirOf())).toBe(false);
  });
});

/**
 * v4.4.1 council finding D6 — `checkpoint()` is a READ-MERGE-WRITE, pinned.
 *
 * Every "never fail closed" degrade in a council run records itself by patching
 * ONE top-level key onto run.json from a different code path: run-budget.js
 * writes `budgetRefusals[]` when the ceiling refuses a wave, run-server.js
 * writes `sharedServer`/`sharedServerUnavailable` at acquisition, run-finalize.js
 * writes the terminal fields. If `checkpoint` were a whole-file WRITE rather
 * than a read-merge-write, whichever of those landed last would silently erase
 * the others — one degrade would hide another, which is precisely the failure
 * mode this release exists to remove. Nothing pinned that, so these do.
 */
describe('checkpoint merge semantics (finding D6)', () => {
  test('independent degrade records written by different code paths all survive together', () => {
    rs.initRun(runDirOf(), { schemaVersion: 2, runId: 'abc123', status: 'running', stages: [] });
    // The exact writes, in the exact order a degraded run makes them.
    rs.checkpoint(runDirOf(), { sharedServerUnavailable: { error: 'database is locked', at: 'T1' } });
    rs.updateStage(runDirOf(), 'stage1', { status: 'partial' });
    rs.checkpoint(runDirOf(), { budgetRefusals: [{ waveId: 'abc123-c1', models: ['kimi'] }] });
    rs.checkpoint(runDirOf(), { labelMap: { 'Review A': 'gpt' } });
    rs.checkpoint(runDirOf(), { status: 'partial', exitCode: 2, completedAt: 'T9' });

    const doc = rs.readRun(runDirOf());
    expect(doc.sharedServerUnavailable).toEqual({ error: 'database is locked', at: 'T1' });
    expect(doc.budgetRefusals).toEqual([{ waveId: 'abc123-c1', models: ['kimi'] }]);
    expect(doc.labelMap).toEqual({ 'Review A': 'gpt' });
    expect(doc.stages).toEqual([{ name: 'stage1', status: 'partial' }]);
    expect(doc.exitCode).toBe(2);
    expect(doc.runId).toBe('abc123'); // …and the seed is still there
  });

  test('order does not matter — the same two keys survive written the other way round', () => {
    rs.initRun(runDirOf(), { runId: 'abc123', status: 'running' });
    rs.checkpoint(runDirOf(), { budgetRefusals: [{ waveId: 'w1', models: ['a'] }] });
    rs.checkpoint(runDirOf(), { sharedServerUnavailable: { error: 'locked' } });
    const doc = rs.readRun(runDirOf());
    expect(doc.budgetRefusals).toHaveLength(1);
    expect(doc.sharedServerUnavailable.error).toBe('locked');
  });

  test('the positive shared-server record coexists with a budget refusal too', () => {
    rs.initRun(runDirOf(), { runId: 'abc123', status: 'running' });
    rs.checkpoint(runDirOf(), { sharedServer: { acquired: true, at: 'T0', goPid: 4242, models: 4 } });
    rs.checkpoint(runDirOf(), { budgetRefusals: [{ waveId: 'w1', models: ['a'] }] });
    const doc = rs.readRun(runDirOf());
    expect(doc.sharedServer).toEqual({ acquired: true, at: 'T0', goPid: 4242, models: 4 });
    expect(doc.budgetRefusals).toHaveLength(1);
  });

  // ⚠️ The merge is TOP-LEVEL ONLY. Patching a key replaces its whole value —
  // it is not a deep merge. Harmless for the disjoint keys above (each is owned
  // end to end by one writer), but a future writer that patches a SUB-field of
  // someone else's object would drop the rest of it. Pinned so that limit is
  // documented behaviour and not a discovery.
  test('the merge is shallow: patching a key replaces its whole value', () => {
    rs.initRun(runDirOf(), { runId: 'abc123', status: 'running' });
    rs.checkpoint(runDirOf(), { usage: { cost: { amount: 1 }, tokens: 500 } });
    rs.checkpoint(runDirOf(), { usage: { cost: { amount: 2 } } });
    expect(rs.readRun(runDirOf()).usage).toEqual({ cost: { amount: 2 } }); // `tokens` is gone
  });
});

describe('updateStage', () => {
  test('upserts by name, preserving other stages', () => {
    rs.initRun(runDirOf(), { runId: 'abc123', status: 'running', stages: [] });
    rs.updateStage(runDirOf(), 'stage1', { status: 'running', startedAt: 'T0', waveId: 'abc123-s1' });
    rs.updateStage(runDirOf(), 'stage2', { status: 'running', startedAt: 'T1' });
    const run = rs.updateStage(runDirOf(), 'stage1', { status: 'complete', completedAt: 'T2' });
    expect(run.stages).toEqual([
      { name: 'stage1', status: 'complete', startedAt: 'T0', completedAt: 'T2', waveId: 'abc123-s1' },
      { name: 'stage2', status: 'running', startedAt: 'T1' },
    ]);
  });
});

describe('pointer files', () => {
  test('writePointer + readPointer roundtrip, with and without the council- prefix', () => {
    rs.writePointer(tmp, 'abc123', runDirOf());
    expect(rs.pointerPath(tmp, 'abc123')).toBe(
      path.join(tmp, '.claude', 'amicus_sessions', 'council-abc123.json'));
    expect(rs.readPointer(tmp, 'abc123')).toEqual({ runId: 'abc123', runDir: runDirOf() });
    expect(rs.readPointer(tmp, 'council-abc123')).toEqual({ runId: 'abc123', runDir: runDirOf() });
  });

  test('readPointer returns null when absent', () => {
    expect(rs.readPointer(tmp, 'nope99')).toBeNull();
  });

  test('listPointers enumerates only well-formed council pointers', () => {
    rs.writePointer(tmp, 'abc123', runDirOf());
    rs.writePointer(tmp, 'def456', path.join(tmp, 'council-def456'));
    const root = path.join(tmp, '.claude', 'amicus_sessions');
    fs.writeFileSync(path.join(root, 'council-broken.json'), '{nope');
    fs.mkdirSync(path.join(root, 'a1b2c3d4'), { recursive: true }); // ordinary session dir
    const ids = rs.listPointers(tmp).map(p => p.runId).sort();
    expect(ids).toEqual(['abc123', 'def456']);
  });
});

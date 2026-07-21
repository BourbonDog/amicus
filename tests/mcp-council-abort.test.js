// tests/mcp-council-abort.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const runState = require('../src/council/run-state');

let tmp; let handlers;
beforeEach(() => {
  jest.resetModules();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-cabort-'));
  handlers = require('../src/mcp-server').handlers;
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); jest.resetModules(); });

function seedRunningCouncil() {
  const runDir = path.join(tmp, 'council-abc123');
  const scratch = path.join(runDir, '_scratch');
  runState.initRun(runDir, {
    schemaVersion: 2, type: 'council-run', runId: 'abc123', status: 'running',
    stages: [
      { name: 'stage1', status: 'complete', waveId: 'abc123-s1', project: runDir },
      { name: 'stage2', status: 'running', waveId: 'abc123-s2', project: scratch },
    ],
    bench: ['gemini', 'gpt'], chair: 'deepseek', critic: null, lenses: null,
    labelMap: null, options: { outDir: runDir }, usage: null,
    createdAt: new Date().toISOString(),
  });
  runState.writePointer(tmp, 'abc123', runDir);
  // Active stage-2 wave + one running leg under _scratch (judge isolation root).
  const waveDir = path.join(scratch, '.claude', 'amicus_sessions', 'abc123-s2');
  const legDir = path.join(scratch, '.claude', 'amicus_sessions', 'abc123-s2-1');
  fs.mkdirSync(waveDir, { recursive: true });
  fs.mkdirSync(legDir, { recursive: true });
  fs.writeFileSync(path.join(waveDir, 'metadata.json'), JSON.stringify({
    taskId: 'abc123-s2', type: 'wave', status: 'running', legs: ['abc123-s2-1'],
  }));
  fs.writeFileSync(path.join(legDir, 'metadata.json'), JSON.stringify({
    taskId: 'abc123-s2-1', status: 'running',
  }));
  return { runDir, waveDir, legDir };
}
const parse = (r) => JSON.parse(r.content[0].text);
const metaOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf-8'));

function seedWave(project, waveId) {
  const waveDir = path.join(project, '.claude', 'amicus_sessions', waveId);
  const legDir = path.join(project, '.claude', 'amicus_sessions', `${waveId}-1`);
  fs.mkdirSync(waveDir, { recursive: true });
  fs.mkdirSync(legDir, { recursive: true });
  fs.writeFileSync(path.join(waveDir, 'metadata.json'), JSON.stringify({
    taskId: waveId, type: 'wave', status: 'running', legs: [`${waveId}-1`],
  }));
  fs.writeFileSync(path.join(legDir, 'metadata.json'), JSON.stringify({
    taskId: `${waveId}-1`, status: 'running',
  }));
  return { waveDir, legDir };
}

/**
 * A run whose CHAIR stage is in flight. The chair relaunches (ch1..ch4), so the
 * engine records the chain in `waveIds` — there is no single `waveId` to target.
 * No `pid` is seeded, so anything that settles here did so via the per-leg
 * cascade rather than the waitThenKill process-tree fallback.
 */
function seedRunningChair() {
  const runDir = path.join(tmp, 'council-def456');
  runState.initRun(runDir, {
    schemaVersion: 2, type: 'council-run', runId: 'def456', status: 'running',
    stages: [
      { name: 'stage1', status: 'complete', waveId: 'def456-s1', project: runDir },
      { name: 'chair', status: 'running', waveIds: ['def456-ch1', 'def456-ch2'], project: runDir },
    ],
    bench: ['gemini', 'gpt'], chair: 'deepseek', critic: null, lenses: null,
    labelMap: null, options: { outDir: runDir }, usage: null,
    createdAt: new Date().toISOString(),
  });
  runState.writePointer(tmp, 'def456', runDir);
  return { runDir, ch1: seedWave(runDir, 'def456-ch1'), ch2: seedWave(runDir, 'def456-ch2') };
}

describe('MCP amicus_abort on council runIds', () => {
  test('marks run.json aborted and cascades to the active wave + legs', async () => {
    const { runDir, waveDir, legDir } = seedRunningCouncil();
    const res = await handlers.amicus_abort({ taskId: 'abc123' }, tmp);
    const body = parse(res);
    expect(body.status).toBe('aborted');
    expect(runState.readRun(runDir).status).toBe('aborted');
    expect(metaOf(waveDir).status).toBe('aborted');
    expect(metaOf(legDir).status).toBe('aborted');
  });

  test('abort-wins: a later engine checkpoint cannot demote the abort', async () => {
    const { runDir } = seedRunningCouncil();
    await handlers.amicus_abort({ taskId: 'abc123' }, tmp);
    runState.checkpoint(runDir, { status: 'complete', exitCode: 0 });
    expect(runState.readRun(runDir).status).toBe('aborted');
  });

  test('non-running council run reports not running (no re-mark)', async () => {
    const { runDir } = seedRunningCouncil();
    runState.checkpoint(runDir, { status: 'complete', exitCode: 0 });
    const res = await handlers.amicus_abort({ taskId: 'abc123' }, tmp);
    expect(res.content[0].text).toContain('not running');
  });

  test('cascades to chair sub-waves recorded in waveIds, not just the pid kill', async () => {
    const { runDir, ch1, ch2 } = seedRunningChair();
    const body = parse(await handlers.amicus_abort({ taskId: 'def456' }, tmp));
    expect(body.status).toBe('aborted');
    // One leg per recorded chair sub-wave — proves the targeted cascade ran.
    expect(body.legsAborted).toBe(2);
    expect(runState.readRun(runDir).status).toBe('aborted');
    for (const w of [ch1, ch2]) {
      expect(metaOf(w.legDir).status).toBe('aborted');
      expect(metaOf(w.waveDir).status).toBe('aborted');
    }
  });

  test('unknown id still errors', async () => {
    const res = await handlers.amicus_abort({ taskId: 'deadbeef' }, tmp);
    expect(res.isError).toBe(true);
  });
});

describe('CLI amicus abort on council runIds', () => {
  test('--json path emits an abort doc with scope council-run', async () => {
    const { runDir } = seedRunningCouncil();
    const { handleAbort } = require('../src/cli-handlers-abort');
    const logs = jest.spyOn(console, 'log').mockImplementation(() => {});
    const code = await handleAbort({ _: ['abort', 'abc123'], json: true, cwd: tmp });
    expect(code).toBe(0);
    const doc = JSON.parse(logs.mock.calls[logs.mock.calls.length - 1][0]);
    expect(doc).toMatchObject({ type: 'abort', scope: 'council-run', taskId: 'abc123', ok: true });
    expect(runState.readRun(runDir).status).toBe('aborted');
    logs.mockRestore();
  });

  test('human path narrates the council abort', async () => {
    seedRunningCouncil();
    const { handleAbort } = require('../src/cli-handlers-abort');
    const logs = jest.spyOn(console, 'log').mockImplementation(() => {});
    const code = await handleAbort({ _: ['abort', 'abc123'], cwd: tmp });
    expect(code).toBe(0);
    expect(logs.mock.calls.map(c => c[0]).join('\n')).toContain('Council run abc123 marked as aborted');
    logs.mockRestore();
  });
});

// tests/mcp-council-status.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const runState = require('../src/council/run-state');

let tmp; let handlers;
beforeEach(() => {
  jest.resetModules();
  process.env.AMICUS_WAIT_POLL_INTERVAL_MS = '25';
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-cstatus-'));
  handlers = require('../src/mcp-server').handlers;
});
afterEach(() => {
  delete process.env.AMICUS_WAIT_POLL_INTERVAL_MS;
  fs.rmSync(tmp, { recursive: true, force: true });
  jest.resetModules();
});

function seedRun(status = 'running', extra = {}) {
  const runDir = path.join(tmp, 'council-abc123');
  runState.initRun(runDir, {
    schemaVersion: 2, type: 'council-run', runId: 'abc123', status,
    stages: [
      { name: 'stage1', status: 'complete', waveId: 'abc123-s1', project: runDir },
      { name: 'stage2', status: status === 'running' ? 'running' : 'complete', waveId: 'abc123-s2', project: path.join(runDir, '_scratch') },
    ],
    bench: ['gemini', 'gpt'], chair: 'deepseek', critic: null, lenses: null, labelMap: null,
    options: { outDir: runDir }, usage: null, pid: process.pid,
    createdAt: new Date().toISOString(), ...extra,
  });
  runState.writePointer(tmp, 'abc123', runDir);
  return runDir;
}
const parse = (r) => JSON.parse(r.content[0].text);

describe('amicus_status on council runIds (pointer resolution)', () => {
  test('running council run: stage progression + type council-run', async () => {
    seedRun('running');
    const res = await handlers.amicus_status({ taskId: 'abc123' }, tmp);
    const body = parse(res);
    expect(body.type).toBe('council-run');
    expect(body.status).toBe('running');
    expect(body.currentStage).toBe('stage2');
    expect(body.stages.map(s => s.name)).toEqual(['stage1', 'stage2']);
    expect(body).toHaveProperty('elapsed');
    expect(body).toHaveProperty('version');
  });

  test('wave/leg rollup one level above wave→legs when the active stage wave exists', async () => {
    const runDir = seedRun('running');
    const scratch = path.join(runDir, '_scratch');
    const waveDir = path.join(scratch, '.claude', 'amicus_sessions', 'abc123-s2');
    fs.mkdirSync(waveDir, { recursive: true });
    fs.writeFileSync(path.join(waveDir, 'metadata.json'), JSON.stringify({
      taskId: 'abc123-s2', type: 'wave', status: 'running', legs: ['abc123-s2-1', 'abc123-s2-2'],
    }));
    for (const [leg, status] of [['abc123-s2-1', 'complete'], ['abc123-s2-2', 'running']]) {
      const d = path.join(scratch, '.claude', 'amicus_sessions', leg);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'metadata.json'), JSON.stringify({ taskId: leg, status }));
    }
    const body = parse(await handlers.amicus_status({ taskId: 'abc123' }, tmp));
    expect(body.legsTotal).toBe(2);
    expect(body.legsComplete).toBe(1);
  });

  test('council- prefixed id resolves too', async () => {
    seedRun('running');
    const body = parse(await handlers.amicus_status({ taskId: 'council-abc123' }, tmp));
    expect(body.runId).toBe('abc123');
  });

  test('unknown id still returns the not-found error', async () => {
    const res = await handlers.amicus_status({ taskId: 'deadbeef' }, tmp);
    expect(res.isError).toBe(true);
  });

  test('crash detection: running run.json with a dead pid flips to error', async () => {
    seedRun('running', { pid: 999999999 });
    const body = parse(await handlers.amicus_status({ taskId: 'abc123' }, tmp));
    expect(body.status).toBe('error');
    expect(body.reason).toContain('exited unexpectedly');
  });
});

describe('amicus_wait on council runIds', () => {
  test('resolves when run.json flips terminal on disk', async () => {
    const runDir = seedRun('running');
    const p = handlers.amicus_wait({ taskId: 'abc123', timeoutMs: 10000 }, tmp);
    setTimeout(() => {
      runState.checkpoint(runDir, { status: 'complete', exitCode: 0, completedAt: new Date().toISOString() });
    }, 150);
    const body = parse(await p);
    expect(body.type).toBe('council-run');
    expect(body.status).toBe('complete');
    expect(body.timedOut).toBe(false);
  }, 15000);
});

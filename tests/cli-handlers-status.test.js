// tests/cli-handlers-status.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { handleStatus } = require('../src/cli-handlers-status');

function createSession(projectDir, taskId, meta) {
  const sessDir = path.join(projectDir, '.claude', 'amicus_sessions', taskId);
  fs.mkdirSync(sessDir, { recursive: true });
  fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
    taskId, status: 'running', model: 'gemini', createdAt: new Date().toISOString(), ...meta,
  }, null, 2));
  return sessDir;
}

// Repo convention (mirrors tests/doctor-handler.test.js): CLI output handlers
// write via process.stdout/stderr.write, not console.log/error, so capture
// swaps those out rather than jest.spyOn(console, ...).
function capture(fn) {
  const out = []; const err = [];
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  process.stdout.write = (s) => { out.push(s); return true; };
  process.stderr.write = (s) => { err.push(s); return true; };
  const restore = () => { process.stdout.write = origOut; process.stderr.write = origErr; };
  return Promise.resolve(fn())
    .then((code) => { restore(); return { code, out: out.join(''), err: err.join('') }; })
    .catch((e) => { restore(); throw e; });
}

describe('amicus status CLI', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-status-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    jest.resetModules();
  });

  test('--json prints the status payload without next_poll', async () => {
    createSession(tmpDir, 'cs-1', { status: 'complete', mode: 'headless' });
    const { code, out } = await capture(() => handleStatus({ _: ['status', 'cs-1'], cwd: tmpDir, json: true }));
    expect(code).toBe(0);
    const parsed = JSON.parse(out);
    expect(parsed.taskId).toBe('cs-1');
    expect(parsed.status).toBe('complete');
    expect(parsed.next_poll).toBeUndefined();
  });

  test('human output prints task + status + elapsed', async () => {
    createSession(tmpDir, 'cs-2', { status: 'running', pid: process.pid });
    const { code, out } = await capture(() => handleStatus({ _: ['status', 'cs-2'], cwd: tmpDir }));
    expect(code).toBe(0);
    expect(out).toContain('cs-2');
    expect(out).toContain('running');
    expect(out).toMatch(/Elapsed:/);
  });

  test('wave renders header + per-leg lines', async () => {
    createSession(tmpDir, 'cw-1', { type: 'wave', status: 'running', legs: ['cw-1-1'], pid: process.pid });
    createSession(tmpDir, 'cw-1-1', { status: 'complete', model: 'openrouter/x/y' });
    const { code, out } = await capture(() => handleStatus({ _: ['status', 'cw-1'], cwd: tmpDir }));
    expect(code).toBe(0);
    expect(out).toContain('1/1 legs');
    expect(out).toContain('openrouter/x/y');
  });

  test('--wave flag is an alternative spelling for the id', async () => {
    createSession(tmpDir, 'cw-2', { type: 'wave', status: 'complete', legs: [] });
    const { code } = await capture(() => handleStatus({ _: ['status'], wave: 'cw-2', cwd: tmpDir, json: true }));
    expect(code).toBe(0);
  });

  test('missing id and unknown id return exit 1', async () => {
    const missing = await capture(() => handleStatus({ _: ['status'], cwd: tmpDir }));
    expect(missing.code).toBe(1);
    const unknown = await capture(() => handleStatus({ _: ['status', 'nope-9'], cwd: tmpDir }));
    expect(unknown.code).toBe(1);
    expect(unknown.err.length).toBeGreaterThan(0);
  });
});

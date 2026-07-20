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

  // Central exit-code contract: exit 0 = status RETRIEVED, even when the run
  // itself ended in a failed terminal state — the QUERY succeeded. A mutation
  // like `if (result.isError || data.status === 'crashed') return 1` must
  // fail these.
  test('a crashed run still exits 0 (query succeeded) and renders the failure in human mode', async () => {
    createSession(tmpDir, 'cs-crashed', { status: 'crashed', reason: 'Process exited unexpectedly' });
    const { code, out, err } = await capture(() => handleStatus({ _: ['status', 'cs-crashed'], cwd: tmpDir }));
    expect(code).toBe(0);
    expect(out).toContain('crashed');
    expect(out).toContain('Process exited unexpectedly');
    expect(err).toBe('');
  });

  test('an errored run still exits 0 (query succeeded) and renders the failure in --json mode', async () => {
    createSession(tmpDir, 'cs-errored', { status: 'error', reason: 'provider returned 402' });
    const { code, out, err } = await capture(() => handleStatus({ _: ['status', 'cs-errored'], cwd: tmpDir, json: true }));
    expect(code).toBe(0);
    const parsed = JSON.parse(out);
    expect(parsed.status).toBe('error');
    expect(parsed.reason).toBe('provider returned 402');
    expect(err).toBe('');
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

  test('missing task_id with --json emits the error doc on stdout, exit 1 (v4.0 §7)', async () => {
    const { code, out, err } = await capture(() => handleStatus({ _: ['status'], cwd: tmpDir, json: true }));
    expect(code).toBe(1);
    const doc = JSON.parse(out);
    expect(doc).toMatchObject({ schemaVersion: 2, type: 'error', ok: false, error: { code: 'BAD_SESSION' } });
    expect(doc.error.message).toContain('task_id is required');
    expect(err).toBe('');
  });

  test('invalid task_id with --json emits the error doc on stdout, exit 1', async () => {
    const { code, out } = await capture(() => handleStatus({ _: ['status', '../evil'], cwd: tmpDir, json: true }));
    expect(code).toBe(1);
    const doc = JSON.parse(out);
    expect(doc.type).toBe('error');
    expect(doc.error.code).toBe('BAD_SESSION');
  });

  test('unknown task_id with --json emits the error doc on stdout, exit 1', async () => {
    const { code, out } = await capture(() => handleStatus({ _: ['status', 'no-such-task'], cwd: tmpDir, json: true }));
    expect(code).toBe(1);
    const doc = JSON.parse(out);
    expect(doc.type).toBe('error');
    expect(doc.error.code).toBe('BAD_SESSION');
    expect(doc.error.message).toContain('no-such-task');
  });

  test('human mode failure output is unchanged (stderr text, empty stdout)', async () => {
    const { code, out, err } = await capture(() => handleStatus({ _: ['status'], cwd: tmpDir }));
    expect(code).toBe(1);
    expect(out).toBe('');
    expect(err).toContain('Error: task_id is required for status');
    expect(err).toContain('Usage: amicus status');
  });
});

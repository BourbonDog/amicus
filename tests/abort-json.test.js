'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const { handleAbort } = require('../src/cli-handlers');
const { SCHEMA_VERSION } = require('../src/utils/result-schema');

function captureStdout(fn) {
  const out = [];
  const spyOut = jest.spyOn(process.stdout, 'write').mockImplementation((s) => { out.push(s); return true; });
  const spyErr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  // Success docs are written via console.log (JSON.stringify(...)) — same
  // convention as start.js/resume.js/continue.js — so capture that too,
  // interleaved with any process.stdout.write calls (there are none in the
  // json path, but this keeps the helper honest either way).
  const spyLog = jest.spyOn(console, 'log').mockImplementation((s) => { out.push(s + '\n'); });
  const spyExit = jest.spyOn(process, 'exit').mockImplementation((c) => { throw new Error(`exit:${c}`); });
  return fn().catch(e => e).finally(() => {
    spyOut.mockRestore(); spyErr.mockRestore(); spyLog.mockRestore(); spyExit.mockRestore();
  }).then(() => out.join(''));
}

describe('abort --json (B21-rest)', () => {
  let project;

  const writeSession = (taskId, meta) => {
    const dir = path.join(project, '.claude', 'amicus_sessions', taskId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({ taskId, ...meta }, null, 2));
    return dir;
  };

  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-abortjson-'));
  });
  afterEach(() => fs.rmSync(project, { recursive: true, force: true }));

  it('single running session -> exactly one parseable abort doc on stdout', async () => {
    writeSession('json0001', { status: 'running' });
    const out = await captureStdout(() => handleAbort({ _: ['abort', 'json0001'], cwd: project, json: true }));
    const doc = JSON.parse(out);
    expect(doc).toMatchObject({
      schemaVersion: SCHEMA_VERSION, type: 'abort', ok: true, scope: 'session',
      taskId: 'json0001', aborted: ['json0001'], count: 1,
    });
  });

  it('a running session with a pid-less-honoring process still runs the kill fallback, ' +
    'narration on stderr only — stdout stays exactly one doc', async () => {
    process.env.AMICUS_ABORT_GRACE_MS = '20';
    const killSpy = jest.spyOn(process, 'kill').mockImplementation((pid, sig) => {
      if (sig === 0) { const e = new Error('ESRCH'); e.code = 'ESRCH'; throw e; } // already exited
    });
    try {
      writeSession('json0pid1', { status: 'running', pid: 54399 });
      const errChunks = [];
      const spyErr = jest.spyOn(process.stderr, 'write').mockImplementation((s) => { errChunks.push(s); return true; });
      const spyLog = jest.spyOn(console, 'log').mockImplementation(() => {});
      const out = [];
      spyLog.mockImplementation((s) => { out.push(s + '\n'); });
      await handleAbort({ _: ['abort', 'json0pid1'], cwd: project, json: true });
      spyErr.mockRestore(); spyLog.mockRestore();

      const stdout = out.join('');
      const doc = JSON.parse(stdout); // exactly one parseable doc, no extra prose
      expect(doc).toMatchObject({ type: 'abort', ok: true, scope: 'session', taskId: 'json0pid1' });
      expect(errChunks.join('')).toContain('Process exited cleanly');
    } finally {
      killSpy.mockRestore();
      delete process.env.AMICUS_ABORT_GRACE_MS;
    }
  });

  it('wave abort -> one doc, scope wave, aborted lists the wave + running legs', async () => {
    writeSession('jsonwave1', { type: 'wave', status: 'running', legs: ['jsonwave1-1', 'jsonwave1-2'] });
    writeSession('jsonwave1-1', { status: 'running', parentWave: 'jsonwave1' });
    writeSession('jsonwave1-2', { status: 'complete', parentWave: 'jsonwave1' });
    const out = await captureStdout(() => handleAbort({ _: ['abort', 'jsonwave1'], cwd: project, json: true }));
    const doc = JSON.parse(out);
    expect(doc).toMatchObject({ type: 'abort', ok: true, scope: 'wave', taskId: 'jsonwave1' });
    expect(doc.aborted).toEqual(expect.arrayContaining(['jsonwave1', 'jsonwave1-1']));
    expect(doc.aborted).not.toContain('jsonwave1-2');
  });

  it('--all -> one doc, scope all, taskId null, aborted lists every running session', async () => {
    writeSession('jsonall01', { status: 'running' });
    writeSession('jsonall02', { status: 'running' });
    writeSession('jsonall03', { status: 'complete' });
    const out = await captureStdout(() => handleAbort({ _: ['abort'], all: true, cwd: project, json: true }));
    const doc = JSON.parse(out);
    expect(doc).toMatchObject({ type: 'abort', ok: true, scope: 'all', taskId: null });
    expect(doc.aborted.sort()).toEqual(['jsonall01', 'jsonall02']);
    expect(doc.count).toBe(2);
  });

  it('--all with nothing running -> ok doc, empty aborted, count 0', async () => {
    const out = await captureStdout(() => handleAbort({ _: ['abort'], all: true, cwd: project, json: true }));
    const doc = JSON.parse(out);
    expect(doc).toMatchObject({ type: 'abort', ok: true, scope: 'all', taskId: null, aborted: [], count: 0 });
  });

  it('missing task id -> BAD_SESSION error envelope on stdout', async () => {
    const out = await captureStdout(() => handleAbort({ _: ['abort'], cwd: project, json: true }));
    const doc = JSON.parse(out);
    expect(doc).toMatchObject({ type: 'error', ok: false, error: { code: 'BAD_SESSION' } });
  });

  it('invalid task id -> BAD_SESSION error envelope on stdout', async () => {
    const out = await captureStdout(() => handleAbort({ _: ['abort', '../etc'], cwd: project, json: true }));
    const doc = JSON.parse(out);
    expect(doc).toMatchObject({ type: 'error', ok: false, error: { code: 'BAD_SESSION' } });
  });

  it('session not found -> BAD_SESSION error envelope on stdout', async () => {
    const out = await captureStdout(() => handleAbort({ _: ['abort', 'nosuchtask'], cwd: project, json: true }));
    const doc = JSON.parse(out);
    expect(doc).toMatchObject({ type: 'error', ok: false, error: { code: 'BAD_SESSION' } });
  });

  it('malformed metadata -> BAD_SESSION error envelope on stdout', async () => {
    const dir = path.join(project, '.claude', 'amicus_sessions', 'jsonbad01');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'metadata.json'), '{not json');
    const out = await captureStdout(() => handleAbort({ _: ['abort', 'jsonbad01'], cwd: project, json: true }));
    const doc = JSON.parse(out);
    expect(doc).toMatchObject({ type: 'error', ok: false, error: { code: 'BAD_SESSION' } });
  });

  it('not-running session -> ok:false-shaped error? no: returns an abort doc with ok:false, ' +
    'ambient ok stays informative (not started)', async () => {
    writeSession('jsondone1', { status: 'complete' });
    const out = await captureStdout(() => handleAbort({ _: ['abort', 'jsondone1'], cwd: project, json: true }));
    const doc = JSON.parse(out);
    // Not a hard error (task exists) — but nothing was aborted. Model as ok:false abort doc.
    expect(doc.type).toBe('abort');
    expect(doc.ok).toBe(false);
    expect(doc.taskId).toBe('jsondone1');
    expect(doc.aborted).toEqual([]);
    expect(doc.count).toBe(0);
  });
});

describe('abort human output unchanged when NOT --json (byte-identical pins)', () => {
  let project, logSpy;

  const writeSession = (taskId, meta) => {
    const dir = path.join(project, '.claude', 'amicus_sessions', taskId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({ taskId, ...meta }, null, 2));
    return dir;
  };

  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-aborthuman-'));
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => { logSpy.mockRestore(); fs.rmSync(project, { recursive: true, force: true }); });

  it('not-running session still prints the exact pinned message', async () => {
    writeSession('human0001', { status: 'complete' });
    await handleAbort({ _: ['abort', 'human0001'], cwd: project });
    const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('is not running (status: complete)');
  });

  it('--all no-op message unchanged', async () => {
    await handleAbort({ _: ['abort'], all: true, cwd: project });
    expect(logSpy).toHaveBeenCalledWith('No running sessions to abort.');
  });
});

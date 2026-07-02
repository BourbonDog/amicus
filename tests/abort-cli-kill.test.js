// tests/abort-cli-kill.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const { handleAbort } = require('../src/cli-handlers');

describe('abort <taskId> fallback kill (Phase 3)', () => {
  let project; let logSpy; let killSpy;

  const writeSession = (taskId, meta) => {
    const dir = path.join(project, '.claude', 'amicus_sessions', taskId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({ taskId, ...meta }, null, 2));
    return dir;
  };
  const readStatus = (taskId) => JSON.parse(fs.readFileSync(
    path.join(project, '.claude', 'amicus_sessions', taskId, 'metadata.json'), 'utf-8')).status;
  const output = () => logSpy.mock.calls.map(c => c.join(' ')).join('\n');

  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-abortkill-'));
    process.env.AMICUS_ABORT_GRACE_MS = '40';
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    killSpy = jest.spyOn(process, 'kill');
  });
  afterEach(() => {
    logSpy.mockRestore();
    killSpy.mockRestore();
    delete process.env.AMICUS_ABORT_GRACE_MS;
    fs.rmSync(project, { recursive: true, force: true });
  });

  it('wedged interactive session: marker first, then SIGTERM after the grace window, honest message', async () => {
    killSpy.mockImplementation(() => {}); // pid always "alive"
    writeSession('beef0010', { status: 'running', pid: 54321, headless: false });

    await handleAbort({ _: ['abort', 'beef0010'], cwd: project });

    expect(readStatus('beef0010')).toBe('aborted');            // marker landed
    expect(killSpy).toHaveBeenCalledWith(54321, 'SIGTERM');    // fallback fired (handler awaited it)
    expect(output()).toContain('marked as aborted');
    expect(output()).toContain('did not exit in time');        // honest outcome
  });

  it('process that honors the marker is never signalled and gets the clean-exit message', async () => {
    killSpy.mockImplementation((pid, sig) => {
      if (pid === 54322 && sig === 0) { const e = new Error('ESRCH'); e.code = 'ESRCH'; throw e; }
    }); // liveness probe: already exited
    writeSession('beef0011', { status: 'running', pid: 54322 });

    await handleAbort({ _: ['abort', 'beef0011'], cwd: project });

    expect(readStatus('beef0011')).toBe('aborted');
    expect(killSpy).not.toHaveBeenCalledWith(54322, 'SIGTERM');
    expect(output()).toContain('Process exited cleanly');
  });

  it('pid-less session (shared-server record) stays marker-only — no kill, no wait chatter', async () => {
    killSpy.mockImplementation(() => { throw new Error('kill must not be called'); });
    writeSession('beef0012', { status: 'running', pid: null });

    await handleAbort({ _: ['abort', 'beef0012'], cwd: project });

    expect(readStatus('beef0012')).toBe('aborted');
    expect(killSpy).not.toHaveBeenCalled();
    expect(output()).toContain('marked as aborted');
    expect(output()).not.toContain('Waiting up to');
  });

  it('EPERM-unkillable pid gets the honest still-running message, not a false outcome', async () => {
    killSpy.mockImplementation(() => {
      const e = new Error('EPERM'); e.code = 'EPERM'; throw e;
    }); // liveness probe: EPERM = alive; SIGTERM also refused (3.1 contract: pid in NEITHER array)
    writeSession('beef0014', { status: 'running', pid: 54323 });

    await handleAbort({ _: ['abort', 'beef0014'], cwd: project });

    expect(readStatus('beef0014')).toBe('aborted');            // marker still lands
    expect(output()).toContain('still running');               // honest third outcome
    expect(output()).toContain('could not signal');
    expect(output()).not.toContain('Process exited cleanly');  // no false success
    expect(output()).not.toContain('did not exit in time');    // no false kill claim
  });

  it('no-regression: wave abort keeps marker-only behavior for legs (existing contract)', async () => {
    writeSession('beef0013', { type: 'wave', status: 'running', legs: ['beef0013-1'] });
    writeSession('beef0013-1', { status: 'running', parentWave: 'beef0013' });
    await handleAbort({ _: ['abort', 'beef0013'], cwd: project });
    expect(readStatus('beef0013')).toBe('aborted');
    expect(readStatus('beef0013-1')).toBe('aborted');
  });
});

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const { startAbortWatch, markResultAborted } = require('../../src/sidecar/interactive-abort');

const writeMeta = (dir, meta) =>
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify(meta, null, 2));

describe('startAbortWatch', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-abortwatch-'));
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('marker triggers abortSession THEN Electron kill, exactly once, then stops polling', async () => {
    const calls = [];
    const abortOpenCodeSession = jest.fn(async () => { calls.push('abortSession'); });
    const electronProcess = { killed: false, kill: jest.fn(() => calls.push('kill')) };
    const watch = startAbortWatch({
      sessionDir: dir,
      abortOpenCodeSession,
      killElectron: () => { if (!electronProcess.killed) { electronProcess.kill('SIGTERM'); } },
      intervalMs: 1000,
    });

    writeMeta(dir, { taskId: 't1', status: 'running' });
    await jest.advanceTimersByTimeAsync(1000);
    expect(abortOpenCodeSession).not.toHaveBeenCalled(); // running: no teardown
    expect(watch.wasAborted()).toBe(false);

    writeMeta(dir, { taskId: 't1', status: 'aborted' });
    await jest.advanceTimersByTimeAsync(1000);
    expect(calls).toEqual(['abortSession', 'kill']); // order matters: server abort first
    expect(watch.wasAborted()).toBe(true);

    await jest.advanceTimersByTimeAsync(5000); // fired once — no re-fire
    expect(abortOpenCodeSession).toHaveBeenCalledTimes(1);
    watch.stop();
  });

  test('abortSession rejection still kills Electron (best-effort chain)', async () => {
    const killElectron = jest.fn();
    const watch = startAbortWatch({
      sessionDir: dir,
      abortOpenCodeSession: jest.fn().mockRejectedValue(new Error('server gone')),
      killElectron,
      intervalMs: 1000,
    });
    writeMeta(dir, { status: 'aborted' });
    await jest.advanceTimersByTimeAsync(1000);
    expect(killElectron).toHaveBeenCalledTimes(1);
    expect(watch.wasAborted()).toBe(true);
    watch.stop();
  });

  test('missing then corrupt metadata keeps polling without throwing', async () => {
    const killElectron = jest.fn();
    const watch = startAbortWatch({ sessionDir: dir, abortOpenCodeSession: jest.fn(), killElectron, intervalMs: 1000 });
    await jest.advanceTimersByTimeAsync(1000); // no metadata.json yet
    fs.writeFileSync(path.join(dir, 'metadata.json'), '{not json');
    await jest.advanceTimersByTimeAsync(1000); // corrupt: swallowed
    expect(killElectron).not.toHaveBeenCalled();
    writeMeta(dir, { status: 'aborted' });
    await jest.advanceTimersByTimeAsync(1000);
    expect(killElectron).toHaveBeenCalledTimes(1); // recovered
    watch.stop();
  });

  test('stop() halts polling — a later marker is ignored', async () => {
    const killElectron = jest.fn();
    const watch = startAbortWatch({ sessionDir: dir, abortOpenCodeSession: jest.fn(), killElectron, intervalMs: 1000 });
    watch.stop();
    writeMeta(dir, { status: 'aborted' });
    await jest.advanceTimersByTimeAsync(5000);
    expect(killElectron).not.toHaveBeenCalled();
    expect(watch.wasAborted()).toBe(false);
  });
});

describe('markResultAborted → terminal status', () => {
  test('flips aborted+completed only when the watch fired', () => {
    expect(markResultAborted({ completed: true }, true)).toEqual({ completed: false, aborted: true });
    const untouched = { completed: true };
    markResultAborted(untouched, false);
    expect(untouched.aborted).toBeUndefined();
    expect(untouched.completed).toBe(true);
  });

  test('an aborted GUI result resolves to status "aborted", never error/complete', () => {
    const { resolveTerminalState } = require('../../src/sidecar/session-finalize');
    // SIGTERM'd Electron exits non-zero → completed:false; marker must win:
    expect(resolveTerminalState(markResultAborted({ summary: '', completed: false, exitCode: 1 }, true)).status).toBe('aborted');
    // Electron exiting 0 after the marker must ALSO not finalize complete:
    expect(resolveTerminalState(markResultAborted({ summary: 'x', completed: true, exitCode: 0 }, true)).status).toBe('aborted');
  });
});

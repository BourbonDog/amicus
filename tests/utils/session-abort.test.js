'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { markAborted, installSignalAbort } = require('../../src/utils/session-abort');

describe('markAborted', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-abort-'));
    fs.writeFileSync(path.join(dir, 'metadata.json'),
      JSON.stringify({ taskId: 'abc', status: 'running' }));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('sets status=aborted and records reason + timestamp', () => {
    markAborted(dir, 'SIGTERM');
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf-8'));
    expect(meta.status).toBe('aborted');
    expect(meta.reason).toContain('SIGTERM');
    expect(meta.abortedAt).toBeTruthy();
  });

  test('is a no-op (no throw) when metadata is missing', () => {
    fs.rmSync(path.join(dir, 'metadata.json'));
    expect(() => markAborted(dir, 'SIGINT')).not.toThrow();
  });

  test('is a no-op (no throw) when metadata is corrupt JSON', () => {
    fs.writeFileSync(path.join(dir, 'metadata.json'), '{bad json');
    expect(() => markAborted(dir, 'SIGINT')).not.toThrow();
  });
});

describe('installSignalAbort', () => {
  test('invokes onAbort with the signal and uninstall removes the listener', () => {
    const onAbort = jest.fn();
    const uninstall = installSignalAbort({ onAbort, signals: ['SIGUSR2'] });
    process.emit('SIGUSR2');
    expect(onAbort).toHaveBeenCalledWith('SIGUSR2');
    uninstall();
    process.emit('SIGUSR2');
    expect(onAbort).toHaveBeenCalledTimes(1);
  });
});

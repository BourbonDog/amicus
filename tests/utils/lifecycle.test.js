'use strict';
const { isOneShotCommand, armExitWatchdog } = require('../../src/utils/lifecycle');

describe('isOneShotCommand', () => {
  test('start/continue/resume/list/read/abort are one-shot', () => {
    for (const c of ['start', 'continue', 'resume', 'list', 'read', 'abort']) {
      expect(isOneShotCommand(c)).toBe(true);
    }
  });
  test('mcp is NOT one-shot (long-lived server)', () => {
    expect(isOneShotCommand('mcp')).toBe(false);
  });
});

describe('armExitWatchdog', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('calls exit(code) after ms and logs', () => {
    const exit = jest.fn();
    const log = jest.fn();
    armExitWatchdog(0, 1500, { exit, log });
    expect(exit).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1500);
    expect(exit).toHaveBeenCalledWith(0);
    expect(log).toHaveBeenCalled();
  });

  test('returns an unref-able timer that does not hold the loop', () => {
    const exit = jest.fn();
    const t = armExitWatchdog(0, 1500, { exit });
    expect(typeof t.unref).toBe('function');
  });
});

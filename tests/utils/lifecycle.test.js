'use strict';
const { isOneShotCommand, armExitWatchdog, exitReaping } = require('../../src/utils/lifecycle');

describe('isOneShotCommand', () => {
  test('start/continue/resume/list/read/abort/fanout are one-shot', () => {
    for (const c of ['start', 'continue', 'resume', 'list', 'read', 'abort', 'fanout']) {
      expect(isOneShotCommand(c)).toBe(true);
    }
  });
  test('mcp is NOT one-shot (long-lived server)', () => {
    expect(isOneShotCommand('mcp')).toBe(false);
  });
  test('provider is one-shot (M11: runs a 2s socket probe; must return to the shell)', () => {
    expect(isOneShotCommand('provider')).toBe(true);
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

  test('unref()s the timer so it does not hold the loop open', () => {
    const exit = jest.fn();
    const realSetTimeout = setTimeout;
    let captured;
    const stSpy = jest.spyOn(global, 'setTimeout').mockImplementation((fn, ms) => {
      captured = realSetTimeout(fn, ms);
      jest.spyOn(captured, 'unref');
      return captured;
    });
    armExitWatchdog(0, 1500, { exit });
    expect(typeof captured.unref).toBe('function');
    expect(captured.unref).toHaveBeenCalled();
    stSpy.mockRestore();
  });
});

// v4.4.1 fix wave, F3: a wave running on an INJECTED server never closes it —
// so a force-exit would leave the OpenCode process orphaned, still holding the
// SQLite lock the shared server exists to stop contending on.
describe('exitReaping', () => {
  test('SIGTERMs the injected server\'s Go pid, then exits with the code', () => {
    const kill = jest.fn();
    const exit = jest.fn();
    exitReaping({ goPid: 4242 }, { kill, exit })(130);
    expect(kill).toHaveBeenCalledWith(4242, 'SIGTERM');
    expect(exit).toHaveBeenCalledWith(130);
  });

  test('the exit still happens when the kill throws (pid already gone)', () => {
    const exit = jest.fn();
    const kill = jest.fn(() => { throw new Error('ESRCH'); });
    exitReaping({ goPid: 4242 }, { kill, exit })(143);
    expect(exit).toHaveBeenCalledWith(143);
  });

  test('no pid, or no server at all, exits without signalling anything', () => {
    const kill = jest.fn(); const exit = jest.fn();
    exitReaping({ goPid: null }, { kill, exit })(0);
    exitReaping(null, { kill, exit })(0);
    expect(kill).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledTimes(2);
  });

  test('never signals THIS process', () => {
    const kill = jest.fn(); const exit = jest.fn();
    exitReaping({ goPid: process.pid }, { kill, exit })(0);
    expect(kill).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });
});

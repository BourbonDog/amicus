'use strict';

const { createActivityPoller, killIfAlive } = require('../src/utils/activity-poller');

describe('interactive watchdog teardown', () => {
  it('killIfAlive sends SIGTERM to a running process', () => {
    const electronProcess = { killed: false, kill: jest.fn() };
    killIfAlive(electronProcess);
    expect(electronProcess.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('killIfAlive does not call kill if process is already killed', () => {
    const electronProcess = { killed: true, kill: jest.fn() };
    killIfAlive(electronProcess);
    expect(electronProcess.kill).not.toHaveBeenCalled();
  });

  it('killIfAlive does not throw when process is null', () => {
    expect(() => killIfAlive(null)).not.toThrow();
  });

  it('an active (busy) session touches the watchdog instead of being killed', async () => {
    jest.useFakeTimers();
    const touch = jest.fn();
    const poller = createActivityPoller({
      getStatus: async () => ({ type: 'busy' }),
      onActivity: touch,
      intervalMs: 1000,
    });
    await jest.advanceTimersByTimeAsync(1000);
    expect(touch).toHaveBeenCalled(); // active session keeps itself alive
    poller.stop();
    jest.useRealTimers();
  });
});

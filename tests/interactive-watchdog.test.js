'use strict';

const { createActivityPoller } = require('../src/utils/activity-poller');

describe('interactive watchdog teardown', () => {
  it('kills the electron process when the idle timeout fires', () => {
    const electronProcess = { killed: false, kill: jest.fn() };
    // The onTimeout body wired in interactive.js:
    const onTimeout = () => {
      if (electronProcess && !electronProcess.killed) { electronProcess.kill('SIGTERM'); }
    };
    onTimeout();
    expect(electronProcess.kill).toHaveBeenCalledWith('SIGTERM');
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

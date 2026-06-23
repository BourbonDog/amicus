'use strict';

const { createActivityPoller } = require('../../src/utils/activity-poller');

describe('createActivityPoller', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('calls onActivity when status is busy', async () => {
    const onActivity = jest.fn();
    const getStatus = jest.fn().mockResolvedValue({ type: 'busy' });
    const p = createActivityPoller({ getStatus, onActivity, intervalMs: 1000 });
    await jest.advanceTimersByTimeAsync(1000);
    expect(onActivity).toHaveBeenCalled();
    p.stop();
  });

  it('does NOT call onActivity when status is idle', async () => {
    const onActivity = jest.fn();
    const getStatus = jest.fn().mockResolvedValue({ type: 'idle' });
    const p = createActivityPoller({ getStatus, onActivity, intervalMs: 1000 });
    await jest.advanceTimersByTimeAsync(1000);
    expect(onActivity).not.toHaveBeenCalled();
    p.stop();
  });

  it('stop() halts further polling', async () => {
    const getStatus = jest.fn().mockResolvedValue({ type: 'busy' });
    const p = createActivityPoller({ getStatus, onActivity: () => {}, intervalMs: 1000 });
    p.stop();
    await jest.advanceTimersByTimeAsync(5000);
    expect(getStatus).not.toHaveBeenCalled();
  });

  it('swallows getStatus errors and keeps polling', async () => {
    const onActivity = jest.fn();
    const getStatus = jest.fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue({ type: 'busy' });
    const p = createActivityPoller({ getStatus, onActivity, intervalMs: 1000 });
    await jest.advanceTimersByTimeAsync(2000);
    expect(onActivity).toHaveBeenCalled();
    p.stop();
  });
});

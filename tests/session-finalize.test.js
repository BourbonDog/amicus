const { resolveTerminalState } = require('../src/sidecar/session-finalize');

describe('resolveTerminalState', () => {
  it('completed run → complete / 0', () => {
    expect(resolveTerminalState({ completed: true })).toEqual({ status: 'complete', exitCode: 0 });
  });
  it('error wins over everything → error / 1', () => {
    expect(resolveTerminalState({ completed: true, error: 'boom' })).toEqual({ status: 'error', exitCode: 1 });
    expect(resolveTerminalState({ aborted: true, error: 'boom' })).toEqual({ status: 'error', exitCode: 1 });
    expect(resolveTerminalState({ timedOut: true, error: 'boom' })).toEqual({ status: 'error', exitCode: 1 });
  });
  it('timed-out (no error) → timed-out / 2', () => {
    expect(resolveTerminalState({ completed: false, timedOut: true })).toEqual({ status: 'timed-out', exitCode: 2 });
  });
  it('external abort → aborted / 2', () => {
    expect(resolveTerminalState({ completed: false, aborted: true })).toEqual({ status: 'aborted', exitCode: 2 });
  });
  it('signal abort → aborted / 130 or 143', () => {
    expect(resolveTerminalState({ aborted: true }, 'SIGINT')).toEqual({ status: 'aborted', exitCode: 130 });
    expect(resolveTerminalState({ aborted: true }, 'SIGTERM')).toEqual({ status: 'aborted', exitCode: 143 });
  });
  it('incomplete with no flags → error / 1', () => {
    expect(resolveTerminalState({ completed: false })).toEqual({ status: 'error', exitCode: 1 });
  });
  it('null/undefined result → error / 1', () => {
    expect(resolveTerminalState(null)).toEqual({ status: 'error', exitCode: 1 });
  });
});

'use strict';

/**
 * H7: crash detection must work against the REAL handle shape from
 * buildServerHandle — { url, goPid, close } — which exposes NO emitter.
 * No mocked emitter anywhere in this file.
 */

beforeEach(() => jest.useFakeTimers());
afterEach(() => { jest.useRealTimers(); delete process.env.AMICUS_CRASH_POLL_MS; });

const { buildServerHandle } = require('../src/opencode-client');
const { SharedServerManager } = require('../src/utils/shared-server');

const quiet = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

function makeRealHandle(pid) {
  return buildServerHandle(
    { url: 'http://127.0.0.1:43111', close: jest.fn(), pid },
    { kill: jest.fn(), logger: quiet, findListenerPid: jest.fn(() => null) }
  );
}

describe('SharedServerManager goPid crash poll (H7)', () => {
  test('real buildServerHandle shape: goPid death triggers crash + restart', async () => {
    let alive = true;
    const mgr = new SharedServerManager({ logger: quiet, isProcessAlive: () => alive });
    const handle = makeRealHandle(424242);
    // Sanity: the real handle has NO emitter surface — old wiring was dead code.
    expect(typeof handle.on).toBe('undefined');
    expect(handle.process).toBeUndefined();
    mgr._doStartServer = jest.fn().mockResolvedValue({ server: handle, client: {} });
    const crashSpy = jest.spyOn(mgr, '_onServerCrash');
    await mgr.ensureServer();
    // Alive engine: poll ticks must NOT fire a crash.
    await jest.advanceTimersByTimeAsync(5000);
    expect(crashSpy).not.toHaveBeenCalled();
    // Engine dies: next tick detects it, tears down handles.
    alive = false;
    await jest.advanceTimersByTimeAsync(5000);
    expect(crashSpy).toHaveBeenCalledTimes(1);
    expect(mgr.server).toBeNull();
    // Backoff (2000ms) elapses → restart machinery re-runs _doStartServer.
    alive = true;
    await jest.advanceTimersByTimeAsync(2000);
    expect(mgr._doStartServer).toHaveBeenCalledTimes(2);
  });

  test('poll interval honors AMICUS_CRASH_POLL_MS', async () => {
    process.env.AMICUS_CRASH_POLL_MS = '100';
    let alive = true;
    const mgr = new SharedServerManager({ logger: quiet, isProcessAlive: () => alive });
    mgr._doStartServer = jest.fn().mockResolvedValue({ server: makeRealHandle(555), client: {} });
    const crashSpy = jest.spyOn(mgr, '_onServerCrash');
    await mgr.ensureServer();
    alive = false;
    await jest.advanceTimersByTimeAsync(100);
    expect(crashSpy).toHaveBeenCalledTimes(1);
  });

  test('shutdown stops the poll — no crash fires after close', async () => {
    let alive = true;
    const mgr = new SharedServerManager({ logger: quiet, isProcessAlive: () => alive });
    mgr._doStartServer = jest.fn().mockResolvedValue({ server: makeRealHandle(556), client: {} });
    const crashSpy = jest.spyOn(mgr, '_onServerCrash');
    await mgr.ensureServer();
    mgr.shutdown();
    alive = false;
    await jest.advanceTimersByTimeAsync(20000);
    expect(crashSpy).not.toHaveBeenCalled();
  });

  test('shutdown during the restart backoff window cancels the pending restart (spawn-after-shutdown race)', async () => {
    let alive = true;
    const mgr = new SharedServerManager({ logger: quiet, isProcessAlive: () => alive });
    mgr._doStartServer = jest.fn().mockResolvedValue({ server: makeRealHandle(557), client: {} });
    await mgr.ensureServer();
    // Engine dies: crash poll detects it and schedules a restart after RESTART_BACKOFF (2000ms).
    alive = false;
    await jest.advanceTimersByTimeAsync(5000);
    expect(mgr.server).toBeNull();
    expect(mgr._doStartServer).toHaveBeenCalledTimes(1);
    // Manager is shut down while the restart timer is still pending.
    mgr.shutdown();
    // Let the original 2s backoff (and then some) elapse.
    await jest.advanceTimersByTimeAsync(2500);
    // The pending restart must NOT fire a fresh server spawn after shutdown.
    expect(mgr._doStartServer).toHaveBeenCalledTimes(1);
  });
});

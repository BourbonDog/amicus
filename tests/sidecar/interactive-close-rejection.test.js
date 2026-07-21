/**
 * Adversarial-review finding (285903d..b9f0266, critical): B06 made
 * server.close() async (it can reject — e.g. a throwing sdkServer.close()
 * on double-close/wrapper-already-dead). interactive.js:104 (session-setup
 * error path) and :203 (normal Electron-exit path) call it bare and
 * un-awaited, un-guarded — a rejection there becomes a DETACHED unhandled
 * rejection that crashes the process on the default interactive path.
 *
 * These tests pin that a rejecting server.close() at BOTH interactive.js
 * teardown sites does NOT produce an unhandled rejection, and the
 * runInteractive() promise still resolves normally.
 */

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../src/utils/agent-mapping', () => ({
  mapAgentToOpenCode: () => ({ agent: 'chat' })
}));

jest.mock('../../src/sidecar/interactive-mirror', () => ({
  startInteractiveMirror: () => ({ stop: jest.fn().mockResolvedValue({ usage: null }) })
}));
jest.mock('../../src/utils/idle-watchdog', () => ({
  IdleWatchdog: class { start() { return this; } touch() {} cancel() {} }
}));
jest.mock('../../src/utils/activity-poller', () => ({
  createActivityPoller: () => ({ stop: jest.fn() }),
  killIfAlive: jest.fn()
}));
jest.mock('../../src/sidecar/interactive-abort', () => {
  const actual = jest.requireActual('../../src/sidecar/interactive-abort');
  return {
    ...actual,
    startAbortWatch: () => ({ stop: jest.fn(), wasAborted: () => false }),
  };
});

// The message both teardown sites reject with; also what identifies OUR
// rejection in the process-global bucket (see ourRejections below).
const CLOSE_REJECTION = 'SDK wrapper already dead';

describe('runInteractive teardown vs. rejecting server.close() (adversarial-review finding)', () => {
  let project;
  let unhandledRejections;
  let onUnhandledRejection;

  let electronInstalled = true;
  try { require.resolve('electron'); } catch { electronInstalled = false; }
  const itElectron = electronInstalled ? it : it.skip;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-close-reject-'));

    unhandledRejections = [];
    onUnhandledRejection = (reason) => { unhandledRejections.push(reason); };
    process.on('unhandledRejection', onUnhandledRejection);
  });

  afterEach(() => {
    process.removeListener('unhandledRejection', onUnhandledRejection);
    fs.rmSync(project, { recursive: true, force: true });
  });

  // Give any detached (un-awaited) rejection a macrotask to surface as
  // 'unhandledRejection' before we assert on the collected list.
  const flushMacrotasks = () => new Promise((resolve) => setImmediate(resolve));

  // 'unhandledRejection' is a PROCESS-level event and a Jest worker runs many
  // test files in one process, so the raw bucket also collects strays from
  // unrelated suites that happen to surface inside our flush windows. Asserting
  // on the whole bucket made this file pass in isolation but flake under
  // full-suite parallel load (it aborted the v4.0.0 push). Only a rejection
  // carrying our close()'s message can be the escape these tests pin.
  //
  // Narrowing loses nothing: Jest already fails a run on ANY unhandled
  // rejection, so genuine leaks elsewhere in the teardown path are still
  // caught project-wide — the bucket assertion here was a worse-attributed
  // duplicate of that, not extra coverage.
  const ourRejections = () =>
    unhandledRejections.filter((r) => r?.message === CLOSE_REJECTION);

  itElectron('session-setup failure path (:104) — rejecting close() does not escape as unhandledRejection', async () => {
    const rejectingClose = jest.fn().mockRejectedValue(new Error(CLOSE_REJECTION));

    jest.doMock('../../src/opencode-client', () => ({
      createSession: jest.fn().mockRejectedValue(new Error('session create failed')),
      sendPromptAsync: jest.fn().mockResolvedValue({}),
      getMessages: jest.fn().mockResolvedValue([]),
      getSessionStatus: jest.fn().mockResolvedValue({}),
      abortSession: jest.fn().mockResolvedValue({}),
    }));
    jest.doMock('../../src/sidecar/session-utils', () => ({
      startOpenCodeServer: jest.fn().mockResolvedValue({
        client: { fake: 'client' },
        server: { url: 'http://localhost:4096', close: rejectingClose }
      })
    }));
    jest.doMock('child_process', () => ({
      spawn: jest.fn(() => { throw new Error('should not spawn Electron on setup failure'); })
    }));

    const { runInteractive } = require('../../src/sidecar/interactive');

    const taskId = 'close-reject-0001';
    const result = await runInteractive('m', 'sys', 'hi', taskId, project, {});

    expect(result.completed).toBe(false);
    expect(result.error).toMatch(/Session setup failed/);
    expect(rejectingClose).toHaveBeenCalled();

    await flushMacrotasks();
    await flushMacrotasks();

    expect(ourRejections()).toEqual([]);
  });

  itElectron('normal Electron-exit path (:203) — rejecting close() does not escape as unhandledRejection', async () => {
    const rejectingClose = jest.fn().mockRejectedValue(new Error(CLOSE_REJECTION));

    jest.doMock('../../src/opencode-client', () => ({
      createSession: jest.fn().mockResolvedValue('ses_test'),
      sendPromptAsync: jest.fn().mockResolvedValue({}),
      getMessages: jest.fn().mockResolvedValue([]),
      getSessionStatus: jest.fn().mockResolvedValue({}),
      abortSession: jest.fn().mockResolvedValue({}),
    }));
    jest.doMock('../../src/sidecar/session-utils', () => ({
      startOpenCodeServer: jest.fn().mockResolvedValue({
        client: { fake: 'client' },
        server: { url: 'http://localhost:4096', close: rejectingClose }
      })
    }));
    jest.doMock('child_process', () => ({
      spawn: jest.fn((_bin, _args, opts) => {
        const handlers = {};
        const proc = {
          stdout: { on: (ev, cb) => { handlers[`stdout:${ev}`] = cb; } },
          stderr: { on: () => {} },
          on: (ev, cb) => { handlers[ev] = cb; }
        };
        // Electron exits 0 (clean) on the next tick, same as a normal close.
        setImmediate(() => { if (handlers.close) { handlers.close(0); } });
        return proc;
      })
    }));

    const { runInteractive } = require('../../src/sidecar/interactive');

    const taskId = 'close-reject-0002';
    const result = await runInteractive('m', 'sys', 'hi', taskId, project, {});

    expect(result.completed).toBe(true);
    expect(rejectingClose).toHaveBeenCalled();

    await flushMacrotasks();
    await flushMacrotasks();

    expect(ourRejections()).toEqual([]);
  });
});

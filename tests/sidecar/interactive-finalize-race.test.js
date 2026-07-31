/**
 * Phase-3 final review — FIX 2: interactive finalize can clobber a durable
 * 'aborted' marker.
 *
 * If the abort marker lands on disk and Electron exits naturally BEFORE the
 * abort watch's next ~2s tick, abortWatch.wasAborted() is false even though
 * the session was, in fact, aborted. resolveTerminalState() then resolves to
 * 'complete' and finalizeSession overwrites the durable on-disk 'aborted'
 * status. The close handler must re-read metadata.json once and OR the
 * on-disk status==='aborted' into the aborted flag BEFORE markResultAborted.
 */

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../src/opencode-client', () => ({
  createSession: jest.fn().mockResolvedValue('ses_test'),
  sendPromptAsync: jest.fn().mockResolvedValue({}),
  getMessages: jest.fn().mockResolvedValue([]),
  getSessionStatus: jest.fn().mockResolvedValue({}),
  abortSession: jest.fn().mockResolvedValue({}),
}));

jest.mock('../../src/sidecar/session-utils', () => ({
  startOpenCodeServer: jest.fn().mockResolvedValue({
    client: { fake: 'client' },
    server: { url: 'http://localhost:4096', close: jest.fn() }
  })
}));

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

// The abort watch NEVER ticks in this scenario (the marker lands and Electron
// exits before the next ~2s poll) — so wasAborted() must read false from the
// watch's own perspective. The close handler's own re-read is what's under test.
jest.mock('../../src/sidecar/interactive-abort', () => {
  const actual = jest.requireActual('../../src/sidecar/interactive-abort');
  return {
    ...actual,
    startAbortWatch: () => ({ stop: jest.fn(), wasAborted: () => false }),
  };
});

let mockSpawnEnv = null;
jest.mock('child_process', () => ({
  spawn: jest.fn((_bin, _args, opts) => {
    mockSpawnEnv = opts.env;
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

// --- electron availability gate: stub ensureElectron (#55) so these tests never
// depend on a REAL electron install. require.resolve-guarding was not enough: a
// scripts-suppressed install leaves the package resolvable with dist/<exe>
// missing, and the REAL ensureElectron() then kicks off a repair whose lock
// poisons parallel sibling suites ("Another electron repair is already in
// progress"). Provisioning itself is covered by tests/ensure-electron.test.js. ---
jest.mock('../../src/sidecar/electron-ensure', () => ({ ensureElectron: jest.fn().mockResolvedValue({ ok: true, path: '/fake/electron' }) }));

describe('runInteractive close handler vs. durable abort marker (phase-3 final review)', () => {
  let project;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSpawnEnv = null;
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-finalize-race-'));
  });

  afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
  });

  it('folds an on-disk aborted marker into the result even when the watch never ticked', async () => {
    const { getSessionDir } = require('../../src/session-manager');
    const { runInteractive } = require('../../src/sidecar/interactive');

    const taskId = 'race-0001';
    const sessionDir = getSessionDir(project, taskId);
    fs.mkdirSync(sessionDir, { recursive: true });
    // Marker landed on disk (e.g. via `amicus abort`) — but the abort watch
    // (mocked above) never observed it before Electron's close fired.
    fs.writeFileSync(path.join(sessionDir, 'metadata.json'), JSON.stringify({
      taskId, status: 'aborted', abortedAt: new Date().toISOString(),
    }, null, 2));

    const result = await runInteractive('m', 'sys', 'hi', taskId, project, {});

    expect(result.aborted).toBe(true);
    expect(result.completed).toBe(false);

    const { resolveTerminalState } = require('../../src/sidecar/session-finalize');
    expect(resolveTerminalState(result).status).toBe('aborted');
  });

  it('does not fold anything when there is no on-disk marker (no false positives)', async () => {
    const { getSessionDir } = require('../../src/session-manager');
    const { runInteractive } = require('../../src/sidecar/interactive');

    const taskId = 'race-0002';
    const sessionDir = getSessionDir(project, taskId);
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, 'metadata.json'), JSON.stringify({
      taskId, status: 'running',
    }, null, 2));

    const result = await runInteractive('m', 'sys', 'hi', taskId, project, {});

    expect(result.aborted).toBeUndefined();
    expect(result.completed).toBe(true);
  });
});

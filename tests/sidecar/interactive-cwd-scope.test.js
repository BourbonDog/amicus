/**
 * #45 — interactive --cwd: scope session + route from the session directory.
 *
 * When the amicus process cwd != --cwd, the OpenCode session must be CREATED
 * scoped to canonicalProjectPath(--cwd) and every per-session call (status
 * poll, message mirror) must be scoped to the SAME directory, and the Electron
 * Web-UI route must be built from that directory (threaded via the spawn env),
 * NOT a fresh base64url(process.cwd()) guess. Otherwise turn-1 works (id-only
 * lookup) but Web-UI follow-ups query a --cwd-scoped route with no matching
 * session and fail "unable to retrieve session".
 */

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

// --- SDK client wrapper: capture the directory arg on every per-session call ---
// (jest hoists jest.mock above imports; factory may only reference `mock*` vars)
jest.mock('../../src/opencode-client', () => ({
  createSession: jest.fn().mockResolvedValue('ses_test'),
  sendPromptAsync: jest.fn().mockResolvedValue({}),
  getMessages: jest.fn().mockResolvedValue([]),
  getSessionStatus: jest.fn().mockResolvedValue({})
}));
const {
  createSession, getMessages, getSessionStatus
} = require('../../src/opencode-client');

// --- OpenCode server start: return a fake client + server ---
jest.mock('../../src/sidecar/session-utils', () => ({
  startOpenCodeServer: jest.fn().mockResolvedValue({
    client: { fake: 'client' },
    server: { url: 'http://localhost:4096', close: jest.fn() }
  })
}));

jest.mock('../../src/utils/agent-mapping', () => ({
  mapAgentToOpenCode: () => ({ agent: 'chat' })
}));
jest.mock('../../src/session-manager', () => ({ getSessionDir: () => '/sess/dir' }));

// --- mirror + poller + watchdog: capture the getStatus/getMessages closures ---
let mockGetStatusFn = null;
let mockMirrorGetMessagesFn = null;
jest.mock('../../src/sidecar/interactive-mirror', () => ({
  startInteractiveMirror: ({ getMessages: gm }) => {
    mockMirrorGetMessagesFn = gm;
    return { stop: jest.fn().mockResolvedValue({ usage: null }) };
  }
}));
jest.mock('../../src/utils/idle-watchdog', () => ({
  IdleWatchdog: class { start() { return this; } touch() {} cancel() {} }
}));
jest.mock('../../src/utils/activity-poller', () => ({
  createActivityPoller: ({ getStatus }) => {
    mockGetStatusFn = getStatus;
    return { stop: jest.fn() };
  },
  killIfAlive: jest.fn()
}));

// --- electron spawn: capture the env handed to the child, then "exit" cleanly ---
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
    // Fire close on next tick so runInteractive's promise resolves.
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

const { canonicalProjectPath } = require('../../src/utils/project-path');

describe('runInteractive scopes session + route to --cwd (#45)', () => {
  // process cwd != --cwd: this is the path that breaks today.
  const PROJECT = 'c:\\Users\\me\\--cwd-target';
  const EXPECTED_DIR = canonicalProjectPath(PROJECT);

  let runInteractive;
  beforeEach(() => {
    jest.clearAllMocks();
    mockSpawnEnv = null;
    mockGetStatusFn = null;
    mockMirrorGetMessagesFn = null;
    runInteractive = require('../../src/sidecar/interactive').runInteractive;
  });

  it('creates the session scoped to canonicalProjectPath(--cwd)', async () => {
    await runInteractive('m', 'sys', 'hi', 'task-1', PROJECT, {});
    expect(createSession).toHaveBeenCalledWith({ fake: 'client' }, EXPECTED_DIR);
  });

  it('scopes the status poll and message mirror to the same directory', async () => {
    await runInteractive('m', 'sys', 'hi', 'task-1', PROJECT, {});
    // Invoke the captured closures the poller/mirror would call.
    await mockGetStatusFn();
    await mockMirrorGetMessagesFn();
    expect(getSessionStatus).toHaveBeenCalledWith({ fake: 'client' }, 'ses_test', EXPECTED_DIR);
    expect(getMessages).toHaveBeenCalledWith({ fake: 'client' }, 'ses_test', EXPECTED_DIR);
  });

  it('threads the session directory to Electron so the route matches the create scope', async () => {
    await runInteractive('m', 'sys', 'hi', 'task-1', PROJECT, {});
    expect(mockSpawnEnv.AMICUS_SESSION_DIRECTORY).toBe(EXPECTED_DIR);
  });
});

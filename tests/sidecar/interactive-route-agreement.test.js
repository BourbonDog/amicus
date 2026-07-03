/**
 * #46 — regression: create/route directory AGREEMENT when cwd != --cwd.
 *
 * The live Electron repro of the cross-cwd "unable to retrieve session" bug is
 * no longer reproducible, so this is the durable code-level guard that locks the
 * agreement #45 established. It asserts the three links of the chain agree on ONE
 * directory value when the amicus process cwd != --cwd:
 *
 *   (1) createSession's `directory` EQUALS the directory threaded to Electron and
 *       fed to the real buildSessionRoute (the input used to build the Web-UI
 *       route) — they are the SAME value, not two independently-derived guesses.
 *   (2) the Web-UI route is derived from the server-echoed session.directory (or
 *       the consistent canonicalProjectPath(--cwd) fallback), NOT a fresh
 *       base64url(process.cwd()). A CWD-derived route segment must NOT appear.
 *   (3) per-session follow-up calls (status poll, message mirror) carry that SAME
 *       directory.
 *
 * Unlike the per-link assertions in interactive-cwd-scope.test.js, this test ties
 * the launcher and the route builder together ACROSS the module boundary: it runs
 * the env value the launcher actually threads (AMICUS_SESSION_DIRECTORY) through
 * the REAL electron/session-route.js, exactly as electron/main.js does, and proves
 * the produced route encodes the create-scope directory and never process.cwd().
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
  createSession, sendPromptAsync, getMessages, getSessionStatus
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
    setImmediate(() => { if (handlers.close) { handlers.close(0); } });
    return proc;
  })
}));

const { canonicalProjectPath } = require('../../src/utils/project-path');
// The REAL route builder electron/main.js uses — exercised across the boundary.
const { buildSessionRoute } = require('../../electron/session-route');

describe('create/route directory agreement when cwd != --cwd (#46)', () => {
  // --cwd is a DIFFERENT directory than the amicus process cwd. This is the
  // sidecar-skill launch path that broke before #45: a base64url(process.cwd())
  // route points at a project with no matching session.
  const PROJECT = 'c:\\Users\\me\\--cwd-target';
  const EXPECTED_DIR = canonicalProjectPath(PROJECT);
  const BASE_URL = 'http://localhost:4096';

  // getElectronPath()/checkElectronAvailable() are local bindings in
  // interactive.js and rely on a real electron install (present in CI/this
  // worktree); skip headlessly rather than asserting against the guard.
  let electronInstalled = true;
  try { require.resolve('electron'); } catch { electronInstalled = false; }
  const itElectron = electronInstalled ? it : it.skip;

  let runInteractive;
  beforeEach(() => {
    jest.clearAllMocks();
    mockSpawnEnv = null;
    mockGetStatusFn = null;
    mockMirrorGetMessagesFn = null;
    runInteractive = require('../../src/sidecar/interactive').runInteractive;
  });

  // (1) create scope == route input: the SAME single value, not two guesses.
  itElectron('createSession directory EQUALS the directory used to build the route', async () => {
    await runInteractive('m', 'sys', 'hi', 'task-1', PROJECT, {});

    const createDir = createSession.mock.calls[0][1];
    const routeInput = mockSpawnEnv.AMICUS_SESSION_DIRECTORY;

    // The launcher threads ONE directory to Electron; the route is built from it.
    expect(routeInput).toBe(createDir);
    expect(createDir).toBe(EXPECTED_DIR);
  });

  // (2) route derives from the session directory, NOT a fresh base64url(CWD).
  itElectron('route segment encodes the session directory and never process.cwd()', async () => {
    await runInteractive('m', 'sys', 'hi', 'task-1', PROJECT, {});

    // Reproduce exactly what electron/main.js does: feed the threaded
    // SESSION_DIRECTORY through the real buildSessionRoute.
    const route = buildSessionRoute(BASE_URL, 'ses_test', mockSpawnEnv.AMICUS_SESSION_DIRECTORY);

    const sessionSeg = Buffer.from(EXPECTED_DIR).toString('base64url');
    const cwdSeg = Buffer.from(canonicalProjectPath(process.cwd())).toString('base64url');
    const rawCwdSeg = Buffer.from(process.cwd()).toString('base64url');

    expect(route).toBe(`${BASE_URL}/${sessionSeg}/session/ses_test`);
    // A regression to base64url(process.cwd()) (canonicalized OR raw) must not match.
    expect(route).not.toContain(cwdSeg);
    expect(route).not.toContain(rawCwdSeg);
  });

  // (3) per-session follow-up calls carry the SAME directory as create + route.
  itElectron('per-session follow-up calls carry the same directory as create + route', async () => {
    await runInteractive('m', 'sys', 'hi', 'task-1', PROJECT, {});

    // Drive the closures the activity poller / mirror invoke on each tick.
    await mockGetStatusFn();
    await mockMirrorGetMessagesFn();

    const createDir = createSession.mock.calls[0][1];
    const promptDir = sendPromptAsync.mock.calls[0][2].directory;
    const statusDir = getSessionStatus.mock.calls[0][2];
    const messagesDir = getMessages.mock.calls[0][2];
    const routeInput = mockSpawnEnv.AMICUS_SESSION_DIRECTORY;

    // One value, agreed everywhere: create, initial prompt, status, mirror, route.
    for (const dir of [promptDir, statusDir, messagesDir, routeInput]) {
      expect(dir).toBe(createDir);
    }
    expect(createDir).toBe(EXPECTED_DIR);
  });
});

// tests/observe/early-return-terminal.test.js
'use strict';
// FR-1 (v4.5): the three runHeadless early returns must stamp a terminal stage
// into progress.json — and preserve previously recorded usage — exactly like the
// A3 outer catch does. Mock idiom copied from premature-completion.test.js.
const fs = require('fs');

jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
  mkdirSync: jest.fn(),
  appendFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
  renameSync: jest.fn(),
  rmSync: jest.fn(),
  readFileSync: jest.fn(() => JSON.stringify({ status: 'running' })),
}));

const mockCreateSession = jest.fn();
const mockSendPromptAsync = jest.fn();
const mockGetMessages = jest.fn();
const mockCheckHealth = jest.fn();
const mockStartServer = jest.fn();
const mockAbortSession = jest.fn();
const mockGetSessionStatus = jest.fn();
const mockGetChildren = jest.fn();

jest.mock('../../src/opencode-client', () => ({
  createSession: mockCreateSession,
  sendPrompt: mockSendPromptAsync,
  sendPromptAsync: mockSendPromptAsync,
  getMessages: mockGetMessages,
  checkHealth: mockCheckHealth,
  startServer: mockStartServer,
  abortSession: mockAbortSession,
  getSessionStatus: mockGetSessionStatus,
  getChildren: mockGetChildren,
}));

const mockLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };
jest.mock('../../src/utils/logger', () => ({ logger: mockLogger }));

const { runHeadless } = require('../../src/headless');

const MODEL = 'openrouter/qwen/qwen3.7-max';
const OPTS = {
  pollIntervalMs: 5, stableIdlePolls: 3, stableFinishedPolls: 2,
  toolCallStallMs: 100000, usageSettlePolls: 1, usageSettleIntervalMs: 1,
  toolSettleGraceMs: 100000,
};

const FS_DEFAULTS = {
  existsSync: () => true,
  readFileSync: () => JSON.stringify({ status: 'running' }),
  writeFileSync: () => {},
  appendFileSync: () => {},
  mkdirSync: () => {},
  unlinkSync: () => {},
  renameSync: () => {},
  rmSync: () => {},
};

beforeEach(() => {
  jest.clearAllMocks();
  for (const [name, impl] of Object.entries(FS_DEFAULTS)) { fs[name].mockImplementation(impl); }
  mockCheckHealth.mockResolvedValue(true);
  mockCreateSession.mockResolvedValue('ses_x');
  mockSendPromptAsync.mockResolvedValue(undefined);
  mockAbortSession.mockResolvedValue(undefined);
  mockGetChildren.mockResolvedValue([]);
  mockGetSessionStatus.mockResolvedValue({ type: 'busy' });
  mockStartServer.mockResolvedValue({
    client: {}, server: { url: 'http://127.0.0.1:1', close: jest.fn() },
  });
});

/** Every progress.json payload written, in order (idiom from premature-completion). */
function progressWrites() {
  return fs.writeFileSync.mock.calls
    .filter((c) => typeof c[0] === 'string' && c[0].includes('progress.json'))
    .map((c) => JSON.parse(c[1]));
}

function lastProgress() {
  const w = progressWrites();
  return w[w.length - 1];
}

/** Make readFileSync serve a prior progress.json WITH usage, metadata elsewhere. */
function armPriorProgress(usage) {
  fs.readFileSync.mockImplementation((p) => {
    if (typeof p === 'string' && p.includes('progress.json')) {
      return JSON.stringify({ schemaVersion: 1, type: 'progress', stage: 'receiving', usage });
    }
    return JSON.stringify({ status: 'running' });
  });
}

const PRIOR_USAGE = { costReported: 0.12, tokensIn: 1000, tokensOut: 50 };

describe('FR-1: every early return stamps a terminal stage', () => {
  test('server-start failure (:292 path) leaves stage "error", not "initializing"', async () => {
    mockStartServer.mockRejectedValue(new Error('spawn EACCES'));

    const result = await runHeadless(MODEL, 'sys', 'user', 'fr1a', '/proj', 60000, 'build', OPTS);

    expect(result.completed).toBe(false);
    expect(result.error).toMatch(/Failed to start server/);
    expect(lastProgress().stage).toBe('error');
  }, 20000);

  test('server-never-ready (:317 path) leaves stage "error", not "server_ready"', async () => {
    // waitForServer polls checkHealth; permanently false => serverReady false.
    mockCheckHealth.mockResolvedValue(false);

    const result = await runHeadless(MODEL, 'sys', 'user', 'fr1b', '/proj', 60000, 'build', OPTS);

    expect(result.completed).toBe(false);
    expect(result.error).toMatch(/failed to start/i);
    expect(lastProgress().stage).toBe('error');
  }, 30000);

  test('createSession failure (:354 path — the council-reachable one) leaves stage "error"', async () => {
    mockCreateSession.mockRejectedValue(new Error('database is locked'));

    const result = await runHeadless(MODEL, 'sys', 'user', 'fr1c', '/proj', 60000, 'build', OPTS);

    expect(result.completed).toBe(false);
    expect(result.error).toBe('database is locked');
    expect(lastProgress().stage).toBe('error');
  }, 20000);

  test('createSession failure under an EXTERNAL server (council leg) stamps terminal too', async () => {
    mockCreateSession.mockRejectedValue(new Error('database is locked'));
    const external = {
      ...OPTS,
      client: {},
      server: { url: 'http://127.0.0.1:2', close: jest.fn() },
    };

    const result = await runHeadless(MODEL, 'sys', 'user', 'fr1d', '/proj', 60000, 'build', external);

    expect(result.completed).toBe(false);
    expect(lastProgress().stage).toBe('error');
    // shared server must NOT be closed by the leg
    expect(external.server.close).not.toHaveBeenCalled();
  }, 20000);

  test('the terminal stamp preserves previously recorded usage (writeProgress rebuilds)', async () => {
    mockCreateSession.mockRejectedValue(new Error('boom'));
    armPriorProgress(PRIOR_USAGE);

    await runHeadless(MODEL, 'sys', 'user', 'fr1e', '/proj', 60000, 'build', OPTS);

    const last = lastProgress();
    expect(last.stage).toBe('error');
    expect(last.usage).toEqual(PRIOR_USAGE);
  }, 20000);

  test('a throwing progress write is swallowed — the original error still returns', async () => {
    // Armed only once createSession runs — the 'initializing' write at the top of runHeadless
    // sits OUTSIDE the outer try, so failing it would abort before this path is even reached.
    // Same gotcha, same fix, as premature-completion.test.js's A3 "swallow" test.
    let armed = false;
    mockCreateSession.mockImplementation(async () => { armed = true; throw new Error('the real error'); });
    fs.writeFileSync.mockImplementation((p) => {
      if (armed && typeof p === 'string' && p.includes('progress.json')) { throw new Error('disk full'); }
    });

    const result = await runHeadless(MODEL, 'sys', 'user', 'fr1f', '/proj', 60000, 'build', OPTS);

    expect(result.error).toBe('the real error');
  }, 20000);
});

// tests/headless-server-start-retry.test.js
'use strict';

/**
 * v4.4.1 fix wave, F5 — runHeadless's OWN server start is covered by the
 * lock-class retry too.
 *
 * The retry landed in `startOpenCodeServer` (sidecar/session-utils.js), but
 * src/headless.js calls `startServer` directly, so a plain `amicus start` that
 * lost OpenCode's SQLite startup race still died on the first
 * `database is locked`. "Two separate amicus processes contending" is half the
 * retry's stated justification — this is one of the two processes.
 *
 * Same narrow policy as the other site: lock-class messages only, bounded at 3
 * attempts, final failure rethrown UNCHANGED into headless's existing degrade
 * path (never fails closed differently than before).
 */

const mockCreateSession = jest.fn();
const mockSendPromptAsync = jest.fn();
const mockGetMessages = jest.fn();
const mockCheckHealth = jest.fn();
const mockStartServer = jest.fn();
const mockServerClose = jest.fn();
const mockGetSessionStatus = jest.fn();

jest.mock('../src/opencode-client', () => ({
  createSession: mockCreateSession,
  sendPromptAsync: mockSendPromptAsync,
  getMessages: mockGetMessages,
  checkHealth: mockCheckHealth,
  startServer: mockStartServer,
  getSessionStatus: mockGetSessionStatus,
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
  mkdirSync: jest.fn(),
  appendFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  readFileSync: jest.fn(() => JSON.stringify({ status: 'running' })),
  unlinkSync: jest.fn(),
  renameSync: jest.fn(),
  rmSync: jest.fn(),
}));

jest.mock('../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const { runHeadless } = require('../src/headless');

const LOCKED = 'Server exited with code 1\nServer output: Error: Unexpected error\n\ndatabase is locked';
const okServer = () => ({ client: {}, server: { url: 'http://127.0.0.1:1', close: mockServerClose } });

/** Start the server, then bail immediately at session creation. */
const run = () => runHeadless('openrouter/a/b', 'sys', 'user', 'task1234', '/proj', 60000, 'build',
  { retryDelayMs: 1, pollIntervalMs: 5 });

describe('runHeadless server start: lock-class retry (F5)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // clearAllMocks does NOT drain a *Once queue or drop an implementation, so
    // reset the starter explicitly — otherwise these tests leak into each other
    // and the whole file becomes order-dependent.
    mockStartServer.mockReset();
    mockCheckHealth.mockResolvedValue(true);
    // Bail right after the start so the test is about the start alone.
    mockCreateSession.mockRejectedValue(new Error('stop here'));
  });

  it('retries a "database is locked" start failure and can succeed', async () => {
    mockStartServer
      .mockRejectedValueOnce(new Error(LOCKED))
      .mockImplementationOnce(async () => okServer());

    const result = await run();

    expect(mockStartServer).toHaveBeenCalledTimes(2);
    // The server DID come up: the run got past the start and failed later.
    expect(result.error).toBe('stop here');
    expect(result.error).not.toMatch(/Failed to start server/);
  });

  it('retries SQLITE_BUSY too', async () => {
    mockStartServer
      .mockRejectedValueOnce(new Error('SQLITE_BUSY: database is busy'))
      .mockImplementationOnce(async () => okServer());
    await run();
    expect(mockStartServer).toHaveBeenCalledTimes(2);
  });

  it('is bounded at 3 attempts, then degrades exactly as before', async () => {
    mockStartServer.mockRejectedValue(new Error(LOCKED));
    const result = await run();
    expect(mockStartServer).toHaveBeenCalledTimes(3);
    // Never fails closed differently: same shaped result headless always gave.
    expect(result.completed).toBe(false);
    expect(result.error).toMatch(/Failed to start server: .*database is locked/s);
  });

  it('does NOT retry a deterministic failure (missing binary)', async () => {
    mockStartServer.mockRejectedValue(new Error('ENOENT: opencode not found'));
    const result = await run();
    expect(mockStartServer).toHaveBeenCalledTimes(1);
    expect(result.error).toMatch(/Failed to start server: ENOENT/);
  });

  it('does NOT retry a port conflict', async () => {
    mockStartServer.mockRejectedValue(new Error('EADDRINUSE: address already in use'));
    await run();
    expect(mockStartServer).toHaveBeenCalledTimes(1);
  });

  it('a clean start still takes exactly one attempt', async () => {
    mockStartServer.mockImplementation(async () => okServer());
    await run();
    expect(mockStartServer).toHaveBeenCalledTimes(1);
  });

  // The shared-server seam is upstream of all of this: an injected server means
  // there is no start to retry.
  it('an injected external server never reaches the starter at all', async () => {
    mockStartServer.mockImplementation(async () => okServer());
    await runHeadless('openrouter/a/b', 'sys', 'user', 'task1234', '/proj', 60000, 'build',
      { client: {}, server: { url: 'http://127.0.0.1:2', close: mockServerClose }, pollIntervalMs: 5 });
    expect(mockStartServer).not.toHaveBeenCalled();
  });
});

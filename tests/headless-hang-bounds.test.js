// tests/headless-hang-bounds.test.js
'use strict';

/**
 * A wedged engine is the very reason the timeout/stall/backstop paths exist, so
 * none of their own SDK calls may hang runHeadless: the abort, the last poll
 * after the sleep crosses the deadline, the startup health check, and the
 * post-loop server.close() rejection that used to discard gathered usage.
 */

const mockCreateSession = jest.fn();
const mockSendPromptAsync = jest.fn();
const mockGetMessages = jest.fn();
const mockCheckHealth = jest.fn();
const mockStartServer = jest.fn();
const mockServerClose = jest.fn();
const mockAbortSession = jest.fn();
const mockGetSessionStatus = jest.fn();

jest.mock('../src/opencode-client', () => ({
  createSession: mockCreateSession,
  sendPromptAsync: mockSendPromptAsync,
  getMessages: mockGetMessages,
  checkHealth: mockCheckHealth,
  startServer: mockStartServer,
  abortSession: mockAbortSession,
  getSessionStatus: mockGetSessionStatus,
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
  mkdirSync: jest.fn(),
  appendFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  renameSync: jest.fn(),
  rmSync: jest.fn(),
  readFileSync: jest.fn(() => JSON.stringify({ status: 'running' })),
  unlinkSync: jest.fn(),
}));

jest.mock('../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const { runHeadless, waitForServer } = require('../src/headless');

const never = () => new Promise(() => {});

describe('headless hang bounds', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckHealth.mockResolvedValue(true);
    mockCreateSession.mockResolvedValue('session-1');
    mockSendPromptAsync.mockResolvedValue(undefined);
    mockAbortSession.mockResolvedValue(undefined);
    mockGetSessionStatus.mockResolvedValue({ type: 'busy' });
    mockGetMessages.mockResolvedValue([]);
    mockServerClose.mockResolvedValue(undefined);
    mockStartServer.mockResolvedValue({
      client: {},
      server: { url: 'http://127.0.0.1:1', close: mockServerClose },
    });
  });

  test('the --timeout abort never settling still lets runHeadless return', async () => {
    mockAbortSession.mockImplementation(never);
    const result = await runHeadless('openrouter/a/b', 'sys', 'user', 'task1234', '/proj',
      100, 'build', { pollIntervalMs: 5, toolSettleAbortTimeoutMs: 50 });
    expect(result.timedOut).toBe(true);
    expect(mockAbortSession).toHaveBeenCalled();
  });

  test('a sleep that crosses the deadline never issues an unbounded final poll', async () => {
    let calls = 0;
    // The first poll answers; any poll issued after the deadline would hang forever.
    mockGetMessages.mockImplementation(() => (calls++ === 0 ? Promise.resolve([]) : never()));
    const result = await runHeadless('openrouter/a/b', 'sys', 'user', 'task1234', '/proj',
      300, 'build', { pollIntervalMs: 200, usageSettlePolls: 0 });
    expect(result.timedOut).toBe(true);
  });

  test('a post-loop server.close() rejection does not throw away the result', async () => {
    mockServerClose.mockRejectedValue(new Error('close boom'));
    const result = await runHeadless('openrouter/a/b', 'sys', 'user', 'task1234', '/proj',
      100, 'build', { pollIntervalMs: 5 });
    expect(result.timedOut).toBe(true);
    expect(String(result.error || '')).not.toMatch(/close boom/);
  });

  test('waitForServer bounds a health check that never answers', async () => {
    jest.useFakeTimers();
    try {
      const p = waitForServer({}, never, 1);
      await jest.advanceTimersByTimeAsync(3000);
      expect(await p).toBe(false);
    } finally { jest.useRealTimers(); }
  });
});

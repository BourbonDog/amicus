// tests/headless-poll-failures.test.js
'use strict';

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
  readFileSync: jest.fn(() => JSON.stringify({ status: 'running' })),
  unlinkSync: jest.fn(),
  // writeFileAtomic (progress.js's writer) tmp-writes then renames; both
  // no-ops, matching the other fs stubs above.
  renameSync: jest.fn(),
  rmSync: jest.fn(),
}));

jest.mock('../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const { runHeadless } = require('../src/headless');

describe('consecutive poll-failure fast-exit (F4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckHealth.mockResolvedValue(true);
    mockCreateSession.mockResolvedValue('session-1');
    mockSendPromptAsync.mockResolvedValue(undefined);
    mockGetSessionStatus.mockResolvedValue({ type: 'busy' });
    mockStartServer.mockResolvedValue({
      client: {},
      server: { url: 'http://127.0.0.1:1', close: mockServerClose },
    });
  });

  it('bails with an error after K consecutive getMessages failures (dead server)', async () => {
    mockGetMessages.mockRejectedValue(new Error('ECONNREFUSED'));
    const started = Date.now();
    const result = await runHeadless(
      'openrouter/a/b', 'sys', 'user', 'task1234', '/proj',
      60000, 'build',
      { pollIntervalMs: 5, maxConsecutivePollFailures: 3 }
    );
    expect(Date.now() - started).toBeLessThan(10000); // far less than the 60s timeout
    expect(result.completed).toBe(false);
    expect(result.error).toMatch(/3 consecutive/);
  });

  // #133 P1: this fixture is the codebase's existing route to the
  // failedWithNoUsableOutput return (headless.js :1298) — sessionError set,
  // mirror.output empty. createSession resolved in beforeEach, so
  // opencodeSessionId must be threaded onto this return too, not just the
  // normal-completion one.
  it('carries opencodeSessionId on the no-usable-output return (#133 P1, :1298)', async () => {
    mockGetMessages.mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await runHeadless(
      'openrouter/a/b', 'sys', 'user', 'task1234', '/proj',
      60000, 'build',
      { pollIntervalMs: 5, maxConsecutivePollFailures: 3 }
    );
    expect(result.completed).toBe(false);
    expect(result.opencodeSessionId).toBe('session-1');
  });

  it('classifies partial-output + dead-server as error (never complete), keeping the partial summary', async () => {
    const partialMsg = [{
      info: { role: 'assistant', id: 'm1', time: {} },
      parts: [{ type: 'text', text: 'partial output, no fold marker' }],
    }];
    mockGetMessages
      .mockResolvedValueOnce(partialMsg)
      .mockResolvedValueOnce(partialMsg)
      .mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await runHeadless(
      'openrouter/a/b', 'sys', 'user', 'task1234', '/proj',
      60000, 'build',
      { pollIntervalMs: 5, maxConsecutivePollFailures: 3 }
    );
    expect(result.completed).toBe(false);
    expect(result.error).toMatch(/3 consecutive/);
    expect(result.summary).toContain('partial output');
  });

  it('resets the failure counter on a successful poll', async () => {
    // 2 failures, then success-with-marker → must complete despite K=3
    mockGetMessages
      .mockRejectedValueOnce(new Error('blip'))
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValue([{
        info: { role: 'assistant', id: 'm1', time: { completed: Date.now() } },
        parts: [{ type: 'text', text: 'done\n[SIDECAR_FOLD]\n' }],
      }]);
    const result = await runHeadless(
      'openrouter/a/b', 'sys', 'user', 'task1234', '/proj',
      60000, 'build',
      { pollIntervalMs: 5, maxConsecutivePollFailures: 3 }
    );
    expect(result.completed).toBe(true);
    expect(result.error).toBeUndefined();
  });
});

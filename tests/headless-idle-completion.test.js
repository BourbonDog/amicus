// tests/headless-idle-completion.test.js
'use strict';

/**
 * The poll loop has three completion-ish exits: the fold-marker branch, the
 * SDK-authoritative idle-status branch, and the stable-poll activity heuristic.
 * Only the fold-marker branch used to set `completed = true` — the two idle
 * exits broke out of the loop leaving `completed` false, so resolveTerminalState
 * fell through to error/"Incomplete" and metadata.json misclassified genuinely
 * successful runs (stdout --json meanwhile said "complete" from the output).
 * These tests pin completed:true for both idle exits; the completed:true →
 * metadata "complete" mapping is pinned by start-terminal-status.test.js.
 * Dead-server classification (F4) must remain an error — pinned below and in
 * headless-poll-failures.test.js.
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
  readFileSync: jest.fn(() => JSON.stringify({ status: 'running' })),
  unlinkSync: jest.fn(),
  // writeFileAtomic (progress.js's writer) tmp-writes then renames; both are
  // no-ops here, same as the other fs stubs above — this suite asserts on
  // headless's return value, not on-disk writes.
  renameSync: jest.fn(),
  rmSync: jest.fn(),
}));

jest.mock('../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const { runHeadless } = require('../src/headless');

// Plain reply with real output but no [SIDECAR_FOLD] marker — the shape of any
// non-fold headless run (e.g. `--prompt "Reply with exactly: OK"`).
const plainReply = (text, finished) => [{
  info: { role: 'assistant', id: 'm1', time: finished ? { completed: 1 } : {} },
  parts: [{ type: 'text', text }],
}];

describe('idle-detection exits classify as completed', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckHealth.mockResolvedValue(true);
    mockCreateSession.mockResolvedValue('session-1');
    mockSendPromptAsync.mockResolvedValue(undefined);
    mockStartServer.mockResolvedValue({
      client: {},
      server: { url: 'http://127.0.0.1:1', close: mockServerClose },
    });
  });

  it('SDK idle status with output → completed:true, no error', async () => {
    mockGetMessages.mockResolvedValue(plainReply('OK'));
    mockGetSessionStatus.mockResolvedValue({ type: 'idle' });

    const result = await runHeadless(
      'openrouter/a/b', 'sys', 'user', 'task1234', '/proj',
      60000, 'build',
      { pollIntervalMs: 5 }
    );
    expect(result.completed).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.summary).toBe('OK');
  });

  it('SDK idle status keyed by session id → completed:true', async () => {
    mockGetMessages.mockResolvedValue(plainReply('OK'));
    mockGetSessionStatus.mockResolvedValue({ 'session-1': { type: 'idle' } });

    const result = await runHeadless(
      'openrouter/a/b', 'sys', 'user', 'task1234', '/proj',
      60000, 'build',
      { pollIntervalMs: 5 }
    );
    expect(result.completed).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('stable-poll heuristic (status endpoint unavailable) → completed:true, no error', async () => {
    mockGetMessages.mockResolvedValue(plainReply('OK', true));
    mockGetSessionStatus.mockRejectedValue(new Error('session.status unsupported'));

    const result = await runHeadless(
      'openrouter/a/b', 'sys', 'user', 'task1234', '/proj',
      60000, 'build',
      { pollIntervalMs: 5, stableFinishedPolls: 2, stableIdlePolls: 3 }
    );
    expect(result.completed).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.summary).toBe('OK');
  });

  it('dead server after partial output STILL classifies as error (F4 unchanged)', async () => {
    // Output exists and the status endpoint never reports idle — the server
    // then dies. The idle-exit fix must not leak completed:true here.
    mockGetMessages
      .mockResolvedValueOnce(plainReply('partial output'))
      .mockResolvedValueOnce(plainReply('partial output'))
      .mockRejectedValue(new Error('ECONNREFUSED'));
    mockGetSessionStatus.mockResolvedValue({ type: 'busy' });

    const result = await runHeadless(
      'openrouter/a/b', 'sys', 'user', 'task1234', '/proj',
      60000, 'build',
      { pollIntervalMs: 5, maxConsecutivePollFailures: 3, stableIdlePolls: 50, stableFinishedPolls: 50 }
    );
    expect(result.completed).toBe(false);
    expect(result.error).toMatch(/3 consecutive/);
  });
});

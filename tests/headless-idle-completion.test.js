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
const { logger: mockLogger } = require('../src/utils/logger');

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

  it('does NOT complete via the idle heuristic while the SDK says busy and no tool is live — waits for the message to finalize (spec 2026-09-11 §3, run D0)', async () => {
    // D0 shape: a completed narration text part arms the gate (output > 0),
    // the final answer is invisible in flight (no growth), the engine is busy.
    const narration = 'Rawlings guidance captured. Now let me get the Wilson method.';
    const answer = '# Breaking in a glove\n\nFull deliverable text.\n```json\n{"overall":"x","findings":[]}\n```';
    let poll = 0;
    mockGetMessages.mockImplementation(() => {
      poll += 1;
      if (poll < 12) {
        return Promise.resolve([{
          info: { role: 'assistant', id: 'm1', time: {} },          // NOT finalized
          parts: [{ id: 'm1:t', type: 'text', text: narration }],
        }]);
      }
      return Promise.resolve([{
        info: { role: 'assistant', id: 'm1', time: { completed: 1 }, finish: 'stop' },
        parts: [{ id: 'm1:t', type: 'text', text: narration + '\n\n' + answer }],
      }]);
    });
    mockGetSessionStatus.mockResolvedValue({ type: 'busy' });

    const result = await runHeadless(
      'openrouter/a/b', 'sys', 'user', 'task1234', '/proj',
      60000, 'build',
      { pollIntervalMs: 5, stableFinishedPolls: 2, stableIdlePolls: 3, usageSettlePolls: 0 }
    );
    // Named mutant "BUSYIGNORED": the veto never fires — the leg exits at poll 4 with
    // only the narration and `poll` never reaches 12. (`usageSettlePolls: 0` keeps the
    // post-loop usage-settle re-polls out of this counter, so 4 means 4.)
    expect(poll).toBeGreaterThanOrEqual(12);
    expect(result.completed).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.summary).toContain('Full deliverable text.');
    // The veto is visible in a trace: exactly once for the single flat stretch, on its
    // first vetoed poll (stablePolls still 0), naming the status it deferred to.
    const resets = mockLogger.debug.mock.calls.filter((c) => c[0] === 'Idle heuristic reset: SDK busy, no live tools');
    expect(resets).toHaveLength(1);
    expect(resets[0][1]).toEqual({ taskId: 'task1234', stablePolls: 0, sdkStatus: 'busy' });
  });

  it('does NOT complete via the idle heuristic while the SDK says retry (provider backoff) and no tool is live — the engine has not given up (spec 2026-09-11 §3 as amended)', async () => {
    // The D0 shape with the third arm of the SDK's status union: a 429 between
    // attempts is not silence — the engine is still working the same turn.
    const narration = 'Rawlings guidance captured. Now let me get the Wilson method.';
    const answer = '# Breaking in a glove\n\nFull deliverable text.\n```json\n{"overall":"x","findings":[]}\n```';
    let poll = 0;
    mockGetMessages.mockImplementation(() => {
      poll += 1;
      if (poll < 12) {
        return Promise.resolve([{
          info: { role: 'assistant', id: 'm1', time: {} },          // NOT finalized
          parts: [{ id: 'm1:t', type: 'text', text: narration }],
        }]);
      }
      return Promise.resolve([{
        info: { role: 'assistant', id: 'm1', time: { completed: 1 }, finish: 'stop' },
        parts: [{ id: 'm1:t', type: 'text', text: narration + '\n\n' + answer }],
      }]);
    });
    mockGetSessionStatus.mockResolvedValue({ type: 'retry', attempt: 2, message: '429 rate limited', next: Date.now() + 60000 });

    const result = await runHeadless(
      'openrouter/a/b', 'sys', 'user', 'task1234', '/proj',
      60000, 'build',
      { pollIntervalMs: 5, stableFinishedPolls: 2, stableIdlePolls: 3, usageSettlePolls: 0 }
    );
    // Named mutant "RETRYHARVEST": drop the retry arm — the leg exits at poll 4 with
    // only the narration.
    expect(poll).toBeGreaterThanOrEqual(12);
    expect(result.completed).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.summary).toContain('Full deliverable text.');
    const retryResets = mockLogger.debug.mock.calls.filter((c) => c[0] === 'Idle heuristic reset: SDK busy, no live tools');
    expect(retryResets).toHaveLength(1);
    expect(retryResets[0][1]).toEqual({ taskId: 'task1234', stablePolls: 0, sdkStatus: 'retry' });
  });

  it('does NOT complete via the idle heuristic while busy when a SETTLED tool part is present (run D0\'s real mirror: narration + completed webfetch)', async () => {
    // A settled tool part must not disarm the veto: it is neither live (B4) nor pending (B53).
    const narration = 'Rawlings guidance captured. Now let me get the Wilson method.';
    const answer = '# Breaking in a glove\n\nFull deliverable text.\n```json\n{"overall":"x","findings":[]}\n```';
    // A fresh object every poll: the real mirror sees a new snapshot each read.
    const settledTool = () => ({
      id: 'm1:tool1', sessionID: 'session-1', messageID: 'm1', type: 'tool', callID: 'call_1',
      tool: 'webfetch',
      state: { status: 'completed', input: { url: 'https://example.test/rawlings' }, output: 'fetched', title: 'webfetch', time: { start: 1, end: 2 } }
    });
    let poll = 0;
    mockGetMessages.mockImplementation(() => {
      poll += 1;
      if (poll < 12) {
        return Promise.resolve([{
          info: { role: 'assistant', id: 'm1', time: {} },          // NOT finalized
          parts: [settledTool(), { id: 'm1:t', type: 'text', text: narration }],
        }]);
      }
      return Promise.resolve([{
        info: { role: 'assistant', id: 'm1', time: { completed: 1 }, finish: 'stop' },
        parts: [settledTool(), { id: 'm1:t', type: 'text', text: narration + '\n\n' + answer }],
      }]);
    });
    mockGetSessionStatus.mockResolvedValue({ type: 'busy' });

    const result = await runHeadless(
      'openrouter/a/b', 'sys', 'user', 'task1234', '/proj',
      60000, 'build',
      { pollIntervalMs: 5, stableFinishedPolls: 2, stableIdlePolls: 3, usageSettlePolls: 0 }
    );
    expect(poll).toBeGreaterThanOrEqual(12);
    expect(result.completed).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.summary).toContain('Full deliverable text.');
    expect(result.toolSettleTimedOut).toBeFalsy();
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

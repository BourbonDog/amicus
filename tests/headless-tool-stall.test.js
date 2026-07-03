// tests/headless-tool-stall.test.js
'use strict';

/**
 * B53: a headless run whose current TOOL CALL wedges (tool_use emitted, result
 * never arrives, no further output) used to burn the FULL --timeout (up to 15
 * min) with zero progress. The stall detector fires fast when BOTH (a) at
 * least one pending tool call exists, and (b) no progress has been observed
 * for AMICUS_TOOL_CALL_STALL_MS. It must not false-positive during active
 * streaming (output/tool/result growth resets the clock) and must not fire
 * without a wedged tool call. Terminal classification is `error` via the
 * SAME abortSession + finalization path the timeout exit uses — never
 * `completed`, never plain "timed out" wording (headless-idle-completion.js
 * pins the fourth-exit-path contract; this is the fifth).
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
  // writeFileAtomic (15a.1) writes tmp + renameSync; rmSync is its error-path cleanup
  renameSync: jest.fn(),
  rmSync: jest.fn(),
  readFileSync: jest.fn(() => JSON.stringify({ status: 'running' })),
  unlinkSync: jest.fn(),
}));

jest.mock('../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const { runHeadless } = require('../src/headless');
const { buildFoldMarker } = require('../src/utils/fold-marker');

// 15b.3: fixed nonce for the one fixture in this file that expects a real
// fold-marker completion (test (c) below) — this file is otherwise about
// tool-call stall detection, not fold-nonce semantics.
const NONCE = 'toolstallnonce01';

// A tool_use with no tool_result ever — the wedge. name kept distinct for the
// reason-string assertion.
const wedgedToolCall = [{
  info: { role: 'assistant', id: 'm1', time: {} },
  parts: [{ id: 'tc1', type: 'tool_use', name: 'Bash', input: { cmd: 'sleep 999' } }],
}];

// Same tool call, PLUS growing text output alongside it (active streaming).
const wedgedToolCallWithGrowingText = (text) => [{
  info: { role: 'assistant', id: 'm1', time: {} },
  parts: [
    { id: 'tc1', type: 'tool_use', name: 'Bash', input: { cmd: 'sleep 999' } },
    { id: 'm1:t', type: 'text', text },
  ],
}];

// The tool call resolved with a result.
const resolvedToolCall = [{
  info: { role: 'assistant', id: 'm1', time: { completed: 1 } },
  parts: [
    { id: 'tc1', type: 'tool_use', name: 'Bash', input: { cmd: 'sleep 999' } },
    { id: 'tr1', type: 'tool_result', tool_use_id: 'tc1', is_error: false, content: 'done' },
    { id: 'm1:t', type: 'text', text: `all done\n${buildFoldMarker(NONCE)}\n` },
  ],
}];

describe('per-tool-call stall detector (B53)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckHealth.mockResolvedValue(true);
    mockCreateSession.mockResolvedValue('session-1');
    mockSendPromptAsync.mockResolvedValue(undefined);
    mockAbortSession.mockResolvedValue(undefined);
    mockGetSessionStatus.mockResolvedValue({ type: 'busy' });
    mockStartServer.mockResolvedValue({
      client: {},
      server: { url: 'http://127.0.0.1:1', close: mockServerClose },
    });
  });

  it('(a) wedged tool_use + total silence exits at ~stallMs, far below timeoutMs', async () => {
    mockGetMessages.mockResolvedValue(wedgedToolCall);
    const started = Date.now();

    const result = await runHeadless(
      'openrouter/a/b', 'sys', 'user', 'task1234', '/proj',
      60000, 'build',
      { pollIntervalMs: 5, toolCallStallMs: 50 }
    );

    expect(Date.now() - started).toBeLessThan(10000); // far less than the 60s timeout
    expect(result.completed).toBe(false);
    expect(result.timedOut).toBeFalsy();
    expect(result.error).toMatch(/Tool call stalled/);
    expect(result.error).toMatch(/Bash/);
    expect(result.error).toMatch(/pending \d+s/);
    // distinct from the consecutive-poll-failure and plain-timeout reasons
    expect(result.error).not.toMatch(/consecutive/);
    expect(result.error).not.toMatch(/timed out/i);
    expect(mockAbortSession).toHaveBeenCalledWith({}, 'session-1');
  }, 15000);

  it('(b) pending tool call WITH output still growing does not fire', async () => {
    let call = 0;
    mockGetMessages.mockImplementation(() => {
      call++;
      // Text keeps growing every poll — active streaming alongside the pending tool.
      return Promise.resolve(wedgedToolCallWithGrowingText('x'.repeat(call)));
    });

    const result = await runHeadless(
      'openrouter/a/b', 'sys', 'user', 'task1234', '/proj',
      300, 'build', // short overall timeout so the test still terminates
      { pollIntervalMs: 5, toolCallStallMs: 50, stableIdlePolls: 3, stableFinishedPolls: 2 }
    );

    // Growth resets the stall clock every poll, so the run rides out to the
    // (short) overall timeout rather than the stall detector firing early.
    expect(result.timedOut).toBe(true);
    expect(result.error).toBeFalsy();
    expect(mockAbortSession).toHaveBeenCalledTimes(1); // the timeout path's own abort, not the stall path
  });

  it('(c) result arrives late but before threshold — no fire, run completes normally', async () => {
    mockGetMessages
      .mockResolvedValueOnce(wedgedToolCall)
      .mockResolvedValueOnce(wedgedToolCall)
      .mockResolvedValue(resolvedToolCall);

    const result = await runHeadless(
      'openrouter/a/b', 'sys', 'user', 'task1234', '/proj',
      60000, 'build',
      { pollIntervalMs: 5, toolCallStallMs: 100000, nonce: NONCE } // threshold far beyond this short test's runtime
    );

    expect(result.completed).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.summary).toBe('all done');
    expect(mockAbortSession).not.toHaveBeenCalled();
  });

  it('(d) stall before ANY output fires (the "waiting for model" branch — the observed live case)', async () => {
    mockGetMessages.mockResolvedValue(wedgedToolCall); // no text part at all, ever
    const started = Date.now();

    const result = await runHeadless(
      'openrouter/a/b', 'sys', 'user', 'task1234', '/proj',
      60000, 'build',
      { pollIntervalMs: 5, toolCallStallMs: 50 }
    );

    expect(Date.now() - started).toBeLessThan(10000);
    expect(result.completed).toBe(false);
    expect(result.error).toMatch(/Tool call stalled/);
  }, 15000);

  it('(e) a per-run stall-threshold override is respected (shorter fires sooner)', async () => {
    mockGetMessages.mockResolvedValue(wedgedToolCall);

    const startedShort = Date.now();
    await runHeadless(
      'openrouter/a/b', 'sys', 'user', 'taskShort1', '/proj',
      60000, 'build',
      { pollIntervalMs: 5, toolCallStallMs: 20 }
    );
    const shortElapsed = Date.now() - startedShort;

    jest.clearAllMocks();
    mockCheckHealth.mockResolvedValue(true);
    mockCreateSession.mockResolvedValue('session-1');
    mockSendPromptAsync.mockResolvedValue(undefined);
    mockAbortSession.mockResolvedValue(undefined);
    mockGetSessionStatus.mockResolvedValue({ type: 'busy' });
    mockStartServer.mockResolvedValue({
      client: {},
      server: { url: 'http://127.0.0.1:1', close: mockServerClose },
    });
    mockGetMessages.mockResolvedValue(wedgedToolCall);

    const startedLong = Date.now();
    await runHeadless(
      'openrouter/a/b', 'sys', 'user', 'taskLong1', '/proj',
      60000, 'build',
      { pollIntervalMs: 5, toolCallStallMs: 2000 }
    );
    const longElapsed = Date.now() - startedLong;

    expect(shortElapsed).toBeLessThan(longElapsed);
  }, 15000);

  it('usage aggregates through sumPerMessageUsage on a stall exit like any other failure', async () => {
    const wedgedWithUsage = [{
      info: {
        role: 'assistant', id: 'm1', time: {},
        tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
        cost: 0.001,
      },
      parts: [{ id: 'tc1', type: 'tool_use', name: 'Bash', input: {} }],
    }];
    mockGetMessages.mockResolvedValue(wedgedWithUsage);

    const result = await runHeadless(
      'openrouter/a/b', 'sys', 'user', 'task1234', '/proj',
      60000, 'build',
      { pollIntervalMs: 5, toolCallStallMs: 50 }
    );

    expect(result.error).toMatch(/Tool call stalled/);
    expect(result.usage.tokens).toEqual({ input: 10, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0 });
  }, 15000);

  it('does not fire when there is no pending tool call at all (plain idle text stall is a different path)', async () => {
    // Text grows once then goes fully static with NO tool call in play — this is
    // the pre-existing stable-poll idle path's territory, not the stall detector's.
    let call = 0;
    mockGetMessages.mockImplementation(() => {
      call++;
      const text = call === 1 ? 'hello' : 'hello'; // static after first poll
      return Promise.resolve([{
        info: { role: 'assistant', id: 'm1', time: {} },
        parts: [{ id: 'm1:t', type: 'text', text }],
      }]);
    });

    const result = await runHeadless(
      'openrouter/a/b', 'sys', 'user', 'task1234', '/proj',
      300, 'build',
      { pollIntervalMs: 5, toolCallStallMs: 50, stableIdlePolls: 3, stableFinishedPolls: 2 }
    );

    // No pending tool call ever existed, so the stall detector must not be the
    // reason this exits — it rides to the stable-poll idle completion instead.
    expect(result.error).toBeFalsy();
  });
});

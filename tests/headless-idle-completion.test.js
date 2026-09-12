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
    // within the 60 s leg deadline, so the leg is HELD (see the beyond-deadline case for the other branch)
    mockGetSessionStatus.mockResolvedValue({ type: 'retry', attempt: 2, message: '429 rate limited', next: Date.now() + 5000 });

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

  it('a busy leg whose message never finalizes ends by the leg --timeout, named as such, with the exit line carrying the status (the documented trade; council #246 C4)', async () => {
    // The veto holds the leg for the WHOLE 300 ms window — there is no exit at
    // stableIdlePolls 3 — and the bound for a busy-but-wedged leg is the leg --timeout BY
    // DESIGN (spec §2/§3: D1's qwen ran 796 s legitimately busy, so any intermediate
    // ceiling below that re-creates the mid-answer harvest). This pins that trade.
    const narration = 'Rawlings guidance captured. Now let me get the Wilson method.';
    mockGetMessages.mockResolvedValue([{
      info: { role: 'assistant', id: 'm1', time: {} },            // NEVER finalized
      parts: [{ id: 'm1:t', type: 'text', text: narration }],
    }]);
    mockGetSessionStatus.mockResolvedValue({ type: 'busy' });

    const result = await runHeadless(
      'openrouter/a/b', 'sys', 'user', 'task1234', '/proj',
      300, 'build',
      { pollIntervalMs: 5, stableIdlePolls: 3, stableFinishedPolls: 2, usageSettlePolls: 0 }
    );
    expect(result.completed).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.error).toBeUndefined();            // a plain timeout carries no error
    expect(mockAbortSession).toHaveBeenCalledTimes(1);   // the timeout path aborts
    expect(mockLogger.warn).toHaveBeenCalledWith('Task timed out', expect.objectContaining({ taskId: 'task1234' }));
    const exits = [mockLogger.info, mockLogger.warn, mockLogger.debug, mockLogger.error]
      .flatMap((f) => f.mock.calls)
      .filter((c) => c[0] === 'Polling loop exited');
    expect(exits).toHaveLength(1);
    expect(exits[0][1]).toEqual(expect.objectContaining({ completed: false, sdkStatus: 'busy' }));
  }, 10000);

  it("a status flip-flop (busy → unavailable → busy) mid-stretch counts while unavailable, resets on busy, and the trace shows both the stretch's first veto and the reset (council #246 C3/C4)", async () => {
    // Named mutant "FLAPSILENT": drop `|| stablePolls > 0` from the latch condition and only
    // ONE line survives — the reset that discarded a non-zero count goes untraced.
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
    // Status calls 5 and 6 throw: two polls COUNT toward stableIdlePolls 3 without reaching it.
    let statusCall = 0;
    mockGetSessionStatus.mockImplementation(() => {
      statusCall += 1;
      if (statusCall === 5 || statusCall === 6) {
        return Promise.reject(new Error('session.status unsupported'));
      }
      return Promise.resolve({ type: 'busy' });
    });

    const result = await runHeadless(
      'openrouter/a/b', 'sys', 'user', 'task1234', '/proj',
      60000, 'build',
      { pollIntervalMs: 5, stableIdlePolls: 3, stableFinishedPolls: 2, usageSettlePolls: 0 }
    );
    expect(result.completed).toBe(true);
    expect(result.summary).toContain('Full deliverable text.');
    const resets = mockLogger.debug.mock.calls.filter((c) => c[0] === 'Idle heuristic reset: SDK busy, no live tools');
    expect(resets).toHaveLength(2);
    expect(resets[0][1]).toEqual({ taskId: 'task1234', stablePolls: 0, sdkStatus: 'busy' });
    expect(resets[1][1]).toEqual({ taskId: 'task1234', stablePolls: 2, sdkStatus: 'busy' });
    // The count never reached the threshold, so the fallback never ended this message.
    expect(mockLogger.warn).not.toHaveBeenCalledWith(
      'Idle heuristic ended an unfinalized message on the fallback path', expect.anything()
    );
  }, 10000);

  it('the fallback heuristic ending an UNFINALIZED message logs a warning naming the status — status unavailable (council #246 C2/D2)', async () => {
    // Named mutant "FALLBACKSILENT": delete the warning (keep the `if`) and BOTH
    // fallback-warning cases redden.
    const narration = 'Rawlings guidance captured. Now let me get the Wilson method.';
    mockGetMessages.mockResolvedValue([{
      info: { role: 'assistant', id: 'm1', time: {} },            // NEVER finalized
      parts: [{ id: 'm1:t', type: 'text', text: narration }],
    }]);
    mockGetSessionStatus.mockRejectedValue(new Error('session.status unsupported'));

    const result = await runHeadless(
      'openrouter/a/b', 'sys', 'user', 'task1234', '/proj',
      60000, 'build',
      { pollIntervalMs: 5, stableIdlePolls: 3, stableFinishedPolls: 2, usageSettlePolls: 0 }
    );
    expect(result.completed).toBe(true);                 // the fallback fired
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Idle heuristic ended an unfinalized message on the fallback path',
      expect.objectContaining({ taskId: 'task1234', stablePolls: 3, sdkStatus: 'unavailable' })
    );
  }, 10000);

  it('the fallback heuristic ending an UNFINALIZED message logs a warning naming the status — status of a type this gate does not know (council #246 C2/D2)', async () => {
    const narration = 'Rawlings guidance captured. Now let me get the Wilson method.';
    mockGetMessages.mockResolvedValue([{
      info: { role: 'assistant', id: 'm1', time: {} },            // NEVER finalized
      parts: [{ id: 'm1:t', type: 'text', text: narration }],
    }]);
    // The raw type is recorded VERBATIM; only a non-string type maps to 'other'.
    mockGetSessionStatus.mockResolvedValue({ type: 'working' });

    const result = await runHeadless(
      'openrouter/a/b', 'sys', 'user', 'task1234', '/proj',
      60000, 'build',
      { pollIntervalMs: 5, stableIdlePolls: 3, stableFinishedPolls: 2, usageSettlePolls: 0 }
    );
    expect(result.completed).toBe(true);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Idle heuristic ended an unfinalized message on the fallback path',
      expect.objectContaining({ taskId: 'task1234', stablePolls: 3, sdkStatus: 'working' })
    );
  }, 10000);

  it('a retry whose next attempt lies beyond the leg deadline ends the leg at once with the named reason, session aborted (council #246 C1/D1/A1, the next half)', async () => {
    // Named mutant "NEXTIGNORED": drop the `lastSdkRetryNext > deadline` comparison and the
    // leg runs to its 60 s --timeout instead, so this case dies on its 10 s jest timeout.
    const narration = 'Rawlings guidance captured. Now let me get the Wilson method.';
    mockGetMessages.mockResolvedValue([{
      info: { role: 'assistant', id: 'm1', time: {} },            // NEVER finalized
      parts: [{ id: 'm1:t', type: 'text', text: narration }],
    }]);
    mockGetSessionStatus.mockResolvedValue({
      type: 'retry', attempt: 3, message: '429 rate limited', next: Date.now() + 10 * 60 * 1000,
    });

    const started = Date.now();
    const result = await runHeadless(
      'openrouter/a/b', 'sys', 'user', 'task1234', '/proj',
      60000, 'build',
      { pollIntervalMs: 5, stableIdlePolls: 3, stableFinishedPolls: 2, usageSettlePolls: 0 }
    );
    expect(Date.now() - started).toBeLessThan(5000);
    expect(result.completed).toBe(false);
    expect(result.timedOut).toBe(false);
    expect(result.error).toMatch(/^RETRY_BEYOND_DEADLINE: /);
    expect(result.error).toContain('attempt 3');
    expect(result.error).toContain('429 rate limited');
    expect(mockAbortSession).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Provider backoff exceeds the leg deadline; ending the leg now instead of waiting',
      expect.objectContaining({ taskId: 'task1234', attempt: 3 })
    );
  }, 10000);

  it('a FINALIZED message with a session-level retry scheduled past the deadline still completes on the stable-finished path — the finished answer is never discarded (council #246 round 2 C1/B2)', async () => {
    // The message is finalized from the first poll; the retry belongs to whatever the
    // engine does next. Named mutant "FINISHEDRETRYEXIT": drop `!assistantFinished` from the
    // beyond-deadline exit — the leg ends RETRY_BEYOND_DEADLINE and this answer is lost.
    mockGetMessages.mockResolvedValue(plainReply('Final answer', true));
    mockGetSessionStatus.mockResolvedValue({ type: 'retry', attempt: 3, message: '429 rate limited', next: Date.now() + 10 * 60 * 1000 });

    const result = await runHeadless(
      'openrouter/a/b', 'sys', 'user', 'task1234', '/proj',
      60000, 'build',
      { pollIntervalMs: 5, stableFinishedPolls: 2, stableIdlePolls: 3, usageSettlePolls: 0 }
    );
    expect(result.completed).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.summary).toBe('Final answer');
    expect(mockAbortSession).not.toHaveBeenCalled();
    expect(mockLogger.warn).not.toHaveBeenCalledWith(
      'Provider backoff exceeds the leg deadline; ending the leg now instead of waiting', expect.anything());
  });

  it('a retry scheduled past the deadline while a tool call is LIVE defers to the B4 tool-settle ceiling instead of ending the leg (council #246 round 3 D1)', async () => {
    // Real-shape running tool part + unfinalized narration + retry status with `next` past
    // the deadline. The B4 ceiling (toolSettleGraceMs) bounds the wait and completes the leg
    // loud; the beyond-deadline exit must not pre-empt it. Named mutant "RETRYOVERTOOL": drop
    // `liveTools.length === 0` from that exit — the leg ends RETRY_BEYOND_DEADLINE at poll 1.
    const narration = 'Fetching the Rawlings guidance.';
    mockGetMessages.mockResolvedValue([{
      info: { role: 'assistant', id: 'm1', time: {} },
      parts: [
        { id: 'm1:tool1', sessionID: 'session-1', messageID: 'm1', type: 'tool', callID: 'call_1',
          tool: 'webfetch',
          state: { status: 'running', input: { url: 'https://example.test/rawlings' }, title: 'webfetch', time: { start: 1 } } },
        { id: 'm1:t', type: 'text', text: narration },
      ],
    }]);
    mockGetSessionStatus.mockResolvedValue({ type: 'retry', attempt: 3, message: '429 rate limited', next: Date.now() + 10 * 60 * 1000 });
    const started = Date.now();

    const result = await runHeadless(
      'openrouter/a/b', 'sys', 'user', 'task1234', '/proj',
      60000, 'build',
      { pollIntervalMs: 5, stableFinishedPolls: 2, stableIdlePolls: 3, usageSettlePolls: 0, toolSettleGraceMs: 50 }
    );
    expect(Date.now() - started).toBeLessThan(5000);
    expect(result.error).toBeUndefined();
    expect(result.toolSettleTimedOut).toBe(true);
    expect(result.completed).toBe(true);
    expect(mockLogger.warn).not.toHaveBeenCalledWith(
      'Provider backoff exceeds the leg deadline; ending the leg now instead of waiting', expect.anything());
  });
});

describe('the session.status contract the veto reasons about', () => {
  it('the pinned @opencode-ai/sdk still publishes exactly the three SessionStatus arms (idle | retry | busy) — a fourth arm or a rename must land here before it can silently disarm the veto', () => {
    // headless.js HOLDS the leg on `busy` and on `retry` and EXITS on `idle`. Any other arm
    // is recorded verbatim as `sdkStatus` and falls through to the fallback heuristic, which
    // since council #246 warns when it ends an unfinalized message — so a new arm meaning
    // "still working" would weaken the veto. This is the tripwire for that.
    const realFs = jest.requireActual('fs');   // the module-level mock replaces `fs`
    const path = require('path');
    // ⚠️ NOT `require.resolve('@opencode-ai/sdk/package.json')`: the SDK is ESM-only and its
    // `exports` map publishes neither `./package.json` nor any `require` condition, so BOTH
    // Node's and Jest's resolvers refuse every specifier for it (measured 2026-09-11). The
    // installed path is therefore read directly.
    const typesPath = path.join(
      __dirname, '..', 'node_modules', '@opencode-ai', 'sdk', 'dist', 'gen', 'types.gen.d.ts'
    );
    const src = realFs.readFileSync(typesPath, 'utf8');
    const marker = 'export type SessionStatus =';
    const start = src.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    expect(src).toContain('export type SessionStatus =');
    const rest = src.slice(start + marker.length);
    const end = rest.indexOf('export type');
    const union = end === -1 ? rest : rest.slice(0, end);
    const arms = [...union.matchAll(/type:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(arms)).toEqual(new Set(['idle', 'retry', 'busy']));
    // The retry arm's `next` is a number (epoch ms: opencode session/processor.ts sets
    // next: Date.now() + delay).
    expect(union).toMatch(/type:\s*"retry"[\s\S]*?next:\s*number/);
  });
});

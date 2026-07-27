'use strict';

/**
 * v4.4 B4 part 1 — a leg declared `complete` while its OpenCode session keeps
 * working and billing.
 *
 * THE MEASURED DEFECT (`council-wsgate02/wsgate02-s1-3`, from the OpenCode DB):
 *   04:34:56.255  leg created
 *   04:35:08.440  last text growth — 166 chars of reasoning preamble
 *   04:35:02.417  `task` tool part created, state.status = 'running'
 *   04:36:09.700  amicus declared the leg COMPLETE (the STABLE_IDLE_POLLS gate,
 *                 ~60 s after the last progress) and adjudicated 166 characters
 *                 as a finished peer review
 *   04:38:19.061  the `task` tool actually reached 'completed' — 2m 9.4s later
 *   04:38:19.301  the parent's 1st assistant message finalized ($0.06091455)
 *   04:39:26.811  a 2nd assistant message finalized ($0.081878725) carrying the
 *                 REAL 4,368-character review
 * So the leg was declared complete 129.4 s before its tool finished, and the
 * session billed $0.14279 of parent spend plus a $0.47105 child session after.
 *
 * THE LANDMINE. The diagnosis's own proposed fix — gate the idle exit on
 * `pendingToolCalls.length === 0`, where pending clears on a `tool_result` part
 * — would hang EVERY tool-using leg: across the 35 recorded legs there are 36
 * `tool_use` records and ZERO `tool_result` records, because OpenCode has no
 * such part type. See tests/sidecar/tool-part-status.test.js for the derivation
 * of the real vocabulary ('pending'|'running'|'completed'|'error', terminal =
 * completed|error).
 *
 * THE BOUND. 9 of 1,307 persisted tool parts are stuck non-terminal forever
 * (killed sessions that never wrote a terminal status), so the wait must have a
 * ceiling. Per the owner's standing ruling — fail LOUD, not fail CLOSED — on
 * exceeding it the leg COMPLETES anyway and says so, rather than failing.
 */

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
  // v4.4.1 CA-1's child-session walk destructures this at module load. Stubbed
  // so the walk RUNS (returning "no children") instead of throwing on an
  // undefined function — LC-2 asserts the abort is ordered after it.
  getChildren: mockGetChildren,
}));

const mockLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };
jest.mock('../../src/utils/logger', () => ({ logger: mockLogger }));

const { runHeadless } = require('../../src/headless');
const { buildFoldMarker } = require('../../src/utils/fold-marker');

const NONCE = 'prematurenonce1234';
const MARKER = buildFoldMarker(NONCE);
const MODEL = 'openrouter/qwen/qwen3.7-max';

/** A real-shape SDK tool part at a given status. */
const toolPart = (id, tool, status) => ({
  id,
  callID: `call_${id}`,
  type: 'tool',
  tool,
  state: status === 'running'
    ? { status, input: { description: 'explore' }, time: { start: 1 } }
    : { status, input: { description: 'explore' }, output: 'ok', title: tool, time: { start: 1, end: 2 } },
});

const textPart = (id, text) => ({ id, type: 'text', text });

/** A leg with real output whose `task` tool NEVER reaches a terminal status. */
const stuck = () => [msg('m1', [
  textPart('m1:t', 'partial output'),
  toolPart('p_stuck', 'task', 'running'),
])];

const msg = (id, parts, { completed, cost, tokens } = {}) => ({
  info: {
    role: 'assistant', id,
    time: completed ? { created: 1, completed: 2 } : { created: 1 },
    ...(cost !== undefined ? { cost } : {}),
    ...(tokens !== undefined ? { tokens } : {}),
  },
  parts,
});

/** Every progress.json payload written, in order. */
function progressWrites() {
  return fs.writeFileSync.mock.calls
    .filter((c) => typeof c[0] === 'string' && c[0].includes('progress.json'))
    .map((c) => JSON.parse(c[1]));
}

/** Assistant text appended to conversation.jsonl, concatenated. */
function mirroredText() {
  return fs.appendFileSync.mock.calls
    .map((c) => { try { return JSON.parse(c[1]); } catch { return null; } })
    .filter((o) => o && o.role === 'assistant' && typeof o.content === 'string')
    .map((o) => o.content).join('');
}

beforeEach(() => {
  jest.clearAllMocks();
  fs.existsSync.mockReturnValue(true);
  fs.readFileSync.mockReturnValue(JSON.stringify({ status: 'running' }));
  mockCheckHealth.mockResolvedValue(true);
  mockCreateSession.mockResolvedValue('ses_parent');
  mockSendPromptAsync.mockResolvedValue(undefined);
  mockAbortSession.mockResolvedValue(undefined);
  mockGetChildren.mockResolvedValue([]);
  // The real run's session was BUSY running the tool — the SDK never said idle,
  // so the STABLE_IDLE_POLLS gate is what fired. Model that faithfully.
  mockGetSessionStatus.mockResolvedValue({ type: 'busy' });
  mockStartServer.mockResolvedValue({
    client: {}, server: { url: 'http://127.0.0.1:1', close: jest.fn() },
  });
});

const OPTS = {
  pollIntervalMs: 5, stableIdlePolls: 3, stableFinishedPolls: 2,
  toolCallStallMs: 100000, usageSettlePolls: 1, usageSettleIntervalMs: 1,
  nonce: NONCE, toolSettleGraceMs: 100000,
};

describe('the idle gate must not complete a leg while a tool call is live', () => {
  test('REPLAY of wsgate02-s1-3: the leg waits for the task tool and captures the REAL review', async () => {
    // Poll 1-8: 166-char preamble, `task` tool RUNNING, text static (idle would fire at 3).
    // Poll 9+:  tool 'completed', a 2nd finalized message with the real review.
    let poll = 0;
    mockGetMessages.mockImplementation(() => {
      poll += 1;
      if (poll < 9) {
        return Promise.resolve([msg('m1', [
          textPart('m1:t', 'I will examine the actual source files and cross-reference'),
          toolPart('prt_task', 'task', 'running'),
        ])]);
      }
      return Promise.resolve([
        msg('m1', [
          textPart('m1:t', 'I will examine the actual source files and cross-reference'),
          toolPart('prt_task', 'task', 'completed'),
        ], { completed: true, cost: 0.06091455, tokens: { input: 40026, output: 365, reasoning: 59, cache: { read: 0, write: 0 } } }),
        msg('m2', [textPart('m2:t', `\nTHE REAL REVIEW BODY\n${MARKER}\n`)],
          { completed: true, cost: 0.081878725, tokens: { input: 45755, output: 977, reasoning: 2275, cache: { read: 0, write: 0 } } }),
      ]);
    });

    const result = await runHeadless(MODEL, 'sys', 'user', 'wsg02s13', '/proj', 60000, 'build', OPTS);

    // The defect: pre-fix this returned ONLY the 57-char preamble at poll 4.
    expect(result.completed).toBe(true);
    expect(result.summary).toContain('THE REAL REVIEW BODY');
    // Both assistant messages' spend is captured — the $0.14279 of parent
    // session money that used to land 2-3 minutes after "complete".
    expect(result.usage.costReported).toBeCloseTo(0.14279328, 8);
    expect(result.toolSettleTimedOut).toBeFalsy();
    // It genuinely waited past the idle threshold rather than exiting at poll 4.
    expect(poll).toBeGreaterThanOrEqual(9);
  }, 20000);

  test('a leg whose tools are ALREADY terminal completes with no added latency (wsgate01-s1-2 / wsgate03-s1-1 shape)', async () => {
    // Both recorded multi-tool legs had every tool part terminal well before the
    // leg completed (62.3 s and 14.8 s earlier), so the gate must be a no-op.
    const parts = [
      textPart('m1:t', 'full review text'),
      ...Array.from({ length: 8 }, (_, i) => toolPart(`p${i}`, 'read', 'completed')),
      toolPart('perr', 'read', 'error'), // wsgate03-s1-1's 3 read:error parts
    ];
    mockGetMessages.mockResolvedValue([msg('m1', parts)]);

    const result = await runHeadless(MODEL, 'sys', 'user', 'nolatency', '/proj', 60000, 'build', OPTS);

    expect(result.completed).toBe(true);
    expect(result.toolSettleTimedOut).toBeFalsy();
    expect(result.summary).toBe('full review text');
  }, 20000);

  test('a tool-using leg whose message FINALIZES completes on the stable-finished path', async () => {
    // OpenCode finalizes an assistant message only AFTER its tool calls end
    // (measured: task end 04:38:19.061, message completed 04:38:19.301), so
    // assistantFinished structurally implies settled — verified, not assumed.
    mockGetMessages.mockResolvedValue([msg('m1', [
      textPart('m1:t', 'done reviewing'),
      toolPart('p1', 'glob', 'completed'),
    ], { completed: true, cost: 0.01, tokens: { input: 10, output: 5 } })]);

    const result = await runHeadless(MODEL, 'sys', 'user', 'finished1', '/proj', 60000, 'build', OPTS);
    expect(result.completed).toBe(true);
    expect(result.summary).toBe('done reviewing');
  }, 20000);

  test('the trailing fold marker does NOT complete the leg while a tool is still running', async () => {
    // A fold marker without info.time.completed means OpenCode has not finalized
    // the message, so the session may still be billing (this is the B1 race).
    let poll = 0;
    mockGetMessages.mockImplementation(() => {
      poll += 1;
      const status = poll < 6 ? 'running' : 'completed';
      return Promise.resolve([msg('m1', [
        textPart('m1:t', `answer\n${MARKER}\n`),
        toolPart('p1', 'task', status),
      ], poll < 6 ? {} : { cost: 0.5, tokens: { input: 1, output: 1 } })]);
    });

    const result = await runHeadless(MODEL, 'sys', 'user', 'foldwait1', '/proj', 60000, 'build', OPTS);

    expect(result.completed).toBe(true);
    expect(poll).toBeGreaterThanOrEqual(6); // it waited for the tool
    expect(result.usage.costReported).toBeCloseTo(0.5, 8);
  }, 20000);
});

describe('the wait is BOUNDED and the ceiling is LOUD, not silent', () => {
  test('a tool call that never settles completes the leg anyway after the grace', async () => {
    mockGetMessages.mockResolvedValue(stuck());
    const started = Date.now();

    const result = await runHeadless(MODEL, 'sys', 'user', 'stuck1', '/proj', 60000, 'build',
      { ...OPTS, toolSettleGraceMs: 60 });

    // Bounded: nowhere near the 60 s --timeout.
    expect(Date.now() - started).toBeLessThan(15000);
    // fail LOUD, not CLOSED: the leg COMPLETES (partial output kept), it is not failed.
    expect(result.completed).toBe(true);
    expect(result.timedOut).toBeFalsy();
    expect(result.summary).toBe('partial output');
    // …and it is impossible to miss.
    expect(result.toolSettleTimedOut).toBe(true);
    expect(result.unsettledToolCalls).toEqual([expect.objectContaining({ id: 'p_stuck', name: 'task' })]);
  }, 20000);

  test('the ceiling is surfaced on the error log channel (visible at the default LOG_LEVEL)', async () => {
    mockGetMessages.mockResolvedValue(stuck());
    await runHeadless(MODEL, 'sys', 'user', 'stuck2', '/proj', 60000, 'build',
      { ...OPTS, toolSettleGraceMs: 60 });

    // logger's default level is 'error', so warn/info would be invisible.
    const msgs = mockLogger.error.mock.calls.map((c) => c[0]).join(' | ');
    expect(msgs).toMatch(/tool call/i);
    expect(msgs).toMatch(/settle/i);
  }, 20000);

  test('the ceiling is stamped on the TERMINAL progress record the live GUI reads', async () => {
    mockGetMessages.mockResolvedValue(stuck());
    await runHeadless(MODEL, 'sys', 'user', 'stuck3', '/proj', 60000, 'build',
      { ...OPTS, toolSettleGraceMs: 60 });

    const last = progressWrites().pop();
    expect(last.stage).toBe('complete');
    expect(last.toolSettleTimedOut).toBe(true);
    expect(last.unsettledToolCalls).toBe(1);
  }, 20000);

  test('a settled leg does NOT carry the flag anywhere (no false alarms)', async () => {
    mockGetMessages.mockResolvedValue([msg('m1', [
      textPart('m1:t', 'clean'), toolPart('p1', 'read', 'completed'),
    ], { completed: true })]);

    const result = await runHeadless(MODEL, 'sys', 'user', 'clean1', '/proj', 60000, 'build', OPTS);
    expect(result.toolSettleTimedOut).toBeFalsy();
    const last = progressWrites().pop();
    expect(last.toolSettleTimedOut).toBeUndefined();
  }, 20000);

  test('ANTI-HANG: a legacy no-state tool part must NOT defer completion', async () => {
    // Regression guard. The first cut of this fix deferred on
    // `getPendingToolCalls`, which treats a shapeless `tool_use` part as live.
    // tests/observe/progress-usage-wiring.test.js emits exactly that shape and
    // its leg was held to the full --timeout instead of folding. The gate now
    // reads `getLiveToolCalls` — POSITIVE evidence only.
    mockGetMessages.mockResolvedValue([msg('m1', [
      { id: 'tc1', type: 'tool_use', name: 'web_search', input: { q: 'x' } },
      textPart('m1:t', `answer\n${MARKER}\n`),
    ])]);

    const started = Date.now();
    const result = await runHeadless(MODEL, 'sys', 'user', 'nostate1', '/proj', 20000, 'build',
      { ...OPTS, toolSettleGraceMs: 100000 }); // a grace far beyond the test's patience

    expect(result.completed).toBe(true);
    expect(result.summary).toBe('answer');
    expect(result.toolSettleTimedOut).toBeFalsy();
    expect(Date.now() - started).toBeLessThan(5000); // folded immediately, no wait
  }, 25000);

  test('toolSettleGraceMs: 0 disables the deferral entirely (escape hatch)', async () => {
    mockGetMessages.mockResolvedValue(stuck());
    const result = await runHeadless(MODEL, 'sys', 'user', 'nogr1', '/proj', 60000, 'build',
      { ...OPTS, toolSettleGraceMs: 0 });

    // Pre-v4.4 behaviour: completes at the idle threshold, no waiting, no flag.
    expect(result.completed).toBe(true);
    expect(result.toolSettleTimedOut).toBeFalsy();
  }, 20000);
});

describe('the ceiling ABORTS the session so it stops billing (LC-2, owner ruling 2026-07-26)', () => {
  /** Rebind the server so its close() lands in the same ordering log as the walk/abort. */
  const recordingServer = (calls) => {
    mockStartServer.mockResolvedValue({
      client: {},
      server: { url: 'http://127.0.0.1:1', close: jest.fn(async () => { calls.push('close'); }) },
    });
  };

  test('the settle ceiling aborts the session, after the child walk', async () => {
    const calls = [];
    recordingServer(calls);
    mockGetMessages.mockResolvedValue(stuck());
    mockGetChildren.mockImplementation(async () => { calls.push('walk'); return []; });
    mockAbortSession.mockImplementation(async () => { calls.push('abort'); });

    const result = await runHeadless(MODEL, 'sys', 'user', 'lc2ord', '/proj', 60000, 'build',
      { ...OPTS, toolSettleGraceMs: 60 });

    expect(result.completed).toBe(true);           // unchanged: never fail closed
    expect(result.summary).toBe('partial output'); // unchanged: partial output kept
    expect(result.toolSettleTimedOut).toBe(true);  // unchanged: still loud
    expect(result.toolSettleAborted).toBe(true);   // new
    // ORDER IS THE POINT. Before the walk and the subtree cost data v4.4.0 exists
    // to capture is lost; after server.close() and there is no server to ask.
    expect(calls).toEqual(['walk', 'abort', 'close']);
    expect(mockAbortSession.mock.calls[0][1]).toBe('ses_parent'); // its OWN session
  }, 20000);

  test('the abort flag rides the terminal progress record the live GUI reads', async () => {
    mockGetMessages.mockResolvedValue(stuck());
    await runHeadless(MODEL, 'sys', 'user', 'lc2prog', '/proj', 60000, 'build',
      { ...OPTS, toolSettleGraceMs: 60 });

    const last = progressWrites().pop();
    expect(last.stage).toBe('complete');
    expect(last.toolSettleTimedOut).toBe(true);
    expect(last.toolSettleAborted).toBe(true);
  }, 20000);

  test('a leg that settles normally is never aborted', async () => {
    mockGetMessages.mockResolvedValue([msg('m1', [
      textPart('m1:t', 'clean'), toolPart('p1', 'read', 'completed'),
    ], { completed: true })]);

    const result = await runHeadless(MODEL, 'sys', 'user', 'lc2clean', '/proj', 60000, 'build', OPTS);

    expect(result.toolSettleTimedOut).toBeFalsy();
    expect(result.toolSettleAborted).toBeFalsy();
    expect(result.toolSettleAborted).toBeUndefined(); // absent, not a false alarm
    expect(mockAbortSession).not.toHaveBeenCalled();
    expect(progressWrites().pop().toolSettleAborted).toBeUndefined();
  }, 20000);

  test('an abort failure never sinks a completed leg (standing ruling A-8)', async () => {
    mockGetMessages.mockResolvedValue(stuck());
    mockAbortSession.mockRejectedValue(new Error('boom'));

    const result = await runHeadless(MODEL, 'sys', 'user', 'lc2boom', '/proj', 60000, 'build',
      { ...OPTS, toolSettleGraceMs: 60 });

    // The leg already succeeded and was already paid for. An optimization layered
    // on top of it must never subtract value from it.
    expect(result.completed).toBe(true);
    expect(result.summary).toBe('partial output');
    expect(result.error).toBeUndefined();
    expect(result.toolSettleTimedOut).toBe(true);
    // …and it says so: we tried and could not, so the session MAY still be billing.
    expect(result.toolSettleAborted).toBe(false);
  }, 20000);

  /**
   * Task 6 review X1. The ordering test above uses an OWNED server so `close`
   * can join the assertion array — but the case the LC-2 abort exists for is
   * `externalServer: true`, i.e. EVERY council leg, where `close()` is never
   * called and the abort is the only thing that stops the session billing
   * against a server that outlives the leg. That was the regression with no
   * test. It is provably fine by inspection (the abort block is not guarded by
   * `externalServer`), so this is a guard, not a bug report — but the guard is
   * what stops a future `if (!externalServer)` from silently un-fixing the
   * expensive half of the case.
   */
  test('X1: on a SHARED server (every council leg) the abort still fires — and close() does NOT', async () => {
    const calls = [];
    const sharedClose = jest.fn(async () => { calls.push('close'); });
    mockGetMessages.mockResolvedValue(stuck());
    mockGetChildren.mockImplementation(async () => { calls.push('walk'); return []; });
    mockAbortSession.mockImplementation(async () => { calls.push('abort'); });

    const result = await runHeadless(MODEL, 'sys', 'user', 'lc2shared', '/proj', 60000, 'build', {
      ...OPTS,
      toolSettleGraceMs: 60,
      // Shared-server mode is detected from client+server both being supplied.
      client: {},
      server: { url: 'http://127.0.0.1:1', close: sharedClose },
    });

    expect(result.completed).toBe(true);
    expect(result.summary).toBe('partial output');
    expect(result.toolSettleTimedOut).toBe(true);
    // THE POINT: the abort landed even though nothing else will ever stop this
    // session — the shared server is not ours to close.
    expect(result.toolSettleAborted).toBe(true);
    expect(mockAbortSession).toHaveBeenCalled();
    expect(mockAbortSession.mock.calls[0][1]).toBe('ses_parent');
    // …and the walk still ran first, with no close() anywhere.
    expect(calls).toEqual(['walk', 'abort']);
    expect(sharedClose).not.toHaveBeenCalled();
  }, 20000);

  test('X2: a LANDED abort is logged at info, not warn (a good outcome is not a warning)', async () => {
    mockGetMessages.mockResolvedValue(stuck());
    await runHeadless(MODEL, 'sys', 'user', 'lc2level', '/proj', 60000, 'build',
      { ...OPTS, toolSettleGraceMs: 60 });

    const infos = mockLogger.info.mock.calls.map((c) => c[0]);
    const warns = mockLogger.warn.mock.calls.map((c) => c[0]);
    expect(infos).toContain('Aborted the OpenCode session after the tool-settle ceiling');
    expect(warns.join(' | ')).not.toMatch(/^Aborted the OpenCode session/m);
  }, 20000);

  test('X2: a FAILED abort stays at warn — that one really is a problem', async () => {
    mockGetMessages.mockResolvedValue(stuck());
    mockAbortSession.mockRejectedValue(new Error('boom'));
    await runHeadless(MODEL, 'sys', 'user', 'lc2lvl2', '/proj', 60000, 'build',
      { ...OPTS, toolSettleGraceMs: 60 });

    const warns = mockLogger.warn.mock.calls.map((c) => c[0]).join(' | ');
    expect(warns).toMatch(/Could not abort the session/);
  }, 20000);

  test('an abort that never returns is bounded — the leg is not held hostage', async () => {
    mockGetMessages.mockResolvedValue(stuck());
    mockAbortSession.mockImplementation(() => new Promise(() => {})); // never settles
    const started = Date.now();

    const result = await runHeadless(MODEL, 'sys', 'user', 'lc2hang', '/proj', 60000, 'build',
      { ...OPTS, toolSettleGraceMs: 60, toolSettleAbortTimeoutMs: 50 });

    expect(result.completed).toBe(true);
    expect(result.summary).toBe('partial output');
    expect(result.toolSettleAborted).toBe(false);
    expect(Date.now() - started).toBeLessThan(15000);
  }, 20000);
});

describe('a subagent call is DETECTED so its unattributed child spend can be flagged (Task 2)', () => {
  test('runHeadless reports subagentToolCalls for a leg that made a `task` call', async () => {
    // OpenCode's tool is named `task` in LOWERCASE. The pre-existing
    // `t.name === 'Task'` filter could never match even once the name was read.
    mockGetMessages.mockResolvedValue([msg('m1', [
      textPart('m1:t', 'review'),
      toolPart('prt_task', 'task', 'completed'),
      toolPart('prt_read', 'read', 'completed'),
    ], { completed: true, cost: 0.11210719, tokens: { input: 966589, output: 7228 } })]);

    const result = await runHeadless(MODEL, 'sys', 'user', 'subag1', '/proj', 60000, 'build', OPTS);
    expect(result.completed).toBe(true);
    expect(result.subagentToolCalls).toBe(1);
    // The tool name now actually reaches the recorded tool call.
    expect(result.toolCalls.map((t) => t.name).sort()).toEqual(['read', 'task']);
  }, 20000);

  test('a leg with tool calls but NO subagent carries no subtree flag', async () => {
    mockGetMessages.mockResolvedValue([msg('m1', [
      textPart('m1:t', 'review'), toolPart('p1', 'glob', 'completed'),
    ], { completed: true })]);

    const result = await runHeadless(MODEL, 'sys', 'user', 'nosub1', '/proj', 60000, 'build', OPTS);
    expect(result.subagentToolCalls).toBeUndefined();
  }, 20000);
});

describe('the pre-existing exit paths are preserved', () => {
  test('a user-initiated abort stays IMMEDIATE even with a live tool call', async () => {
    mockGetMessages.mockResolvedValue([msg('m1', [
      textPart('m1:t', 'working'), toolPart('p1', 'task', 'running'),
    ])]);
    // The external abort marker the MCP/CLI abort verb writes.
    fs.readFileSync.mockReturnValue(JSON.stringify({ status: 'aborted' }));

    const started = Date.now();
    const result = await runHeadless(MODEL, 'sys', 'user', 'abort1', '/proj', 60000, 'build',
      { ...OPTS, toolSettleGraceMs: 100000 });

    expect(result.aborted).toBe(true);
    expect(result.completed).toBe(false);
    expect(Date.now() - started).toBeLessThan(5000); // not held by the settle grace
    expect(mockAbortSession).toHaveBeenCalled();
  }, 20000);

  test('the overall --timeout still fires while a tool call is live', async () => {
    mockGetMessages.mockResolvedValue([msg('m1', [
      textPart('m1:t', 'working'), toolPart('p1', 'task', 'running'),
    ])]);

    const result = await runHeadless(MODEL, 'sys', 'user', 'tmo1', '/proj', 200, 'build',
      { ...OPTS, toolSettleGraceMs: 100000 });

    expect(result.timedOut).toBe(true);
    expect(result.completed).toBe(false);
  }, 20000);

  test('B53 still fails fast on a wedge with NO output (its actual target case)', async () => {
    // No text part ever ⇒ the idle gate never engages ⇒ no deferral is active ⇒
    // the stall detector is untouched by this change.
    mockGetMessages.mockResolvedValue([msg('m1', [toolPart('p1', 'bash', 'running')])]);

    const result = await runHeadless(MODEL, 'sys', 'user', 'wedge1', '/proj', 60000, 'build',
      { ...OPTS, toolCallStallMs: 40, toolSettleGraceMs: 100000 });

    expect(result.completed).toBe(false);
    expect(result.error).toMatch(/Tool call stalled/);
    expect(result.error).toMatch(/bash/);
  }, 20000);

  test('LC-3 regression floor: the pre-existing exit paths still WRITE a terminal record at all', async () => {
    // Cheap belt on the refactor: the terminal write sits above both returns, so
    // a leg that errors out with no output must still leave a progress record —
    // deriving the stage must not have moved the write behind a branch.
    mockGetMessages.mockResolvedValue([msg('m1', [toolPart('p1', 'bash', 'running')])]);
    await runHeadless(MODEL, 'sys', 'user', 'lc3floor', '/proj', 60000, 'build',
      { ...OPTS, toolCallStallMs: 40, toolSettleGraceMs: 100000 });
    expect(progressWrites().length).toBeGreaterThan(0);
  }, 20000);

  test('B1 usage settle still runs AFTER the deferral ends (ordering preserved)', async () => {
    // The tool settles and the fold marker lands with NO usage; usage is stamped
    // only on the post-loop settle re-poll. Both mechanisms must compose.
    let poll = 0;
    mockGetMessages.mockImplementation(() => {
      poll += 1;
      if (poll < 4) {
        return Promise.resolve([msg('m1', [textPart('m1:t', 'text'), toolPart('p1', 'task', 'running')])]);
      }
      if (poll === 4) {
        // Tool settles, marker lands, still NO usage payload (the B1 race).
        return Promise.resolve([msg('m1', [
          textPart('m1:t', `text\n${MARKER}\n`), toolPart('p1', 'task', 'completed'),
        ])]);
      }
      // The settle re-poll finally sees the finalization stamp.
      return Promise.resolve([msg('m1', [
        textPart('m1:t', `text\n${MARKER}\n`), toolPart('p1', 'task', 'completed'),
      ], { completed: true, cost: 0.00759441096, tokens: { input: 100, output: 20 } })]);
    });

    const result = await runHeadless(MODEL, 'sys', 'user', 'settle1', '/proj', 60000, 'build',
      { ...OPTS, usageSettlePolls: 3, usageSettleIntervalMs: 1 });

    expect(result.completed).toBe(true);
    expect(result.usage.costReported).toBeCloseTo(0.00759441096, 11);
    // …and the assistant text was mirrored exactly once despite the extra reads.
    expect(mirroredText().match(/text/g)).toHaveLength(1);
  }, 20000);
});

/**
 * v4.4.1 LC-3 — the terminal progress record must tell the TRUTH about how the
 * leg ended.
 *
 * THE DEFECT. `writeProgress(sessionDir, 'complete', …)` sits above BOTH returns
 * at the bottom of runHeadless, so every terminal path reached it: the external
 * abort, the --timeout, the poll-failure bail, the tool-call wedge. The live
 * Council Workspace reads progress.json DIRECTLY (src/observe/live-doc.js
 * enrichLegUsage), so an aborted or errored leg rendered with a green check for
 * the whole window before metadata.json landed. A green check on a failed leg is
 * exactly the class of lie the v4.4 cost effort exists to remove.
 *
 * THE FIX IS AT THE WRITER. src/observe/council-legs.js already prefers
 * metadata.json for a terminal leg and is not the problem; the live doc's other
 * consumer has nothing else to read. The stage is derived from
 * resolveTerminalState (src/sidecar/session-finalize.js) — the same function
 * that will stamp metadata.json's status from this function's return value — so
 * the two can never disagree.
 */
describe('LC-3: the terminal progress record states how the leg actually ended', () => {
  const lastStage = () => progressWrites().pop().stage;

  test('a CLEAN leg still writes stage "complete" (no regression)', async () => {
    mockGetMessages.mockResolvedValue([msg('m1', [
      textPart('m1:t', 'clean'), toolPart('p1', 'read', 'completed'),
    ], { completed: true })]);

    const result = await runHeadless(MODEL, 'sys', 'user', 'lc3ok', '/proj', 60000, 'build', OPTS);
    expect(result.completed).toBe(true);
    expect(lastStage()).toBe('complete');
  }, 20000);

  test('an ABORTED leg writes stage "aborted", not "complete"', async () => {
    mockGetMessages.mockResolvedValue([msg('m1', [
      textPart('m1:t', 'working'), toolPart('p1', 'task', 'running'),
    ])]);
    // The external abort marker the MCP/CLI abort verb writes.
    fs.readFileSync.mockReturnValue(JSON.stringify({ status: 'aborted' }));

    const result = await runHeadless(MODEL, 'sys', 'user', 'lc3abort', '/proj', 60000, 'build',
      { ...OPTS, toolSettleGraceMs: 100000 });

    expect(result.aborted).toBe(true);
    expect(lastStage()).toBe('aborted');
  }, 20000);

  test('a TIMED-OUT leg writes stage "timed-out", not "complete"', async () => {
    // The case a hand-rolled `aborted ? … : sessionError ? … : 'complete'` would
    // still have got wrong: neither flag is set, yet the leg plainly failed.
    mockGetMessages.mockResolvedValue([msg('m1', [
      textPart('m1:t', 'working'), toolPart('p1', 'task', 'running'),
    ])]);

    const result = await runHeadless(MODEL, 'sys', 'user', 'lc3tmo', '/proj', 200, 'build',
      { ...OPTS, toolSettleGraceMs: 100000 });

    expect(result.timedOut).toBe(true);
    expect(result.completed).toBe(false);
    expect(lastStage()).toBe('timed-out');
  }, 20000);

  test('a WEDGED leg (B53, error with no output) writes stage "error"', async () => {
    mockGetMessages.mockResolvedValue([msg('m1', [toolPart('p1', 'bash', 'running')])]);

    const result = await runHeadless(MODEL, 'sys', 'user', 'lc3wedge', '/proj', 60000, 'build',
      { ...OPTS, toolCallStallMs: 40, toolSettleGraceMs: 100000 });

    expect(result.completed).toBe(false);
    expect(result.error).toMatch(/Tool call stalled/);
    expect(lastStage()).toBe('error');
  }, 20000);

  test('a model error with NO output writes stage "error"', async () => {
    mockGetMessages.mockResolvedValue([{
      info: {
        role: 'assistant', id: 'm1', time: { created: 1, completed: 2 },
        error: { name: 'ProviderError', data: { message: 'upstream 502' } },
      },
      parts: [],
    }]);

    const result = await runHeadless(MODEL, 'sys', 'user', 'lc3err', '/proj', 60000, 'build', OPTS);
    expect(result.error).toBe('upstream 502');
    expect(lastStage()).toBe('error');
  }, 20000);

  test('F1 SEMANTICS: a model error ALONGSIDE usable output is still "complete"', async () => {
    // The other case the hand-rolled expression would have got wrong, in the
    // opposite direction. This leg returns exitCode 0 with a usable summary and
    // finalizeHeadlessResult will stamp metadata.status = 'complete', so a
    // progress stage of 'error' would be a fresh lie pointed the other way.
    mockGetMessages.mockResolvedValue([msg('m1', [
      textPart('m1:t', `a real answer\n${MARKER}\n`), toolPart('p1', 'read', 'completed'),
    ], { completed: true, cost: 0.01, tokens: { input: 10, output: 5 } })].map((m) => ({
      ...m,
      info: { ...m.info, error: { name: 'ProviderError', data: { message: 'late warning' } } },
    })));

    const result = await runHeadless(MODEL, 'sys', 'user', 'lc3f1', '/proj', 60000, 'build', OPTS);

    expect(result.completed).toBe(true);
    expect(result.summary).toBe('a real answer');
    expect(result.error).toBeUndefined();   // F1: output present ⇒ not propagated
    expect(lastStage()).toBe('complete');   // …and the stage agrees with the result
  }, 20000);

  test('the stage always matches what resolveTerminalState will stamp on metadata.json', async () => {
    // The invariant behind the whole fix, asserted end-to-end rather than by
    // inspection: progress.json's stage and metadata.json's status come from one
    // function, so a leg can never render green in the GUI and red in the file.
    const { resolveTerminalState } = require('../../src/sidecar/session-finalize');

    mockGetMessages.mockResolvedValue([msg('m1', [
      textPart('m1:t', 'working'), toolPart('p1', 'task', 'running'),
    ])]);
    fs.readFileSync.mockReturnValue(JSON.stringify({ status: 'aborted' }));

    const result = await runHeadless(MODEL, 'sys', 'user', 'lc3pin', '/proj', 60000, 'build',
      { ...OPTS, toolSettleGraceMs: 100000 });

    expect(lastStage()).toBe(resolveTerminalState(result).status);
    expect(lastStage()).toBe('aborted');
  }, 20000);

  test('the settle flags still ride the terminal record on a NON-complete stage', async () => {
    // The B4/LC-2 payload is orthogonal to the stage — widening the stage must
    // not have dropped it on any path.
    mockGetMessages.mockResolvedValue(stuck());
    const result = await runHeadless(MODEL, 'sys', 'user', 'lc3flags', '/proj', 60000, 'build',
      { ...OPTS, toolSettleGraceMs: 60 });

    const last = progressWrites().pop();
    expect(result.completed).toBe(true);
    expect(last.stage).toBe('complete');
    expect(last.toolSettleTimedOut).toBe(true);
    expect(last.toolSettleAborted).toBe(true);
  }, 20000);
});

/**
 * v4.4.1 A3 — the last hole in LC-3's story.
 *
 * LC-3 fixed the SUCCESS path: the terminal progress record's stage is now derived from
 * resolveTerminalState instead of being hardcoded 'complete', so an aborted/errored/timed-out
 * leg stops rendering with a green check. But runHeadless also has an outer `catch (error)`,
 * and that path wrote NO terminal progress record at all — so on an exception progress.json
 * kept whatever non-terminal stage the last flush left on it (usually 'receiving') while the
 * caller's finalizeHeadlessResult stamped metadata.json 'error' off the returned result.
 *
 * That is the same stale-state class LC-3 closed one path over, and it matters for the same
 * reason: the live Council Workspace and `amicus watch` read progress.json DIRECTLY
 * (src/observe/live-doc.js enrichLegUsage, src/observe/council-legs.js), so a leg that blew up
 * rendered as still-streaming for the rest of the window.
 */
describe('A3: the exception path writes a terminal progress record too', () => {
  const lastProgress = () => progressWrites().pop();

  test('a throw before the poll loop still stamps a terminal stage, not "receiving"', async () => {
    mockSendPromptAsync.mockRejectedValue(new Error('session prompt exploded'));

    const result = await runHeadless(MODEL, 'sys', 'user', 'a3boom', '/proj', 60000, 'build', OPTS);

    expect(result.completed).toBe(false);
    expect(result.error).toBe('session prompt exploded');
    // Pre-fix the LAST progress write on this path was 'session_created' — a non-terminal stage
    // that the GUI and `amicus watch` both read as "still working".
    expect(lastProgress().stage).toBe('error');
    expect(lastProgress().stageLabel).toBe('Failed');
  }, 20000);

  test('the stage agrees with what finalizeHeadlessResult will stamp on metadata.json', async () => {
    // The same invariant LC-3 asserts for the success path: one function decides both, so a leg
    // can never render green in the GUI and red in the file.
    const { resolveTerminalState } = require('../../src/sidecar/session-finalize');
    mockSendPromptAsync.mockRejectedValue(new Error('boom'));

    const result = await runHeadless(MODEL, 'sys', 'user', 'a3pin', '/proj', 60000, 'build', OPTS);

    expect(lastProgress().stage).toBe(resolveTerminalState(result).status);
  }, 20000);

  test('the last known usage is carried onto the terminal record, not deleted', async () => {
    // writeProgress REBUILDS progress.json rather than merging, so a bare terminal write would
    // silently drop whatever real spend the last 'receiving' flush recorded — trading a
    // stale-stage bug for a cost UNDER-report on exactly the legs that failed.
    const priorUsage = { tokens: { input: 4000, output: 120 }, costReported: 0.0031 };
    fs.readFileSync.mockImplementation((p) => (String(p).includes('progress.json')
      ? JSON.stringify({ schemaVersion: 1, type: 'progress', stage: 'receiving', usage: priorUsage })
      : JSON.stringify({ status: 'running' })));
    mockSendPromptAsync.mockRejectedValue(new Error('boom'));

    await runHeadless(MODEL, 'sys', 'user', 'a3usage', '/proj', 60000, 'build', OPTS);

    expect(lastProgress().stage).toBe('error');
    expect(lastProgress().usage).toEqual(priorUsage);
  }, 20000);

  test('an unreadable prior progress.json does not stop the terminal record (never throws inside the error handler)', async () => {
    fs.readFileSync.mockImplementation((p) => {
      if (String(p).includes('progress.json')) { throw new Error('EACCES'); }
      return JSON.stringify({ status: 'running' });
    });
    mockSendPromptAsync.mockRejectedValue(new Error('boom'));

    const result = await runHeadless(MODEL, 'sys', 'user', 'a3unreadable', '/proj', 60000, 'build', OPTS);

    expect(result.error).toBe('boom');           // the ORIGINAL error, never masked
    expect(lastProgress().stage).toBe('error');
    expect(lastProgress().usage).toBeUndefined();
  }, 20000);

  test('a progress write that itself fails is swallowed — the original error still comes back', async () => {
    // Armed only once the run is underway — the 'initializing' write at the top of runHeadless
    // sits OUTSIDE the outer try, so failing it would abort before this path is even reached.
    let armed = false;
    mockSendPromptAsync.mockImplementation(async () => { armed = true; throw new Error('the real failure'); });
    fs.writeFileSync.mockImplementation((p) => {
      if (armed && String(p).includes('progress.json')) { throw new Error('disk full'); }
    });

    const result = await runHeadless(MODEL, 'sys', 'user', 'a3wfail', '/proj', 60000, 'build', OPTS);

    expect(result.error).toBe('the real failure');
    expect(result.completed).toBe(false);
    expect(mockLogger.debug).toHaveBeenCalledWith(
      'terminal progress write failed after exception (best-effort)',
      expect.objectContaining({ taskId: 'a3wfail' }),
    );
  }, 20000);

  /**
   * v4.4.1 M2 — review minor. `if (!externalServer) { await server.close(); }` sat directly
   * above this whole block, OUTSIDE any try. A rejecting close() would have skipped the
   * terminal-write block entirely (never reached) AND replaced `result.error` with the close
   * failure instead of the original exception — silently losing both halves of what A3 exists
   * to guarantee. Now guarded: a close failure is logged and swallowed, same as every other
   * best-effort close in this file.
   */
  test('M2: a server.close() rejection in the exception path does not mask the original error or skip the terminal write', async () => {
    // The PRECEDING test overrides fs.writeFileSync with a throwing implementation that
    // jest.clearAllMocks() (in beforeEach) does not remove — only mockReset()/resetAllMocks()
    // clears an implementation, and this suite only clears calls. Restore the harness default
    // (a bare no-op) so this test observes ITS OWN scenario, not the previous test's.
    fs.writeFileSync.mockImplementation(() => {});
    mockStartServer.mockResolvedValue({
      client: {},
      server: { url: 'http://127.0.0.1:1', close: jest.fn(async () => { throw new Error('close blew up'); }) },
    });
    mockSendPromptAsync.mockRejectedValue(new Error('the real failure'));

    const result = await runHeadless(MODEL, 'sys', 'user', 'm2close', '/proj', 60000, 'build', OPTS);

    expect(result.error).toBe('the real failure'); // NOT replaced by the close() rejection
    expect(result.completed).toBe(false);
    expect(lastProgress().stage).toBe('error');     // the terminal write still ran
    expect(lastProgress().stageLabel).toBe('Failed');
    expect(mockLogger.debug).toHaveBeenCalledWith(
      'server.close() failed in the outer exception handler (best-effort)',
      expect.objectContaining({ taskId: 'm2close', error: 'close blew up' }),
    );
  }, 20000);

  /**
   * v4.4.1 M3 — review minor. The comment above the `usage` read-back used to say "carrying the
   * last known ones forward", which reads as "whatever the last flush wrote". The last
   * 'receiving' flush's `p.extra` also carried `messagesReceived` (src/sidecar/conversation-
   * mirror.js), and that is NOT carried onto the exception path's terminal record — only `usage`
   * is. This pins the actual (unchanged) scope so the comment and the code cannot drift apart
   * again: readProgress() only ever falls back to `messagesReceived` when conversation.jsonl has
   * no assistant entries, so dropping it here (where the leg blew up, not where it never
   * started) costs nothing real.
   */
  test('M3: only `usage` survives onto the exception terminal record — other prior extras (e.g. messagesReceived) are dropped, by design', async () => {
    // See the M2 test above for why this reset is needed: a preceding test's writeFileSync
    // mock implementation otherwise leaks in (clearAllMocks() does not clear implementations).
    fs.writeFileSync.mockImplementation(() => {});
    const priorUsage = { tokens: { input: 10, output: 2 }, costReported: 0.0001 };
    fs.readFileSync.mockImplementation((p) => (String(p).includes('progress.json')
      ? JSON.stringify({ schemaVersion: 1, type: 'progress', stage: 'receiving', messagesReceived: 7, usage: priorUsage })
      : JSON.stringify({ status: 'running' })));
    mockSendPromptAsync.mockRejectedValue(new Error('boom'));

    await runHeadless(MODEL, 'sys', 'user', 'm3extra', '/proj', 60000, 'build', OPTS);

    const last = lastProgress();
    expect(last.usage).toEqual(priorUsage);
    expect(last).not.toHaveProperty('messagesReceived');
  }, 20000);
});

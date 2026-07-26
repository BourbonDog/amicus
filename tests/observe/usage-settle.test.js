'use strict';

/**
 * v4.4 B1 + B3 — the finalization race and the stale-zero progress snapshot.
 *
 * B1 (diagnosis §2): the poll loop's FAST-PATH exits (trailing fold marker,
 * SDK `idle`, and the no-finish-signal STABLE_IDLE_POLLS gate) all `break`
 * WITHOUT requiring `info.time.completed`, and nothing re-reads messages
 * between the break and the final `sumPerMessageUsage(mirror.usageByMsg)`.
 * OpenCode stamps `info.tokens`/`info.cost` at finalization, so a leg that
 * folds in the same poll that carried its last text delta loses its usage.
 * Measured on real paid legs: `$0.00759441096` lost by 155 ms
 * (council-wsgate04/wsgate04-p1-1) and `$0.00690565716` by 29 ms (p2-1).
 *
 * B3 (diagnosis §4): `progress.json`'s `usage` block is stamped ONLY on
 * `receiving` flushes, which fire on text/tool/reasoning GROWTH — always
 * before finalization — and `writeProgress` rebuilds the file from scratch,
 * so it cannot preserve a prior snapshot. 31 of 35 real legs ended with an
 * all-zero `usage` in `progress.json` while `metadata.json` held thousands of
 * real tokens. That snapshot is what the LIVE workspace GUI reads
 * (src/observe/live-doc.js `enrichLegUsage`), so every completed leg looked free.
 *
 * Both are driven here through the REAL runHeadless poll loop against a fake
 * SDK client — no network, no paid run (diagnosis §10.2).
 */

const fs = require('fs');

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  appendFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
  renameSync: jest.fn(),
  rmSync: jest.fn(),
  readFileSync: jest.fn(() => '{}'),
}));

const mockCreateSession = jest.fn();
const mockSendPromptAsync = jest.fn();
const mockGetMessages = jest.fn();
const mockCheckHealth = jest.fn();
const mockStartServer = jest.fn();
const mockAbortSession = jest.fn();
const mockGetSessionStatus = jest.fn();

jest.mock('../../src/opencode-client', () => ({
  createSession: mockCreateSession,
  sendPrompt: mockSendPromptAsync,
  sendPromptAsync: mockSendPromptAsync,
  getMessages: mockGetMessages,
  checkHealth: mockCheckHealth,
  startServer: mockStartServer,
  abortSession: mockAbortSession,
  getSessionStatus: mockGetSessionStatus,
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const { runHeadless } = require('../../src/headless');
const { buildFoldMarker } = require('../../src/utils/fold-marker');

const NONCE = 'settlenonce1234567';
const MARKER = buildFoldMarker(NONCE);
const MODEL = 'openrouter/z-ai/glm-5.2';

/** The exact shape of the two real glm repair legs that lost their usage. */
function foldedMessage({ tokens, cost, completed }) {
  const info = { role: 'assistant', id: 'msg-1', time: completed ? { completed: Date.now() } : {} };
  if (tokens) { info.tokens = tokens; }
  if (cost !== undefined) { info.cost = cost; }
  return { info, parts: [{ id: 'p1', type: 'text', text: `The review body.\n${MARKER}` }] };
}

function progressWrites() {
  return fs.writeFileSync.mock.calls
    .filter((c) => typeof c[0] === 'string' && c[0].includes('progress.json'))
    .map((c) => JSON.parse(c[1]));
}

function conversationAppends() {
  return fs.appendFileSync.mock.calls
    .filter((c) => typeof c[0] === 'string' && c[0].includes('conversation.jsonl'))
    .map((c) => JSON.parse(c[1]));
}

function run(opts = {}) {
  return runHeadless(MODEL, '# system', 'review this', 'settle-task', '/test/project', 15000,
    undefined, { nonce: NONCE, pollIntervalMs: 5, usageSettleIntervalMs: 1, ...opts });
}

describe('B1: the fold-marker fast path loses usage without a post-loop re-poll', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckHealth.mockResolvedValue(true);
    mockCreateSession.mockResolvedValue('ses_race');
    mockSendPromptAsync.mockResolvedValue(undefined);
    mockGetSessionStatus.mockResolvedValue({ type: 'busy' });
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('{}');
    mockStartServer.mockResolvedValue({
      client: {}, server: { url: 'http://127.0.0.1:4440', close: jest.fn() },
    });
  });

  test('usage stamped ONE poll after the fold-marker break is still captured', async () => {
    // Poll 1: the marker is visible in the SAME snapshot that carried the last
    // text delta, with NO usage payload yet — the losing side of the real race.
    mockGetMessages
      .mockResolvedValueOnce([foldedMessage({ tokens: undefined, cost: undefined, completed: false })])
      // Settle poll: OpenCode has now stamped tokens + cost (155 ms later, live).
      .mockResolvedValue([foldedMessage({
        tokens: { input: 21456, output: 1893, reasoning: 0, cache: { read: 0, write: 0 } },
        cost: 0.00759441096, completed: true,
      })]);

    const result = await run();

    expect(result.completed).toBe(true);
    expect(result.usage.costReported).toBeCloseTo(0.00759441096, 10);
    expect(result.usage.tokens.input).toBe(21456);
    expect(result.usage.tokens.output).toBe(1893);
  }, 20000);

  test('the settle re-poll must NOT re-mirror text into conversation.jsonl', async () => {
    mockGetMessages
      .mockResolvedValueOnce([foldedMessage({ completed: false })])
      .mockResolvedValue([foldedMessage({ tokens: { input: 10, output: 5 }, cost: 0.001, completed: true })]);

    await run();

    const assistantText = conversationAppends()
      .filter((l) => l.role === 'assistant' && typeof l.content === 'string' && l.content.includes('The review body.'));
    expect(assistantText).toHaveLength(1);
  }, 20000);

  test('the re-poll is bounded and stops as soon as usage is present', async () => {
    mockGetMessages
      .mockResolvedValueOnce([foldedMessage({ completed: false })])
      .mockResolvedValue([foldedMessage({ tokens: { input: 10, output: 5 }, cost: 0.001, completed: true })]);

    await run({ usageSettlePolls: 5 });

    // 1 loop poll + exactly 1 settle poll (priced on the first re-read).
    expect(mockGetMessages).toHaveBeenCalledTimes(2);
  }, 20000);

  test('the re-poll gives up after usageSettlePolls when usage never arrives', async () => {
    mockGetMessages.mockResolvedValue([foldedMessage({ completed: false })]);

    const result = await run({ usageSettlePolls: 3 });

    expect(mockGetMessages).toHaveBeenCalledTimes(4); // 1 loop + 3 bounded settle polls
    // B2 composes here: no observation → unknown, never a fabricated $0.
    expect(result.usage.tokens.input).toBe(0);
    expect(result.completed).toBe(true);
  }, 20000);

  test('a failing re-poll is best-effort and never changes the completion verdict', async () => {
    mockGetMessages
      .mockResolvedValueOnce([foldedMessage({ completed: false })])
      .mockRejectedValue(new Error('server gone'));

    const result = await run();

    expect(result.completed).toBe(true);
    expect(result.error).toBeUndefined();
  }, 20000);

  test('the SDK-idle fast path is covered by the same re-poll', async () => {
    // No fold marker at all: text streams, then session.status reports idle.
    const textOnly = (info) => ({ info, parts: [{ id: 'p1', type: 'text', text: 'Answer with no marker.' }] });
    mockGetSessionStatus.mockResolvedValue({ type: 'idle' });
    mockGetMessages
      .mockResolvedValueOnce([textOnly({ role: 'assistant', id: 'm1', time: {} })])
      .mockResolvedValue([textOnly({
        role: 'assistant', id: 'm1', time: { completed: Date.now() },
        tokens: { input: 900, output: 120 }, cost: 0.00690565716,
      })]);

    const result = await run();

    expect(result.completed).toBe(true);
    expect(result.usage.costReported).toBeCloseTo(0.00690565716, 10);
  }, 20000);

  test('an externally aborted leg does not re-poll (nothing to settle)', async () => {
    // metadata.json reads back status:'aborted' → the loop breaks with aborted.
    fs.readFileSync.mockReturnValue(JSON.stringify({ status: 'aborted' }));
    mockGetMessages.mockResolvedValue([foldedMessage({ completed: false })]);

    const result = await run();

    expect(result.aborted).toBe(true);
    expect(mockGetMessages).not.toHaveBeenCalled();
  }, 20000);
});

/**
 * v4.4 cost-council finding 2 — the "best-effort" settle loop could still crash
 * the leg.
 *
 * The try/catch wrapped ONLY the `withTimeout(getMessages(...))` network call.
 * The synchronous work after it — `mirrorUsageOnly(settled, mirror)` and
 * `allAssistantUsagePresent(settled)` — ran outside the boundary, so a throw
 * there escaped `runHeadless`, DISCARDING a leg whose model output had already
 * been captured and paid for, and surfacing as an unhandled rejection.
 *
 * Scope correction on the council's report: the specific payload it named (an
 * error OBJECT where an array was expected) does NOT throw — `getMessages`
 * normalizes a non-array SDK response to `[]`, and both helpers additionally
 * guard with `Array.isArray`. The BOUNDARY gap it identified is nonetheless
 * real: any throw raised while inspecting the snapshot destroys the leg. These
 * tests drive that with a payload that is an array but whose element is hostile
 * on property access, which is what "structurally malformed" has to mean once
 * the two `Array.isArray` guards are accounted for.
 */
describe('the settle loop is a real best-effort boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckHealth.mockResolvedValue(true);
    mockCreateSession.mockResolvedValue('ses_fault');
    mockSendPromptAsync.mockResolvedValue(undefined);
    mockGetSessionStatus.mockResolvedValue({ type: 'busy' });
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('{}');
    mockStartServer.mockResolvedValue({
      client: {}, server: { url: 'http://127.0.0.1:4440', close: jest.fn() },
    });
  });

  /** An array (so both Array.isArray guards pass) that throws when read. */
  const hostileSnapshot = () => [{
    get info() { throw new TypeError('Cannot read properties of undefined'); },
  }];

  test('a snapshot that throws while being inspected must not discard the leg', async () => {
    mockGetMessages
      .mockResolvedValueOnce([foldedMessage({ completed: false })])
      .mockResolvedValue(hostileSnapshot());

    const result = await run();

    // The whole point: the model's answer was already captured and billed.
    expect(result.completed).toBe(true);
    expect(result.summary).toContain('The review body.');
    expect(result.error).toBeUndefined();
  }, 20000);

  test('the throw is contained, logged, and stops further settle reads', async () => {
    const { logger } = require('../../src/utils/logger');
    mockGetMessages
      .mockResolvedValueOnce([foldedMessage({ completed: false })])
      .mockResolvedValue(hostileSnapshot());

    await run({ usageSettlePolls: 3 });

    // 1 loop poll + exactly 1 settle read: the first failure ends the re-poll,
    // same as the network-failure branch — never a retry storm on a bad shape.
    expect(mockGetMessages).toHaveBeenCalledTimes(2);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('usage-settle'),
      expect.objectContaining({ error: expect.stringContaining('Cannot read properties') }),
    );
  }, 20000);

  test('the terminal progress record still lands after a settle throw', async () => {
    mockGetMessages
      .mockResolvedValueOnce([foldedMessage({ completed: false })])
      .mockResolvedValue(hostileSnapshot());

    await run();

    const writes = progressWrites();
    expect(writes[writes.length - 1].stage).toBe('complete');
  }, 20000);

  test('a hostile snapshot on a LATER read keeps the usage already settled', async () => {
    // Settle read 1 prices msg-1 but leaves msg-2 unpriced, so
    // allAssistantUsagePresent is false and the loop goes round again; settle
    // read 2 is hostile. The $ captured on read 1 must survive the throw.
    const second = { info: { role: 'assistant', id: 'msg-2', time: {} }, parts: [] };
    mockGetMessages
      .mockResolvedValueOnce([foldedMessage({ completed: false })])
      .mockResolvedValueOnce([
        foldedMessage({ tokens: { input: 700, output: 42 }, cost: 0.0031, completed: false }),
        second,
      ])
      .mockResolvedValue(hostileSnapshot());

    const result = await run({ usageSettlePolls: 4 });

    expect(result.completed).toBe(true);
    expect(mockGetMessages).toHaveBeenCalledTimes(3); // 1 loop + 2 settle (2nd throws → stop)
    expect(result.usage.tokens.input).toBe(700);
    expect(result.usage.costReported).toBeCloseTo(0.0031, 10);
  }, 20000);
});

describe('B3: a terminal progress write carries the settled usage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckHealth.mockResolvedValue(true);
    mockCreateSession.mockResolvedValue('ses_b3');
    mockSendPromptAsync.mockResolvedValue(undefined);
    mockGetSessionStatus.mockResolvedValue({ type: 'busy' });
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('{}');
    mockStartServer.mockResolvedValue({
      client: {}, server: { url: 'http://127.0.0.1:4440', close: jest.fn() },
    });
  });

  test("the LAST progress.json write is stage 'complete' and holds real usage", async () => {
    mockGetMessages
      .mockResolvedValueOnce([foldedMessage({ completed: false })])
      .mockResolvedValue([foldedMessage({
        tokens: { input: 21456, output: 1893, reasoning: 0, cache: { read: 3, write: 1 } },
        cost: 0.00759441096, completed: true,
      })]);

    await run();

    const writes = progressWrites();
    const last = writes[writes.length - 1];
    expect(last.stage).toBe('complete');
    expect(last.usage).toBeDefined();
    expect(last.usage.tokens.input).toBe(21456);
    expect(last.usage.tokens.output).toBe(1893);
    expect(last.usage.tokens.cacheRead).toBe(3);
    expect(last.usage.costReported).toBeCloseTo(0.00759441096, 10);
    // The pre-fix symptom: every leg's final progress record was stage
    // 'receiving' with an all-zero usage snapshot.
    expect(writes.filter((w) => w.stage === 'receiving').length).toBeGreaterThan(0);
  }, 20000);

  test('the terminal write still lands when the leg errored with no output', async () => {
    mockGetMessages.mockResolvedValue([{
      info: { role: 'assistant', id: 'm1', time: { completed: Date.now() },
        error: { name: 'ProviderError', data: { message: 'nope' } } },
      parts: [],
    }]);

    const result = await run();

    expect(result.completed).toBe(false);
    const writes = progressWrites();
    expect(writes[writes.length - 1].stage).toBe('complete');
    expect(writes[writes.length - 1].usage).toBeDefined();
  }, 20000);
});

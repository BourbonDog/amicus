'use strict';

/**
 * Guards the real src/headless.js:474 wiring (Task 8, BINDING DECISION 1).
 *
 * The other progress-usage tests exercise writeProgress/readProgress in
 * isolation and would still pass even if the headless poll loop never wired
 * usage through at all, or read the wrong Map. This file drives the ACTUAL
 * runHeadless poll loop end-to-end (mocked SDK client, mocked fs) and proves:
 *
 *   1. The 'receiving' progress flush carries `usage` summed from
 *      `mirror.usageByMsg` (the PERSISTENT accumulated Map on the
 *      long-lived mirror state), not `mr.usageByMsg` (the per-poll delta
 *      returned by mirrorMessages(), which has no such property).
 *   2. That usage reflects the CURRENT Map contents on each flush (not a
 *      stale/frozen snapshot from the first poll).
 *
 * If the injection regresses to `mr.usageByMsg`, `sumPerMessageUsage`
 * throws (`Cannot read properties of undefined (reading 'values')`) inside
 * the `mr.progressUpdates.forEach` callback. That throw is swallowed by the
 * poll loop's own try/catch (src/headless.js ~590), so it does NOT fail the
 * run outright — but it DOES prevent that poll's progress.json write from
 * ever happening, which this test catches by asserting on the recorded
 * 'receiving' writes directly. If the injection is simply dropped (reverting
 * to the pre-Task-8 `writeProgress(sessionDir, p.stage, p.extra)`), writes
 * still happen but carry no `usage` key — caught by the `usage` presence
 * assertions below.
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

const NONCE = 'wiringnonce123456';
const NONCED_MARKER = buildFoldMarker(NONCE);

describe('progress.json usage: headless poll-loop wiring (Task 8)', () => {
  const testModel = 'openrouter/google/gemini-2.5-flash';

  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckHealth.mockResolvedValue(true);
    mockCreateSession.mockResolvedValue('session-123');
    mockSendPromptAsync.mockResolvedValue(undefined);
    mockGetSessionStatus.mockResolvedValue({ type: 'busy' });
    fs.existsSync.mockReturnValue(true);
    mockStartServer.mockResolvedValue({
      client: { session: { create: jest.fn(), prompt: jest.fn(), messages: jest.fn() }, config: { get: jest.fn() } },
      server: { url: 'http://127.0.0.1:4440', close: jest.fn() },
    });
  });

  test('injects mirror.usageByMsg (accumulated) into each receiving flush, reflecting the current Map', async () => {
    // Poll 1: first tool call — usageByMsg gets its first snapshot for msg-1.
    mockGetMessages
      .mockResolvedValueOnce([{
        info: { role: 'assistant', id: 'msg-1', time: {}, tokens: { input: 100, output: 20 }, cost: 0.001 },
        parts: [{ id: 'tool-1', type: 'tool_use', name: 'web_search', input: { query: 'test' } }],
      }])
      // Poll 2: second (new) tool call — usageByMsg is overwritten for msg-1 with grown totals.
      .mockResolvedValueOnce([{
        info: { role: 'assistant', id: 'msg-1', time: {}, tokens: { input: 150, output: 40 }, cost: 0.002 },
        parts: [
          { id: 'tool-1', type: 'tool_use', name: 'web_search', input: { query: 'test' } },
          { id: 'tool-2', type: 'tool_use', name: 'Read', input: { path: '/tmp/x' } },
        ],
      }])
      // Poll 3: completion — no NEW receiving-triggering event, just the fold marker.
      .mockResolvedValueOnce([{
        info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() }, tokens: { input: 150, output: 40 }, cost: 0.002 },
        parts: [
          { id: 'tool-1', type: 'tool_use', name: 'web_search', input: { query: 'test' } },
          { id: 'tool-2', type: 'tool_use', name: 'Read', input: { path: '/tmp/x' } },
          { id: 'p1', type: 'text', text: `Done\n${NONCED_MARKER}` },
        ],
      }]);

    const result = await runHeadless(
      testModel, '# system', 'do the task', 'wiring-task-1', '/test/project', 15000,
      undefined, { nonce: NONCE, pollIntervalMs: 5 }
    );

    expect(result.completed).toBe(true);

    const progressWrites = fs.writeFileSync.mock.calls.filter(call =>
      typeof call[0] === 'string' && call[0].includes('progress.json')
    );
    const receivingWrites = progressWrites
      .map(call => JSON.parse(call[1]))
      .filter(data => data.stage === 'receiving');

    // Two NEW tool_use ids (tool-1, tool-2) each fire their own 'receiving'
    // flush — both must have made it to progress.json.
    expect(receivingWrites.length).toBeGreaterThanOrEqual(2);

    const first = receivingWrites[0];
    const second = receivingWrites[1];

    // Every receiving flush must carry usage — a dropped injection (silent
    // usage loss) leaves these undefined.
    expect(first.usage).toBeDefined();
    expect(second.usage).toBeDefined();

    // The FIRST flush (poll 1) sums a Map with only msg-1's poll-1 snapshot.
    expect(first.usage.tokens.input).toBe(100);
    expect(first.usage.tokens.output).toBe(20);
    expect(first.usage.costReported).toBeCloseTo(0.001);

    // The SECOND flush (poll 2) sums the Map AFTER msg-1's entry was
    // overwritten with poll-2's grown totals — proving the injection reads
    // the live mirror.usageByMsg Map on each flush, not a frozen value from
    // the first poll (and not `mr.usageByMsg`, which doesn't exist on the
    // per-poll delta and would have thrown before either write landed).
    expect(second.usage.tokens.input).toBe(150);
    expect(second.usage.tokens.output).toBe(40);
    expect(second.usage.costReported).toBeCloseTo(0.002);
  }, 20000);
});

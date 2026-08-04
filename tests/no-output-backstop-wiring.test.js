'use strict';

/**
 * v4.6.2 PR2 Task 2 — wire the no-output backstop (Task 1's
 * src/utils/no-output-backstop.js state machine) into runHeadless's poll
 * loop, so a leg whose model produces ZERO output/reasoning/tool calls fails
 * fast with a named reason instead of burning the full --timeout.
 *
 * Harness modeled on tests/observe/premature-completion.test.js — the
 * nearest headless polling test that mocks src/opencode-client + fs +
 * logger and drives runHeadless end-to-end (a `grep -rln
 * "_createOpencodeServer" tests/` turns up only tests/server-start-
 * duration-log.test.js, which exercises startServer() directly, not
 * runHeadless — premature-completion.test.js is the real nearest match, and
 * the task brief names it explicitly). Same mock shape, same fs-default
 * reset discipline — no new mocking style invented.
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

jest.mock('../src/opencode-client', () => ({
  createSession: mockCreateSession,
  sendPrompt: mockSendPromptAsync,
  sendPromptAsync: mockSendPromptAsync,
  getMessages: mockGetMessages,
  checkHealth: mockCheckHealth,
  startServer: mockStartServer,
  abortSession: mockAbortSession,
  getSessionStatus: mockGetSessionStatus,
  // v4.4.1 CA-1's child-session walk destructures this at module load — stub
  // so the walk runs (returning "no children") instead of throwing.
  getChildren: mockGetChildren,
}));

const mockLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };
jest.mock('../src/utils/logger', () => ({ logger: mockLogger }));

const { runHeadless } = require('../src/headless');

const MODEL = 'openrouter/qwen/qwen3.7-max';

/** Same suite-level fs-default reset discipline as premature-completion.test.js
 * (X2): jest.clearAllMocks() clears calls but not mockImplementation()s set by
 * an earlier test, so every fs member is restored to its default before each
 * test rather than relying on resetAllMocks() (which would also blow away the
 * opencode-client/logger stubs re-armed below). */
const FS_DEFAULTS = {
  existsSync: () => true,
  readFileSync: () => JSON.stringify({ status: 'running' }),
  writeFileSync: () => {},
  appendFileSync: () => {},
  mkdirSync: () => {},
  unlinkSync: () => {},
  renameSync: () => {},
  rmSync: () => {},
};

beforeEach(() => {
  jest.clearAllMocks();
  for (const [name, impl] of Object.entries(FS_DEFAULTS)) { fs[name].mockImplementation(impl); }
  mockCheckHealth.mockResolvedValue(true);
  mockCreateSession.mockResolvedValue('ses_parent');
  mockSendPromptAsync.mockResolvedValue(undefined);
  mockAbortSession.mockResolvedValue(undefined);
  mockGetChildren.mockResolvedValue([]);
  mockGetSessionStatus.mockResolvedValue({ type: 'busy' });
  mockStartServer.mockResolvedValue({
    client: {}, server: { url: 'http://127.0.0.1:1', close: jest.fn() },
  });
});

// Poll fast (real wall-clock, no fake timers — same style as the rest of the
// headless family) so every test here finishes in well under a second.
const OPTS = {
  pollIntervalMs: 5, stableIdlePolls: 3, stableFinishedPolls: 2,
  toolCallStallMs: 100000, usageSettlePolls: 1, usageSettleIntervalMs: 1,
};

describe('runHeadless no-output backstop wiring', () => {
  test('a session that never produces anything fails at the backstop window, not the timeout', async () => {
    // No output, no reasoning, no tool calls — ever.
    mockGetMessages.mockResolvedValue([]);
    const started = Date.now();

    // overall --timeout is a huge 60s; the backstop (200ms, via the direct
    // options seam) must be what actually ends this leg.
    const result = await runHeadless(MODEL, 'sys', 'user', 'nooutput1', '/proj', 60000, 'build',
      { ...OPTS, noOutputBackstopMs: 200 });

    // Fired at the backstop, nowhere near the 60s --timeout.
    expect(Date.now() - started).toBeLessThan(10000);
    expect(result.completed).toBe(false);
    expect(String(result.error)).toMatch(/^NO_OUTPUT_BACKSTOP:/);
    expect(String(result.error)).toMatch(/no output, reasoning, or tool calls/);
    // The session must have been aborted, mirroring the timeout path (LC-2 style).
    expect(mockAbortSession).toHaveBeenCalledTimes(1);
    expect(mockAbortSession.mock.calls[0][1]).toBe('ses_parent');
  }, 20000);

  test('one reasoning delta disarms it — the leg then runs to the normal timeout path', async () => {
    // A single assistant message that never finalizes (no info.time.completed),
    // carrying a reasoning part whose text grows ONCE (poll 1: 0 -> 8 chars)
    // then stays flat — exactly one progressed tick, then silence.
    mockGetMessages.mockResolvedValue([{
      info: { role: 'assistant', id: 'm1', time: { created: 1 } },
      parts: [{ id: 'r1', type: 'reasoning', text: 'thinking' }],
    }]);

    const result = await runHeadless(MODEL, 'sys', 'user', 'onedelta1', '/proj', 1500, 'build',
      { ...OPTS, noOutputBackstopMs: 200 });

    expect(String(result.error || '')).not.toMatch(/NO_OUTPUT_BACKSTOP/);
    // It reached the ordinary timeout machinery instead of the backstop.
    expect(result.timedOut).toBe(true);
    expect(result.completed).toBe(false);
  }, 20000);

  test('AMICUS_NO_OUTPUT_BACKSTOP_MS=0 disables — silent leg runs to the timeout', async () => {
    mockGetMessages.mockResolvedValue([]);

    // Routed through the env-resolution seam (options._env), not the direct
    // option, so this exercises resolveNoOutputBackstopMs's explicit-0 path too.
    const result = await runHeadless(MODEL, 'sys', 'user', 'disabled1', '/proj', 300, 'build',
      { ...OPTS, _env: { AMICUS_NO_OUTPUT_BACKSTOP_MS: '0' } });

    expect(String(result.error || '')).not.toMatch(/NO_OUTPUT_BACKSTOP/);
    expect(result.timedOut).toBe(true);
    expect(result.completed).toBe(false);
  }, 20000);
});

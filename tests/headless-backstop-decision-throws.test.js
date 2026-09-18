'use strict';

/**
 * Council #269 round 1 (A1 + B1 + C2, three seats): a throw inside the poll loop's
 * backstop DECISION block used to be swallowed by the poll body's `catch (pollError)`
 * and retried on every poll until the leg `--timeout` — the leg then died a generic
 * `timeout` with the `NO_OUTPUT_BACKSTOP:` diagnosis (the prefix models-probe.js
 * classifies on) lost. No known caller throws today: `sessionStatusSafe` cannot,
 * `decideBackstopExtension` is pure and `isoOrNumber` guards its one Date call. This
 * file pins the STRUCTURAL guarantee instead — the decision block owns its own
 * `catch`, and that catch KILLS.
 *
 * A separate file from tests/no-output-backstop-wiring.test.js because it needs a
 * `jest.mock` of src/utils/no-output-backstop, which that suite must not have.
 * Scaffolding (fs/opencode-client/logger mocks, FS_DEFAULTS, OPTS) is copied from it.
 *
 * MEASURED RED (2026-09-18, before the inner try/catch landed): the leg did NOT die —
 * the injected throw was retried every 5 ms poll and the test HUNG to its own Jest
 * timeout (20 000 ms) on a 60 s leg cap, exactly A1's claim.
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
  getChildren: mockGetChildren,
}));

const mockLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };
jest.mock('../src/utils/logger', () => ({ logger: mockLogger }));

// The injection. Everything else in the module stays REAL — `isBackstopRecord` in
// particular, because the record the catch builds has to pass the same gate every
// other record passes on its way onto the leg document.
jest.mock('../src/utils/no-output-backstop', () => {
  const real = jest.requireActual('../src/utils/no-output-backstop');
  return { ...real, decideBackstopExtension: () => { throw new Error('injected decision failure'); } };
});

const { runHeadless } = require('../src/headless');

const MODEL = 'openrouter/qwen/qwen3.7-max';

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

const OPTS = {
  pollIntervalMs: 5, stableIdlePolls: 3, stableFinishedPolls: 2,
  toolCallStallMs: 100000, usageSettlePolls: 1, usageSettleIntervalMs: 1,
};

describe('#269 r1 (A1/B1/C2): a throw in the backstop decision block KILLS, it is never retried', () => {
  test('the leg dies at its own window under its own name, with the failure in the session clause', async () => {
    mockGetMessages.mockResolvedValue([]);
    const started = Date.now();
    const result = await runHeadless(MODEL, 'sys', 'user', 'decidethrow1', '/proj', 60000, 'build',
      { ...OPTS, noOutputBackstopMs: 1000 });
    const elapsed = Date.now() - started;

    // The whole point: the window, not the 60 s leg cap.
    expect(elapsed).toBeLessThan(1900);
    expect(result.completed).toBe(false);
    expect(result.timedOut).toBeFalsy();
    // The NAMED diagnosis survives — this prefix is what src/sidecar/models-probe.js
    // classifies a SILENT alias on, and what a generic `timeout` would have destroyed.
    expect(String(result.error)).toMatch(/^NO_OUTPUT_BACKSTOP: no output, reasoning, or tool calls in 1s/);
    // The failure names ITSELF, in amicus's own probe-outcome arm — never as an engine status.
    expect(String(result.error)).toMatch(/\(session: unknown — probe failed: backstop decision failed: injected decision failure\)$/);
    // No fourth clause: the decision never produced a record, so there is nothing to report.
    expect(String(result.error)).not.toMatch(/extended/);
    expect(result.backstop).toEqual({ windowMs: 1000, firedAtMs: expect.any(Number), status: 'unknown', extended: false });
    // The post-loop backstop block still aborts the session exactly once, as on every kill.
    expect(mockAbortSession).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).toHaveBeenCalledWith(
      'No-output backstop decision threw; killing the leg under its own name',
      expect.objectContaining({ error: 'injected decision failure' }));
  }, 20000);
});

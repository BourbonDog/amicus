'use strict';

/**
 * Council #269 round 1 (C1 + D1): a REFUSED `extend()` must not publish `extended: true`.
 *
 * `createNoOutputBackstop().extend(deadlineMs, nowMs)` refuses a deadline that has already
 * elapsed (C1: a stalled poll — a long `getMessages` — can put `Date.now()` past
 * `clockStartedAt + extendedMs` before the tick that fires). D1 is what happens next: the
 * decision's record still said `extended: true, extendedToMs: …`, so the leg document and
 * the death report both claimed a window the leg never got. The poll loop now REWRITES the
 * record to `why: 'elapsed'` before killing.
 *
 * The elapsed case is not reachable through runHeadless's public options without stalling
 * the loop, so this file injects the refusal at the seam it belongs to: the real decision
 * runs, and the backstop instance's `extend()` always answers `false`. A separate file from
 * tests/headless-backstop-decision-throws.test.js because the two need different mock
 * shapes of the same module (two files rather than jest.doMock gymnastics — the brief's
 * ruling), and separate from tests/no-output-backstop-wiring.test.js, which must not mock
 * src/utils/no-output-backstop at all.
 *
 * MEASURED RED (2026-09-18, before the record rewrite landed): the leg died at the right
 * INSTANT but lied about it — `error` read "… in 2s — … (session: busy) — window extended
 * once from 1s to 2s at 1s on session busy" and `backstop` was
 * `{ …, extended: true, extendedToMs: 2000 }` for a leg that got no extension at all.
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

// The injection: a REAL backstop whose extend() always refuses — the shape a stalled
// poll produces. `decideBackstopExtension`, `isBackstopRecord` and
// `formatBackstopExtensionClause` all stay real, so the record and the clause under test
// are the ones production builds.
jest.mock('../src/utils/no-output-backstop', () => {
  const real = jest.requireActual('../src/utils/no-output-backstop');
  return {
    ...real,
    createNoOutputBackstop: (opts) => ({ ...real.createNoOutputBackstop(opts), extend: () => false }),
  };
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

describe('#269 r1 (C1/D1): a refused extend() is recorded as a refusal, never as an extension', () => {
  test('busy at the deadline but the extension is refused: the leg dies at the ORIGINAL window, record why elapsed', async () => {
    mockGetMessages.mockResolvedValue([]);
    const started = Date.now();
    const result = await runHeadless(MODEL, 'sys', 'user', 'elapsed1', '/proj', 60000, 'build',
      { ...OPTS, noOutputBackstopMs: 1000 });
    const elapsed = Date.now() - started;

    // No second window was ever granted, so the leg dies at the first firing.
    expect(elapsed).toBeLessThan(1900);
    expect(result.timedOut).toBeFalsy();
    // The head reports the ORIGINAL window (1 s) — the extended number would be a lie.
    expect(String(result.error)).toMatch(/^NO_OUTPUT_BACKSTOP: no output, reasoning, or tool calls in 1s/);
    expect(String(result.error)).toMatch(/ \(session: busy\) — not extended: the extended window had already passed when the decision ran$/);
    expect(result.backstop).toEqual({
      windowMs: 1000, firedAtMs: expect.any(Number), status: 'busy', extended: false, why: 'elapsed',
    });
    expect(mockAbortSession).toHaveBeenCalledTimes(1);
    // A refusal is not an extension: the "extended once" log line must never have fired.
    expect(mockLogger.warn).not.toHaveBeenCalledWith(
      'No-output backstop extended once on session status', expect.anything());
  }, 20000);
});

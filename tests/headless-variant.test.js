// tests/headless-variant.test.js
'use strict';

/**
 * #218 PR 4: the effort lever through runHeadless. `--thinking` used to become a
 * `reasoning` object the engine's prompt endpoint never had a field for (probe
 * F1); it now goes out as the engine's `variant` field (F2), validated in
 * sendPrompt against what the model DECLARES. These tests pin the forwarding,
 * the budget that rides the handle (PR 3), the record of what was sent, and the
 * refusal — a zero-spend named leg death, not a throw.
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

const CACHE = { read: 0, write: 0 };
/** One assistant message finalized by the engine, the way probe rows L1–L4 recorded it. */
const finished = ({ parts = [], tokens = { input: 5, output: 0, reasoning: 32000, cache: CACHE }, finish = 'length', error } = {}) => [{
  info: { role: 'assistant', id: 'm1', time: { created: 1, completed: 2 }, finish, tokens, cost: 0.63, ...(error ? { error } : {}) },
  parts,
}];
const OPTS = { nonce: 'testnonce1234567', pollIntervalMs: 5, stableFinishedPolls: 1, stableIdlePolls: 2, usageSettlePolls: 0, noOutputBackstopMs: 1500 };
const run = (opts = {}) => runHeadless('openrouter/moonshotai/kimi-k3', 'sys', 'user', 'task1234', '/proj', 60000, 'build', { ...OPTS, ...opts });

describe('#218 PR 4 — the effort lever through runHeadless', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckHealth.mockResolvedValue(true);
    mockCreateSession.mockResolvedValue('session-1');
    mockGetSessionStatus.mockResolvedValue({ type: 'busy' });
    mockStartServer.mockResolvedValue({ client: {}, server: { url: 'http://127.0.0.1:1', close: mockServerClose, outputBudget: 24000, ambientOutputTokenFlag: null } });
    mockGetMessages.mockResolvedValue(finished({ parts: [{ type: 'text', text: 'ok' }], tokens: { input: 5, output: 1, reasoning: 0, cache: CACHE }, finish: 'stop' }));
  });

  it('forwards `variant` and the handle\'s budget to sendPromptAsync, never `reasoning`', async () => {
    // Named mutant "VARIANTNOTSENT": drop the `promptOptions.variant` line.
    mockSendPromptAsync.mockResolvedValue({ data: {}, sentVariant: { variant: 'low', verified: true, waitedMs: 0 } });
    await run({ variant: 'low' });
    const opts = mockSendPromptAsync.mock.calls[0][2];
    expect(opts.variant).toBe('low');
    expect(opts.outputBudget).toBe(24000); // the spawn-time value on the handle (PR 3), not config.json
    expect(opts).not.toHaveProperty('reasoning');
  });

  it('sends nothing extra when no variant was requested', async () => {
    mockSendPromptAsync.mockResolvedValue({ data: {} });
    await run({});
    const opts = mockSendPromptAsync.mock.calls[0][2];
    expect(opts).not.toHaveProperty('variant');
    expect(opts).not.toHaveProperty('outputBudget');
  });

  it('records the variant SENT on the result, emit-when-sent (the leg record\'s source)', async () => {
    // Named mutant "VARIANTDROPPED": drop the `...sentVariantFields` spread from the completed return.
    mockSendPromptAsync.mockResolvedValue({ data: {}, sentVariant: { variant: 'low', verified: true, waitedMs: 0 } });
    const r = await run({ variant: 'low' });
    expect(r.completed).toBe(true);
    expect(r.variant).toBe('low');
    expect('variantUnverified' in r).toBe(false);
  });

  it('marks an unverified send on the result and warns with the wait (M0 cold read)', async () => {
    // Named mutant "UNVERIFIEDHIDDEN": drop the variantUnverified field.
    const { logger } = require('../src/utils/logger');
    mockSendPromptAsync.mockResolvedValue({ data: {}, sentVariant: { variant: 'medium', verified: false, waitedMs: 5003 } });
    const r = await run({ variant: 'medium' });
    expect(r.variant).toBe('medium');
    expect(r.variantUnverified).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith('Variant sent unverified', expect.objectContaining({
      note: expect.stringContaining('did not know openrouter/moonshotai/kimi-k3 within 5003 ms'),
    }));
  });

  it('an UNREADABLE /config/providers reaches the same warn with the reason it observed (EP-3)', async () => {
    // Named mutant "UNREADABLEDROPPED": drop `unreadable` from headless.js's note call.
    const { logger } = require('../src/utils/logger');
    mockSendPromptAsync.mockResolvedValue({ data: {}, sentVariant: { variant: 'medium', verified: false, waitedMs: 0, unreadable: 'HTTP 500' } });
    const r = await run({ variant: 'medium' });
    expect(r.variantUnverified).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith('Variant sent unverified', expect.objectContaining({
      note: expect.stringContaining('/config/providers could not be read (HTTP 500; one read, no wait)'),
    }));
  });

  it('records the variant on a failed-with-no-usable-output return too (the OUTPUT_LENGTH death)', async () => {
    // Named mutant "ERRORVARIANTDROPPED": drop the `...sentVariantFields` spread from that return.
    mockSendPromptAsync.mockResolvedValue({ data: {}, sentVariant: { variant: 'high', verified: true, waitedMs: 0 } });
    mockGetMessages.mockResolvedValue(finished({ parts: [], finish: 'length' }));
    const r = await run({ variant: 'high' });
    expect(r.completed).toBe(false);
    expect(r.error.startsWith('OUTPUT_LENGTH:')).toBe(true);
    expect(r.finish).toBe('length');
    expect(r.variant).toBe('high');
  });

  it('aborts the send when the no-output backstop wins the race against the declaration wait (EP-2)', async () => {
    // Named mutant "ORPHANSENDS": drop `sendAbort.abort()` in the backstop catch — the signal is never aborted.
    let seenSignal = null;
    mockSendPromptAsync.mockImplementation((_c, _s, opts) => new Promise((resolve) => {
      seenSignal = opts.signal;
      setTimeout(() => resolve({ data: {}, sentVariant: { variant: 'low', verified: true, waitedMs: 400 } }), 400);
    }));
    const r = await run({ variant: 'low', noOutputBackstopMs: 100 });
    expect(r.completed).toBe(false);
    expect(r.error).toMatch(/^NO_OUTPUT_BACKSTOP:/);
    expect(seenSignal).toBeDefined();
    expect(seenSignal.aborted).toBe(true);
    expect('variant' in r).toBe(false);
    expect(mockAbortSession).toHaveBeenCalledTimes(1);
  });

  it('passes no signal when no variant was requested (the no-variant path is byte-identical)', async () => {
    mockSendPromptAsync.mockResolvedValue({ data: {} });
    await run({});
    expect(mockSendPromptAsync.mock.calls[0][2]).not.toHaveProperty('signal');
  });

  it("a refused variant is the leg's named death through runHeadless's outer handler: no poll, no spend, the reason on `error`, no finish", async () => {
    // Preservation pin (green at HEAD by construction): runHeadless's outer `catch (error)`
    // already turns any pre-loop throw into the standard error result — it aborts the
    // never-prompted session, cancels the watchdog, closes an owned server, writes the
    // terminal progress record and returns emptyUsageTotals(). The guard this rests on is
    // sendPrompt's throw-before-send: named mutant "SENTANYWAY" in tests/opencode-client.test.js.
    const err = new Error("VARIANT_UNDECLARED: openrouter/moonshotai/kimi-k3 does not declare a 'medium' variant — the engine's catalogue lists low, high, max for it (/config/providers); an undeclared variant is a silent no-op on the wire (probe F3/M7), so nothing was sent. Pick one of the listed levels, or omit --thinking to run at the provider's own default effort");
    err.name = 'VariantRefusedError'; err.code = 'VARIANT_UNDECLARED';
    mockSendPromptAsync.mockRejectedValue(err);
    const t0 = Date.now();
    const r = await run({ variant: 'medium' });
    expect(Date.now() - t0).toBeLessThan(1000); // not the 1500 ms backstop
    expect(r.completed).toBe(false);
    expect(r.error).toBe(err.message);
    expect(mockSendPromptAsync).toHaveBeenCalledTimes(1);
    expect(mockGetMessages).not.toHaveBeenCalled();
    expect(mockAbortSession).toHaveBeenCalledTimes(1); // the outer handler's abort of the idle session — nothing was prompted
    expect('finish' in r).toBe(false);
    expect('variant' in r).toBe(false);
    expect(r.usage.tokens).toEqual({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 });
  });

  it('a genuine send failure is returned as an error result through the same outer handler (unchanged behaviour)', async () => {
    mockSendPromptAsync.mockRejectedValue(new Error('ECONNRESET'));
    const r = await run({ variant: 'low' });
    expect(r.completed).toBe(false);
    expect(r.error).toBe('ECONNRESET');
    expect('variant' in r).toBe(false);
  });
});

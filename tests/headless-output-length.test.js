// tests/headless-output-length.test.js
'use strict';

/**
 * #218 PR 3: a leg whose provider stopped at the max_tokens reservation. The
 * engine stamps `finish: 'length'` on the assistant message at finalization
 * (probe rows L1-L4); with no answer text that is a dead leg, and it used to
 * leave runHeadless as `completed` with an empty summary -- or, with visible
 * reasoning, with its THINKING promoted to the summary. These tests pin the
 * in-loop exit, the OUTPUT_LENGTH naming, and the new `finish` on the result.
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
/**
 * One assistant message in a MULTI-message leg, as a tool loop leaves them:
 * `m1` finalized earlier, `m2` last. Same finalized shape as `finished` above,
 * with the id and the token block per message so the leg's totals are the sum.
 */
const msg = (id, { parts = [], finish = 'stop', tokens = { input: 5, output: 1, reasoning: 0, cache: CACHE }, completed = true } = {}) => ({
  info: { role: 'assistant', id, time: completed ? { created: 1, completed: 2 } : { created: 1 }, finish, tokens, cost: 0.01 },
  parts,
});
const OPTS = { nonce: 'testnonce1234567', pollIntervalMs: 5, stableFinishedPolls: 1, stableIdlePolls: 2, usageSettlePolls: 0, noOutputBackstopMs: 1500 };
const run = (opts = {}) => runHeadless('openrouter/moonshotai/kimi-k3', 'sys', 'user', 'task1234', '/proj', 60000, 'build', { ...OPTS, ...opts });

describe('#218 PR 3 — a leg whose provider stopped for length', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckHealth.mockResolvedValue(true);
    mockCreateSession.mockResolvedValue('session-1');
    mockSendPromptAsync.mockResolvedValue(undefined);
    mockGetSessionStatus.mockResolvedValue({ type: 'busy' });
    mockStartServer.mockResolvedValue({ client: {}, server: { url: 'http://127.0.0.1:1', close: mockServerClose } });
  });

  it('hidden reasoning, no answer text (L1): exits the loop on the finalized message and dies as OUTPUT_LENGTH — not the backstop', async () => {
    mockGetMessages.mockResolvedValue(finished());
    const t0 = Date.now();
    const r = await run();
    // Named mutant "NOEXIT": drop the in-loop `'length'` exit — the leg waits out the 1500 ms
    // backstop and its error starts NO_OUTPUT_BACKSTOP instead.
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r.completed).toBe(false);
    expect(r.finish).toBe('length');
    expect(r.summary).toBe('');
    expect(r.error).toBe("OUTPUT_LENGTH: the provider stopped at the max_tokens reservation (finish 'length') and no answer text arrived — "
      + "32000 reasoning / 0 output tokens; outputBudget is unset — the engine's 32000 default reservation governs — "
      + 'raise outputBudget in config.json (docs/configuration.md, Output budget)');
  });

  it('visible reasoning promoted to output (L2/L4): still the death, and it says only reasoning was streamed', async () => {
    mockGetMessages.mockResolvedValue(finished({ parts: [{ id: 'm1:r', type: 'reasoning', text: 'thinking…' }] }));
    const r = await run();
    // Named mutant "DEATHNOTFORCED": drop `|| outputLengthDeath` from failedWithNoUsableOutput —
    // completed reads true and error is absent because mirror.output is non-empty.
    expect(r.completed).toBe(false);
    expect(r.error).toContain('and only reasoning was streamed, no answer text — 32000 reasoning / 0 output tokens;');
    expect(r.finish).toBe('length');
  });

  it("a cut review WITH answer text (L3): completes, keeps the text, carries finish 'length', no error", async () => {
    mockGetMessages.mockResolvedValue(finished({ parts: [{ id: 'm1:t', type: 'text', text: 'Partial review' }], tokens: { input: 5, output: 8, reasoning: 32, cache: CACHE } }));
    const r = await run();
    expect(r.completed).toBe(true);
    expect(r.error).toBeUndefined();
    expect(r.summary).toBe('Partial review');
    expect(r.finish).toBe('length');
  });

  it("finish 'stop' rides out as finish, and a leg with no finish carries no key", async () => {
    mockGetMessages.mockResolvedValue(finished({ parts: [{ id: 'm1:t', type: 'text', text: 'OK' }], finish: 'stop', tokens: { input: 5, output: 1, reasoning: 0, cache: CACHE } }));
    const r1 = await run();
    expect(r1.completed).toBe(true);
    expect(r1.finish).toBe('stop');
    mockGetMessages.mockResolvedValue([{ info: { role: 'assistant', id: 'm1', time: { completed: 1 } }, parts: [{ id: 'm1:t', type: 'text', text: 'OK' }] }]);
    const r2 = await run();
    expect(r2.completed).toBe(true);
    expect('finish' in r2).toBe(false);
  });

  it("an error the engine put on the message wins over this PR's name", async () => {
    mockGetMessages.mockResolvedValue(finished({ error: { name: 'MessageOutputLengthError', data: {} } }));
    const r = await run();
    // Named mutant "ENGINEERRORLOST": drop the `!sessionError` guard — the error is overwritten.
    expect(r.completed).toBe(false);
    expect(r.error).toBe('MessageOutputLengthError');
    expect(r.finish).toBe('length');
  });

  it('the configured budget is named in the reason (seam: options._readOutputBudget)', async () => {
    mockGetMessages.mockResolvedValue(finished());
    const r = await run({ _readOutputBudget: () => 8000 });
    expect(r.error).toContain('; outputBudget is 8000 — raise');
    const r2 = await run({ _readOutputBudget: () => { throw new Error('config unreadable'); } });
    expect(r2.error).toContain('; outputBudget could not be read — raise');
  });

  it('an earlier reasoning-only message that was promoted does not condemn a later length-stopped message WITH answer text (council #232 r1 B2/D1)', async () => {
    const m1 = msg('m1', { parts: [{ id: 'm1:r', type: 'reasoning', text: 'thinking…' }] });
    const m2 = msg('m2', {
      parts: [{ id: 'm2:t', type: 'text', text: 'Partial review' }],
      finish: 'length', tokens: { input: 5, output: 8, reasoning: 32, cache: CACHE },
    });
    mockGetMessages.mockResolvedValueOnce([m1]).mockResolvedValue([m1, m2]);
    const r = await run();
    // Named mutant "STICKYPROMOTION": decide on the session-wide promotion flag
    // (`hasText: !!mirror.output && !mirror.promotedReasoning`) — m1's reasoning was
    // promoted on the first poll, so the death is named on a message that answered
    // and this reads completed:false.
    expect(r.completed).toBe(true);
    expect(r.error).toBeUndefined();
    expect(r.finish).toBe('length');
    // the promoted thinking is NOT in the review (council #232 r1 breakage; mutant KEEPPROMOTED)
    expect(r.summary).toBe('Partial review');
  });

  it('an earlier message with text does not hide a final length stop with none: the death is named (council #232 r1 B2)', async () => {
    const m1 = msg('m1', { parts: [{ id: 'm1:t', type: 'text', text: 'Let me look at the file.' }] });
    const m2 = msg('m2', { finish: 'length', tokens: { input: 5, output: 0, reasoning: 32000, cache: CACHE } });
    mockGetMessages.mockResolvedValue([m1, m2]);
    const r = await run();
    // Named mutant "SESSIONWIDE": test `!mirror.output` instead of the message flag —
    // m1's text is in `output`, so the leg completes and this reads completed:true.
    expect(r.completed).toBe(false);
    expect(r.error.startsWith('OUTPUT_LENGTH:')).toBe(true);
    // The counts are the leg's totals, summed per message: m1 spent 1 output token
    // on its text, m2 spent 32000 reasoning tokens and produced none.
    expect(r.error).toContain('no answer text arrived — 32000 reasoning / 1 output tokens');
    expect(r.finish).toBe('length');
  });

  it('reasoning on the last message and no text says only reasoning was streamed; text on it never does', async () => {
    mockGetMessages.mockResolvedValue([msg('m1', {
      parts: [{ id: 'm1:r', type: 'reasoning', text: 'thinking…' }],
      finish: 'length', tokens: { input: 5, output: 0, reasoning: 32000, cache: CACHE },
    })]);
    const r1 = await run();
    expect(r1.completed).toBe(false);
    expect(r1.error).toContain('only reasoning was streamed');
    mockGetMessages.mockResolvedValue([msg('m2', {
      parts: [{ id: 'm2:r', type: 'reasoning', text: 'thinking…' }, { id: 'm2:t', type: 'text', text: 'Partial review' }],
      finish: 'length', tokens: { input: 5, output: 8, reasoning: 32, cache: CACHE },
    })]);
    const r2 = await run();
    expect(r2.completed).toBe(true);
    expect(r2.error).toBeUndefined();
  });

  it('the reason names the budget the server was SPAWNED with, not config at death (council #232 r1 B3)', async () => {
    mockGetMessages.mockResolvedValue(finished());
    mockStartServer.mockResolvedValue({ client: {}, server: { url: 'http://127.0.0.1:1', close: mockServerClose, outputBudget: 12000 } });
    // Named mutant "CONFIGATDEATH": drop the handle branch from readOutputBudgetSafe —
    // the seam's 8000 is named instead of the 12000 the engine reserved.
    const r = await run({ _readOutputBudget: () => 8000 });
    expect(r.error).toContain('; outputBudget is 12000 — raise');
    mockStartServer.mockResolvedValue({ client: {}, server: { url: 'http://127.0.0.1:1', close: mockServerClose, outputBudget: null } });
    const r2 = await run({ _readOutputBudget: () => 8000 });
    expect(r2.error).toContain('outputBudget is unset');
  });

  it('finish and tokens that land only on the usage-settle re-poll still name the death', async () => {
    // The loop exits on a finalized message that has not yet been stamped (time.completed set,
    // no finish, no tokens) via the stable-finished heuristic on promoted reasoning; the settle
    // re-poll then sees the stamped message. Both passes must record finish (mirror test NOFINISH).
    const unstamped = [{ info: { role: 'assistant', id: 'm1', time: { completed: 1 } }, parts: [{ id: 'm1:r', type: 'reasoning', text: 'thinking…' }] }];
    const stamped = finished({ parts: [{ id: 'm1:r', type: 'reasoning', text: 'thinking…' }] });
    mockGetMessages.mockResolvedValueOnce(unstamped).mockResolvedValueOnce(unstamped).mockResolvedValue(stamped);
    const r = await run({ usageSettlePolls: 2, usageSettleIntervalMs: 1 });
    expect(r.completed).toBe(false);
    expect(r.error).toMatch(/^OUTPUT_LENGTH: .*only reasoning was streamed.*32000 reasoning \/ 0 output tokens;/);
  });
});

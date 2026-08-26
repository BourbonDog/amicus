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

const { runHeadless, formatNoOutputBackstopReason } = require('../src/headless');
const { statusFromResult } = require('../src/utils/result-schema');

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
    // Task 6 review (Minor 2): prove the caller-set phrasing through the REAL
    // runHeadless wiring, not just the pure helper — this leg's `ms` arrived
    // as the direct `noOutputBackstopMs: 200` option above, so it must never
    // claim to BE the live env window. Would break if the pre-send/per-poll
    // firing sites stopped forwarding `backstopFromEnv` correctly, or if
    // formatNoOutputBackstopReason's caller-set branch regressed to claiming
    // direct governance ("(0 disables)" / "the AMICUS_NO_OUTPUT_BACKSTOP_MS
    // window").
    expect(String(result.error)).toMatch(/a caller-set window overriding the AMICUS_NO_OUTPUT_BACKSTOP_MS default/);
    expect(String(result.error)).not.toMatch(/\(0 disables\)/);
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

/**
 * Fix wave — review finding (Important), CLOSED by the same commit that
 * raised it (46d5251cc). The `--timeout` block and the backstop block WERE
 * independent `if`s, both gated only on `!completed && !aborted`, so with
 * noOutputBackstopMs and timeoutMs configured close together the post-break
 * poll tail could consume the remaining margin and BOTH would fire for one
 * leg: a double abortSession(), and result.timedOut === true riding
 * alongside result.error = 'NO_OUTPUT_BACKSTOP: ...'. That mattered because
 * result-schema.js :: statusFromResult checks `timedOut` BEFORE `error`,
 * so a backstop-killed leg read as an ordinary 'timeout'.
 * NO LONGER REACHABLE: headless.js:993 now also requires `!backstopFired`
 * and headless.js:1011 requires `backstopFired`, so the two guards are
 * mutually exclusive by construction — see headless.js:985-992 for the
 * race they close. The test below pins it: exactly one abort, never both.
 */
describe('fix wave: the backstop and the ordinary --timeout must not both fire for one leg', () => {
  test('thresholds set close together: only the backstop fires, never both', async () => {
    // A single poll-interval sleep (100ms) deterministically overshoots BOTH
    // the 50ms backstop deadline and the 60ms overall timeout deadline in one
    // hop, on the very first iteration — this reproduces the collision
    // regardless of machine speed/jitter, unlike relying on a tight real-time
    // race between two close-together thresholds polled at a fast interval.
    mockGetMessages.mockResolvedValue([]);

    const result = await runHeadless(MODEL, 'sys', 'user', 'collide1', '/proj', 60, 'build',
      { ...OPTS, pollIntervalMs: 100, noOutputBackstopMs: 50 });

    // The backstop must be the ONE terminal-timing signal for this leg — the
    // ordinary --timeout block has to yield once backstopFired is true.
    expect(result.timedOut).toBeFalsy();
    expect(result.error).toMatch(/^NO_OUTPUT_BACKSTOP:/);
    // The downstream truth: statusFromResult must read this as 'error', not
    // 'timeout' — this is the actual consequence the review flagged.
    expect(statusFromResult(result)).toBe('error');
    // Exactly one abort — not one from each independent block.
    expect(mockAbortSession).toHaveBeenCalledTimes(1);
  }, 20000);
});

/**
 * Amendment wave — controller live-smoke finding. Field evidence: with an
 * accepting-but-silent endpoint, the leg hung 6+ minutes at the prompt-send
 * step, 0 messages, backstop never fired. Root cause: `await sendPromptAsync`
 * (before this amendment) was awaited BEFORE the backstop was even created —
 * OpenCode's own prompt handler can block on the upstream provider call
 * before ever returning, so a silently-accepting endpoint hangs THIS await,
 * upstream of every mechanism (including the backstop) that was supposed to
 * catch it. The fix arms the backstop before the send and races the send
 * itself against the same deadline.
 */
describe('amendment: the backstop is armed before the prompt send, not after', () => {
  test('a prompt-send call that never resolves (silent-endpoint shape) fails within the backstop window, not the timeout', async () => {
    // The exact field-observed shape: OpenCode's own prompt-send handler
    // blocks on the upstream provider call before ever returning, so
    // sendPromptAsync itself never resolves OR rejects.
    mockSendPromptAsync.mockImplementation(() => new Promise(() => {}));
    mockGetMessages.mockResolvedValue([]);
    const started = Date.now();

    const result = await runHeadless(MODEL, 'sys', 'user', 'silentsend1', '/proj', 60000, 'build',
      { ...OPTS, noOutputBackstopMs: 200 });

    // Fired at the backstop, nowhere near the 60s --timeout, and fast enough
    // that this is obviously NOT jest's own test-timeout catching a hang.
    expect(Date.now() - started).toBeLessThan(5000);
    expect(result.completed).toBe(false);
    expect(result.timedOut).toBeFalsy();
    expect(result.error).toMatch(/^NO_OUTPUT_BACKSTOP:/);
    expect(statusFromResult(result)).toBe('error');
    expect(mockAbortSession).toHaveBeenCalledTimes(1);
    expect(mockAbortSession.mock.calls[0][1]).toBe('ses_parent');
    // The poll loop must never have run at all — the leg died before it
    // started polling (point 4 of the amendment: "the loop may be skipped").
    expect(mockGetMessages).not.toHaveBeenCalled();
  }, 20000);
});

/**
 * Amendment wave 2 — controller live-smoke finding, root-caused with debug
 * logs (LOG_LEVEL=debug, silent-sink run): pollCount climbed 13->21,
 * messageCount:2, hasAssistantMsg:true, outputLength:0 for 42+ seconds,
 * backstop=10s never fired. OpenCode creates an EMPTY assistant-message
 * placeholder on prompt ACCEPTANCE (see the pre-existing comment a few lines
 * above the `progressed` computation: "the SDK creates an empty
 * assistant-message placeholder on promptAsync that is NOT a finished
 * response"). The original wiring ticked the backstop with `progressed`,
 * which includes messageActivity/newAssistant — both fire once for that
 * placeholder, permanently disarming the backstop on the exact bookkeeping
 * artifact of the accepted-but-not-serving shape it exists to catch. Spec §5
 * says "disarms permanently on first token/reasoning/tool_use" — the plan
 * reused `progressed` wholesale, which is the drift this wave corrects.
 */
describe('amendment 2: the backstop disarms only on SUBSTANTIVE activity, not the empty assistant placeholder', () => {
  test('an empty assistant-message placeholder (message/newAssistant activity, zero output/reasoning/tool parts) does NOT disarm the backstop', async () => {
    // Constant across every poll: OpenCode's placeholder appears once (message
    // count 0->1, assistant id null->'placeholder1' on poll 1) and then NEVER
    // changes again — no text, no reasoning, no tool parts, ever.
    mockGetMessages.mockResolvedValue([{
      info: { role: 'assistant', id: 'placeholder1', time: { created: 1 } },
      parts: [],
    }]);
    const started = Date.now();

    const result = await runHeadless(MODEL, 'sys', 'user', 'placeholder1', '/proj', 60000, 'build',
      { ...OPTS, noOutputBackstopMs: 200 });

    // Fired at the backstop, not the 60s --timeout — proves messageActivity/
    // newAssistant no longer disarm it.
    expect(Date.now() - started).toBeLessThan(10000);
    expect(result.completed).toBe(false);
    expect(result.timedOut).toBeFalsy();
    expect(result.error).toMatch(/^NO_OUTPUT_BACKSTOP:/);
    expect(result.error).toMatch(/no output, reasoning, or tool calls/);
    expect(statusFromResult(result)).toBe('error');
    expect(mockAbortSession).toHaveBeenCalledTimes(1);
  }, 20000);

  test('real reasoning growth on a LATER poll (isolated from the placeholder\'s one-time message/newAssistant blip) still disarms it', async () => {
    // Poll 1: the empty placeholder appears (message/newAssistant activity,
    // no reasoning). Poll 2+: reasoning starts streaming into that SAME
    // message — messageCount and the assistant id are now stable (both
    // false), so ONLY reasoningActivity is true. This isolates
    // substantiveActivity's reasoning branch from messageActivity/
    // newAssistant, proving the fix disarms on the intended signal rather
    // than by accident from the placeholder blip (which the OTHER amendment-2
    // test above proves, on its own, no longer disarms anything).
    let poll = 0;
    mockGetMessages.mockImplementation(() => {
      poll += 1;
      const parts = poll === 1 ? [] : [{ id: 'r1', type: 'reasoning', text: 'thinking' }];
      return Promise.resolve([{
        info: { role: 'assistant', id: 'm1', time: { created: 1 } },
        parts,
      }]);
    });

    const result = await runHeadless(MODEL, 'sys', 'user', 'isolatedreasoning1', '/proj', 1500, 'build',
      { ...OPTS, noOutputBackstopMs: 200 });

    expect(String(result.error || '')).not.toMatch(/NO_OUTPUT_BACKSTOP/);
    // It reached the ordinary timeout machinery — proving the backstop really
    // did disarm (permanently) rather than just not having fired yet.
    expect(result.timedOut).toBe(true);
    expect(result.completed).toBe(false);
    expect(poll).toBeGreaterThan(1); // the isolated poll-2+ reasoning growth actually ran
  }, 20000);
});

/**
 * v4.6.2 PR3 Task 1 — the recorded PR2 carry: `options.noOutputBackstopMs`
 * used a bare `!== undefined` check, which lets a NON-NUMBER value (e.g. a
 * string arriving from a CLI/JSON boundary) through unguarded. Downstream,
 * `createNoOutputBackstop`'s `startedAt + ms` does string CONCATENATION
 * instead of addition when `ms` is a string, producing a deadline so large
 * `nowMs >= deadline` can never go true — the backstop silently never fires.
 * The fix narrows the direct-value branch to `Number.isFinite(...)`, so any
 * non-finite input (string, NaN, null-as-object, etc.) falls through to the
 * existing env-resolution seam instead of reaching the arithmetic unguarded.
 * Finite zero is unaffected: `Number.isFinite(0) === true`, same as the old
 * `0 !== undefined`, so the documented explicit-disable escape hatch survives
 * the narrowing untouched.
 */
describe('v4.6.2 PR3 Task 1: the noOutputBackstopMs coercion guard', () => {
  test('a STRING noOutputBackstopMs (non-finite) falls through to env resolution instead of doing string arithmetic', async () => {
    // No output, no reasoning, no tool calls — ever.
    mockGetMessages.mockResolvedValue([]);
    const started = Date.now();

    // '200' must be REJECTED by the guard (Number.isFinite('200') === false)
    // and fall through to the env seam (50ms) — if the guard instead let the
    // string through raw, `startedAt + '200'` string-concatenates into an
    // unreachable deadline and this leg would run to the full 60s --timeout
    // instead of firing the backstop.
    const result = await runHeadless(MODEL, 'sys', 'user', 'stringcoerce1', '/proj', 60000, 'build',
      { ...OPTS, noOutputBackstopMs: '200', _env: { AMICUS_NO_OUTPUT_BACKSTOP_MS: '50' } });

    // Fired at the env-resolved ~50ms window, nowhere near the 60s --timeout.
    expect(Date.now() - started).toBeLessThan(10000);
    expect(result.completed).toBe(false);
    expect(String(result.error)).toMatch(/^NO_OUTPUT_BACKSTOP:/);
    // Task 6 review (Minor 2): prove the env-resolved phrasing through the
    // REAL runHeadless wiring — this leg's `ms` reached the deadline
    // arithmetic ONLY via the env-resolution fallthrough (the direct '200'
    // was rejected by Number.isFinite), so `backstopFromEnv` must have been
    // true and the message must claim direct governance. Would break if the
    // fallthrough stopped setting `backstopFromEnv`, or if the fromEnv
    // branch's wording regressed (dropped the var name or "(0 disables)").
    expect(String(result.error)).toMatch(/the AMICUS_NO_OUTPUT_BACKSTOP_MS window \(0 disables\)/);
    expect(mockAbortSession).toHaveBeenCalledTimes(1);
  }, 20000);

  test('a direct noOutputBackstopMs: 0 (finite zero, explicit) still disables — silent leg runs to the timeout', async () => {
    mockGetMessages.mockResolvedValue([]);

    // Routed through the DIRECT option seam this time (not options._env) —
    // finite zero must survive the Number.isFinite narrowing exactly like it
    // survived the old `!== undefined` check: it is a legal explicit value,
    // not an absent one.
    const result = await runHeadless(MODEL, 'sys', 'user', 'directzero1', '/proj', 300, 'build',
      { ...OPTS, noOutputBackstopMs: 0 });

    expect(String(result.error || '')).not.toMatch(/NO_OUTPUT_BACKSTOP/);
    expect(result.timedOut).toBe(true);
    expect(result.completed).toBe(false);
  }, 20000);
});

/**
 * Task 6 (#129, #133): the reason string reports only what the deadline
 * mechanism actually observed — a deadline passed with no substantive
 * activity — never a cause. The removed guess ("likely a listed-but-not-
 * serving model or a dead endpoint") sent 30 minutes of #133's debugging at
 * model ids and API keys while the real cause (an opencode engine version
 * skew) sat in the engine's own log the whole time. (v4.9 W10: that log is
 * now read and quoted — see the last describe in this file. The single
 * `opencode/log/opencode.log` path this comment used to name was already
 * stale; src/utils/engine-log.js records the measured scheme.)
 *
 * Task 6 REVIEW (Important finding, superseding this suite's original
 * contract): `fromEnv` answers "did `ms` arrive as a direct numeric option",
 * not "does AMICUS_NO_OUTPUT_BACKSTOP_MS influence this window" — those
 * diverge on a Stage-1 retry (`run-retry.js :: retryStage1Losses`'s `escalatedBackstopMs`
 * doubles the resolved/direct value, and its `common` forwards it as a direct option), so a
 * retry-fired 600s backstop (the 300s default, doubled) is `fromEnv: false` while still genuinely
 * governed by the env var. The original version of these tests asserted the
 * ABSENCE of the variable NAME on the caller-set branch; the real
 * requirement was always the absence of a FALSE CLAIM that the window IS the
 * live env value. The tests below assert that instead: the caller-set branch
 * may (now does) name the var, but must never pair it with "(0 disables)" or
 * say "the AMICUS_NO_OUTPUT_BACKSTOP_MS window" — both of which mean "this
 * value tracks the env var live," true only on the fromEnv branch.
 *
 * These tests exercise `formatNoOutputBackstopReason` directly — a pure,
 * module-scope helper lifted out of the `noOutputBackstopReason` closure so
 * the string can be asserted on without driving the whole runHeadless poll
 * loop. The two firing sites (pre-send and per-poll) both still call the
 * original in-closure wrapper, which just forwards to this helper with the
 * per-run `noOutputBackstopMs`/`backstopFromEnv` values — so proving the
 * helper's output also proves what those sites will emit. (The wiring itself
 * — that a real runHeadless call actually reaches each branch — is proven
 * separately below, by extending two of the existing end-to-end tests.)
 */
describe('formatNoOutputBackstopReason: reports only what the deadline observed, never a cause', () => {
  test('states only what was observed, with no cause claim — proof: fails if the removed guess ("likely"/"dead endpoint"/"not serving"/"accepted") is ever reintroduced, or if the required prefix/phrase is dropped', () => {
    const msg = formatNoOutputBackstopReason({ ms: 120000, fromEnv: true });
    expect(msg.startsWith('NO_OUTPUT_BACKSTOP:')).toBe(true); // models-probe.js:39 anchors on this exact prefix
    expect(msg).toMatch(/no output, reasoning, or tool calls/); // this file's own :115/:265 assert this phrase
    expect(msg).not.toMatch(/likely|dead endpoint|not serving|accepted/i);
  });

  test('fromEnv=true claims direct governance: names the var AND pairs it with "(0 disables)" — proof: fails if the from-env branch stops naming AMICUS_NO_OUTPUT_BACKSTOP_MS or drops the "(0 disables)" qualifier that marks this window as the live env value, breaking the documented remedy in troubleshooting.md', () => {
    const msg = formatNoOutputBackstopReason({ ms: 120000, fromEnv: true });
    expect(msg).toMatch(/AMICUS_NO_OUTPUT_BACKSTOP_MS/);
    expect(msg).toMatch(/\(0 disables\)/);
  });

  // ⚠️ NAME KEPT SHORT ON PURPOSE (PR #191 council A2). The narrative below used to
  // live IN the test name: ~1065 characters of mutant names, red-set counts and
  // review-round citations that ship in the npm tarball and print on every runner
  // line. A test name is user-facing output; this is not. Same rule the v4.8.0
  // changelog cut applied to maintainer prose — applied here to our own test.
  //
  // WHAT THIS ASSERTS: on a CALLER-SET window (`fromEnv: false`) the message still
  // names AMICUS_NO_OUTPUT_BACKSTOP_MS, but never phrases it as though the window
  // tracks the env var live. Driven here on the probe's fixed 30s.
  // WHY IT MATTERS: a Stage-1 retry's window IS derived from the env default
  // (doubled), so a message that stayed silent about the var on a caller-set window
  // would hide the one remedy that applies to a retry. That derivation is asserted
  // in tests/council/run-retry.test.js, NOT here.
  // ALSO GUARDS a regression to the literal "the AMICUS_NO_OUTPUT_BACKSTOP_MS
  // window" phrasing, or a reintroduced "(0 disables)" — either would falsely claim
  // this caller-set window tracks the env var live.
  test('fromEnv=false names the env var without claiming it governs a caller-set window', () => {
    const msg = formatNoOutputBackstopReason({ ms: 30000, fromEnv: false });
    expect(msg).toMatch(/AMICUS_NO_OUTPUT_BACKSTOP_MS/);
    expect(msg).not.toMatch(/\(0 disables\)/);
    expect(msg).not.toMatch(/the AMICUS_NO_OUTPUT_BACKSTOP_MS window/);
    expect(msg).toMatch(/30s/);
  });

  test('the seconds count derives from ms, not a hardcoded 120 — proof: fails if a future edit hardcodes "120s" instead of deriving from the ms argument, which would silently mis-report Task 5\'s doubled retry window (the real one is now 300s -> 600s since #135 C0 raised the default; the 240000 fixture below is illustrative and deliberately NOT the live default, which is what keeps this pin independent of it)', () => {
    const msg = formatNoOutputBackstopReason({ ms: 240000, fromEnv: true });
    expect(msg).toMatch(/240s/);
    expect(msg).not.toMatch(/\b120s\b/);
  });
});

/**
 * v4.9 W10 Task A (#133 piece 2) — the death report now QUOTES the engine.
 *
 * Task 6 stopped the message from guessing a cause. It did not make the
 * message say the true one, which was on disk the whole time: in #133 the
 * engine logged its real failure at the exact timestamp of every dead MCP
 * session, and nothing read it. Reporting silence while the cause sits
 * unread is a correct-but-SILENT degrade — the product principle rates that
 * as bad as a crash. src/utils/engine-log.js reads it; both firing sites
 * append it.
 *
 * TWO INVARIANTS, pinned here as a matched pair:
 *  1. ENRICHED — the excerpt lands AFTER the byte-stable `NO_OUTPUT_BACKSTOP:`
 *     prefix and after the whole of today's sentence, so
 *     src/sidecar/models-probe.js's prefix classification is untouched. These
 *     assert the FULL string equals today's + the suffix, not just a substring.
 *  2. CONTROL — on every miss path the message is BYTE-IDENTICAL to today's.
 *
 * The resolver's own rules (formats, bounds, correlation) are pinned in
 * tests/engine-log.test.js. These drive the REAL resolver through the REAL
 * runHeadless wiring over a synthetic fixture tree — this suite mocks `fs`, so
 * the fixture is built and read with `jest.requireActual('fs')`, injected via
 * the `_engineLog` seam (same shape of test-only option as `_env` above).
 * FIXTURES ARE SYNTHETIC: no line here came from any machine's engine log.
 */
describe('v4.9 W10 Task A: the NO_OUTPUT_BACKSTOP reason carries the engine\'s own error line', () => {
  const realFs = jest.requireActual('fs');
  const os = require('os');
  const path = require('path');
  const MADE = [];

  const ERROR_LINE = 'time=2026-08-25T18:55:32Z level=ERROR service=session '
    + 'session.id=ses_parent error="SQLiteError: no such column: fixture_seq"';
  const EXPECTED_EXCERPT = 'SQLiteError: no such column: fixture_seq';

  /** A synthetic data dir holding `opencode/log/<one file>`. */
  function fixtureDataDir(lines) {
    const dir = realFs.mkdtempSync(path.join(os.tmpdir(), 'amicus-w10-wiring-'));
    MADE.push(dir);
    const logDir = path.join(dir, 'opencode', 'log');
    realFs.mkdirSync(logDir, { recursive: true });
    realFs.writeFileSync(path.join(logDir, '2026-08-25T185532.log'), `${lines.join('\n')}\n`);
    return dir;
  }

  const engineLogOpts = (dataDir) => ({ dataDir, fs: realFs });

  afterAll(() => {
    for (const dir of MADE) {
      try { realFs.rmSync(dir, { recursive: true, force: true }); } catch (_e) { /* best effort */ }
    }
  });

  test('poll-loop firing site: the excerpt is appended after the whole of today\'s message', async () => {
    mockGetMessages.mockResolvedValue([]);
    const dataDir = fixtureDataDir([ERROR_LINE]);

    const result = await runHeadless(MODEL, 'sys', 'user', 'englogpoll1', '/proj', 60000, 'build',
      { ...OPTS, noOutputBackstopMs: 200, _engineLog: engineLogOpts(dataDir) });

    expect(result.error).toBe(
      `${formatNoOutputBackstopReason({ ms: 200, fromEnv: false })} — engine log: ${EXPECTED_EXCERPT}`);
    // The prefix models-probe.js classifies on is still the first bytes.
    expect(result.error).toMatch(/^NO_OUTPUT_BACKSTOP:/);
    expect(statusFromResult(result)).toBe('error');
  }, 20000);

  test('pre-send firing site: a prompt send that never resolves also carries the excerpt', async () => {
    // The #133 shape: the leg dies upstream of the poll loop entirely.
    mockSendPromptAsync.mockImplementation(() => new Promise(() => {}));
    mockGetMessages.mockResolvedValue([]);
    const dataDir = fixtureDataDir([ERROR_LINE]);

    const result = await runHeadless(MODEL, 'sys', 'user', 'englogsend1', '/proj', 60000, 'build',
      { ...OPTS, noOutputBackstopMs: 200, _engineLog: engineLogOpts(dataDir) });

    expect(mockGetMessages).not.toHaveBeenCalled(); // proves it was the pre-send site
    expect(result.error).toBe(
      `${formatNoOutputBackstopReason({ ms: 200, fromEnv: false })} — engine log: ${EXPECTED_EXCERPT}`);
  }, 20000);

  test('control — no engine log dir: the message is byte-identical to today\'s', async () => {
    mockGetMessages.mockResolvedValue([]);
    const absent = path.join(os.tmpdir(), `amicus-w10-absent-${Date.now()}`);

    const result = await runHeadless(MODEL, 'sys', 'user', 'englogmiss1', '/proj', 60000, 'build',
      { ...OPTS, noOutputBackstopMs: 200, _engineLog: engineLogOpts(absent) });

    expect(result.error).toBe(formatNoOutputBackstopReason({ ms: 200, fromEnv: false }));
    expect(result.error).not.toMatch(/engine log/);
  }, 20000);

  test('control — a log with no ERROR line for this session: byte-identical to today\'s', async () => {
    mockGetMessages.mockResolvedValue([]);
    const dataDir = fixtureDataDir([
      'time=2026-08-25T18:55:30Z level=INFO service=session session.id=ses_parent message="created"',
      'time=2026-08-25T18:55:32Z level=ERROR service=session session.id=ses_other error="not ours"',
    ]);

    const result = await runHeadless(MODEL, 'sys', 'user', 'englogmiss2', '/proj', 60000, 'build',
      { ...OPTS, noOutputBackstopMs: 200, _engineLog: engineLogOpts(dataDir) });

    expect(result.error).toBe(formatNoOutputBackstopReason({ ms: 200, fromEnv: false }));
  }, 20000);

  test('a resolver that throws cannot break the death report — the leg still dies with today\'s message', async () => {
    mockGetMessages.mockResolvedValue([]);
    const boom = () => { throw new Error('fixture fs is down'); };

    const result = await runHeadless(MODEL, 'sys', 'user', 'englogboom1', '/proj', 60000, 'build',
      { ...OPTS,
        noOutputBackstopMs: 200,
        _engineLog: { dataDir: '/nope', fs: { existsSync: boom, readdirSync: boom, statSync: boom } } });

    expect(result.error).toBe(formatNoOutputBackstopReason({ ms: 200, fromEnv: false }));
    expect(result.completed).toBe(false);
    expect(mockAbortSession).toHaveBeenCalledTimes(1);
  }, 20000);

  test('formatNoOutputBackstopReason without an excerpt is unchanged; with one, it appends', () => {
    const base = formatNoOutputBackstopReason({ ms: 200, fromEnv: true });
    expect(formatNoOutputBackstopReason({ ms: 200, fromEnv: true, engineLogExcerpt: null })).toBe(base);
    expect(formatNoOutputBackstopReason({ ms: 200, fromEnv: true, engineLogExcerpt: '' })).toBe(base);
    expect(formatNoOutputBackstopReason({ ms: 200, fromEnv: true, engineLogExcerpt: 'boom' }))
      .toBe(`${base} — engine log: boom`);
  });
});

/**
 * v4.9 W10 Task B (#133 piece 3) — the death report also names an ENGINE
 * VERSION SKEW when one was detected at session-create time.
 *
 * This is the #133 outage's literal shape: every MCP leg died behind one engine
 * version serving the server while a different one sat installed. Piece 2 makes
 * the leg quote the engine; piece 3 makes it say WHICH engines, at the failure
 * site, without the user running anything.
 *
 * The skew record is real module state in src/utils/engine-skew.js, driven here
 * through its own public entry point (`noteSessionVersion`) with the
 * installed-version reader and the notice sink injected — so these pins
 * exercise the production path from "the server reported a version" all the way
 * to the rendered leg error, with no seam invented for the test. Reset before
 * AND after every case so no skew leaks into another suite's controls.
 *
 * SHAPES, pinned as a set:
 *  1. skew + excerpt  — the composite #133 message (both clauses, in order).
 *  2. skew, no excerpt — the skew clause is NOT gated on the log read
 *     succeeding (see the deviation note in the test).
 *  3. no skew         — byte-identical to Task A's output, enriched or not.
 *  4. ATTRIBUTION (round-1 review A3+B3) — the clause belongs to THIS leg's own
 *     server, now: another server's skew never rides along, a retracted one
 *     stops appearing, and this leg's own still lands.
 *
 * Named mutants, both measured against this suite:
 *  · SKEWBLIND — `noteSessionVersion`'s mismatch branch returns null. The full
 *    measured red set is recorded in tests/utils/engine-skew.test.js.
 *  · STICKYSKEW — the record degrades to ONE process-wide slot, written once
 *    and never retracted (the pre-review behaviour): reds the two attribution
 *    tests here — "a skew observed on ANOTHER server is not stamped on this
 *    leg" and "a skew RETRACTED by a later matching session is not reported" —
 *    plus 5 in tests/utils/engine-skew.test.js.
 * The two no-skew controls stay GREEN under both by design: that is what makes
 * them controls.
 */
describe('v4.9 W10 Task B: the NO_OUTPUT_BACKSTOP reason names an engine version skew', () => {
  const realFs = jest.requireActual('fs');
  const os = require('os');
  const path = require('path');
  const skewMod = require('../src/utils/engine-skew');
  const MADE = [];

  const ERROR_LINE = 'time=2026-08-25T18:55:32Z level=ERROR service=session '
    + 'session.id=ses_parent error="SQLiteError: no such column: fixture_seq"';
  const EXPECTED_EXCERPT = 'SQLiteError: no such column: fixture_seq';
  const SKEW_SUFFIX = ' (engine skew: server 1.17.3 ≠ installed 1.18.15)';

  /** A synthetic data dir holding `opencode/log/<one file>`. FIXTURE ONLY. */
  function fixtureDataDir(lines) {
    const dir = realFs.mkdtempSync(path.join(os.tmpdir(), 'amicus-w10b-'));
    MADE.push(dir);
    const logDir = path.join(dir, 'opencode', 'log');
    realFs.mkdirSync(logDir, { recursive: true });
    realFs.writeFileSync(path.join(logDir, '2026-08-25T185532.log'), `${lines.join('\n')}\n`);
    return dir;
  }

  const engineLogOpts = (dataDir) => ({ dataDir, fs: realFs });

  /**
   * Put a real skew on the record, exactly as a skewed create would.
   *
   * `client` defaults to undefined — the same identity the leg's own client has
   * here, since `mockStartServer` hands runHeadless a bare `{}` with no SDK
   * transport on it. Pass a client to arm a DIFFERENT server's record.
   */
  function armSkew(client) {
    skewMod.noteSessionVersion('1.17.3', {
      readInstalledVersion: () => '1.18.15',
      client,
      notify: () => {}, // the notice itself is pinned in tests/utils/engine-skew.test.js
    });
  }

  /** A client that names its server, matching the measured SDK shape. */
  const clientAt = (baseUrl) => ({ _client: { getConfig: () => ({ baseUrl }) } });

  beforeEach(() => { skewMod._resetEngineSkew(); });
  afterEach(() => { skewMod._resetEngineSkew(); });

  afterAll(() => {
    for (const dir of MADE) {
      try { realFs.rmSync(dir, { recursive: true, force: true }); } catch (_e) { /* best effort */ }
    }
  });

  test('the #133 composite: the engine\'s line AND the two engine versions, in that order', async () => {
    mockGetMessages.mockResolvedValue([]);
    armSkew();
    const dataDir = fixtureDataDir([ERROR_LINE]);

    const result = await runHeadless(MODEL, 'sys', 'user', 'skewcomp1', '/proj', 60000, 'build',
      { ...OPTS, noOutputBackstopMs: 200, _engineLog: engineLogOpts(dataDir) });

    expect(result.error).toBe(
      `${formatNoOutputBackstopReason({ ms: 200, fromEnv: false })}`
      + ` — engine log: ${EXPECTED_EXCERPT}${SKEW_SUFFIX}`);
    expect(result.error).toMatch(/^NO_OUTPUT_BACKSTOP:/); // models-probe.js's prefix is still first
    expect(statusFromResult(result)).toBe('error');
  }, 20000);

  test('a skew is reported even when the log read finds nothing', async () => {
    // DELIBERATE, and a deviation from the plan bullet's literal "when Piece 2's
    // backstop enrichment fires AND skew was detected": gating the skew clause
    // on a successful log read would make the RELIABLE signal (two version
    // strings both sides already published) depend on the UNRELIABLE one (a log
    // file that may be absent, rotated, or unreadable). In #133 the skew WAS the
    // answer; a user whose log dir is missing would get silence.
    mockGetMessages.mockResolvedValue([]);
    armSkew();
    const absent = path.join(os.tmpdir(), `amicus-w10b-absent-${Date.now()}`);

    const result = await runHeadless(MODEL, 'sys', 'user', 'skewnolog1', '/proj', 60000, 'build',
      { ...OPTS, noOutputBackstopMs: 200, _engineLog: engineLogOpts(absent) });

    expect(result.error).toBe(
      `${formatNoOutputBackstopReason({ ms: 200, fromEnv: false })}${SKEW_SUFFIX}`);
    expect(result.error).not.toMatch(/engine log:/);
  }, 20000);

  test('pre-send firing site: the skew clause reaches the site that dies upstream of the poll loop', async () => {
    mockSendPromptAsync.mockImplementation(() => new Promise(() => {}));
    mockGetMessages.mockResolvedValue([]);
    armSkew();
    const dataDir = fixtureDataDir([ERROR_LINE]);

    const result = await runHeadless(MODEL, 'sys', 'user', 'skewsend1', '/proj', 60000, 'build',
      { ...OPTS, noOutputBackstopMs: 200, _engineLog: engineLogOpts(dataDir) });

    expect(mockGetMessages).not.toHaveBeenCalled(); // proves it was the pre-send site
    expect(result.error).toBe(
      `${formatNoOutputBackstopReason({ ms: 200, fromEnv: false })}`
      + ` — engine log: ${EXPECTED_EXCERPT}${SKEW_SUFFIX}`);
  }, 20000);

  test('control — no skew on the record: the enriched message is byte-identical to Task A\'s', async () => {
    mockGetMessages.mockResolvedValue([]);
    const dataDir = fixtureDataDir([ERROR_LINE]);

    const result = await runHeadless(MODEL, 'sys', 'user', 'skewnone1', '/proj', 60000, 'build',
      { ...OPTS, noOutputBackstopMs: 200, _engineLog: engineLogOpts(dataDir) });

    expect(result.error).toBe(
      `${formatNoOutputBackstopReason({ ms: 200, fromEnv: false })} — engine log: ${EXPECTED_EXCERPT}`);
    expect(result.error).not.toMatch(/engine skew/);
  }, 20000);

  test('control — a session whose server version MATCHES arms nothing', async () => {
    mockGetMessages.mockResolvedValue([]);
    skewMod.noteSessionVersion('1.18.15', {
      readInstalledVersion: () => '1.18.15', notify: () => {},
    });
    const absent = path.join(os.tmpdir(), `amicus-w10b-match-${Date.now()}`);

    const result = await runHeadless(MODEL, 'sys', 'user', 'skewmatch1', '/proj', 60000, 'build',
      { ...OPTS, noOutputBackstopMs: 200, _engineLog: engineLogOpts(absent) });

    expect(result.error).toBe(formatNoOutputBackstopReason({ ms: 200, fromEnv: false }));
  }, 20000);

  /**
   * W10 round-1 review A3+B3 — the clause names THIS leg's server, now.
   *
   * The record used to be one process-wide slot written once, so the first skew
   * anyone observed was stamped on every later death report: another server's
   * legs wore it, and so did legs that died after the skew was fixed. A death
   * report that names the wrong cause is the guess this whole piece replaced.
   */
  test('a skew observed on ANOTHER server is not stamped on this leg', async () => {
    mockGetMessages.mockResolvedValue([]);
    armSkew(clientAt('http://127.0.0.1:9999')); // some other server, in this process
    const absent = path.join(os.tmpdir(), `amicus-w10b-other-${Date.now()}`);

    const result = await runHeadless(MODEL, 'sys', 'user', 'skewother1', '/proj', 60000, 'build',
      { ...OPTS, noOutputBackstopMs: 200, _engineLog: engineLogOpts(absent) });

    expect(result.error).toBe(formatNoOutputBackstopReason({ ms: 200, fromEnv: false }));
    expect(result.error).not.toMatch(/engine skew/);
  }, 20000);

  test('THIS leg\'s own server\'s skew still reaches the report', async () => {
    // The positive twin of the test above: same mechanism, same run shape, only
    // the server identity differs — so the pair pins attribution, not silence.
    mockGetMessages.mockResolvedValue([]);
    const client = clientAt('http://127.0.0.1:9999');
    mockStartServer.mockResolvedValue({
      client, server: { url: 'http://127.0.0.1:9999', close: jest.fn() },
    });
    armSkew(client);
    const absent = path.join(os.tmpdir(), `amicus-w10b-own-${Date.now()}`);

    const result = await runHeadless(MODEL, 'sys', 'user', 'skewown1', '/proj', 60000, 'build',
      { ...OPTS, noOutputBackstopMs: 200, _engineLog: engineLogOpts(absent) });

    expect(result.error).toBe(
      `${formatNoOutputBackstopReason({ ms: 200, fromEnv: false })}${SKEW_SUFFIX}`);
  }, 20000);

  test('a skew RETRACTED by a later matching session is not reported', async () => {
    mockGetMessages.mockResolvedValue([]);
    armSkew();
    skewMod.noteSessionVersion('1.18.15', { // the operator fixed it mid-process
      readInstalledVersion: () => '1.18.15', notify: () => {},
    });
    const absent = path.join(os.tmpdir(), `amicus-w10b-fixed-${Date.now()}`);

    const result = await runHeadless(MODEL, 'sys', 'user', 'skewfixed1', '/proj', 60000, 'build',
      { ...OPTS, noOutputBackstopMs: 200, _engineLog: engineLogOpts(absent) });

    expect(result.error).toBe(formatNoOutputBackstopReason({ ms: 200, fromEnv: false }));
  }, 20000);

  test('formatNoOutputBackstopReason composes the two clauses independently', () => {
    const base = formatNoOutputBackstopReason({ ms: 200, fromEnv: true });
    const skew = { server: '1.17.3', installed: '1.18.15' };
    expect(formatNoOutputBackstopReason({ ms: 200, fromEnv: true, engineSkew: null })).toBe(base);
    expect(formatNoOutputBackstopReason({ ms: 200, fromEnv: true, engineSkew: skew }))
      .toBe(`${base}${SKEW_SUFFIX}`);
    expect(formatNoOutputBackstopReason({
      ms: 200, fromEnv: true, engineLogExcerpt: 'boom', engineSkew: skew,
    })).toBe(`${base} — engine log: boom${SKEW_SUFFIX}`);
  });
});

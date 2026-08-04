# v4.6.2 PR2 — no-output fast-fail backstop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** spec §5 — a headless leg whose model produces zero output, reasoning, and tool calls
fails fast with a named reason (`NO_OUTPUT_BACKSTOP`) instead of polling to the full timeout,
disarming permanently on first activity so slow cold-prefill local models are never affected.

**Architecture:** one new pure state-machine util (`src/utils/no-output-backstop.js` — the
`run-retry.js` extracted-module precedent) + a two-site wiring in `runHeadless`'s poll loop
(arm at loop start, tick beside the existing `progressed` computation, mirror the `timedOut`
post-loop block on fire). No new announcement machinery: the leg death flows into the existing
dead-leg path (fanout error leg doc / council dead-leg → SL-2 retry → degrade sink → exit 2).

**Tech Stack:** Node 18 CommonJS, jest, `envNumber` (`src/utils/env-num.js` — honors explicit
`0`), house patterns (`options._*` test seams, conventional commits).

**Spec:** `docs/superpowers/specs/2026-08-03-v462-field-report-five-design.md` §5, D4.
**Naming correction vs spec:** §5 says "disarms on the first true `anyActivity` tick" — the
real predicate variable is **`progressed`** (`src/headless.js:728-730`, measured 2026-08-04 at
`22828f0`). Same semantics (text/tool/result/message/new-assistant/reasoning/settle growth).

## Global Constraints

- TDD: every behavior lands with its failing test first (spec §9).
- Knob: `AMICUS_NO_OUTPUT_BACKSTOP_MS`, default **120000**; any value **≤ 0 disables** — `0` is
  a documented escape hatch, so `envNumber` is the correct reader (see its "NOT A BLANKET
  REPLACEMENT" docblock: migrate only knobs whose call site understands `0` — this one does).
- Disarm is **permanent** on the first `progressed === true` tick; the backstop can never fire
  after any activity has ever been observed (D4; a 30-90s cold-prefill local model must never
  be hit).
- On fire: the leg fails with reason text
  `NO_OUTPUT_BACKSTOP: model produced no output, reasoning, or tool calls in <N>s — likely a listed-but-not-serving model or a dead endpoint`
  and the session is aborted exactly the way the timeout path does (`src/headless.js:834-847`).
- No new degrade channel (D4): council runs inherit SL-2 retry + sink announcement + exit 2
  through the ordinary dead-leg machinery.
- `headless.js` is on the size-gate grandfathered exclude list — no extraction required there.
  The new util must stay well under 300.
- PR3 will reuse the module with a 30s override — the module takes `ms` as an input; nothing
  inside it reads the env directly except the exported resolver.
- Commits: conventional prefixes; end every commit message with
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `no-output-backstop` util

**Files:**
- Create: `src/utils/no-output-backstop.js`
- Test: `tests/no-output-backstop.test.js`

**Interfaces:**
- Consumes: `envNumber` from `./env-num`.
- Produces (Task 2 imports these exact names):
  `resolveNoOutputBackstopMs(env?) -> number` (env-resolved, default 120000);
  `createNoOutputBackstop({ ms, startedAt }) -> { tick(progressed, nowMs): 'armed'|'disarmed'|'fired', state(): string }`.

- [ ] **Step 1: Write the failing test**

Create `tests/no-output-backstop.test.js`:

```js
'use strict';

const {
  resolveNoOutputBackstopMs, createNoOutputBackstop,
} = require('../src/utils/no-output-backstop');

describe('resolveNoOutputBackstopMs', () => {
  test('default 120000 when unset', () => {
    expect(resolveNoOutputBackstopMs({})).toBe(120000);
  });
  test('explicit value wins', () => {
    expect(resolveNoOutputBackstopMs({ AMICUS_NO_OUTPUT_BACKSTOP_MS: '30000' })).toBe(30000);
  });
  test('explicit 0 is honored (the documented disable)', () => {
    expect(resolveNoOutputBackstopMs({ AMICUS_NO_OUTPUT_BACKSTOP_MS: '0' })).toBe(0);
  });
  test('blank and non-finite fall back to the default', () => {
    expect(resolveNoOutputBackstopMs({ AMICUS_NO_OUTPUT_BACKSTOP_MS: '' })).toBe(120000);
    expect(resolveNoOutputBackstopMs({ AMICUS_NO_OUTPUT_BACKSTOP_MS: 'Infinity' })).toBe(120000);
  });
});

describe('createNoOutputBackstop', () => {
  const T0 = 1_000_000;

  test('fires at the deadline when nothing ever progressed', () => {
    const b = createNoOutputBackstop({ ms: 120000, startedAt: T0 });
    expect(b.tick(false, T0 + 119999)).toBe('armed');
    expect(b.tick(false, T0 + 120000)).toBe('fired');
  });

  test('first progress disarms permanently — later silence never fires', () => {
    const b = createNoOutputBackstop({ ms: 120000, startedAt: T0 });
    expect(b.tick(true, T0 + 5000)).toBe('disarmed');
    expect(b.tick(false, T0 + 500000)).toBe('disarmed');
    expect(b.state()).toBe('disarmed');
  });

  test('fired is terminal — later ticks stay fired and progress cannot resurrect it', () => {
    const b = createNoOutputBackstop({ ms: 1000, startedAt: T0 });
    expect(b.tick(false, T0 + 1000)).toBe('fired');
    expect(b.tick(true, T0 + 2000)).toBe('fired');
  });

  test('ms <= 0 never arms', () => {
    const off = createNoOutputBackstop({ ms: 0, startedAt: T0 });
    expect(off.tick(false, T0 + 10_000_000)).toBe('disarmed');
    const neg = createNoOutputBackstop({ ms: -5, startedAt: T0 });
    expect(neg.tick(false, T0 + 10_000_000)).toBe('disarmed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/no-output-backstop.test.js`
Expected: FAIL — `Cannot find module '../src/utils/no-output-backstop'`

- [ ] **Step 3: Write the implementation**

Create `src/utils/no-output-backstop.js`:

```js
/**
 * @module utils/no-output-backstop
 * v4.6.2 PR2 (spec §5, D4): fail a headless leg fast when the model produces
 * ZERO output, reasoning, and tool calls — the "accepted but not serving"
 * class (the v4.6.1 gemini release-gate incident: requests accepted, zero
 * tokens, three suites burned 130s timeouts each to learn nothing).
 *
 * Pure state machine, loop-driven (no timers of its own — the poll loop
 * ticks it): armed at leg start, DISARMED PERMANENTLY by the first
 * `progressed` tick (a 30-90s cold-prefill local model is never affected),
 * fired when the deadline passes with nothing ever observed. `fired` is
 * terminal. `ms <= 0` never arms — 0 is the documented escape hatch, which
 * is why the env resolver uses envNumber (explicit 0 honored) rather than
 * the `Number(env) || default` idiom.
 *
 * PR3's live probe reuses this with a 30s override — ms is an input; only
 * the exported resolver reads the environment.
 */
'use strict';

const { envNumber } = require('./env-num');

const DEFAULT_NO_OUTPUT_BACKSTOP_MS = 120000;

/** @param {object} [env] test seam; defaults to process.env */
function resolveNoOutputBackstopMs(env) {
  return envNumber('AMICUS_NO_OUTPUT_BACKSTOP_MS', DEFAULT_NO_OUTPUT_BACKSTOP_MS, env);
}

/**
 * @param {{ms:number, startedAt:number}} opts
 * @returns {{tick:(progressed:boolean, nowMs:number)=>string, state:()=>string}}
 */
function createNoOutputBackstop({ ms, startedAt }) {
  let state = ms > 0 ? 'armed' : 'disarmed';
  const deadline = startedAt + ms;
  return {
    tick(progressed, nowMs) {
      if (state !== 'armed') { return state; }
      if (progressed) { state = 'disarmed'; return state; }
      if (nowMs >= deadline) { state = 'fired'; }
      return state;
    },
    state() { return state; },
  };
}

module.exports = { resolveNoOutputBackstopMs, createNoOutputBackstop, DEFAULT_NO_OUTPUT_BACKSTOP_MS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/no-output-backstop.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/utils/no-output-backstop.js tests/no-output-backstop.test.js
git commit -m "feat(backstop): no-output backstop state machine + env resolver

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: wire the backstop into `runHeadless`

**Files:**
- Modify: `src/headless.js` (three insertions: resolve+create near the poll-config block
  ~`:494-520`; tick+break beside the `progressed` computation `:728-730`; a fired-handling
  block mirroring the timeout block `:834-847`)
- Test: `tests/no-output-backstop-wiring.test.js`

**Interfaces:**
- Consumes: `resolveNoOutputBackstopMs`, `createNoOutputBackstop` from Task 1.
- Produces: a fired backstop ends the loop with `backstopFired = true`; the leg's
  `sessionError` becomes the exact reason string from Global Constraints (with `<N>` =
  `Math.round(ms/1000)`); the session is aborted; the leg resolves through the SAME terminal
  path an errored leg already uses (`resolveTerminalState({ error })` — Task 3 pins the
  council-side consequence).

- [ ] **Step 1: Read the harness pattern, then write the failing test**

Read how `tests/observe/premature-completion.test.js` (or the nearest headless polling test —
find with `grep -rln "_createOpencodeServer" tests/ | head`) drives `runHeadless` with a mocked
server/client: the mock returns a session whose `getMessages` yields nothing. Model the new
test on that harness — do NOT invent a new mocking style. The test:

```js
// tests/no-output-backstop-wiring.test.js — shape contract (adapt the harness
// imports/mocks to the file you modeled on; the assertions below are the contract):
'use strict';

describe('runHeadless no-output backstop wiring', () => {
  test('a session that never produces anything fails at the backstop window, not the timeout', async () => {
    // harness: mocked server+client, getMessages always returns [] (no output,
    // no reasoning, no tool calls), AMICUS_NO_OUTPUT_BACKSTOP_MS=200 via env
    // seam or direct option, overall timeoutMs deliberately huge (60_000).
    // poll interval floored small via AMICUS_POLL_INTERVAL_MS if the harness
    // supports it, so the test runs in <2s real time.
    const result = await runHeadlessUnderMock(/* per harness */);
    expect(result.completed).toBe(false);
    expect(String(result.error || result.sessionError)).toMatch(/^NO_OUTPUT_BACKSTOP:/);
    expect(String(result.error || result.sessionError)).toMatch(/no output, reasoning, or tool calls/);
    // proves it fired at the backstop, not the 60s timeout:
    expect(elapsedMsOfTheRun).toBeLessThan(10_000);
    // the session must have been aborted, mirroring the timeout path:
    expect(mockAbortSessionCalls).toHaveLength(1);
  });

  test('one reasoning delta disarms it — the leg then runs to the normal timeout path', async () => {
    // same harness, but the mock emits a single reasoning-growth tick early,
    // then silence; backstop 200ms, timeout 1500ms.
    const result = await runHeadlessUnderMock(/* per harness */);
    expect(String(result.error || result.sessionError || '')).not.toMatch(/NO_OUTPUT_BACKSTOP/);
    // it reached the ordinary timeout machinery instead:
    expect(result.timedOut).toBe(true);
  });

  test('AMICUS_NO_OUTPUT_BACKSTOP_MS=0 disables — silent leg runs to the timeout', async () => {
    const result = await runHeadlessUnderMock(/* env AMICUS_NO_OUTPUT_BACKSTOP_MS=0 */);
    expect(String(result.error || result.sessionError || '')).not.toMatch(/NO_OUTPUT_BACKSTOP/);
    expect(result.timedOut).toBe(true);
  });
});
```

⚠️ The exact result-field names (`error` vs `sessionError` vs the result doc's shape) must be
taken from the harness you modeled on — assert on the REAL fields, and if `timedOut` is not
directly exposed, assert its observable consequence the way the existing timeout tests do.

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/no-output-backstop-wiring.test.js`
Expected: FAIL — the silent-session case runs to the (huge) timeout or the assertions on
`NO_OUTPUT_BACKSTOP` find nothing.

- [ ] **Step 3: Implement the wiring**

Three insertions in `src/headless.js` (anchors measured at `22828f0`; re-locate by content,
not line number):

(a) Near the poll-config block (where `pollCallTimeoutMs` resolves, ~`:494`):

```js
    // v4.6.2 PR2 (spec §5, D4): fail fast when the model never produces
    // ANYTHING — the "accepted but not serving" class. Disarmed permanently
    // by the first progressed tick below; 0 (or negative) disables.
    const { resolveNoOutputBackstopMs, createNoOutputBackstop } = require('./utils/no-output-backstop');
    const noOutputBackstopMs = options.noOutputBackstopMs !== undefined
      ? options.noOutputBackstopMs : resolveNoOutputBackstopMs(options._env);
    const noOutputBackstop = createNoOutputBackstop({ ms: noOutputBackstopMs, startedAt: Date.now() });
    let backstopFired = false;
```

(`options.noOutputBackstopMs` is the PR3 reuse seam + the test seam; `options._env` matches
the PR1 house pattern.)

(b) Immediately after `if (progressed) { lastProgressAt = Date.now(); }` (`:730`):

```js
        // No-output backstop: one tick per poll. Fired is terminal — break the
        // loop; the post-loop block below mirrors the timeout path.
        if (noOutputBackstop.tick(progressed, Date.now()) === 'fired') {
          backstopFired = true;
          sessionError = `NO_OUTPUT_BACKSTOP: model produced no output, reasoning, or tool calls in ${Math.round(noOutputBackstopMs / 1000)}s — likely a listed-but-not-serving model or a dead endpoint`;
          logger.warn('No-output backstop fired', { taskId, backstopMs: noOutputBackstopMs });
          break;
        }
```

⚠️ Verify at implementation time how `sessionError` is declared and consumed in this scope
(the poll loop already sets it on other failure paths — `grep -n "sessionError" src/headless.js`)
and conform: if the loop's other failure paths use a different variable or a `throw`, mirror
THAT mechanism instead, keeping the exact reason string. The contract is the reason string +
loop exit + session abort, not the variable name.

(c) After the existing timeout block (`:834-847`), a sibling block:

```js
    // Backstop fired: abort the OpenCode session exactly like the timeout path
    // (the agent keeps running otherwise). The leg's error already carries the
    // NO_OUTPUT_BACKSTOP reason; no separate degrade machinery — the ordinary
    // dead-leg path (SL-2 retry, sink announcement, exit codes) inherits it.
    if (backstopFired && !completed && !aborted) {
      try {
        const { abortSession } = require('./opencode-client');
        await abortSession(client, sessionId, ...dirArgs);
        logger.info('Session aborted after no-output backstop', { taskId, sessionId });
      } catch (abortErr) {
        logger.warn('Failed to abort session after backstop', { error: abortErr.message });
      }
    }
```

- [ ] **Step 4: Run the new test + the headless family**

Run: `npx jest tests/no-output-backstop-wiring.test.js` then every suite matching
`grep -rln "runHeadless\|headless" tests/ | head -20` that exercises the poll loop (at minimum:
the file you modeled the harness on, `tests/observe/premature-completion.test.js`, any
timeout/stall suites). Expected: all PASS — the backstop must not disturb any existing
timeout/stall/settle behavior (every existing test's mock produces SOME activity or runs with
default 120s backstop far beyond test timeouts; if one fails, understand WHY before touching
it — an existing mock that is genuinely silent for >120s virtual time is a real interaction
to resolve, not to suppress).

- [ ] **Step 5: Commit**

```bash
git add src/headless.js tests/no-output-backstop-wiring.test.js
git commit -m "feat(backstop): wire the no-output backstop into runHeadless

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: council-path pin — backstopped leg → dead leg → SL-2 retry → announced

**Files:**
- Test: extend the existing SL-2/run-retry council suite (find it:
  `grep -rln "run-retry\|stage1-retry\|retryWaveId" tests/council/ | head`) with one case.
  No production code expected — this task PINS the inheritance chain; if the pin fails,
  STOP and report BLOCKED with the failure (that means D4's "no new machinery" premise is
  wrong and the controller must re-decide, not you).

**Interfaces:**
- Consumes: the reason-string contract from Task 2 (`NO_OUTPUT_BACKSTOP: ...`).
- Produces: a green pin proving a leg that died with the backstop reason is retried once
  (SL-2), its enriched dead-leg record carries the reason text, and the run exits degraded.

- [ ] **Step 1: Write the pin (failing only if the chain is broken)**

Model on the existing suite's fixture style — a Stage-1 leg whose result doc carries
`error: 'NO_OUTPUT_BACKSTOP: model produced no output, reasoning, or tool calls in 120s — likely a listed-but-not-serving model or a dead endpoint'`
and no usable output. Assert: (1) the retry launches (the suite's existing retry-fired
assertion pattern); (2) after the retry also dies, the dead-leg degrade record's `why`
contains `NO_OUTPUT_BACKSTOP` (the enriched both-attempts record); (3) `degraded.value`
flips (exit-2 semantics, however the suite asserts it).

- [ ] **Step 2: Run it**

Run: `npx jest <that council suite>`
Expected: PASS with no production changes (the chain is generic over error strings). If it
fails: BLOCKED per above.

- [ ] **Step 3: Commit**

```bash
git add tests/council/<suite>.js
git commit -m "test(backstop): pin backstop-failed leg through SL-2 retry + degrade announcement

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: docs + gates

**Files:**
- Modify: `docs/configuration.md` (env table), `docs/troubleshooting.md` (one entry),
  `CHANGELOG.md` (`[Unreleased]` — it already has v4.6.2-PR1 content; append in style)

- [ ] **Step 1: configuration.md** row (match the table's exact column format):

```markdown
| `AMICUS_NO_OUTPUT_BACKSTOP_MS` | `120000` | Fail a headless leg fast when the model has produced no output, reasoning, or tool calls for this long — the "accepted but not serving" class. Disarms permanently on the first sign of activity, so slow cold-prefill local models are unaffected. `0` (or negative) disables. |
```

- [ ] **Step 2: troubleshooting.md** entry, in the file's Cause/Confirm/Fix house format:
symptom "a leg fails with `NO_OUTPUT_BACKSTOP`" → cause: the model endpoint accepted the
request but produced nothing for 120s (dead/misconfigured endpoint, or a catalog-listed model
no longer being served — run `amicus models --check` for the drift/stale audit) → fix: check
the alias target; raise `AMICUS_NO_OUTPUT_BACKSTOP_MS` only if a model legitimately needs
>120s to its first token.

- [ ] **Step 3: CHANGELOG** `[Unreleased]` `### Added` (match PR1's bold-lead-in bullet style):
one bullet — headless legs now fail fast with `NO_OUTPUT_BACKSTOP` when a model produces
nothing (120s default, env-tunable, disarms on first activity); previously such legs burned
the full timeout to learn nothing.

- [ ] **Step 4: Gates**

Run: `node scripts/generate-docs.js` (new src module → markers) · `npm run lint` ·
`npm run check:sizes` · `npm test` (full; report exact totals; attribute the delta).

- [ ] **Step 5: Commit**

```bash
git add docs/configuration.md docs/troubleshooting.md CHANGELOG.md CLAUDE.md
git commit -m "docs(v4.6.2-pr2): configuration/troubleshooting/CHANGELOG for the no-output backstop

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5 (controller-only — implementers skip): live smoke + PR

- [ ] Controller smoke A (fire path, $0, fully local): start a silent HTTP sink
  (`node -e "require('http').createServer(()=>{}).listen(8099)"` in the background), register
  a temporary local provider pointing at `http://127.0.0.1:8099/v1` with a dummy model, run
  `AMICUS_NO_OUTPUT_BACKSTOP_MS=10000 node bin/amicus.js fanout --models <that-model> --prompt "hi"`.
  Expected: leg fails ~10s with `NO_OUTPUT_BACKSTOP: ...` — not the multi-minute timeout.
  Tear down the provider entry + sink afterwards (real user config touched — restore is
  mandatory).
- [ ] Controller smoke B (disarm path, ~$0.01): `AMICUS_NO_OUTPUT_BACKSTOP_MS=5000` deepseek
  `SMOKE OK` fanout — completes normally (first token disarms well inside 5s; proves no false
  fire on a healthy leg).
- [ ] Push branch (pre-push full suite, ≥5min timeout), `gh pr create` with smoke evidence.

---

## Plan self-review (done at writing time)

- **Spec coverage:** §5 knob/default/disable ✓ (T1), disarm-on-first-activity ✓ (T1/T2),
  named reason + session abort ✓ (T2), dead-leg/SL-2/sink inheritance ✓ (T3 pin), docs ✓ (T4),
  smoke ✓ (T5). The spec's `anyActivity` name corrected to the real `progressed` in the header.
- **Placeholders:** Task 2's harness-adaptation step names the exact discovery command and
  forbids inventing a new mocking style; the contract assertions are complete. Task 3 is a
  deliberate pin-only task with an explicit BLOCKED escalation path.
- **Type consistency:** `tick(progressed, nowMs) -> 'armed'|'disarmed'|'fired'` and the reason
  string are identical across T1/T2/T3.
- **Commit lines:** all four tasks carry the identical standard Co-Authored-By line.

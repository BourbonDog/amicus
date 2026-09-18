# #251 item 1 — The Busy-Aware No-Output Backstop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At the no-output backstop's deadline, ask the engine whether the session is busy before killing the leg; extend the window exactly once on `busy`/`retry` (never on `unknown`/`idle`), clamped strictly below the leg cap; and record which case every kill — and every saved leg — was.

**Architecture:** The state machine in `src/utils/no-output-backstop.js` learns one operation (`extend`) and gains three pure helpers beside it: the extension window formula (moved here from `run-retry-window.js`, which now delegates), the decision table as a function (`decideBackstopExtension`), and the record's predicate + clause renderer. `src/headless.js` calls the decision at its poll-loop firing site, applies it to the backstop, threads the record onto its three returns and appends the clause to the death report. The record then rides the same nine writer sites the `finish` field rides (fanout leg doc, `finalizeSession`, the four solo error branches) through one shared `stampBackstop` helper. Docs, CHANGELOG and the CI comment block say what changed.

**Tech Stack:** Node 22 CommonJS, Jest 29 (`npx jest tests/<file>` for one file; `npm test` for the suite), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-18-251-busy-aware-backstop-design.md` — §3 the decision table (binding), §4 the formula, §5 the clause strings and the record shape (binding, byte-exact), §6 the fences, §7 rulings R1–R9, §9 the docs surfaces.

## Global Constraints

- **300-line gate** (`scripts/check-file-sizes.js`, blocks the commit; `src/**/*.js`, `electron/**/*.js`). Measured on `a74ed58c`: `src/utils/result-schema.js` **300/300** and `src/council/run-retry.js` **300/300** — **do not add a line to either** (they are not in this plan's file list); `src/sidecar/resume.js` **299** (+1 allowed, no more); `src/sidecar/continue.js` 287; `src/sidecar/session-utils.js` 273; `src/sidecar/fanout-leg.js` 272; `src/sidecar/start.js` 269; `src/utils/session-status.js` 173; `src/sidecar/session-finalize.js` 70; `src/council/run-retry-window.js` 62; `src/utils/no-output-backstop.js` 48; `src/headless.js` 2145 (grandfathered in the gate's `exclude` list). Re-measure with `wc -l` after each task; report the numbers in the task report.
- **Module shape:** the `@module` docblock is the FIRST thing in a `src/utils` file (before `'use strict'`) — `scripts/generate-docs.js` reads only a block comment starting at byte zero. JSDoc on every export. The pre-commit hook regenerates and auto-stages `docs/architecture-map.md`; let it.
- **Byte-identity is a requirement, not a nicety.** Every `NO_OUTPUT_BACKSTOP` reason string built for a kill whose decision input was `idle`, a probe outcome, an unknown engine arm, or the pre-send site is byte-identical to `a74ed58c`'s. Every leg document the backstop never fired for carries no `backstop` key. Pins for both are in Tasks 1–3.
- **The decision table is the spec's §3 verbatim.** Classify on the RAW `status.type` (`=== 'busy'`, `=== 'retry'`), never on a sanitised copy; record the sanitised identifier. `unknown` (any `isProbeOutcome`) never extends. Once means once.
- **Test rails:** run ONE file with `npx jest tests/<path>` — a positional path only. NEVER pass `-t`, `--testMatch`, `--testPathPattern` or `--testPathIgnorePatterns` on the amicus command line (each has caused real spend; see BACKLOG). `npm test` at each task's end (it runs lint, docs checks, citations, sizes and the suite). Never `npm run test:integration:live`. Never bare `npm install`.
- **Durations, not only verdicts (failure mode #36):** Task 2 changes what a busy-at-the-deadline test leg does. Before editing, run `npx jest tests/no-output-backstop-wiring.test.js tests/headless-output-length.test.js tests/headless-variant.test.js tests/headless.test.js` and record each file's total time from Jest's summary; after, run them again and report both numbers. Any test whose duration roughly doubled is a test whose fixture now extends — name it and say whether that was intended.
- **Named mutants:** every pin that is GREEN at HEAD by construction (a "does not change" property) names the exact substring edit that reddens it, in a comment beside the test. Every RED-at-HEAD test is run RED before the implementation.
- **Citations:** `scripts/check-citations.js` runs pre-commit over staged files. Prefer `file.js :: symbol` anchors; a `file.js:NNN` citation must be in range at commit time.
- **Sweep the promises (failure mode #12 corollary 3):** Task 4 greps the repo for `fired is terminal`, `disarms permanently`, `Independent of \`--timeout\``, `fires first`, `terminal — break` and rules on each hit — true, amended, or a fence to re-read.
- **Docs line?** Every task's report answers "does this task change a user-visible sentence?" — Task 4 owns the CHANGELOG bullet and every prose surface in spec §9; Tasks 1–3 list the sentences they saw that Task 4 must touch.
- **Commit subjects** name the issue in parentheses, never `fix: #251`. Every commit ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- **Worktree:** `C:\Users\sendt\code\amicus-251-item1` on branch `feat/251-busy-aware-backstop` cut from `main` @ `a74ed58c` (`node_modules` is a junction to the main clone — never `rm -r` it). Implementers work there; nothing touches the main clone.
- **No implementer dispatches subagents.** Report DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED; stop and report rather than work around a brief you believe is wrong.

---

## Rulings made in this plan (the spec's R1–R9 stand; these are execution-level)

- **R-P1 — `decideBackstopExtension` lives in `src/utils/no-output-backstop.js`, not `headless.js`.** The table is the load-bearing logic and `headless.js` is grandfathered at 2145 lines with no unit harness of its own; a pure function is tested row by row. *Cost if wrong:* one cross-utils require (`./session-status`, `./text-sanitize`) — no cycle (`session-status.js` requires only `text-sanitize`).
- **R-P2 — `run-retry-window.js` keeps its docblock and delegates; the identity is pinned with `toBe`.** The #219 reasoning stays where readers look for it; the body becomes one re-export. *Cost if wrong:* none — behaviour identical by identity.
- **R-P3 — The pre-send site reads the status once, explicitly, and records it.** Today its reason closure reads the status internally; to record `status` on the pre-send record the read moves up one line and is passed in. The string is byte-identical (the clause renderer returns `''` for `why: 'pre-send'`). *Cost if wrong:* none observable.
- **R-P4 — `stampBackstop(meta, result)` is exported from `session-finalize.js`** and used by the four error branches (shared-server, start, continue, resume) so the set-or-delete rule has one home; `finalizeSession` applies the same rule to `opts.backstop`. *Cost if wrong:* one extra require line in three files (all measured to have room).
- **R-P5 — The wiring suite's default status mock becomes `{ type: 'idle' }` (spec R9).** Every existing pin that asserted `BUSY_SUFFIX` asserts `IDLE_SUFFIX` = `' (session: idle)'`; the constant is renamed. The busy/retry/unknown decision cases get explicit fixtures in a new `describe`. *Cost if wrong:* a wording change in ~10 assertions.
- **R-P6 — Test timing values:** decision tests use `noOutputBackstopMs: 1000` with `timeoutMs: 60000` (extension → 2 000 ms) so the clause renders distinct integers (`from 1s to 2s at 1s`); the at-cap test uses `timeoutMs: 1000, noOutputBackstopMs: 950` (`extendWindowMs(950, 1000) = 950` → no room). Each such test declares a 20 000 ms Jest timeout like its neighbours.

---

## File Structure

| File | Role | Status |
|---|---|---|
| `src/utils/no-output-backstop.js` | the state machine (+`extend`, `deadline`, `extended`), `extendWindowMs`, `decideBackstopExtension`, `isBackstopRecord`, `formatBackstopExtensionClause`, `BACKSTOP_WHY` | modify (T1), 48 → ≈ 150 |
| `src/council/run-retry-window.js` | docblock kept; `retryBackstopMs` re-exports `extendWindowMs` | modify (T1), 62 → ≈ 66 |
| `src/headless.js` | the decision at the poll-loop firing site; the pre-send record; `formatNoOutputBackstopReason` gains `extension`; the record on three returns | modify (T2), grandfathered |
| `src/sidecar/session-finalize.js` | `stampBackstop`; error branch + opts | modify (T3), 70 → ≈ 80 |
| `src/sidecar/session-utils.js` | `finalizeSession` applies `opts.backstop` | modify (T3), 273 → 275 |
| `src/sidecar/fanout-leg.js` | `legPatch.backstop` | modify (T3), 272 → 274 |
| `src/sidecar/start.js`, `src/sidecar/continue.js`, `src/sidecar/resume.js` | error branch stamp + opts (+ resume's reopen delete) | modify (T3), +1 line each |
| `tests/no-output-backstop.test.js` | unit pins for T1 | modify (T1) |
| `tests/council/run-retry.test.js` | the identity pin beside the existing `retryBackstopMs` test | modify (T1) |
| `tests/no-output-backstop-wiring.test.js` | default mock → idle; the new decision `describe` | modify (T2) |
| `tests/shared-server-finalize.test.js`, `tests/sidecar/session-utils.test.js`, `tests/start-terminal-status.test.js`, `tests/continue-resume-spend.test.js`, `tests/sidecar/resume.test.js`, `tests/sidecar/fanout.test.js` | threading pins, one per writer, mirroring the `finish` pins already there | modify (T3) |
| `tests/scripts/council-review-workflow.test.js` | the extension derived from the workflow's own values stays under the leg cap; the CI retry leg is at-cap | modify (T4) |
| `CHANGELOG.md`, `docs/troubleshooting.md`, `docs/council.md`, `docs/configuration.md`, `skills/second-opinion/MODEL-NOTES.md`, `.github/workflows/council-review.yml` (comment only) | the promises | modify (T4) |

---

### Task 1: The state machine learns to extend once; the formula, the decision, the record

**Files:**
- Modify: `src/utils/no-output-backstop.js`
- Modify: `src/council/run-retry-window.js`
- Test: `tests/no-output-backstop.test.js`
- Test: `tests/council/run-retry.test.js` (one new `test` beside the existing one that requires `run-retry-window`)

**Interfaces:**
- Consumes: `src/utils/session-status.js :: { isRenderableStatus, isProbeOutcome, MAX_STATUS_TYPE_CHARS }`, `src/utils/text-sanitize.js :: collapseExcerpt` (existing).
- Produces (every later task relies on these exact names):
  - `createNoOutputBackstop({ ms, startedAt })` → `{ tick(progressed, nowMs) → 'armed'|'disarmed'|'fired', extend(deadlineMs) → boolean, state() → string, deadline() → number, extended() → boolean }`
  - `extendWindowMs(baseMs, legTimeoutMs) → number` = `Math.min(2 * baseMs, Math.floor(legTimeoutMs * 0.95))`
  - `decideBackstopExtension({ status, windowMs, firedAtMs, legTimeoutMs, clockStartedAt }) → { extendTo: number|null, record: object }`
  - `isBackstopRecord(x) → boolean`
  - `formatBackstopExtensionClause(record) → string` (`''` when nothing to say)
  - `BACKSTOP_WHY = ['at-cap', 'retry-beyond-window', 'pre-send']`
  - `run-retry-window.js :: retryBackstopMs === no-output-backstop.js :: extendWindowMs` (same function object)

- [ ] **Step 1: Write the failing unit tests**

Append to `tests/no-output-backstop.test.js` (it already requires `resolveNoOutputBackstopMs` and `createNoOutputBackstop` from `../src/utils/no-output-backstop`; extend that destructure):

```js
const {
  resolveNoOutputBackstopMs, createNoOutputBackstop, extendWindowMs, decideBackstopExtension,
  isBackstopRecord, formatBackstopExtensionClause, BACKSTOP_WHY,
} = require('../src/utils/no-output-backstop');
const { probeUnknown } = require('../src/utils/session-status');

describe('#251 item 1 — extend(): a fired backstop re-arms exactly once, at a later deadline', () => {
  test('E1 fired → extend to a later deadline re-arms; it fires again only at the new deadline', () => {
    const b = createNoOutputBackstop({ ms: 100, startedAt: 1000 });
    expect(b.tick(false, 1100)).toBe('fired');
    expect(b.extend(1200)).toBe(true);
    expect(b.state()).toBe('armed');
    expect(b.deadline()).toBe(1200);
    expect(b.extended()).toBe(true);
    expect(b.tick(false, 1150)).toBe('armed');
    expect(b.tick(false, 1200)).toBe('fired');
  });
  test('E2 once means once — a second extend after the second firing is refused', () => {
    const b = createNoOutputBackstop({ ms: 100, startedAt: 1000 });
    b.tick(false, 1100); b.extend(1200); b.tick(false, 1200);
    expect(b.extend(1400)).toBe(false);
    expect(b.state()).toBe('fired');
    expect(b.deadline()).toBe(1200);
  });
  test('E3 extend is refused while armed, while disarmed, and for a deadline that is not later', () => {
    const armed = createNoOutputBackstop({ ms: 100, startedAt: 1000 });
    expect(armed.extend(1500)).toBe(false);
    expect(armed.state()).toBe('armed');
    const disarmed = createNoOutputBackstop({ ms: 100, startedAt: 1000 });
    disarmed.tick(true, 1050);
    expect(disarmed.extend(1500)).toBe(false);
    expect(disarmed.state()).toBe('disarmed');
    const fired = createNoOutputBackstop({ ms: 100, startedAt: 1000 });
    fired.tick(false, 1100);
    expect(fired.extend(1100)).toBe(false); // equal, not later
    expect(fired.extend(1099)).toBe(false);
    expect(fired.state()).toBe('fired');
    expect(fired.extended()).toBe(false);
  });
  test('E4 progress after an extension still disarms it permanently', () => {
    const b = createNoOutputBackstop({ ms: 100, startedAt: 1000 });
    b.tick(false, 1100); b.extend(1200);
    expect(b.tick(true, 1150)).toBe('disarmed');
    expect(b.tick(false, 5000)).toBe('disarmed');
  });
  test('E5 a never-armed backstop (ms <= 0) cannot be extended', () => {
    const b = createNoOutputBackstop({ ms: 0, startedAt: 1000 });
    expect(b.tick(false, 99999)).toBe('disarmed');
    expect(b.extend(200000)).toBe(false);
  });
});

describe('#251 item 1 — extendWindowMs is the retry window formula, and the SAME function', () => {
  test('F1 doubled, clamped strictly below the leg cap (the #219 table)', () => {
    expect(extendWindowMs(480000, 960000)).toBe(912000); // CI first attempt
    expect(extendWindowMs(912000, 960000)).toBe(912000); // CI retry: no room
    expect(extendWindowMs(300000, 900000)).toBe(600000); // local default
    expect(extendWindowMs(30000, 120000)).toBe(60000);   // the live model probe
    expect(extendWindowMs(0, 960000)).toBe(0);           // disabled stays disabled
  });
  test('F2 run-retry-window.js re-exports the identical function object (not a copy)', () => {
    const { retryBackstopMs } = require('../src/council/run-retry-window');
    expect(retryBackstopMs).toBe(extendWindowMs);
  });
});

describe('#251 item 1 — decideBackstopExtension: the spec §3 table, row by row', () => {
  const base = { windowMs: 480000, firedAtMs: 480722, legTimeoutMs: 960000, clockStartedAt: 1000000 };
  test('D1 busy with room → extend to clock + extended window; record extended:true', () => {
    const d = decideBackstopExtension({ ...base, status: { type: 'busy' } });
    expect(d.extendTo).toBe(1000000 + 912000);
    expect(d.record).toEqual({ windowMs: 480000, firedAtMs: 480722, status: 'busy', extended: true, extendedToMs: 912000 });
    expect(isBackstopRecord(d.record)).toBe(true);
  });
  test('D2 retry with no `next`, or a `next` inside the extended window → extend', () => {
    const noNext = decideBackstopExtension({ ...base, status: { type: 'retry', attempt: 2, message: '429' } });
    expect(noNext.extendTo).toBe(1912000);
    expect(noNext.record.status).toBe('retry');
    const inside = decideBackstopExtension({ ...base, status: { type: 'retry', attempt: 2, message: '429', next: 1912000 } });
    expect(inside.extendTo).toBe(1912000);
  });
  test('D3 retry whose `next` lies past the extended window → kill now, why retry-beyond-window, ISO recorded', () => {
    const d = decideBackstopExtension({ ...base, status: { type: 'retry', attempt: 3, message: '503', next: 1912001 } });
    expect(d.extendTo).toBeNull();
    expect(d.record).toEqual({
      windowMs: 480000, firedAtMs: 480722, status: 'retry', extended: false,
      why: 'retry-beyond-window', retryNextIso: new Date(1912001).toISOString(),
    });
    expect(isBackstopRecord(d.record)).toBe(true);
  });
  test('D4 busy but the window is already at the clamp → kill now, why at-cap (the CI retry leg)', () => {
    const d = decideBackstopExtension({ ...base, windowMs: 912000, firedAtMs: 913904, status: { type: 'busy' } });
    expect(d.extendTo).toBeNull();
    expect(d.record).toEqual({ windowMs: 912000, firedAtMs: 913904, status: 'busy', extended: false, why: 'at-cap' });
  });
  test('D5 idle → kill now, no why, no extension', () => {
    const d = decideBackstopExtension({ ...base, status: { type: 'idle' } });
    expect(d).toEqual({ extendTo: null, record: { windowMs: 480000, firedAtMs: 480722, status: 'idle', extended: false } });
  });
  test('D6 every probe outcome → kill now, status recorded as unknown (never extend on unknown)', () => {
    for (const probe of [probeUnknown('skipped', 'no window'), probeUnknown('failed', 'boom'), probeUnknown('no-status', 'the engine returned {}')]) {
      const d = decideBackstopExtension({ ...base, status: probe });
      expect(d.extendTo).toBeNull();
      expect(d.record).toEqual({ windowMs: 480000, firedAtMs: 480722, status: 'unknown', extended: false });
    }
  });
  test('D7 an engine `unknown` that is NOT a probe outcome is an unknown arm: kill now, identifier recorded, never extended', () => {
    const d = decideBackstopExtension({ ...base, status: { type: 'unknown', probe: 'failed', detail: 'forged' } });
    expect(d.extendTo).toBeNull();
    expect(d.record.status).toBe('unknown');
    expect(d.record.extended).toBe(false);
  });
  test('D8 an unrecognised or unrenderable status never extends; the sanitised identifier is what is recorded', () => {
    expect(decideBackstopExtension({ ...base, status: { type: 'working' } }).extendTo).toBeNull();
    expect(decideBackstopExtension({ ...base, status: { type: 'working' } }).record.status).toBe('working');
    expect(decideBackstopExtension({ ...base, status: null }).record.status).toBe('unknown');
    expect(decideBackstopExtension({ ...base, status: { type: '' } }).record.status).toBe('unknown');
    expect(decideBackstopExtension({ ...base, status: { type: 'busy\n\n  '.padEnd(80, 'x') } }).extendTo).toBeNull(); // raw type !== 'busy'
  });
  test('D9 classification is on the RAW type: a type that only SANITISES to busy does not extend', () => {
    // collapseExcerpt would collapse whitespace; the decision must compare the raw identifier.
    const d = decideBackstopExtension({ ...base, status: { type: ' busy ' } });
    expect(d.extendTo).toBeNull();
  });
});

describe('#251 item 1 — isBackstopRecord and the clause', () => {
  test('P1 accepts exactly the documented shapes and rejects forged or partial ones', () => {
    expect(isBackstopRecord({ windowMs: 1, firedAtMs: 2, status: 'busy', extended: true, extendedToMs: 3 })).toBe(true);
    expect(isBackstopRecord({ windowMs: 1, firedAtMs: 2, status: 'idle', extended: false })).toBe(true);
    for (const why of BACKSTOP_WHY) {
      const rec = { windowMs: 1, firedAtMs: 2, status: 'busy', extended: false, why };
      if (why === 'retry-beyond-window') { rec.retryNextIso = '2026-09-18T12:34:56.000Z'; }
      expect(isBackstopRecord(rec)).toBe(true);
    }
    expect(isBackstopRecord(null)).toBe(false);
    expect(isBackstopRecord([])).toBe(false);
    expect(isBackstopRecord({ windowMs: 1.5, firedAtMs: 2, status: 'busy', extended: false })).toBe(false);
    expect(isBackstopRecord({ windowMs: 1, firedAtMs: -1, status: 'busy', extended: false })).toBe(false);
    expect(isBackstopRecord({ windowMs: 1, firedAtMs: 2, status: '', extended: false })).toBe(false);
    expect(isBackstopRecord({ windowMs: 1, firedAtMs: 2, status: 'busy', extended: 'yes' })).toBe(false);
    expect(isBackstopRecord({ windowMs: 1, firedAtMs: 2, status: 'busy', extended: true })).toBe(false); // extended needs extendedToMs > windowMs
    expect(isBackstopRecord({ windowMs: 5, firedAtMs: 2, status: 'busy', extended: true, extendedToMs: 5 })).toBe(false);
    expect(isBackstopRecord({ windowMs: 1, firedAtMs: 2, status: 'busy', extended: true, extendedToMs: 3, why: 'at-cap' })).toBe(false); // extended never carries why
    expect(isBackstopRecord({ windowMs: 1, firedAtMs: 2, status: 'busy', extended: false, why: 'because' })).toBe(false);
    expect(isBackstopRecord({ windowMs: 1, firedAtMs: 2, status: 'busy', extended: false, why: 'retry-beyond-window' })).toBe(false); // needs retryNextIso
    expect(isBackstopRecord({ windowMs: 1, firedAtMs: 2, status: 'busy', extended: false, why: 'at-cap', retryNextIso: 'x' })).toBe(false);
  });
  test('C1 the four clause strings, byte-exact (spec §5.1)', () => {
    expect(formatBackstopExtensionClause({ windowMs: 480000, firedAtMs: 480722, status: 'busy', extended: true, extendedToMs: 912000 }))
      .toBe(' — window extended once from 480s to 912s at 481s on session busy');
    expect(formatBackstopExtensionClause({ windowMs: 912000, firedAtMs: 913904, status: 'busy', extended: false, why: 'at-cap' }))
      .toBe(' — not extended: the window is already at the leg cap');
    expect(formatBackstopExtensionClause({ windowMs: 480000, firedAtMs: 480722, status: 'retry', extended: false, why: 'retry-beyond-window', retryNextIso: '2026-09-18T12:34:56.000Z' }))
      .toBe(' — not extended: the engine schedules its next attempt at 2026-09-18T12:34:56.000Z, past the extended window');
    expect(formatBackstopExtensionClause({ windowMs: 480000, firedAtMs: 480722, status: 'busy', extended: false, why: 'pre-send' })).toBe('');
  });
  test('C2 nothing to say renders nothing: idle, unknown, a non-record, undefined', () => {
    expect(formatBackstopExtensionClause({ windowMs: 480000, firedAtMs: 480722, status: 'idle', extended: false })).toBe('');
    expect(formatBackstopExtensionClause({ windowMs: 480000, firedAtMs: 480722, status: 'unknown', extended: false })).toBe('');
    expect(formatBackstopExtensionClause({ forged: true })).toBe('');
    expect(formatBackstopExtensionClause(undefined)).toBe('');
  });
});
```

Also, in `tests/council/run-retry.test.js`, directly after the existing test that does
`const { retryBackstopMs } = require('../../src/council/run-retry-window');` (around line 849), add:

```js
  test('#251 item 1: the retry window and the backstop extension are ONE function (identity, not equivalence)', () => {
    const { retryBackstopMs } = require('../../src/council/run-retry-window');
    const { extendWindowMs } = require('../../src/utils/no-output-backstop');
    expect(retryBackstopMs).toBe(extendWindowMs);
  });
```

- [ ] **Step 2: Run the two files and confirm the new tests fail for the right reason**

Run: `npx jest tests/no-output-backstop.test.js` and `npx jest tests/council/run-retry.test.js`
Expected: the new tests FAIL with `extendWindowMs is not a function` / `b.extend is not a function` / `expect(received).toBe(expected)` on the identity pin; every pre-existing test still passes.

- [ ] **Step 3: Implement in `src/utils/no-output-backstop.js`**

Replace the file's body below the docblock. Amend the docblock's "`fired` is terminal" sentence to read: "`fired` is terminal for ticks: progress cannot resurrect it. The ONE way back to `armed` is `extend()`, which a caller may use exactly once (#251 item 1: the engine reported the session busy at the deadline) and only to a LATER deadline." Keep every other sentence.

```js
'use strict';

const { envNumber } = require('./env-num');
const { isRenderableStatus, isProbeOutcome, MAX_STATUS_TYPE_CHARS } = require('./session-status');
const { collapseExcerpt } = require('./text-sanitize');

const DEFAULT_NO_OUTPUT_BACKSTOP_MS = 300000;

/** The reasons a busy/retry session was NOT extended (spec 2026-09-18 §5.2). */
const BACKSTOP_WHY = ['at-cap', 'retry-beyond-window', 'pre-send'];

/** @param {object} [env] test seam; defaults to process.env */
function resolveNoOutputBackstopMs(env) {
  return envNumber('AMICUS_NO_OUTPUT_BACKSTOP_MS', DEFAULT_NO_OUTPUT_BACKSTOP_MS, env);
}

/**
 * @param {{ms:number, startedAt:number}} opts
 * @returns {{tick:(progressed:boolean, nowMs:number)=>string, extend:(deadlineMs:number)=>boolean,
 *   state:()=>string, deadline:()=>number, extended:()=>boolean}}
 */
function createNoOutputBackstop({ ms, startedAt }) {
  let state = ms > 0 ? 'armed' : 'disarmed';
  let deadline = startedAt + ms;
  let extended = false;
  return {
    tick(progressed, nowMs) {
      if (state !== 'armed') { return state; }
      if (progressed) { state = 'disarmed'; return state; }
      if (nowMs >= deadline) { state = 'fired'; }
      return state;
    },
    // #251 item 1: re-arm a FIRED backstop once, at a later deadline. Refused —
    // false, nothing changes — while armed or disarmed, after one extension, or
    // for a deadline that is not strictly later. `!(deadlineMs > deadline)` also
    // refuses NaN/undefined, which `<=` would let through.
    extend(deadlineMs) {
      if (state !== 'fired' || extended || !(deadlineMs > deadline)) { return false; }
      deadline = deadlineMs;
      extended = true;
      state = 'armed';
      return true;
    },
    state() { return state; },
    deadline() { return deadline; },
    extended() { return extended; },
  };
}

/**
 * The window a leg gets when it is given more time: doubled, clamped STRICTLY
 * below the leg cap. This is the Stage-1 retry's formula (#219) and, since #251
 * item 1, the one extension's — one function, re-exported by
 * council/run-retry-window.js, whose docblock holds the measured reasoning.
 * `2 * 0 === 0` keeps a disabled backstop disabled.
 * @param {number} baseMs the window in force
 * @param {number} legTimeoutMs the per-leg hard cap
 * @returns {number}
 */
function extendWindowMs(baseMs, legTimeoutMs) {
  return Math.min(2 * baseMs, Math.floor(legTimeoutMs * 0.95));
}

/**
 * #251 item 1 — the decision at the poll-loop firing site (spec 2026-09-18 §3),
 * as a pure function so every row is testable without the poll loop.
 * Classifies on the RAW `status.type` and records the SANITISED identifier —
 * the #219 r2 rule in session-status.js: display never decides semantics.
 * @param {{status:*, windowMs:number, firedAtMs:number, legTimeoutMs:number, clockStartedAt:number}} a
 *   status — sessionStatusSafe's answer: an engine SessionStatus or a probeUnknown outcome
 *   windowMs — the window in force at this firing; firedAtMs — elapsed on the backstop's clock
 *   legTimeoutMs — the leg cap; clockStartedAt — the backstop's clock origin (epoch ms)
 * @returns {{extendTo: number|null, record: object}} extendTo is the new deadline (epoch ms) or null
 */
function decideBackstopExtension({ status, windowMs, firedAtMs, legTimeoutMs, clockStartedAt }) {
  const isEngine = isRenderableStatus(status) && !isProbeOutcome(status);
  const type = isEngine ? collapseExcerpt(status.type, MAX_STATUS_TYPE_CHARS) : 'unknown';
  const record = { windowMs, firedAtMs, status: type, extended: false };
  if (!isEngine || (status.type !== 'busy' && status.type !== 'retry')) { return { extendTo: null, record }; }
  const extendedMs = extendWindowMs(windowMs, legTimeoutMs);
  if (!(extendedMs > windowMs)) { return { extendTo: null, record: { ...record, why: 'at-cap' } }; }
  const extendTo = clockStartedAt + extendedMs;
  if (status.type === 'retry' && Number.isFinite(status.next) && status.next > extendTo) {
    return { extendTo: null, record: { ...record, why: 'retry-beyond-window', retryNextIso: new Date(status.next).toISOString() } };
  }
  return { extendTo, record: { ...record, extended: true, extendedToMs: extendedMs } };
}

/**
 * Is this the record decideBackstopExtension writes — and nothing else? Every
 * writer of a leg document uses this before copying the field, so a forged or
 * partial object is dropped, never coerced (spec §5.2).
 * @param {*} x
 * @returns {boolean}
 */
function isBackstopRecord(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) { return false; }
  if (!(Number.isInteger(x.windowMs) && x.windowMs >= 0)) { return false; }
  if (!(Number.isInteger(x.firedAtMs) && x.firedAtMs >= 0)) { return false; }
  if (typeof x.status !== 'string' || x.status === '') { return false; }
  if (typeof x.extended !== 'boolean') { return false; }
  if (x.extended) {
    return Number.isInteger(x.extendedToMs) && x.extendedToMs > x.windowMs && x.why === undefined && x.retryNextIso === undefined;
  }
  if (x.extendedToMs !== undefined) { return false; }
  if (x.why === undefined) { return x.retryNextIso === undefined; }
  if (!BACKSTOP_WHY.includes(x.why)) { return false; }
  return x.why === 'retry-beyond-window' ? typeof x.retryNextIso === 'string' && x.retryNextIso !== '' : x.retryNextIso === undefined;
}

/**
 * The death report's fourth clause (spec §5.1). Append-only: '' whenever the
 * record has nothing to say (idle, unknown, an unknown arm, the pre-send site,
 * or not a record at all), so every such reason string is byte-identical to
 * one built before this clause existed. Every value here is a number amicus
 * measured, a sanitised type identifier, or an ISO timestamp amicus formatted —
 * no untrusted text enters.
 * @param {*} record
 * @returns {string}
 */
function formatBackstopExtensionClause(record) {
  if (!isBackstopRecord(record)) { return ''; }
  const s = (ms) => `${Math.round(ms / 1000)}s`;
  if (record.extended) {
    return ` — window extended once from ${s(record.windowMs)} to ${s(record.extendedToMs)} at ${s(record.firedAtMs)} on session ${record.status}`;
  }
  if (record.why === 'at-cap') { return ' — not extended: the window is already at the leg cap'; }
  if (record.why === 'retry-beyond-window') {
    return ` — not extended: the engine schedules its next attempt at ${record.retryNextIso}, past the extended window`;
  }
  return '';
}

module.exports = {
  resolveNoOutputBackstopMs, createNoOutputBackstop, extendWindowMs, decideBackstopExtension,
  isBackstopRecord, formatBackstopExtensionClause, BACKSTOP_WHY, DEFAULT_NO_OUTPUT_BACKSTOP_MS,
};
```

The `@module utils/no-output-backstop` docblock stays first in the file (before `'use strict'`). Nine exports exceed the "≤ 5 exports" convention from other plans; that convention is a guideline for NEW modules — this module already had three, and the four additions are one feature's surface. Say so in the report if the reviewer asks.

Then replace the body of `src/council/run-retry-window.js` below its docblock (keep the docblock word for word, and add one sentence at its end: "Since #251 item 1 the formula has one home — `utils/no-output-backstop.js :: extendWindowMs` — and this module re-exports that very function; `tests/no-output-backstop.test.js` F2 pins the identity."):

```js
'use strict';

const { extendWindowMs } = require('../utils/no-output-backstop');

/**
 * @param {number} baseBackstopMs the first attempt's resolved no-output window
 * @param {number} legTimeoutMs the per-leg hard cap ((o.timeout || 15) * 60_000)
 * @returns {number} the retry's window: doubled, clamped strictly below the cap
 */
const retryBackstopMs = extendWindowMs;

module.exports = { retryBackstopMs };
```

(The existing in-body comment block about the three regimes moves INTO the docblock, above, so no reasoning is lost — it is the module's whole purpose.)

- [ ] **Step 4: Run the two files; confirm green; run the related families**

Run: `npx jest tests/no-output-backstop.test.js`, `npx jest tests/council/run-retry.test.js`, then `npx jest tests/utils/session-status.test.js tests/no-output-backstop-wiring.test.js tests/scripts/council-review-workflow.test.js`
Expected: all PASS (nothing in headless changed yet; the wiring suite must be untouched by this task).

- [ ] **Step 5: Measure, check docs, commit**

Run: `wc -l src/utils/no-output-backstop.js src/council/run-retry-window.js` (report both), `node scripts/generate-docs.js` (the hook does it too; run it so you see what it regenerates), then:

```bash
git add src/utils/no-output-backstop.js src/council/run-retry-window.js tests/no-output-backstop.test.js tests/council/run-retry.test.js docs/architecture-map.md
git commit -m "feat(backstop): a fired backstop can be extended once; the decision table, the record and its clause as pure helpers (#251)"
```

(Trailer per Global Constraints. If the pre-commit hook regenerates `docs/architecture-map.md`, it stages it; if `check-citations` complains about a `run-retry-window.js:59` citation in `skills/second-opinion/MODEL-NOTES.md`, leave MODEL-NOTES to Task 4 and note the line in your report.)

---

### Task 2: `headless.js` consults the session before the kill

**Files:**
- Modify: `src/headless.js` — the requires near line 29; `formatNoOutputBackstopReason` (≈ line 272); the pre-send catch (≈ lines 861–889); the `noOutputBackstopReason` closure (≈ line 840); the poll-loop firing site (≈ line 1370); the three returns (≈ lines 1907–1950 and ≈ 2040).
- Test: `tests/no-output-backstop-wiring.test.js`

**Interfaces:**
- Consumes (Task 1): `decideBackstopExtension`, `isBackstopRecord`, `formatBackstopExtensionClause` from `./utils/no-output-backstop`; `noOutputBackstop.extend(ms)`.
- Produces: the runHeadless result may carry `backstop` (a record per `isBackstopRecord`); `formatNoOutputBackstopReason({ ms, fromEnv, engineLogExcerpt, engineSkew, sessionStatus, extension })` — `extension` optional, `''` when absent. Task 3 reads `result.backstop`.

- [ ] **Step 1: Record the baseline durations (Global Constraint #36)**

Run: `npx jest tests/no-output-backstop-wiring.test.js tests/headless-output-length.test.js tests/headless-variant.test.js tests/headless.test.js`
Write down each file's time from Jest's per-file line and the total. They go in the report.

- [ ] **Step 2: Switch the wiring suite's default status to idle and write the failing decision tests**

In `tests/no-output-backstop-wiring.test.js`:

1. `beforeEach`: `mockGetSessionStatus.mockResolvedValue({ type: 'idle' });` (was `busy`).
2. Rename `const BUSY_SUFFIX = ' (session: busy)';` → `const IDLE_SUFFIX = ' (session: idle)';` and update its comment: "the suite-level default mock answers `{type:'idle'}` — a kill decision that never extends (spec 2026-09-18 §3), so every death here still carries a clause and still dies at its window; the busy/retry/unknown decisions have their own `describe` below." Replace every `BUSY_SUFFIX` use with `IDLE_SUFFIX`.
3. Find every test in the file that sets `mockGetSessionStatus.mockResolvedValue({ type: 'busy' })` explicitly (there is one, plus a `retry` one and the keyed-map ones). For each, read what it pins: if it pins the CLAUSE on a kill ("busy — the engine is still waiting"), give it the at-cap geometry (`timeoutMs: 1000, noOutputBackstopMs: 950`) so the leg still dies at its window and the clause is still `(session: busy)` — and extend its assertion with `— not extended: the window is already at the leg cap`. If it pins something else (the keyed-map unwrap, the forged-`unknown` case), it is a kill with no extension and needs no change; confirm by running it.
4. Add the new `describe` (import `decideBackstopExtension` is NOT needed here — these drive the real loop):

```js
describe('#251 item 1: the backstop consults the session before the kill', () => {
  // Geometry (plan R-P6): window 1000 ms, leg cap 60 s → extendWindowMs = 2000 ms.
  const GEO = { ...OPTS, noOutputBackstopMs: 1000 };
  const run = (taskId, opts = {}, timeoutMs = 60000) =>
    runHeadless(MODEL, 'sys', 'user', taskId, '/proj', timeoutMs, 'build', { ...GEO, ...opts });

  test('W1 busy at the deadline: the leg gets one more window, then dies at the EXTENDED deadline with the clause and the record', async () => {
    mockGetMessages.mockResolvedValue([]);
    mockGetSessionStatus.mockResolvedValue({ type: 'busy' });
    const started = Date.now();
    const result = await run('ext1');
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(1900); // not the 1 s window
    expect(elapsed).toBeLessThan(10000);           // not the 60 s cap
    expect(result.completed).toBe(false);
    expect(result.timedOut).toBeFalsy();
    expect(String(result.error)).toMatch(/^NO_OUTPUT_BACKSTOP: no output, reasoning, or tool calls in 2s — a caller-set window overriding the AMICUS_NO_OUTPUT_BACKSTOP_MS default/);
    expect(String(result.error)).toMatch(/ \(session: busy\) — window extended once from 1s to 2s at 1s on session busy$/);
    expect(result.backstop).toEqual({ windowMs: 1000, firedAtMs: expect.any(Number), status: 'busy', extended: true, extendedToMs: 2000 });
    expect(result.backstop.firedAtMs).toBeGreaterThanOrEqual(1000);
    expect(mockAbortSession).toHaveBeenCalledTimes(1);
    // Two status reads: one for the decision at 1 s, one for the report at 2 s.
    expect(mockGetSessionStatus).toHaveBeenCalledTimes(2);
  }, 20000);

  test('W2 busy at the deadline, then the model speaks inside the extension: the leg completes, keeps its ttftMs and carries the record (the lever\'s purpose)', async () => {
    const started = Date.now();
    // Silence for the first window; from 1.3 s on, a finished assistant message with text.
    mockGetMessages.mockImplementation(async () => (Date.now() - started < 1300 ? [] : [{
      info: { role: 'assistant', id: 'm1', time: { created: 1, completed: 2 } },
      parts: [{ id: 't1', type: 'text', text: 'the answer' }],
    }]));
    mockGetSessionStatus.mockImplementation(async () => ({ type: Date.now() - started < 1300 ? 'busy' : 'idle' }));
    const result = await run('saved1');
    expect(result.completed).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.ttftMs).toBeGreaterThanOrEqual(1000);
    expect(result.backstop).toEqual({ windowMs: 1000, firedAtMs: expect.any(Number), status: 'busy', extended: true, extendedToMs: 2000 });
    expect(mockAbortSession).not.toHaveBeenCalled();
  }, 20000);

  test('W3 idle at the deadline: kill at the ORIGINAL window, string byte-identical to 4.12.0, record says idle / not extended', async () => {
    // Preservation pin, GREEN at HEAD by construction. Named mutant "IDLEEXTENDS": in
    // decideBackstopExtension change `status.type !== 'busy' && status.type !== 'retry'` to
    // `status.type !== 'busy' && status.type !== 'retry' && status.type !== 'idle'` — W3 reddens (dies at 2 s).
    mockGetMessages.mockResolvedValue([]);
    const started = Date.now();
    const result = await run('idle1');
    expect(Date.now() - started).toBeLessThan(1900);
    expect(String(result.error)).toBe(
      'NO_OUTPUT_BACKSTOP: no output, reasoning, or tool calls in 1s — a caller-set window overriding the AMICUS_NO_OUTPUT_BACKSTOP_MS default (session: idle)');
    expect(result.backstop).toEqual({ windowMs: 1000, firedAtMs: expect.any(Number), status: 'idle', extended: false });
  }, 20000);

  test('W4 a probe that answers nothing NEVER extends: failed / no-status / skipped all kill at the original window', async () => {
    // Named mutant "UNKNOWNEXTENDS": drop `&& !isProbeOutcome(status)` from `isEngine` in decideBackstopExtension — the
    // forged-type case below (`{type:'busy'}` keyed under ANOTHER session, which unwraps to no-status) would then... stay
    // a kill; the mutant is caught by D6 in the unit file. Here the observable is the kill time and the clause.
    mockGetMessages.mockResolvedValue([]);
    for (const [name, arm] of [
      ['failed', () => mockGetSessionStatus.mockRejectedValue(new Error('ECONNRESET'))],
      ['no-status', () => mockGetSessionStatus.mockResolvedValue({})],
      ['keyed under another session', () => mockGetSessionStatus.mockResolvedValue({ ses_someone_else: { type: 'busy' } })],
    ]) {
      jest.clearAllMocks();
      mockGetMessages.mockResolvedValue([]);
      arm();
      const started = Date.now();
      const result = await run(`unk-${name.replace(/\W/g, '')}`);
      expect(Date.now() - started).toBeLessThan(1900);
      expect(String(result.error)).toMatch(/^NO_OUTPUT_BACKSTOP: no output, reasoning, or tool calls in 1s/);
      expect(String(result.error)).toMatch(/\(session: unknown — probe /);
      expect(String(result.error)).not.toMatch(/extended/);
      expect(result.backstop).toEqual({ windowMs: 1000, firedAtMs: expect.any(Number), status: 'unknown', extended: false });
    }
  }, 30000);

  test('W5a retry whose next attempt falls inside the extended window extends; W5b one scheduled past it kills now with the named clause', async () => {
    mockGetMessages.mockResolvedValue([]);
    const inside = Date.now() + 1500;
    mockGetSessionStatus.mockResolvedValue({ type: 'retry', attempt: 2, message: '429 rate limited', next: inside });
    let started = Date.now();
    let result = await run('retryin1');
    expect(Date.now() - started).toBeGreaterThanOrEqual(1900);
    expect(result.backstop.extended).toBe(true);
    expect(result.backstop.status).toBe('retry');
    expect(String(result.error)).toMatch(/ — window extended once from 1s to 2s at 1s on session retry$/);

    jest.clearAllMocks();
    mockGetMessages.mockResolvedValue([]);
    const beyond = Date.now() + 60 * 60 * 1000;
    mockGetSessionStatus.mockResolvedValue({ type: 'retry', attempt: 3, message: '503 upstream', next: beyond });
    started = Date.now();
    result = await run('retryout1');
    expect(Date.now() - started).toBeLessThan(1900);
    expect(String(result.error)).toMatch(/ \(session: retry attempt 3 — 503 upstream\) — not extended: the engine schedules its next attempt at \d{4}-\d{2}-\d{2}T[\d:.]+Z, past the extended window$/);
    expect(result.backstop).toEqual({ windowMs: 1000, firedAtMs: expect.any(Number), status: 'retry', extended: false, why: 'retry-beyond-window', retryNextIso: new Date(beyond).toISOString() });
  }, 30000);

  test('W6 once means once: busy at both deadlines dies at the extended deadline, never a third window', async () => {
    // Named mutant "TWICE": in no-output-backstop.js extend(), drop `|| extended` — W6 dies at the 60 s cap instead.
    mockGetMessages.mockResolvedValue([]);
    mockGetSessionStatus.mockResolvedValue({ type: 'busy' });
    const started = Date.now();
    const result = await run('twice1', {}, 8000);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(1900);
    expect(elapsed).toBeLessThan(4000);
    expect(result.timedOut).toBeFalsy();
    expect(String(result.error)).toMatch(/^NO_OUTPUT_BACKSTOP:.* in 2s .*window extended once/);
  }, 20000);

  test('W7 at the cap: a window already at the clamp is not extended (the CI retry leg\'s shape), and the clause says so', async () => {
    mockGetMessages.mockResolvedValue([]);
    mockGetSessionStatus.mockResolvedValue({ type: 'busy' });
    const started = Date.now();
    const result = await run('atcap1', { noOutputBackstopMs: 950 }, 1000);
    expect(Date.now() - started).toBeLessThan(1900);
    expect(result.timedOut).toBeFalsy(); // the backstop, not the 1 s leg cap, ended it — the named diagnosis survives
    expect(String(result.error)).toMatch(/ \(session: busy\) — not extended: the window is already at the leg cap$/);
    expect(result.backstop).toEqual({ windowMs: 950, firedAtMs: expect.any(Number), status: 'busy', extended: false, why: 'at-cap' });
  }, 20000);

  test('W8 the pre-send site never extends: a prompt send that never resolves dies at the window with the byte-identical string, record why pre-send', async () => {
    // Preservation pin. Named mutant "PRESENDEXTENDS": route the pre-send catch through decideBackstopExtension and
    // extend() — the leg would then wait 2 s. (The pre-send path has no backstop object to extend; the mutant is the
    // temptation to add one.)
    mockSendPromptAsync.mockImplementation(() => new Promise(() => {}));
    mockGetSessionStatus.mockResolvedValue({ type: 'busy' });
    const started = Date.now();
    const result = await run('presend1');
    expect(Date.now() - started).toBeLessThan(1900);
    expect(String(result.error)).toBe(
      'NO_OUTPUT_BACKSTOP: no output, reasoning, or tool calls in 1s — a caller-set window overriding the AMICUS_NO_OUTPUT_BACKSTOP_MS default (session: busy)');
    expect(result.backstop).toEqual({ windowMs: 1000, firedAtMs: expect.any(Number), status: 'busy', extended: false, why: 'pre-send' });
  }, 20000);

  test('W9 a leg the backstop never fires for carries NO backstop key (byte-identical documents)', async () => {
    mockGetMessages.mockResolvedValue([{
      info: { role: 'assistant', id: 'm1', time: { created: 1, completed: 2 } },
      parts: [{ id: 't1', type: 'text', text: 'quick answer' }],
    }]);
    const result = await run('quick1');
    expect(result.completed).toBe(true);
    expect('backstop' in result).toBe(false);
  }, 20000);

  test('W10 formatNoOutputBackstopReason without `extension` is byte-identical; with one it appends the clause LAST', () => {
    const base = { ms: 480000, fromEnv: true, engineLogExcerpt: 'ERROR x', engineSkew: { server: '1.18.15', installed: '1.18.14' }, sessionStatus: { type: 'busy' } };
    const before = formatNoOutputBackstopReason(base);
    expect(formatNoOutputBackstopReason({ ...base, extension: undefined })).toBe(before);
    expect(formatNoOutputBackstopReason({ ...base, extension: { windowMs: 480000, firedAtMs: 480722, status: 'idle', extended: false } })).toBe(before);
    expect(formatNoOutputBackstopReason({ ...base, extension: { windowMs: 480000, firedAtMs: 480722, status: 'busy', extended: true, extendedToMs: 912000 } }))
      .toBe(`${before} — window extended once from 480s to 912s at 481s on session busy`);
  });
});
```

- [ ] **Step 3: Run the wiring file; confirm the new tests fail and the renamed pins pass**

Run: `npx jest tests/no-output-backstop-wiring.test.js`
Expected: W1, W2, W5a, W6, W7 (clause), W8 (record), W9 pass or fail exactly as follows — W1/W2/W5a/W6 FAIL (the leg dies at 1 s with no extension), W7 FAILS on the clause, W8 FAILS on the record, W10 FAILS on the clause; W3/W4/W9 PASS already (they pin today's behaviour). Every pre-existing test passes with the idle default. If a pre-existing test fails, read it: it was pinning the busy clause on a kill — apply step 2.3.

- [ ] **Step 4: Implement in `src/headless.js`**

(a) Requires (≈ line 29): extend the existing `require('./utils/no-output-backstop')` destructure to also take `decideBackstopExtension, isBackstopRecord, formatBackstopExtensionClause`.

(b) `formatNoOutputBackstopReason` — add the parameter and the fourth clause, and one sentence to its docblock ("#251 item 1 adds a FOURTH clause on the same terms, after the session clause: `formatBackstopExtensionClause(extension)`, '' whenever the record has nothing to say."):

```js
function formatNoOutputBackstopReason({ ms, fromEnv, engineLogExcerpt, engineSkew, sessionStatus, extension }) {
  // … the existing body unchanged down to the return …
  return `${quoted}${formatSkewSuffix(engineSkew)}${formatSessionStatusSuffix(sessionStatus)}${formatBackstopExtensionClause(extension)}`;
}
```

(c) Inside `runHeadless`, beside `let backstopFired = false;` add `let backstopRecord = null;` and change the closure so it can take a status already read and the record, and reports the window IN FORCE:

```js
    const noOutputBackstopReason = async ({ sessionStatus, extension } = {}) => formatNoOutputBackstopReason({
      // #251 item 1: the window in force at the kill — after an extension that is the
      // extended window, because "no output in 480s" would be false for a leg silent for 912.
      ms: (extension && extension.extended) ? extension.extendedToMs : noOutputBackstopMs,
      fromEnv: backstopFromEnv,
      engineLogExcerpt: engineErrorExcerptSafe(sessionId, options._engineLog),
      engineSkew: currentEngineSkew(client),
      // One HTTP call per kill: a caller that already read the status for the DECISION
      // passes it; the pre-send site and a second firing read here as before.
      sessionStatus: sessionStatus || await sessionStatusSafe(getSessionStatus, client, sessionId, dirArgs, statusProbeMs),
      extension,
    });
```

(d) The pre-send catch (the `isBackstopTimeout` branch): after `backstopFired = true;`, read the status once and record it (plan R-P3), then keep the existing seeding but pass both in:

```js
      backstopFired = true;
      // #251 item 1 (spec §3, ruling R3): this site never extends — the engine did not return
      // from the prompt-send call, upstream of any provider stream. Read the status once for the
      // record and the report; the clause renderer emits nothing for `why: 'pre-send'`, so the
      // string is byte-identical to 4.12.0's (pinned: W8).
      const preSendStatus = await sessionStatusSafe(getSessionStatus, client, sessionId, dirArgs, statusProbeMs);
      backstopRecord = decideBackstopExtension({
        status: preSendStatus, windowMs: noOutputBackstopMs, firedAtMs: Date.now() - outputClockStartedAt,
        legTimeoutMs: timeoutMs, clockStartedAt: outputClockStartedAt,
      }).record;
      backstopRecord = { ...backstopRecord, extended: false, why: 'pre-send' };
      delete backstopRecord.extendedToMs; delete backstopRecord.retryNextIso;
      sessionError = await noOutputBackstopReason({ sessionStatus: preSendStatus, extension: backstopRecord });
```

and change the later `if (backstopFired) { sessionError = await noOutputBackstopReason(); }` block (≈ line 900) to `if (backstopFired && !sessionError) { sessionError = await noOutputBackstopReason({ extension: backstopRecord }); }` — the pre-send branch now seeds `sessionError` itself; the guard keeps the block harmless.

(e) The poll-loop firing site — replace the existing block:

```js
        // No-output backstop: one tick per poll. #251 item 1: `fired` is no longer the end of
        // the leg by itself — the engine is asked ONCE what the session is doing, and a busy
        // or retrying session gets exactly one more window (spec 2026-09-18 §3; the table is
        // decideBackstopExtension, tested row by row). A second firing, or any status that is
        // not evidence of life (idle, a probe that could not answer, an arm we do not know),
        // kills as before; the post-loop block below mirrors the timeout path.
        if (noOutputBackstop.tick(substantiveActivity, Date.now()) === 'fired') {
          const firedAtMs = Date.now() - outputClockStartedAt;
          let decisionStatus = null;
          let extendedNow = false;
          if (!backstopRecord) {
            decisionStatus = await sessionStatusSafe(getSessionStatus, client, sessionId, dirArgs, statusProbeMs);
            const decision = decideBackstopExtension({
              status: decisionStatus, windowMs: noOutputBackstopMs, firedAtMs,
              legTimeoutMs: timeoutMs, clockStartedAt: outputClockStartedAt,
            });
            backstopRecord = decision.record;
            extendedNow = decision.extendTo !== null && noOutputBackstop.extend(decision.extendTo);
            if (extendedNow) {
              logger.warn('No-output backstop extended once on session status', {
                taskId, sessionId, status: backstopRecord.status, fromMs: noOutputBackstopMs,
                toMs: backstopRecord.extendedToMs, atMs: firedAtMs,
              });
            }
          }
          if (!extendedNow) {
            backstopFired = true;
            sessionError = await noOutputBackstopReason({ sessionStatus: decisionStatus, extension: backstopRecord });
            logger.warn('No-output backstop fired', { taskId, backstopMs: noOutputBackstop.deadline() - outputClockStartedAt });
            break;
          }
        }
```

(`decisionStatus` is `null` on the second firing, so the closure reads afresh for the report — spec §3 step 6.)

(f) The three returns: beside each `...(isMeasuredTtft(ttftMs) ? { ttftMs } : {}),` add
`...(isBackstopRecord(backstopRecord) ? { backstop: backstopRecord } : {}),` — the `failedWithNoUsableOutput` return, the success return, and the outer `catch` return (declare `backstopRecord` where `ttftMs` is declared at function scope, ≈ line 610, so the catch can see it: `let backstopRecord = null;` there instead of inside the try — one declaration only).

(g) Sweep this file's own sentences: the comment at the old firing site ("Fired is terminal — break the loop") is replaced by (e); grep `headless.js` for `terminal` near `backstop` and for `sessionStatusSafe` mentions that say the status is read "at the two firing sites and nowhere else" (the `noOutputBackstopReason` docblock says exactly that — amend it: "…and, since #251 item 1, once more at the poll-loop site for the extension DECISION; a living leg still makes no extra call").

- [ ] **Step 5: Run the wiring file, then the headless family, then compare durations**

Run: `npx jest tests/no-output-backstop-wiring.test.js`
Expected: all PASS.
Run: `npx jest tests/no-output-backstop-wiring.test.js tests/headless-output-length.test.js tests/headless-variant.test.js tests/headless.test.js tests/headless-idle-completion.test.js tests/headless-tool-stall.test.js tests/headless-poll-failures.test.js tests/observe/usage-settle.test.js tests/observe/premature-completion.test.js tests/observe/early-return-terminal.test.js tests/observe/progress-usage-wiring.test.js tests/shared-server-directory-scope.test.js`
Expected: all PASS. Compare each file's time with Step 1. Report every file whose time changed by more than ~30 % and name the test(s) responsible (a test that sets a small `noOutputBackstopMs` with the busy default now extends).

- [ ] **Step 6: Run the named mutants**

For IDLEEXTENDS, TWICE, PRESENDEXTENDS (as named in the tests): apply the edit, run the ONE test file that names it, confirm RED, revert (use `git stash` / `git checkout -- <file>` ONLY after committing your green tree — never on uncommitted work). Record each mutant's result (which test reddened) in the report.

- [ ] **Step 7: Full suite, measure, commit**

Run: `npm test` (expect exit 0; report the totals). `wc -l src/headless.js`.

```bash
git add src/headless.js tests/no-output-backstop-wiring.test.js docs/architecture-map.md
git commit -m "feat(headless): consult the session before the no-output kill; extend once on busy/retry, never on unknown; record the case (#251)"
```

---

### Task 3: The record rides every leg document the `finish` field rides

**Files:**
- Modify: `src/sidecar/session-finalize.js` (add + export `stampBackstop`; error branch; `finalizeSession` opts)
- Modify: `src/sidecar/session-utils.js :: finalizeSession` (the `opts.finish` line's sibling)
- Modify: `src/sidecar/fanout-leg.js` (`legPatch`, the `finish:` line's sibling)
- Modify: `src/sidecar/start.js`, `src/sidecar/continue.js`, `src/sidecar/resume.js` (error branch stamp; `finalizeSession` opts; resume's reopen delete line)
- Test: `tests/shared-server-finalize.test.js`, `tests/sidecar/session-utils.test.js`, `tests/sidecar/fanout.test.js`, `tests/start-terminal-status.test.js`, `tests/continue-resume-spend.test.js`, `tests/sidecar/resume.test.js`

**Interfaces:**
- Consumes (Task 1): `isBackstopRecord`. (Task 2): `result.backstop`.
- Produces: `session-finalize.js :: stampBackstop(meta, result)` — sets `meta.backstop = result.backstop` when `result && isBackstopRecord(result.backstop)`, else `delete meta.backstop`; returns nothing. `finalizeSession(sessionDir, summary, project, metadata, opts)` honours `opts.backstop` by the same rule. Leg documents and wave docs carry `backstop` when the leg result did.

- [ ] **Step 1: Write the failing pins — one per writer, each mirroring the `finish` pin already in that file**

Use a shared fixture in each test file:

```js
const REC = { windowMs: 480000, firedAtMs: 480722, status: 'busy', extended: true, extendedToMs: 912000 };
const FORGED = { windowMs: 'x', extended: 'yes' };
```

1. `tests/shared-server-finalize.test.js` — beside the three `finish` tests (≈ lines 76–98):
```js
  it('#251 item 1: an error run carries its backstop record; a forged one is dropped; a stale one is REMOVED', () => {
    // Named mutant "SHAREDNOBACKSTOP": drop the `stampBackstop(metadata, result)` line in finalizeHeadlessResult's error branch.
    const md1 = { status: 'running' };
    finalizeHeadlessResult(dir, { error: 'NO_OUTPUT_BACKSTOP: …', backstop: REC }, project, md1);
    expect(readMeta().backstop).toEqual(REC);
    const md2 = { status: 'running', backstop: REC };
    finalizeHeadlessResult(dir, { error: 'boom', backstop: FORGED }, project, md2);
    expect('backstop' in readMeta()).toBe(false);
  });
  it('#251 item 1: a completed run that was extended keeps the record through finalizeSession', () => {
    finalizeHeadlessResult(dir, { completed: true, summary: 'ok', backstop: REC }, project, { status: 'running' });
    expect(readMeta().backstop).toEqual(REC);
  });
```
(`dir`, `project`, `readMeta` are whatever that file already uses for the `finish` tests — read those tests first and use their exact helpers.)

2. `tests/sidecar/session-utils.test.js` — beside STALEVARIANT / SOLOVARIANTDROPPED (≈ lines 305–320): `finalizeSession(dir, 'summary', project, { backstop: REC }, { status: 'complete' })` → key removed (named mutant "STALEBACKSTOP": drop the `else { delete metadata.backstop; }`); `finalizeSession(dir, 'summary', project, {}, { status: 'complete', backstop: REC })` → `metadata.backstop` equals REC (named mutant "SOLOBACKSTOPDROPPED": drop the set); `opts.backstop = FORGED` → key absent.

3. `tests/sidecar/fanout.test.js` — beside the `finish` threading test at ≈ line 589: two legs, the first's runHeadless mock returning `{ ...legOk(taskId), backstop: REC }`, the second `legOk(taskId)`; assert `legMeta1.backstop` equals REC and `wave.legs[0].backstop` equals REC; `'backstop' in legMeta2` is false. Named mutant "LEGBACKSTOPDROPPED": drop the `backstop:` line in `legPatch`.

4. `tests/start-terminal-status.test.js` — beside SOLOERRORNOFINISH (≈ line 138): a `NO_OUTPUT_BACKSTOP` error result carrying `backstop: REC` → `metadata.backstop` equals REC (named mutant "SOLOERRORNOBACKSTOP": drop the `stampBackstop(meta, result)` line in start.js's error branch); a completed result with no backstop → key absent.

5. `tests/continue-resume-spend.test.js` — beside CONTINUEERRORNOVARIANT: the continue error branch stamps `backstop` (named mutant "CONTINUEERRORNOBACKSTOP").

6. `tests/sidecar/resume.test.js` — beside RESUMESTALEVARIANT: a resumed session whose prior metadata carries `backstop: REC` and whose new run returns no record → the key is gone on reopen and stays gone at the terminal write (named mutant "RESUMESTALEBACKSTOP": drop `delete meta.backstop` from the reopen line); a resumed run that dies with `backstop: REC` → stamped (named mutant "RESUMEERRORNOBACKSTOP").

- [ ] **Step 2: Run the six files; confirm the new tests fail, everything else passes**

Run: `npx jest tests/shared-server-finalize.test.js tests/sidecar/session-utils.test.js tests/sidecar/fanout.test.js tests/start-terminal-status.test.js tests/continue-resume-spend.test.js tests/sidecar/resume.test.js`
Expected: exactly the new tests FAIL (`stampBackstop is not a function`, `expected REC, received undefined`).

- [ ] **Step 3: Implement**

`src/sidecar/session-finalize.js` — add after `resolveTerminalState`:

```js
/**
 * #251 item 1: copy a leg result's backstop record onto metadata, or REMOVE a
 * stale one — the same emit-when-set / delete-when-absent rule `finish` and
 * `variant` follow (council #232 r1 B1), in one place for the four solo error
 * branches (start, continue, resume, the shared-server path) that used to each
 * spell their own copy of that rule. A forged or partial object is dropped.
 * @param {object} meta - mutated
 * @param {{backstop?: *}|null} result
 */
function stampBackstop(meta, result) {
  const { isBackstopRecord } = require('../utils/no-output-backstop');
  if (result && isBackstopRecord(result.backstop)) { meta.backstop = result.backstop; } else { delete meta.backstop; }
}
```
In `finalizeHeadlessResult`'s error branch, after the `metadata.variantUnverified` line: `stampBackstop(metadata, result);`. In its `finalizeSession(...)` call, add `backstop: result && result.backstop` to the opts object. Export: `module.exports = { resolveTerminalState, finalizeHeadlessResult, stampBackstop };`.

`src/sidecar/session-utils.js :: finalizeSession` — after the `opts.variantUnverified` line:
```js
  const { isBackstopRecord } = require('../utils/no-output-backstop'); // #251 item 1
  if (isBackstopRecord(opts.backstop)) { metadata.backstop = opts.backstop; } else { delete metadata.backstop; } // same rule as finish (named mutants "SOLOBACKSTOPDROPPED" / "STALEBACKSTOP", tests/sidecar/session-utils.test.js)
```
(If the file has a top-level require block for `../utils/*`, put the require there instead; keep the file ≤ 275 lines either way.)

`src/sidecar/fanout-leg.js` — in `legPatch`, after the `finish:` line:
```js
    // #251 item 1: the backstop's decision record (extended / at-cap / …), emit-when-valid. Named mutant "LEGBACKSTOPDROPPED" (tests/sidecar/fanout.test.js).
    backstop: (result && isBackstopRecord(result.backstop)) ? result.backstop : undefined,
```
with `isBackstopRecord` added to the file's existing `require('../utils/no-output-backstop')` if it has one, else to the require block near the `isMeasuredTtft` import (line ≈ 17).

`src/sidecar/start.js` / `continue.js` / `resume.js` — in each error branch, after the `variantUnverified` line: `stampBackstop(meta, result);` (resume: `stampBackstop(updatedMetadata, result);`), with the destructure on the existing lazy require line: `const { resolveTerminalState, stampBackstop } = require('./session-finalize');`. In each `finalizeSession(...)` opts object append `, backstop: result && result.backstop`. `resume.js` reopen line (≈ 122): `delete meta.finish; delete meta.variant; delete meta.variantUnverified; delete meta.backstop;` — SAME line. Amend the comment above it that names the "three deletes" → "four deletes".

- [ ] **Step 4: Run the six files, the mutants, the sizes**

Run the six files: all PASS. Apply and revert each named mutant (after committing? — no: run mutants against the WORKING tree only after `git stash`-free discipline: commit first (Step 5), then mutate, run, `git checkout -- <file>`, and amend nothing). `wc -l` on all six source files; `resume.js` must read ≤ 300.

- [ ] **Step 5: Full suite and commit**

Run: `npm test` (exit 0; totals in the report).

```bash
git add src/sidecar/session-finalize.js src/sidecar/session-utils.js src/sidecar/fanout-leg.js src/sidecar/start.js src/sidecar/continue.js src/sidecar/resume.js tests/shared-server-finalize.test.js tests/sidecar/session-utils.test.js tests/sidecar/fanout.test.js tests/start-terminal-status.test.js tests/continue-resume-spend.test.js tests/sidecar/resume.test.js docs/architecture-map.md
git commit -m "feat(sidecar): the backstop record rides every leg document the finish field rides (#251)"
```
Then run the six mutants from Step 4 against the committed tree and add their results to the report.

---

### Task 4: The promises — CHANGELOG, docs, the CI comment, the workflow pin

**Files:**
- Modify: `CHANGELOG.md` (`[Unreleased] ### Changed`, a new bullet ABOVE the #266 one)
- Modify: `docs/troubleshooting.md` (the `## Headless Leg Fails with \`NO_OUTPUT_BACKSTOP\`` section)
- Modify: `docs/council.md` (the "Leg completion and `session.status`" paragraph)
- Modify: `docs/configuration.md` (the `AMICUS_NO_OUTPUT_BACKSTOP_MS` table row)
- Modify: `skills/second-opinion/MODEL-NOTES.md` (the `NO_OUTPUT_BACKSTOP` bullet and its `_Last updated_` line)
- Modify: `.github/workflows/council-review.yml` (comment lines only, in the block above `AMICUS_NO_OUTPUT_BACKSTOP_MS: '480000'`)
- Modify: `docs/usage.md` (the `SILENT` row, ≈ line 442) and `src/headless.js` (four rotted line citations in comments → symbol anchors; comments only)
- Test: `tests/scripts/council-review-workflow.test.js` (inside `describe('no-output backstop headroom (v4.9 W13 Task B)')`)

**Interfaces:**
- Consumes: `extendWindowMs` (Task 1). Produces: nothing code-facing.

- [ ] **Step 1: Write the failing workflow pin**

Inside the `no-output backstop headroom` describe, after the "still fires first" test:

```js
    test('#251 item 1: one extension of the first attempt still fires before the leg cap, and the retry leg has no room to extend — both derived from the workflow\'s own values', () => {
      const { extendWindowMs } = require('../../src/utils/no-output-backstop');
      const cmd = councilRunCommand();
      const ms = Number(cmd.match(/AMICUS_NO_OUTPUT_BACKSTOP_MS: '(\d+)'/)[1]);
      const legCap = Number(cmd.match(/--timeout (\d+)/)[1]) * 60 * 1000;
      const extended = extendWindowMs(ms, legCap);
      expect(extended).toBeGreaterThan(ms);          // the first attempt CAN be extended in CI …
      expect(extended).toBeLessThan(legCap);         // … and still dies under its own name, not `timeout`
      expect(extendWindowMs(extended, legCap)).toBe(extended); // the retry (already at that window) cannot: `at-cap`
      // The worst-case pin above is unchanged by design: its first term is already legCap.
    });
```

Run: `npx jest tests/scripts/council-review-workflow.test.js` — the new test PASSES already (Task 1 shipped the function): it is a preservation pin on CI's geometry. Its named mutant is the workflow value: change `--timeout 16` to `--timeout 8` in a scratch copy and confirm `extended < legCap` fails (480 000 vs 456 000 → passes; the FIRST assertion `extended > ms` fails). Record it.

- [ ] **Step 2: The CHANGELOG bullet**

Under `## [Unreleased]` → `### Changed`, as the FIRST bullet:

```markdown
- **The no-output backstop asks the engine before it kills, and gives a busy session one more
  window.** At its deadline a leg that has produced nothing now reads the engine's `session.status`
  once: `busy` or `retry` (with the next attempt inside reach) extends the window exactly once —
  doubled and clamped strictly below the leg `--timeout`, the Stage-1 retry's own formula, so the
  named diagnosis survives — and `idle`, an unrecognised arm or a probe that could not answer kills
  as before. The death report says which: `… (session: busy) — window extended once from 480s to
  912s at 481s on session busy`, or `— not extended: the window is already at the leg cap` (the CI
  retry leg, already at 912 s), or `— not extended: the engine schedules its next attempt at …, past
  the extended window`; a kill that was never a candidate is byte-identical to 4.12.0's. Every leg
  the backstop fired for carries a `backstop` record on its document (`windowMs`, `firedAtMs`,
  `status`, `extended`, and `extendedToMs` or `why`) — including a leg the extension SAVED, which
  is how the next corpus counts what the lever bought. Measured motive: on amicus 4.12.0 every one
  of 6 backstop kills across two CI rounds reported `(session: busy)`, and the retries that healed
  them first spoke at 28 s, 133 s and 503 s — the last past the 480 s wall. CI's job worst case is
  unchanged (a streaming first attempt was always bounded by the leg cap, not the backstop); the
  live model probe's 30 s window may now run to 60 s for a session the engine reports busy.
  `AMICUS_NO_OUTPUT_BACKSTOP_MS=0` still disables everything. (#251 item 1; closes #135's adapt half
  when released)
```

- [ ] **Step 3: The docs surfaces (each is a small edit; quote the current sentence in your report beside its replacement)**

1. `docs/troubleshooting.md`, the `NO_OUTPUT_BACKSTOP` section: after the `(session: <status>)` bullet add a fourth bullet:
   ```markdown
   - ` — window extended once from 480s to 912s at 481s on session busy` / ` — not extended: …` (since
     the next minor after 4.12.0, #251 item 1) says what the backstop DID with that answer: a `busy` or
     `retry` session gets one more window (doubled, clamped below `--timeout`), and this clause
     appears only when there was a decision to report — a kill on `idle` or on a probe that could not
     answer has no such clause, and the head of the message then names the window in force (after an
     extension, the extended one). The leg's document carries the same fact as a `backstop` record.
   ```
   and change "Three trailing clauses are the exceptions" → "Four trailing clauses are the exceptions" and "The three clauses are independent" → "The four clauses are independent".
2. `docs/council.md`, the paragraph beginning "A headless leg ends on the first of:" — change "the no-output backstop;" to "the no-output backstop (which, since #251 item 1, asks `session.status` at its deadline and extends once — clamped below `--timeout` — when the engine reports `busy` or `retry`);".
3. `docs/configuration.md`, the `AMICUS_NO_OUTPUT_BACKSTOP_MS` row: after "Disarms permanently on the first sign of activity, so slow cold-prefill local models are unaffected." add "At the deadline the engine is asked once whether the session is busy; `busy`/`retry` buys exactly one more window (doubled, clamped strictly below the leg `--timeout`), `idle` or an unanswered probe does not (#251 item 1)."
4. `skills/second-opinion/MODEL-NOTES.md`, the `NO_OUTPUT_BACKSTOP` bullet: in the sub-bullet "Arms at leg launch, disarms PERMANENTLY on the first substantive tick … Independent of `--timeout`." change "Independent of `--timeout`." to "Independent of `--timeout` — except for the ONE extension (below), which is clamped by it." and add a sub-bullet after the retry-escalation one:
   ```markdown
     - **Since #251 item 1 the first attempt can be extended ONCE.** At the deadline the engine's
       `session.status` is read; `busy` or `retry` (next attempt within reach) re-arms the backstop at
       `extendWindowMs(window, legCap)` = the retry's formula (CI: 480 s → 912 s); `idle`, an unknown
       arm or a probe that could not answer kills at once. The CI retry leg is already at 912 s and
       records `not extended: … leg cap`. Read `backstop` on the leg document (`extended`, `why`) and
       the death report's last clause to tell a saved leg from a delayed death.
   ```
   Update the `_Last updated:_` line's date and add "(the once-only extension, #251 item 1)". Fix the `run-retry-window.js:59` citation there to `src/utils/no-output-backstop.js :: extendWindowMs` (the line moved).
5. `.github/workflows/council-review.yml`, the comment block above `AMICUS_NO_OUTPUT_BACKSTOP_MS: '480000'`: after "the backstop still fires FIRST and a genuinely silent seat is still reported and retried rather than burning the whole wall clock." add:
   ```yaml
          # #251 item 1 (2026-09-18): the window is a FIRST cut, not the last. At 480 s a
          # zero-output leg asks the engine what the session is doing; `busy`/`retry` buys
          # the retry's window once (912 s here — still below --timeout, so the named
          # diagnosis survives), anything else kills at once. Motive: on 4.12.0 all 6
          # backstop kills across PR #266 rounds 2–3 read `(session: busy)`, and their
          # retries first spoke at 28/133/503 s. The job's worst case does not move (the
          # pin in tests/scripts/council-review-workflow.test.js already counts the first
          # attempt at the leg cap). Read the death report's last clause / the leg's
          # `backstop` record to see whether an extension saved a leg or delayed a death.
   ```
6. **Sweep the promises:** run `grep -rn "fired is terminal\|disarms permanently\|Independent of \`--timeout\`\|fires first\|FIRST\b.*backstop\|terminal — break" src docs skills README.md .github CHANGELOG.md` (UNCAPPED — pipe to `wc -l` first, then read every hit). For each hit, decide: still true / amended above / a fence that needs the "⚠️ do not read that as" repair. List every hit and its disposition in the report.
7. **`docs/usage.md`, the `SILENT` row of the `models --check --live` table (≈ line 442):** after "(no output within the probe window)" add " — the probe's 30 s window may run once to 60 s when the engine reports the session busy (#251 item 1); its leg cap is 2 minutes (`src/sidecar/models-probe.js`, `timeout: 2`)". Measured by the controller on `a74ed58c`: `PROBE_WINDOW_MS = 30000`, `timeout: 2`, so `extendWindowMs(30000, 120000) = 60000`.
8. **Rotted line citations in `src/headless.js` comments (pre-existing, found by Task 2):** the comments citing `:413`/`:417` and `:365` for where `sessionId` is assigned, and `headless.js:1295` inside `sessionStatusSafe`'s docblock for the poll loop's own status read, point at lines that moved long ago (`check-citations.js` proves only in-range). Replace each with a symbol anchor: the assignment sites → "`sessionId` is assigned in `runHeadless` at the `createSession`/shared-session branches, well before this return"; the poll-loop read → "`runHeadless`'s poll loop (`if (mirror.output.length > 0)` … `getSessionStatus`)". Comments only; run `npx jest tests/no-output-backstop-wiring.test.js` afterwards to confirm nothing else moved; include `src/headless.js` in this task's commit.

- [ ] **Step 4: Gates and commit**

Run: `npm run validate-docs` and `npm run generate-docs:check` if they exist in `package.json` (read `scripts` first; otherwise `npm test` covers them), then `npm test`.

```bash
git add CHANGELOG.md docs/troubleshooting.md docs/council.md docs/configuration.md skills/second-opinion/MODEL-NOTES.md .github/workflows/council-review.yml tests/scripts/council-review-workflow.test.js
git commit -m "docs(backstop): the once-only extension — CHANGELOG, troubleshooting, council, configuration, MODEL-NOTES, the CI comment, and a workflow pin (#251)"
```

---

## Self-review

**Spec coverage.** §3 table → Task 1 D1–D9 (pure) + Task 2 W1–W8 (wired). §4 formula and identity → Task 1 F1/F2, Task 4's workflow pin. §5.1 clause strings → Task 1 C1/C2, Task 2 W1/W5b/W7/W10. §5.2 record + nine writers → Task 2 (three returns), Task 3 (six files, seven pins). §6 fences → W3/W4/W8/W9 byte-identity, F1's disabled case, the worst-case pin untouched. §7 rulings R1–R9 → R1/R7 Task 1; R2 D3/W5; R3 Task 2(d)+W8; R4 W2; R5/R6 by omission (named in Task 3's file list as excluded); R8 F1's probe row + the CHANGELOG sentence; R9 Task 2 step 2. §9 docs → Task 4.

**Placeholders.** None: every code step carries its code; the three "read the neighbouring test's helpers" instructions in Task 3 name the exact test and mutant beside which the new pin goes.

**Type consistency.** `decideBackstopExtension` takes `{ status, windowMs, firedAtMs, legTimeoutMs, clockStartedAt }` and returns `{ extendTo, record }` in Task 1, Task 2(d)/(e); the record's keys (`windowMs, firedAtMs, status, extended, extendedToMs, why, retryNextIso`) are the same in `isBackstopRecord`, the clause renderer, every test fixture and the CHANGELOG. `stampBackstop(meta, result)` in Task 3 matches its three call sites. `noOutputBackstopReason({ sessionStatus, extension })` matches its three callers in Task 2.

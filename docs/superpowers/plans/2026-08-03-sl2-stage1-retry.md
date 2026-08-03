# SL-2 Stage-1 Once-Only Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dead Stage-1 council wave or leg is relaunched exactly once, serially, after the surviving launches settle — heal announced on recovery, the ordinary degrade (enriched) only when the retry also dies.

**Architecture:** New `src/council/run-retry.js` (grouping + orchestration + note-building) at one seam in `runStage1` (`src/council/run-stages.js`). The retry pass runs BEFORE any dead-wave/dead-leg degrade is noted, because the sink (`run-degrade.js`) never un-flips `degraded.value`. The module emits `stage1-retry` heals itself and returns still-dead facts; the caller notes the degrades. `run.js` is untouched — `runStage1`'s return contract keeps its keys with post-retry contents.

**Tech Stack:** Node.js (CommonJS), jest 29.7.0, eslint, `scripts/check-file-sizes.js` (300-line gate over `src/**` + `electron/**`).

**Spec:** `docs/superpowers/specs/2026-08-03-sl2-stage1-retry-design.md` (D1–D7, §4 flow, §5 voice, §8 criteria). Read it before Task 1.

## Global Constraints

- **Branch:** all work on `feat/sl2-stage1-retry` (spec already on it at `0f18bd4`). Never commit to `main`.
- **300-line gate:** measured at plan time — `run-stages.js` **268**, `run-launch.js` **204**, `degrade.js` **68**. Re-run `npm run check:sizes` in every task; if any touched file approaches 300, extract FIRST (BACKLOG hard-gate rule).
- **The sink invariant:** only `run-degrade.js` may assign `degraded.value`. `run-retry.js` must never touch it — `tests/council/degrade-invariant.test.js` (source scan) enforces this; it must stay green with zero modifications.
- **One voice:** every announced line goes through `ctx.degrade.note` → `formatDegrade`. No bare `process.stderr.write` in new code.
- **D7 byte-identity:** when no retry launches (budget-skipped), the existing dead-wave/dead-leg record fields are byte-identical to today's. Copy the strings from `run-stages.js:136-160` exactly — do not re-word.
- **Schemas:** `channel` is `{"type": "string"}` in all three schema copies (re-measured; no enum) — **no schema edits**; `tests/schemas-degrades-lockstep.test.js` must pass unmodified.
- **Commits:** message style `feat:`/`test:`/`docs:`, body explains why, end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Gates before every commit:** the task's named test files pass; before the final task's push: `npm test && npm run lint && npm run check:sizes` all green.

---

### Task 0: Re-ground the baseline

**Files:** none modified.

- [ ] **Step 1: Confirm the branch and spec**

Run: `git -C C:\Users\sendt\code\amicus branch --show-current && git log --oneline -2`
Expected: `feat/sl2-stage1-retry`, top commit `0f18bd4 docs(spec): SL-2 Stage-1 once-only retry design`.

- [ ] **Step 2: Measure the suite baseline**

Run: `npm test 2>&1 | tail -5`
Record the `Test Suites:` and `Tests:` lines verbatim in your task report. Every later task's delta is accounted against THIS measurement, not any figure from memory or docs (the ENV-7 lesson: a baseline compared against the wrong commit reads as phantom drift).

- [ ] **Step 3: Locate the channel-set test**

Run: `grep -rn "DEGRADE_CHANNELS" tests/ src/`
Expected hits include `src/utils/degrade.js` and at least one test asserting channel validation (likely `tests/utils/degrade.test.js` or `tests/council/run-degrade.test.js`). Note the file — Task 1 extends it.

---

### Task 1: The `stage1-retry` channel (+ spec truth alignment)

**Files:**
- Modify: `src/utils/degrade.js:14-22` (the `DEGRADE_CHANNELS` set)
- Test: the channel-validation test file found in Task 0 Step 3
- Modify: `docs/superpowers/specs/2026-08-03-sl2-stage1-retry-design.md` (§5, §8 criterion 10, §10 — schema-enum claim correction)

**Interfaces:**
- Produces: `makeDegrade({channel: 'stage1-retry', kind: 'heal', ...})` validates; `formatDegrade` renders it with the `Recovered:` lead (already true for any `kind:'heal'`).

- [ ] **Step 1: Write the failing test** (in the file located in Task 0; adjust the require path to match that file's convention)

```js
describe("stage1-retry channel (SL-2)", () => {
  test('makeDegrade accepts a stage1-retry heal', () => {
    const r = makeDegrade({
      channel: 'stage1-retry', kind: 'heal',
      what: 'seat gpt reviewed on retry',
      why: "its first leg ended 'error' with no usable output and was relaunched once",
      effect: 'The seat is in this council; nothing was lost',
      data: { seat: 'gpt' },
    });
    expect(r.kind).toBe('heal');
    expect(r.channel).toBe('stage1-retry');
  });

  test('formatDegrade renders a stage1-retry heal with the Recovered: lead', () => {
    const r = makeDegrade({ channel: 'stage1-retry', kind: 'heal',
      what: 'seat gpt reviewed on retry', why: 'relaunched once',
      effect: 'The seat is in this council; nothing was lost' });
    expect(formatDegrade(r)).toBe(
      'Recovered: seat gpt reviewed on retry — relaunched once. The seat is in this council; nothing was lost.\n');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest <that test file> -t "stage1-retry"`
Expected: FAIL — `degrade: unknown channel 'stage1-retry'`.

- [ ] **Step 3: Add the channel**

In `src/utils/degrade.js`, the council-runtime group of `DEGRADE_CHANNELS` gains one entry:

```js
const DEGRADE_CHANNELS = Object.freeze(new Set([
  // council runtime channels
  'dead-leg', 'dead-wave', 'budget-refusal', 'shared-server-unavailable',
  'dropped-members', 'chair-skipped-cost-ceiling', 'chair-failed',
  'thin-cross-review', 'debate-degraded', 'inexact-under-ceiling',
  'stage1-retry',
  'internal',
  // doctor channels
  'doctor-check-failed', 'doctor-fix',
]));
```

- [ ] **Step 4: Run to verify it passes; lockstep untouched**

Run: `npx jest <that test file> tests/schemas-degrades-lockstep.test.js`
Expected: PASS, lockstep unmodified and green (channel is a free string in the schemas).

- [ ] **Step 5: Correct the spec's schema-enum claim** (measured reality beat the prediction)

In the spec, replace the §5 "Vocabulary ripple" paragraph with:

```markdown
**Vocabulary ripple (corrected at plan time):** add `'stage1-retry'` to `DEGRADE_CHANNELS`
(`src/utils/degrade.js`) only. The three schema copies type `channel` as a free string —
re-measured 2026-08-03 — so no schema edit is needed and
`tests/schemas-degrades-lockstep.test.js` is untouched.
```

In §8 criterion 10, replace with: `'stage1-retry' present in DEGRADE_CHANNELS; the lockstep test passes unmodified.` In §10, drop "three schemas; lockstep test" from the files list.

- [ ] **Step 6: Commit**

```bash
git add src/utils/degrade.js tests/ docs/superpowers/specs/2026-08-03-sl2-stage1-retry-design.md
git commit -m "feat: stage1-retry heal channel in the degrade vocabulary

SL-2's first ripple: the once-only Stage-1 retry announces recoveries as
kind:'heal' on a channel of their own, mirroring doctor's check/fix split.
Schemas type channel as a free string (re-measured), so the spec's predicted
enum edit is corrected rather than performed.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `retryOfWaveId` passthrough in run-launch

**Files:**
- Modify: `src/council/run-launch.js:89-131` (the `fanoutFn` call in `launchWave`)
- Test: `tests/council/run-launch.test.js`

**Interfaces:**
- Consumes: `runFanout`'s existing `retryOfWaveId` option (`src/sidecar/fanout.js:44,263` — tags every leg and its spend-ledger row; also suppresses fanout's own stdout print at `fanout.js:75`, which is already suppressed for council launches by `quiet: true` at `run-launch.js:123`).
- Produces: `launchers.launchWave({..., retryOfWaveId})` / `launchSolo({..., retryOfWaveId})` forward the key to the transport; calls WITHOUT it are byte-identical to today.

- [ ] **Step 1: Write the failing tests** (append to `tests/council/run-launch.test.js`, following its existing fake-`fanoutFn` convention — the deps seam is `createLaunchers({fanoutFn})`)

```js
describe('retryOfWaveId passthrough (SL-2)', () => {
  test('launchWave forwards retryOfWaveId to the transport when present', async () => {
    const fanoutFn = jest.fn().mockResolvedValue({ wave: { waveId: 'r-s1r1', legs: [] }, exitCode: 0 });
    const { launchWave } = createLaunchers({ fanoutFn });
    await launchWave({ models: ['gpt'], prompt: 'p', project: tmpDir(), waveId: 'r-s1r1',
      retryOfWaveId: 'r-s1' });
    expect(fanoutFn.mock.calls[0][0].retryOfWaveId).toBe('r-s1');
  });

  test('a launch without retryOfWaveId sends NO retryOfWaveId key (byte-identical transport call)', async () => {
    const fanoutFn = jest.fn().mockResolvedValue({ wave: { waveId: 'r-s1', legs: [] }, exitCode: 0 });
    const { launchWave } = createLaunchers({ fanoutFn });
    await launchWave({ models: ['gpt'], prompt: 'p', project: tmpDir(), waveId: 'r-s1' });
    expect('retryOfWaveId' in fanoutFn.mock.calls[0][0]).toBe(false);
  });
});
```

(`tmpDir()` = whatever helper the file already uses for `opts.project`; if none, `fs.mkdtempSync(path.join(os.tmpdir(), 'rl-'))`.)

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/council/run-launch.test.js -t "retryOfWaveId"`
Expected: first test FAILS (`undefined` ≠ `'r-s1'`); second passes (key already absent).

- [ ] **Step 3: Add the passthrough** — in `launchWave`'s `fanoutFn({...})` call, directly under the `reserveBudget` spread (`run-launch.js:96`):

```js
      // SL-2: a Stage-1 retry names the wave it replaces; fanout threads this
      // onto every leg and its spend-ledger row (v4.3 --retry-failed machinery).
      // Spread-guarded so a normal launch's transport call stays byte-identical.
      ...(opts.retryOfWaveId ? { retryOfWaveId: opts.retryOfWaveId } : {}),
```

- [ ] **Step 4: Run the whole file to verify green**

Run: `npx jest tests/council/run-launch.test.js`
Expected: PASS, zero failures.

- [ ] **Step 5: Commit**

```bash
git add src/council/run-launch.js tests/council/run-launch.test.js
git commit -m "feat: launchers forward retryOfWaveId to the fanout transport

One spread-guarded line: a Stage-1 retry launch names the wave it replaces,
and the v4.3 --retry-failed machinery tags every leg and ledger row with it.
Non-retry launches stay byte-identical.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `groupStage1Losses` — the pure grouping half of run-retry.js

**Files:**
- Create: `src/council/run-retry.js`
- Test: `tests/council/run-retry.test.js` (new)

**Interfaces:**
- Consumes: `o` (the council options object: `runId`, `models`, `critic`, `lenses`), `deadWaves` entries `{waveId, models, reason}` (shape from `run-stages.js:101-105`), `deadLegs` entries (fanout leg docs: `modelInput|model`, `status`, `error`).
- Produces (Task 4 relies on these exact shapes): `groupStage1Losses(o, deadWaves, deadLegs)` → ordered `Array<Unit>` where `Unit = { unit: 'bench'|'critic'|'lens', lensIndex?: number, waveId: string, retryOfWaveId: string, models: string[], firstFailures: Array<{seat, class: 'wave'|'leg', waveId?, status?, reason?}>, srcWaves: Array<deadWave>, srcLegs: Array<deadLeg> }`. Order: bench, critic, lenses ascending. Empty input → `[]`.

- [ ] **Step 1: Write the failing tests**

```js
// tests/council/run-retry.test.js
'use strict';
jest.mock('../../src/council/run-state', () => ({ appendStageWave: jest.fn() }));
const runState = require('../../src/council/run-state');
const { groupStage1Losses, retryStage1Losses } = require('../../src/council/run-retry');

const O = { runId: 'r1', models: ['a', 'b', 'crit'], critic: 'crit', lenses: null };

describe('groupStage1Losses (SL-2 Task 3)', () => {
  test('empty losses -> no units', () => {
    expect(groupStage1Losses(O, [], [])).toEqual([]);
  });

  test('a dead bench wave becomes one bench retry unit with per-seat wave-class firstFailures', () => {
    const w = { waveId: 'r1-s1', models: ['a', 'b'], reason: 'server never started' };
    const [u] = groupStage1Losses(O, [w], []);
    expect(u).toMatchObject({ unit: 'bench', waveId: 'r1-s1r1', retryOfWaveId: 'r1-s1',
      models: ['a', 'b'], srcWaves: [w], srcLegs: [] });
    expect(u.firstFailures).toEqual([
      { seat: 'a', class: 'wave', waveId: 'r1-s1', reason: 'server never started' },
      { seat: 'b', class: 'wave', waveId: 'r1-s1', reason: 'server never started' },
    ]);
  });

  test('dead bench legs batch into ONE bench unit; the critic leg gets its own solo unit', () => {
    const la = { modelInput: 'a', status: 'error', error: 'boom' };
    const lc = { modelInput: 'crit', status: 'timeout', error: null };
    const units = groupStage1Losses(O, [], [la, lc]);
    expect(units.map(u => u.unit)).toEqual(['bench', 'critic']); // stable order
    expect(units[0]).toMatchObject({ waveId: 'r1-s1r1', retryOfWaveId: 'r1-s1', models: ['a'], srcLegs: [la] });
    expect(units[1]).toMatchObject({ waveId: 'r1-c1r1', retryOfWaveId: 'r1-c1', models: ['crit'], srcLegs: [lc] });
    expect(units[1].firstFailures).toEqual([{ seat: 'crit', class: 'leg', status: 'timeout', reason: null }]);
  });

  test('a dead critic WAVE maps to the critic unit by waveId or by model (both carriers)', () => {
    const byId = groupStage1Losses(O, [{ waveId: 'r1-c1', models: ['crit'], reason: 'x' }], []);
    const byModel = groupStage1Losses(O, [{ waveId: 'weird', models: ['crit'], reason: 'x' }], []);
    expect(byId[0].unit).toBe('critic');
    expect(byModel[0].unit).toBe('critic');
  });

  test('lens mode: each dead lens solo retries as its own unit, ascending', () => {
    const OL = { runId: 'r1', models: ['m1', 'm2'], critic: null, lenses: ['security', 'perf'] };
    const units = groupStage1Losses(OL,
      [{ waveId: 'r1-l2', models: ['m2'], reason: 'x' }],
      [{ modelInput: 'm1', status: 'error', error: 'e' }]);
    expect(units.map(u => [u.unit, u.lensIndex, u.waveId, u.retryOfWaveId])).toEqual([
      ['lens', 1, 'r1-l1r1', 'r1-l1'], ['lens', 2, 'r1-l2r1', 'r1-l2']]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/council/run-retry.test.js`
Expected: FAIL — `Cannot find module '../../src/council/run-retry'`.

- [ ] **Step 3: Create the module with the grouping half**

```js
// src/council/run-retry.js
'use strict';

/**
 * @module council/run-retry
 * SL-2 (spec: docs/superpowers/specs/2026-08-03-sl2-stage1-retry-design.md):
 * the Stage-1 once-only retry pass. A sub-wave that died before its legs
 * existed, or a leg that ended with no usable output, is relaunched exactly
 * once — serially, after every surviving launch settled — and the outcome is
 * announced in the one voice: a `stage1-retry` HEAL per recovered seat; the
 * ordinary dead-wave/dead-leg degrade, noted by the CALLER (run-stages.js),
 * when the retry also died. This module emits heals only — it never notes a
 * degrade and never touches `degraded.value`, so the sink invariant holds by
 * construction. No retry of a retry: the pass consumes first-attempt losses
 * only.
 */

const { materializeReviews, isAbortExit } = require('./run-launch');
const briefings = require('./briefings');
const runState = require('./run-state');

/** 1-based lens index for a loss, from the waveId convention or the model. */
function lensIndexOf(o, waveId, model) {
  const m = /-l(\d+)$/.exec(waveId || '');
  if (m) { return Number(m[1]); }
  const i = (o.models || []).indexOf(model);
  return i === -1 ? null : i + 1;
}

/**
 * Group Stage-1 losses into retry units. Pure — no I/O.
 * Bench losses (a dead bench wave's models + dead bench legs) collapse into
 * ONE retry wave; the critic and each lens retry as solos (their briefings
 * differ). Stable order: bench, critic, lenses ascending. The critic matches
 * on EITHER carrier — waveId convention or model — mirroring
 * verdict.js summarizeSeatLoss.
 */
function groupStage1Losses(o, deadWaves = [], deadLegs = []) {
  const isCriticWave = (w) =>
    w.waveId === `${o.runId}-c1` || (!!o.critic && (w.models || []).includes(o.critic));
  const bench = { unit: 'bench', waveId: `${o.runId}-s1r1`, retryOfWaveId: `${o.runId}-s1`,
    models: [], firstFailures: [], srcWaves: [], srcLegs: [] };
  const lensUnits = new Map(); // lensIndex -> unit
  const criticUnit = { unit: 'critic', waveId: `${o.runId}-c1r1`, retryOfWaveId: `${o.runId}-c1`,
    models: o.critic ? [o.critic] : [], firstFailures: [], srcWaves: [], srcLegs: [] };

  const lensUnitFor = (i) => {
    if (!lensUnits.has(i)) {
      lensUnits.set(i, { unit: 'lens', lensIndex: i, waveId: `${o.runId}-l${i}r1`,
        retryOfWaveId: `${o.runId}-l${i}`, models: [], firstFailures: [], srcWaves: [], srcLegs: [] });
    }
    return lensUnits.get(i);
  };

  for (const w of deadWaves) {
    const models = w.models || [];
    if (o.lenses) {
      const u = lensUnitFor(lensIndexOf(o, w.waveId, models[0]));
      u.models.push(...models);
      u.srcWaves.push(w);
      u.firstFailures.push(...models.map(seat => ({ seat, class: 'wave', waveId: w.waveId, reason: w.reason })));
    } else if (isCriticWave(w)) {
      criticUnit.srcWaves.push(w);
      criticUnit.firstFailures.push({ seat: o.critic, class: 'wave', waveId: w.waveId, reason: w.reason });
    } else {
      bench.models.push(...models);
      bench.srcWaves.push(w);
      bench.firstFailures.push(...models.map(seat => ({ seat, class: 'wave', waveId: w.waveId, reason: w.reason })));
    }
  }
  for (const leg of deadLegs) {
    const seat = leg.modelInput || leg.model;
    const ff = { seat, class: 'leg', status: leg.status, reason: leg.error || null };
    if (o.lenses) {
      const u = lensUnitFor(lensIndexOf(o, null, seat));
      u.models.push(seat);
      u.srcLegs.push(leg);
      u.firstFailures.push(ff);
    } else if (o.critic && seat === o.critic) {
      criticUnit.srcLegs.push(leg);
      criticUnit.firstFailures.push(ff);
    } else {
      bench.models.push(seat);
      bench.srcLegs.push(leg);
      bench.firstFailures.push(ff);
    }
  }

  const out = [];
  if (bench.firstFailures.length > 0) { out.push(bench); }
  if (criticUnit.firstFailures.length > 0) { out.push(criticUnit); }
  out.push(...[...lensUnits.values()].sort((a, b) => a.lensIndex - b.lensIndex));
  return out;
}

module.exports = { groupStage1Losses };
```

- [ ] **Step 4: Run to verify green**

Run: `npx jest tests/council/run-retry.test.js -t "groupStage1Losses"`
Expected: PASS. (The `retryStage1Losses` import is `undefined` until Task 4 — keep its tests out of this commit.)

- [ ] **Step 5: Commit**

```bash
git add src/council/run-retry.js tests/council/run-retry.test.js
git commit -m "feat: groupStage1Losses — pure grouping half of the SL-2 retry pass

Bench losses collapse into one retry wave; critic and lenses retry as solos
with their own briefings; stable bench/critic/lens order; both critic
carriers honored (waveId convention or model, mirroring summarizeSeatLoss).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `retryStage1Losses` — the orchestration half

**Files:**
- Modify: `src/council/run-retry.js`
- Test: `tests/council/run-retry.test.js`

**Interfaces:**
- Consumes: `ctx` from run.js as run-stages already receives it — uses exactly `ctx.o`, `ctx.launchers.launchWave/launchSolo` (Task 2 signatures incl. `retryOfWaveId`), `ctx.degrade.note`, `ctx.addWave`, `ctx.overBudget`. Plus `counts: {reviewed, total}` (the FIRST attempt's materialized/leg counts, for D-effect text parity).
- Produces (Task 5 relies on): `retryStage1Losses(ctx, {deadWaves, deadLegs, counts}) -> Promise<{aborted: number|null, recoveredLegs: Array<leg>, stillDeadNotes: Array<noteInput>, stillDeadWaves: Array<{waveId,models,reason}>, stillDeadLegs: Array<leg>, skippedDeadWaves: Array<deadWave>, skippedDeadLegs: Array<deadLeg>}>`. `stillDeadNotes` entries are ready for `ctx.degrade.note(...)` verbatim. On abort: `{aborted: <code>}` with every array empty-or-partial; caller returns immediately.

- [ ] **Step 1: Write the failing tests** (append; the fake-ctx helper at top of the new describe)

```js
const fs = require('fs');
const os = require('os');
const path = require('path');

function fakeCtx(oOverrides = {}, opts = {}) {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl2-'));
  const notes = [];
  return {
    o: { runId: 'r1', runDir, models: ['a', 'b', 'crit'], critic: 'crit', lenses: null,
      briefing: 'B', date: 'D', timeout: 5, gateway: undefined, noValidateModel: false,
      noCostGate: false, councilName: null, fallback: null, catalog: null, ...oOverrides },
    launchers: { launchWave: opts.launchWave || jest.fn(), launchSolo: opts.launchSolo || jest.fn() },
    degrade: { note: (r) => notes.push(r) },
    addWave: jest.fn(),
    overBudget: opts.overBudget || (() => false),
    _notes: notes,
  };
}
const usableLeg = (m) => ({ modelInput: m, status: 'complete', summary: `review by ${m}` });
const deadLeg = (m, status = 'error', error = 'boom') => ({ modelInput: m, status, error });
const COUNTS = { reviewed: 1, total: 3 };

describe('retryStage1Losses (SL-2 Task 4)', () => {
  test('recovery: heal per seat, recovered legs returned, no still-dead output', async () => {
    const launchWave = jest.fn().mockResolvedValue(
      { wave: { waveId: 'r1-s1r1', legs: [usableLeg('a'), usableLeg('b')] }, exitCode: 0 });
    const ctx = fakeCtx({}, { launchWave });
    const r = await retryStage1Losses(ctx, {
      deadWaves: [{ waveId: 'r1-s1', models: ['a', 'b'], reason: 'died' }], deadLegs: [], counts: COUNTS });
    expect(r.aborted).toBeNull();
    expect(r.recoveredLegs).toHaveLength(2);
    expect(r.stillDeadNotes).toEqual([]);
    expect(r.stillDeadWaves).toEqual([]);
    expect(ctx._notes).toHaveLength(2);
    expect(ctx._notes[0]).toMatchObject({ channel: 'stage1-retry', kind: 'heal',
      what: 'seat a reviewed on retry',
      why: "its first wave r1-s1 produced no legs (died) and was relaunched once",
      effect: 'The seat is in this council; nothing was lost' });
    expect(ctx._notes[0].data).toMatchObject({ seat: 'a', retryWaveId: 'r1-s1r1', retryOfWaveId: 'r1-s1' });
    // budget + abort-cascade wiring
    expect(ctx.addWave).toHaveBeenCalledWith(launchWave.mock.calls[0] && (await launchWave.mock.results[0].value).wave);
    expect(runState.appendStageWave).toHaveBeenCalledWith(ctx.o.runDir, 'stage1', 'r1-s1r1');
    expect(launchWave.mock.calls[0][0].retryOfWaveId).toBe('r1-s1');
  });

  test('appendStageWave is called BEFORE the launcher (abort cascade reaches the retry)', async () => {
    const order = [];
    runState.appendStageWave.mockImplementation(() => order.push('append'));
    const launchWave = jest.fn().mockImplementation(async () => { order.push('launch');
      return { wave: { waveId: 'r1-s1r1', legs: [usableLeg('a')] }, exitCode: 0 }; });
    const ctx = fakeCtx({}, { launchWave });
    await retryStage1Losses(ctx, { deadWaves: [{ waveId: 'r1-s1', models: ['a'], reason: 'x' }],
      deadLegs: [], counts: COUNTS });
    expect(order).toEqual(['append', 'launch']);
  });

  test('retry wave dies wholesale (wave-origin): wave-granularity note, enriched why, original texts preserved', async () => {
    const launchWave = jest.fn().mockResolvedValue({ wave: { waveId: 'r1-s1r1', legs: [] }, exitCode: 0 });
    const ctx = fakeCtx({}, { launchWave });
    const r = await retryStage1Losses(ctx, {
      deadWaves: [{ waveId: 'r1-s1', models: ['a', 'b'], reason: 'died' }], deadLegs: [], counts: COUNTS });
    expect(ctx._notes).toEqual([]); // NEVER notes degrades itself
    expect(r.stillDeadNotes).toHaveLength(1);
    expect(r.stillDeadNotes[0]).toMatchObject({ channel: 'dead-wave',
      what: 'Stage-1 wave r1-s1 (a, b) produced NO legs',
      why: 'died; the once-only retry wave also produced no legs' });
    expect(r.stillDeadWaves).toEqual([{ waveId: 'r1-s1', models: ['a', 'b'], reason: 'died' }]);
  });

  test('leg-origin, retry leg dies: dead-leg note names BOTH attempts; recovered sibling heals', async () => {
    const launchWave = jest.fn().mockResolvedValue(
      { wave: { waveId: 'r1-s1r1', legs: [usableLeg('a'), deadLeg('b', 'timeout', null)] }, exitCode: 0 });
    const ctx = fakeCtx({}, { launchWave });
    const r = await retryStage1Losses(ctx, { deadWaves: [],
      deadLegs: [deadLeg('a'), deadLeg('b')], counts: COUNTS });
    expect(r.recoveredLegs.map(l => l.modelInput)).toEqual(['a']);
    expect(ctx._notes).toHaveLength(1); // a's heal
    expect(r.stillDeadNotes).toHaveLength(1);
    expect(r.stillDeadNotes[0]).toMatchObject({ channel: 'dead-leg', what: 'seat b did not review',
      why: "the leg ended 'error': boom with no usable output; its once-only retry also ended 'timeout'",
      effect: '1 of 3 seats reviewed; the run continues with the bench that did and will exit degraded (2)' });
    expect(r.stillDeadLegs.map(l => l.modelInput)).toEqual(['b']);
  });

  test('wave-origin seat whose retry LEG dies: dead-leg granularity naming both attempts (D5)', async () => {
    const launchWave = jest.fn().mockResolvedValue(
      { wave: { waveId: 'r1-s1r1', legs: [deadLeg('a', 'error', 'again')] }, exitCode: 0 });
    const ctx = fakeCtx({}, { launchWave });
    const r = await retryStage1Losses(ctx, {
      deadWaves: [{ waveId: 'r1-s1', models: ['a'], reason: 'died' }], deadLegs: [], counts: COUNTS });
    expect(r.stillDeadNotes[0]).toMatchObject({ channel: 'dead-leg',
      why: "its first wave r1-s1 produced no legs (died); its once-only retry leg ended 'error' with no usable output" });
    expect(r.stillDeadWaves).toEqual([{ waveId: 'r1-s1', models: ['a'], reason: 'died' }]);
  });

  test('critic retries as a SOLO with launchSolo; heal keys deriveSeatLoss-compatible data', async () => {
    const launchSolo = jest.fn().mockResolvedValue(
      { wave: { waveId: 'r1-c1r1', legs: [usableLeg('crit')] }, exitCode: 0, leg: usableLeg('crit') });
    const ctx = fakeCtx({}, { launchSolo });
    const r = await retryStage1Losses(ctx, { deadWaves: [], deadLegs: [deadLeg('crit')], counts: COUNTS });
    expect(launchSolo).toHaveBeenCalledTimes(1);
    expect(launchSolo.mock.calls[0][0]).toMatchObject({ model: 'crit', waveId: 'r1-c1r1', retryOfWaveId: 'r1-c1' });
    expect(r.recoveredLegs).toHaveLength(1);
    expect(ctx._notes[0].data.seat).toBe('crit');
  });

  test('sequential launch: the critic solo launches only after the bench retry settles', async () => {
    const order = [];
    const launchWave = jest.fn().mockImplementation(async () => { order.push('bench');
      return { wave: { waveId: 'r1-s1r1', legs: [usableLeg('a')] }, exitCode: 0 }; });
    const launchSolo = jest.fn().mockImplementation(async () => { order.push('critic');
      return { wave: { waveId: 'r1-c1r1', legs: [usableLeg('crit')] }, exitCode: 0 }; });
    const ctx = fakeCtx({}, { launchWave, launchSolo });
    await retryStage1Losses(ctx, { deadWaves: [], deadLegs: [deadLeg('a'), deadLeg('crit')], counts: COUNTS });
    expect(order).toEqual(['bench', 'critic']);
  });

  test('overBudget pre-gate (D7): unit skipped, original entries routed back untouched, no launch', async () => {
    const launchWave = jest.fn();
    const ctx = fakeCtx({}, { launchWave, overBudget: () => true });
    const w = { waveId: 'r1-s1', models: ['a'], reason: 'died' };
    const l = deadLeg('crit');
    const r = await retryStage1Losses(ctx, { deadWaves: [w], deadLegs: [l], counts: COUNTS });
    expect(launchWave).not.toHaveBeenCalled();
    expect(r.skippedDeadWaves).toEqual([w]);
    expect(r.skippedDeadLegs).toEqual([l]);
    expect(r.stillDeadNotes).toEqual([]);
    expect(ctx._notes).toEqual([]);
  });

  test('an abort exit from a retry propagates immediately', async () => {
    const launchWave = jest.fn().mockResolvedValue({ wave: null, exitCode: 130 });
    const ctx = fakeCtx({}, { launchWave });
    const r = await retryStage1Losses(ctx, {
      deadWaves: [{ waveId: 'r1-s1', models: ['a'], reason: 'x' }], deadLegs: [], counts: COUNTS });
    expect(r.aborted).toBe(130);
    expect(ctx._notes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/council/run-retry.test.js -t "retryStage1Losses"`
Expected: FAIL — `retryStage1Losses is not a function`.

- [ ] **Step 3: Implement the orchestration half** (append to `src/council/run-retry.js`; export it)

```js
/** The briefing a retry unit re-issues — same builders Stage 1 used. */
function briefingFor(o, unit) {
  if (unit.unit === 'critic') { return briefings.buildCriticBriefing({ briefing: o.briefing, date: o.date }); }
  if (unit.unit === 'lens') {
    return briefings.buildLensBriefing({ lens: o.lenses[unit.lensIndex - 1], briefing: o.briefing, date: o.date });
  }
  return briefings.buildSeatBriefing({ briefing: o.briefing, date: o.date });
}

/** D-effect parity: still-dead leg notes reuse today's count phrasing, with the
 *  FIRST attempt's counts — the why carries the retry story (spec §5). */
const legEffect = (counts) =>
  `${counts.reviewed} of ${counts.total} seats reviewed; `
  + 'the run continues with the bench that did and will exit degraded (2)';

function waveStillDeadNote(w, unit) {
  return { channel: 'dead-wave',
    what: `Stage-1 wave ${w.waveId} (${(w.models || []).join(', ') || 'no models'}) produced NO legs`,
    why: `${w.reason}; the once-only retry wave also produced no legs`,
    effect: 'Those seats are NOT in this council. The run continues with the bench that did '
      + 'launch and will exit degraded (2)',
    data: { waveId: w.waveId, models: w.models, reason: w.reason, retryWaveId: unit.waveId } };
}

function srcLegStillDeadNote(leg, unit, counts) {
  const seat = leg.modelInput || leg.model;
  return { channel: 'dead-leg', what: `seat ${seat} did not review`,
    why: `the leg ended '${leg.status}'${leg.error ? `: ${leg.error}` : ''} with no usable output; `
      + 'its once-only retry wave produced no legs',
    effect: legEffect(counts),
    data: { seat, status: leg.status, reason: leg.error || null, retryWaveId: unit.waveId } };
}

function retryLegStillDeadNote(seat, ff, retryLeg, unit, counts) {
  const why = ff && ff.class === 'wave'
    ? `its first wave ${ff.waveId} produced no legs (${ff.reason}); `
      + `its once-only retry leg ended '${retryLeg.status}' with no usable output`
    : `the leg ended '${ff ? ff.status : 'unknown'}'${ff && ff.reason ? `: ${ff.reason}` : ''} `
      + `with no usable output; its once-only retry also ended '${retryLeg.status}'`;
  return { channel: 'dead-leg', what: `seat ${seat} did not review`, why,
    effect: legEffect(counts),
    data: { seat, status: retryLeg.status, reason: retryLeg.error || null,
      firstFailure: ff, retryWaveId: unit.waveId } };
}

/**
 * The retry pass. Serial by design (spec D-order: bench, critic, lenses) —
 * the per-wave-fallback path, where waves actually die, is exactly where
 * concurrent relaunches would race the same server start again.
 */
async function retryStage1Losses(ctx, { deadWaves = [], deadLegs = [], counts = { reviewed: 0, total: 0 } } = {}) {
  const { o, launchers } = ctx;
  const out = { aborted: null, recoveredLegs: [], stillDeadNotes: [],
    stillDeadWaves: [], stillDeadLegs: [], skippedDeadWaves: [], skippedDeadLegs: [] };

  for (const unit of groupStage1Losses(o, deadWaves, deadLegs)) {
    if (ctx.overBudget()) { // D7: skip silently — the loss is already announced by the caller
      out.skippedDeadWaves.push(...unit.srcWaves);
      out.skippedDeadLegs.push(...unit.srcLegs);
      continue;
    }
    runState.appendStageWave(o.runDir, 'stage1', unit.waveId); // BEFORE launch: abort cascade
    const common = { project: o.runDir, timeout: o.timeout, gateway: o.gateway,
      noValidateModel: o.noValidateModel, noCostGate: o.noCostGate,
      councilRunId: o.runId, councilName: o.councilName,
      fallback: o.fallback, catalog: o.catalog,
      waveId: unit.waveId, retryOfWaveId: unit.retryOfWaveId, prompt: briefingFor(o, unit) };
    const res = unit.models.length === 1
      ? await launchers.launchSolo({ ...common, model: unit.models[0] })
      : await launchers.launchWave({ ...common, models: unit.models.slice() });
    ctx.addWave(res.wave); // reservation released + measured legs counted (run-budget)
    if (isAbortExit(res.exitCode)) { out.aborted = res.exitCode; return out; }

    const legs = (res.wave && Array.isArray(res.wave.legs)) ? res.wave.legs : [];
    if (legs.length === 0) {
      // The retry wave itself died wholesale — final failure keeps each
      // source's granularity (D5): wave-origin stays a dead-wave, leg-origin
      // stays a dead-leg, both enriched with the retry fact.
      for (const w of unit.srcWaves) { out.stillDeadNotes.push(waveStillDeadNote(w, unit)); out.stillDeadWaves.push(w); }
      for (const l of unit.srcLegs) { out.stillDeadNotes.push(srcLegStillDeadNote(l, unit, counts)); out.stillDeadLegs.push(l); }
      continue;
    }
    const usable = new Set(materializeReviews(o.runDir, legs).map(m => m.leg));
    const lostWaveSeats = new Map(); // waveId -> seats still lost from a wave-origin
    for (const leg of legs) {
      const seat = leg.modelInput || leg.model;
      const ff = unit.firstFailures.find(f => f.seat === seat) || null;
      if (usable.has(leg)) {
        out.recoveredLegs.push(leg);
        ctx.degrade.note({ channel: 'stage1-retry', kind: 'heal',
          what: `seat ${seat} reviewed on retry`,
          why: ff && ff.class === 'wave'
            ? `its first wave ${ff.waveId} produced no legs (${ff.reason}) and was relaunched once`
            : `its first leg ended '${ff ? ff.status : 'unknown'}' with no usable output and was relaunched once`,
          effect: 'The seat is in this council; nothing was lost',
          data: { seat, retryWaveId: unit.waveId, retryOfWaveId: unit.retryOfWaveId, firstFailure: ff } });
      } else {
        out.stillDeadNotes.push(retryLegStillDeadNote(seat, ff, leg, unit, counts));
        if (ff && ff.class === 'wave') {
          if (!lostWaveSeats.has(ff.waveId)) { lostWaveSeats.set(ff.waveId, []); }
          lostWaveSeats.get(ff.waveId).push(seat);
        } else {
          const src = unit.srcLegs.find(l => (l.modelInput || l.model) === seat);
          if (src) { out.stillDeadLegs.push(src); }
        }
      }
    }
    // Wave-origin seats still lost: the return-contract wave entry carries only
    // the still-lost subset (a partially healed wave is not wholly dead).
    for (const w of unit.srcWaves) {
      const lost = lostWaveSeats.get(w.waveId) || [];
      if (lost.length > 0) { out.stillDeadWaves.push({ ...w, models: lost }); }
    }
  }
  return out;
}

module.exports = { groupStage1Losses, retryStage1Losses };
```

- [ ] **Step 4: Run the whole new suite to verify green**

Run: `npx jest tests/council/run-retry.test.js`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add src/council/run-retry.js tests/council/run-retry.test.js
git commit -m "feat: retryStage1Losses — the SL-2 once-only retry orchestrator

Serial relaunch (bench, critic, lenses) after the survivors settle; heal per
recovered seat on stage1-retry; still-dead facts returned note-ready with D5
final-failure granularity and both attempts in the why; overBudget pre-gate
routes skipped losses back byte-untouched (D7); abort propagates; the module
never notes a degrade and never touches degraded.value.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: The runStage1 seam

**Files:**
- Modify: `src/council/run-stages.js:131-160` and the return at `:258-259`
- Test: `tests/council/run-stages.test.js`

**Interfaces:**
- Consumes: Task 4's `retryStage1Losses` contract, verbatim.
- Produces: `runStage1` keeps its exact return keys `{aborted, reviews, deadLegs, deadWaves, degraded}` — now with POST-retry contents (still-dead only; recovered seats appear in `reviews`). **`run.js` is not modified** — its `deadWaves` → `writeVerdictFiles` flow and `degrade.all()` pick everything up.

- [ ] **Step 1: Write the failing integration tests** (append to `tests/council/run-stages.test.js`, using that file's existing fake-ctx/launcher conventions — it already drives `runStage1` with injected `ctx.launchers`; mirror its setup helpers. The assertions below are the contract; adapt only the setup plumbing.)

```js
describe('SL-2: the Stage-1 once-only retry seam', () => {
  test('a dead leg whose retry recovers: heal noted, NO degrade, review counted, deadLegs empty', async () => {
    // first launch: bench wave with one usable + one dead leg; retry launch: usable leg for the dead seat
    const ctx = makeCtx(/* models ['a','b'], no critic */);
    ctx.launchers.launchWave
      .mockResolvedValueOnce({ wave: { waveId: 'r1-s1', legs: [usableLeg('a'), deadLeg('b')] }, exitCode: 0 })
      .mockResolvedValueOnce({ wave: { waveId: 'r1-s1r1', legs: [usableLeg('b')] }, exitCode: 0 });
    const r = await runStage1(ctx);
    const chans = ctx._notes.map(n => [n.channel, n.kind || 'degrade']);
    expect(chans).toEqual([['stage1-retry', 'heal']]);
    expect(r.reviews.map(v => v.model).sort()).toEqual(['a', 'b']);
    expect(r.deadLegs).toEqual([]);
    expect(r.degraded).toBe(false);
  });

  test('retry also dies: exactly ONE dead-leg degrade, enriched why, degraded true', async () => {
    const ctx = makeCtx();
    ctx.launchers.launchWave
      .mockResolvedValueOnce({ wave: { waveId: 'r1-s1', legs: [usableLeg('a'), deadLeg('b')] }, exitCode: 0 })
      .mockResolvedValueOnce({ wave: { waveId: 'r1-s1r1', legs: [deadLeg('b', 'timeout', null)] }, exitCode: 0 });
    const r = await runStage1(ctx);
    const deadNotes = ctx._notes.filter(n => n.channel === 'dead-leg');
    expect(deadNotes).toHaveLength(1);
    expect(deadNotes[0].why).toMatch(/its once-only retry also ended 'timeout'/);
    expect(r.degraded).toBe(true);
    expect(r.deadLegs.map(l => l.modelInput)).toEqual(['b']);
  });

  test('overBudget: no retry launch, degrade fields byte-identical to the pre-SL-2 text', async () => {
    const ctx = makeCtx({ overBudget: () => true });
    ctx.launchers.launchWave
      .mockResolvedValueOnce({ wave: { waveId: 'r1-s1', legs: [usableLeg('a'), deadLeg('b')] }, exitCode: 0 });
    const r = await runStage1(ctx);
    expect(ctx.launchers.launchWave).toHaveBeenCalledTimes(1); // no second launch
    const n = ctx._notes.find(x => x.channel === 'dead-leg');
    expect(n.why).toBe("the leg ended 'error': boom with no usable output");
    expect(n.effect).toBe('1 of 2 seats reviewed; the run continues with the bench that did and will exit degraded (2)');
    expect(r.degraded).toBe(true);
  });

  test('abort during the retry propagates without noting anything', async () => {
    const ctx = makeCtx();
    ctx.launchers.launchWave
      .mockResolvedValueOnce({ wave: { waveId: 'r1-s1', legs: [deadLeg('a'), deadLeg('b')] }, exitCode: 0 })
      .mockResolvedValueOnce({ wave: null, exitCode: 130 });
    const r = await runStage1(ctx);
    expect(r.aborted).toBe(130);
    expect(ctx._notes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/council/run-stages.test.js -t "SL-2"`
Expected: FAIL — today `runStage1` notes the dead-leg degrade on the first pass and never launches a second wave.

- [ ] **Step 3: Rewire `runStage1`** — replace lines 133-160 (the launch + two note-loops + materialization block) with:

```js
  const { aborted, legs, deadWaves } = await launchStage1(ctx);
  if (aborted) { return { aborted, reviews: [], deadLegs: [], deadWaves: [], degraded: false }; }

  const firstPass = materializeReviews(o.runDir, legs);
  const alive0 = new Set(firstPass.map(m => m.leg));
  const deadLegs0 = legs.filter(l => !alive0.has(l));

  // SL-2: one retry BEFORE anything is recorded lost — the sink never
  // un-flips, so a degrade for a seat the retry saves must never fire at all.
  const retry = await retryStage1Losses(ctx, { deadWaves, deadLegs: deadLegs0,
    counts: { reviewed: firstPass.length, total: legs.length } });
  if (retry.aborted) {
    return { aborted: retry.aborted, reviews: [], deadLegs: deadLegs0, deadWaves, degraded: false };
  }

  for (const d of retry.skippedDeadWaves) {
    ctx.degrade.note({
      channel: 'dead-wave',
      what: `Stage-1 wave ${d.waveId} (${d.models.join(', ') || 'no models'}) produced NO legs`,
      why: d.reason,
      effect: 'Those seats are NOT in this council. The run continues with the bench that did '
        + 'launch and will exit degraded (2)',
      data: { waveId: d.waveId, models: d.models, reason: d.reason },
    });
  }
  for (const leg of retry.skippedDeadLegs) {
    ctx.degrade.note({
      channel: 'dead-leg',
      what: `seat ${leg.modelInput || leg.model} did not review`,
      why: `the leg ended '${leg.status}'${leg.error ? `: ${leg.error}` : ''} with no usable output`,
      effect: `${firstPass.length} of ${legs.length} seats reviewed; `
        + 'the run continues with the bench that did and will exit degraded (2)',
      data: { seat: leg.modelInput || leg.model, status: leg.status, reason: leg.error || null },
    });
  }
  for (const rec of retry.stillDeadNotes) { ctx.degrade.note(rec); }

  const materialized = materializeReviews(o.runDir, [...legs, ...retry.recoveredLegs]);
  const stillDeadLegs = [...retry.skippedDeadLegs, ...retry.stillDeadLegs];
  const stillDeadWaves = [...retry.skippedDeadWaves, ...retry.stillDeadWaves];
```

Add the import at the top beside the run-launch require: `const { retryStage1Losses } = require('./run-retry');`

Then update the tail: the reviews loop is UNCHANGED (it iterates `materialized`), and the return at the old `:258-259` becomes:

```js
  return { aborted: null, reviews, deadLegs: stillDeadLegs, deadWaves: stillDeadWaves,
    degraded: stillDeadLegs.length > 0 || stillDeadWaves.length > 0 };
```

(The old local `deadLegs` binding at `:149` is gone — `deadLegs0` and `stillDeadLegs` replace it. Ensure no other reference to the old name survives in the function: `grep -n "deadLegs" src/council/run-stages.js`.)

- [ ] **Step 4: Run the file suite + the size gate**

Run: `npx jest tests/council/run-stages.test.js && npm run check:sizes`
Expected: every test green, including the pre-existing ones (their fake launchers return waves whose legs all materialize, so no retry triggers and their expectations hold; any that stage a dead leg now needs a second mock response — if one fails on "launchWave called 2 times", add `.mockResolvedValueOnce({ wave: { waveId: '<runId>-s1r1', legs: [] }, exitCode: 0 })` for the retry and assert against the enriched why). Size gate: `run-stages.js` must print ≤ 300.

- [ ] **Step 5: Commit**

```bash
git add src/council/run-stages.js tests/council/run-stages.test.js
git commit -m "feat: runStage1 retries Stage-1 losses once before recording them lost

The seam: collect -> retryStage1Losses -> note degrades only for what is
STILL dead -> materialize the merged bench. Skipped-retry records stay
byte-identical (D7); the return contract keeps its keys with post-retry
contents, so run.js is untouched.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Pins, docs, full gates

**Files:**
- Test: `tests/council/verdict.test.js` (seatLoss heal pin), `tests/council/run-retry.test.js` (sink-invariant pin)
- Modify: `CHANGELOG.md` (`[Unreleased]`), `BACKLOG.md` (SL-2 entry)

**Interfaces:** none new — this task pins cross-module invariants and closes the record.

- [ ] **Step 1: Write the seatLoss heal pin** (append to `tests/council/verdict.test.js`, matching its existing `deriveSeatLoss` describe conventions)

```js
describe('SL-2: heals never count as losses', () => {
  test('a healed critic is SEATED — stage1-retry heal records are ignored by deriveSeatLoss', () => {
    const s = deriveSeatLoss({ runId: 'r1', critic: 'crit', degrades: [
      { kind: 'heal', channel: 'stage1-retry',
        what: 'seat crit reviewed on retry', why: 'w', effect: 'e',
        data: { seat: 'crit', retryWaveId: 'r1-c1r1', retryOfWaveId: 'r1-c1' } },
    ] });
    expect(s).toEqual({ criticRequested: 'crit', criticSeated: true, reason: null, deadBenchSeats: [] });
  });
});
```

Run: `npx jest tests/council/verdict.test.js -t "healed critic"` — expected: PASS immediately (`verdict.js:67` already filters `kind !== 'heal'`). This is a pin, not a fix — it exists so a future refactor of `deriveSeatLoss` cannot silently start counting heals.

- [ ] **Step 2: Pin the sink invariant against the new module** (append to `tests/council/run-retry.test.js`)

```js
test('run-retry.js never touches degraded.value (sink invariant, source pin)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'council', 'run-retry.js'), 'utf-8');
  expect(src).not.toMatch(/degraded\s*\.\s*value/);
});
```

Run: `npx jest tests/council/run-retry.test.js -t "sink invariant"` — expected: PASS. Also run the repo's own scan: `npx jest tests/council/degrade-invariant.test.js` — expected: PASS unmodified.

- [ ] **Step 3: CHANGELOG entry** — under `## [Unreleased]`, above the existing `### Removed` section, add:

```markdown
### Added

- **A lost Stage-1 seat gets one more chance (SL-2).** A council sub-wave that dies before
  its legs exist, or a leg that ends with no usable output, is relaunched exactly once —
  serially, after the surviving launches settle. Recovery announces in the one voice
  (`Recovered: seat X reviewed on retry — …`, a `stage1-retry` heal on
  `run.json`/`verdict.json` `degrades[]`) and the run stays exit 0; a seat still dead after
  its retry degrades exactly as before, with both attempts named in the why. Unconditional;
  gated on the run's `--max-cost` position (an over-budget run skips the retry and records
  the loss byte-identically to v4.6.0). Retry legs and their spend-ledger rows carry
  `retryOfWaveId`. A healed critic counts as seated in `verdict.seatLoss`.
```

- [ ] **Step 4: BACKLOG close-out** — in `BACKLOG.md`, flip the SL-2 checkbox to `[x]` and append one line to its entry:

```markdown
  **DONE (2026-08-03, branch `feat/sl2-stage1-retry`):** shipped per the spec
  (`docs/superpowers/specs/2026-08-03-sl2-stage1-retry-design.md`) — waves AND legs (D1),
  unconditional (D2), `run-retry.js` module (D3). SL-3's re-decision now waits on
  post-retry field data.
```

- [ ] **Step 5: Full gates + delta accounting**

Run: `npm test && npm run lint && npm run check:sizes`
Expected: all green. Compare the suite totals against Task 0's measured baseline and enumerate the delta by task in your report (new tests added in Tasks 1-6; zero unexplained drift).

- [ ] **Step 6: Commit**

```bash
git add tests/council/verdict.test.js tests/council/run-retry.test.js CHANGELOG.md BACKLOG.md
git commit -m "test+docs: SL-2 pins (healed critic seated; sink invariant) + record close-out

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Post-merge verification note (do NOT do it now)**

The spec's §10 GUI item — `renderSeats` showing a retried seat's live leg — is verified during the release live-smoke, not on this branch. Record it in the task report so the release ritual picks it up.

---

## Self-review (performed at plan-writing time)

- **Spec coverage:** D1→Tasks 3-5 (waves+legs); D2→no knob anywhere; D3→Tasks 3-4; D4 per-seat heals→Task 4; D5 granularity→Task 4 tests (all four why combos); D6 double-announce→no code needed (launcher's existing `onBudgetRefusal` path; documented); D7→Task 4+5 skip tests; §5 voice→Tasks 1/4; §6 budget→Task 4 (`overBudget` gate, `addWave`); §8 criteria 1-8,10→Tasks 3-6 tests; criterion 9 (no knob/transport parity)→engine-level change, no CLI/MCP surface touched.
- **Placeholders:** none — every step carries real code or an exact command.
- **Type consistency:** `Unit` shape (Task 3) matches Task 4's consumption; `retryStage1Losses` return keys match Task 5's seam; `counts` `{reviewed, total}` consistent across 4/5.

# #257 — a promoted reasoning answer is not a deliverable — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a council leg whose engine answer had no text part (its reasoning was promoted to output) is recorded as `promoted: true` on every leg document, rejected as a Stage-1 review so the once-only retry fires, counted as a lost seat if the retry repeats it, named in every announcement, and — as a judge — used only when its fenced block parses.

**Architecture:** headless mints one boolean from the mirror's existing stand-in at the normal terminal return; the fact rides the same emit-when-set riders `finish`/`ttftMs`/`backstop` already ride (council leg patch, solo metadata, wave document, runStats row, tally allowlist, schema); `materializeReviews` gains a third skip, which is the only gate both Stage-1 passes and the retry's own heal test go through; the census excludes promoted rows from `reviewed`; the retry's minted first-failure record carries the reasoning-channel facts so one shared clause builder names the cause everywhere; Stage 2 gets a third judge arm plus an info note. No mirror change, no schemaVersion bump, no repair-path change.

**Tech Stack:** Node.js CommonJS, Jest (`npm test` only — never a jest pattern override on the command line), the repo's 300-line-per-file gate (`scripts/check-file-sizes.js`), the one-voice degrade contract (`src/utils/degrade.js`).

**Spec:** `docs/superpowers/specs/2026-09-19-257-promoted-reasoning-design.md` (owner decisions A and B, rulings R1–R12). The measured map is in the SDD ledger (`.superpowers/sdd/2026-09-19-257-promoted-reasoning/00-dataflow-map.md`, local-only).

## Global Constraints

- **Baseline:** every line number below was measured on `7e2fc83f` (main = v4.13.0). Before editing, grep the QUOTED anchor text and confirm every identifier a new block reads or writes is declared ABOVE the insertion line (plan-authoring failure mode #63). If an anchor is not where this plan says, STOP and report NEEDS_CONTEXT — do not improvise.
- **Emit-when-true:** `promoted` is written only as the literal `true`; never `promoted: false`, never `null`. Every document without a promoted leg stays byte-identical (R6).
- **Never on an error leg:** the failed-with-no-usable-output return never emits it; no error-branch metadata writer learns the key (R12).
- **300-line gate:** `src/**/*.js` ≤ 300 lines (`npm run check:sizes` exit 0). Files at the gate that this plan touches: `src/utils/result-schema.js` (300 → the Task 4 extraction takes it to 299), `src/council/run-retry.js` (300 → in-place edits only, zero new lines), `src/sidecar/resume.js` (300 → one in-place edit), `src/council/run-stage2.js` (298 → the Task 8 extraction first). `src/headless.js` is grandfathered.
- **Require-free pins:** `src/council/run-stats-entry.js` must not contain the character sequence `require(` anywhere, comments included. `src/council/promoted.js` (new) is a LEAF: it requires nothing.
- **One voice:** every announcement goes through `makeDegrade` shapes (`what`/`why`/`effect`); any new `channel:` literal is registered in `src/utils/degrade.js` first (the drift pin `tests/council/degrade-contract.test.js:214-231` reads every literal in src).
- **Wording byte-identity:** for every leg that is NOT promoted, every existing announcement string is unchanged. The clause builder returns `''` for a non-promoted input.
- **Tests:** `npm test` (the full unit suite) is the only sanctioned runner from the worktree. To iterate on ONE file, write a one-file jest config (`rootDir` = the worktree, `testMatch: ['<rootDir>/tests/.../<exact file>']`, `testPathIgnorePatterns: ['/node_modules/', 'worktrees']`), run `npx jest --config <that> --listTests` and confirm exactly one path, then run it. NEVER `-t`, `--testPathPattern`, `--testPathIgnorePatterns` or `--testMatch` on the command line. Integration tier only via `npm run test:integration`.
- **Commits:** one per task, `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` trailer, `(#257)` in the subject, NEVER a closing keyword (`closes`/`fixes`/`resolves`) before an issue number anywhere in a commit message.
- **Named mutants:** each named mutant below is an exact edit; after every hardening re-run the pin that guards it and confirm it still FAILS its mutant.
- **Worktree:** `C:\Users\sendt\code\amicus-257`, branch `feat/257-promoted-reasoning`; `node_modules` is a junction to the main clone — never `npm install`.

---

## File structure (what changes, and what each unit owns)

| file | owns | change |
|---|---|---|
| `src/council/promoted.js` (NEW, leaf) | the vocabulary: `isPromotedLeg(leg)`, `promotedFacts(leg)`, `reasoningOnlyClause(facts)` | create |
| `src/headless.js` | minting the fact at the normal terminal return | +1 spread |
| `src/sidecar/fanout-leg.js` | the council leg rider + the substitution scrub | +1 rider, scrub list |
| `src/sidecar/session-utils.js` + `start.js`, `continue.js`, `resume.js`, `session-finalize.js` | solo metadata emit/delete + the four `finalizeSession` opts; the reopen delete | +1 line, in-place edits |
| `src/utils/leg-riders.js` (NEW) | the wave-document rider block extracted from `result-schema.js` | create |
| `src/utils/result-schema.js` | `buildRunResult` uses the extracted riders | −3 +1 +1 require |
| `schemas/run.schema.json`, `schemas/council-tally.schema.json` | declare `promoted` | +field |
| `src/council/run-stats-entry.js`, `src/council/tally.js` | the runStats row and its allowlist | +1 each |
| `src/council/verdict-seats-reviewed.js` | census `reviewed` excludes promoted | in-place |
| `src/council/run-launch.js` | `materializeReviews` skips a promoted leg | +1 skip, +2 docblock |
| `src/council/run-retry-group.js`, `run-retry.js`, `run-retry-notes.js`, `run-stages.js` | the minted `firstFailure.promoted` and the clause at every cause site | in-place + 1 require each where needed |
| `src/council/run-stage2.js`, `run-stage2-notes.js`, `src/utils/degrade.js` | judge third arm, info note, thin-cross-review clause, channel | extraction + small edits |
| docs, CHANGELOG, MODEL-NOTES, BACKLOG | R8, R10 | text |

---

### Task 1: the vocabulary module `src/council/promoted.js`

**Files:**
- Create: `src/council/promoted.js`
- Test: `tests/council/promoted.test.js`

**Interfaces:**
- Produces: `isPromotedLeg(leg) → boolean` (true iff `leg && leg.promoted === true`); `promotedFacts(leg) → {reasoning:number, output:number, finish:string|null} | null` (null unless `isPromotedLeg`); `reasoningOnlyClause(facts) → string` (`''` for null/undefined/non-object; else `` ` — it answered only in its reasoning channel (${reasoning} reasoning / ${output} output tokens${finish ? `, finish '${finish}'` : ''}), which is not a review` ``).
- Consumed by: Tasks 7 and 8 (and Task 3's scrub list by name only).

- [ ] **Step 1: Write the failing tests**

```js
// tests/council/promoted.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const { isPromotedLeg, promotedFacts, reasoningOnlyClause } = require('../../src/council/promoted');

describe('council/promoted — the one vocabulary for a promoted leg (#257)', () => {
  test('isPromotedLeg admits only the literal true', () => {
    expect(isPromotedLeg({ promoted: true })).toBe(true);
    for (const bad of [{ promoted: 'true' }, { promoted: 1 }, { promoted: false }, {}, null, undefined, { promoted: null }]) {
      expect(isPromotedLeg(bad)).toBe(false);
    }
  });

  test('promotedFacts reads the leg usage tokens and finish, defaulting to 0 / null', () => {
    expect(promotedFacts({ promoted: true, usage: { tokens: { reasoning: 40332, output: 1 } }, finish: 'stop' }))
      .toEqual({ reasoning: 40332, output: 1, finish: 'stop' });
    expect(promotedFacts({ promoted: true })).toEqual({ reasoning: 0, output: 0, finish: null });
    expect(promotedFacts({ promoted: true, usage: null, finish: 42 })).toEqual({ reasoning: 0, output: 0, finish: null });
  });

  test('promotedFacts is null for a leg that is not promoted', () => {
    expect(promotedFacts({ status: 'complete', summary: 'x' })).toBeNull();
    expect(promotedFacts(null)).toBeNull();
  });

  test('reasoningOnlyClause is the EMPTY STRING for anything but a facts object (byte-identity guard)', () => {
    for (const x of [null, undefined, '', 0, false, [], 'facts']) { expect(reasoningOnlyClause(x)).toBe(''); }
  });

  test('reasoningOnlyClause wording, with and without finish', () => {
    expect(reasoningOnlyClause({ reasoning: 40332, output: 1, finish: 'stop' }))
      .toBe(" — it answered only in its reasoning channel (40332 reasoning / 1 output tokens, finish 'stop'), which is not a review");
    expect(reasoningOnlyClause({ reasoning: 7, output: 0, finish: null }))
      .toBe(' — it answered only in its reasoning channel (7 reasoning / 0 output tokens), which is not a review');
  });

  test('the module is a LEAF: it requires nothing', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/council/promoted.js'), 'utf8');
    expect(src.match(/require\(/g)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test file (one-file config, `--listTests` first) — expect FAIL: `Cannot find module '../../src/council/promoted'`**

- [ ] **Step 3: Write the module**

```js
// src/council/promoted.js
'use strict';

/**
 * @module council/promoted
 * #257: the ONE vocabulary for a leg whose engine answer had no text part and
 * whose reasoning was promoted to output by conversation-mirror.js. A LEAF —
 * it requires nothing — so run-retry-group.js (leaf-only by header) and any
 * require-free consumer can import it.
 *
 * `promoted` is emit-when-true on every leg document (headless.js mints it from
 * `mirror.promotedOutput` at the normal terminal return; fanout-leg.js,
 * session-utils.js, leg-riders.js, run-stats-entry.js and tally.js carry it).
 * A promoted Stage-1 leg is NOT a review (run-launch.js :: materializeReviews
 * skips it, so the once-only retry fires); a promoted judge is used only when
 * its fenced block parses (run-stage2.js).
 */

/** The literal `true`, nothing else — the same discipline as `variantUnverified`. */
function isPromotedLeg(leg) {
  return !!leg && typeof leg === 'object' && leg.promoted === true;
}

/**
 * The facts every announcement of a promoted leg names, read off the leg
 * document; null for a leg that is not promoted so callers can spread
 * `...(facts ? { promoted: facts } : {})`.
 */
function promotedFacts(leg) {
  if (!isPromotedLeg(leg)) { return null; }
  const t = (leg.usage && leg.usage.tokens) || {};
  return {
    reasoning: Number.isInteger(t.reasoning) && t.reasoning >= 0 ? t.reasoning : 0,
    output: Number.isInteger(t.output) && t.output >= 0 ? t.output : 0,
    finish: typeof leg.finish === 'string' && leg.finish ? leg.finish : null,
  };
}

/**
 * The one clause the retry heal note, the still-dead notes and the skipped-leg
 * note append after "with no usable output". The EMPTY STRING for anything
 * that is not a facts object, so every announcement for a leg that is not
 * promoted stays byte-identical (spec R9).
 */
function reasoningOnlyClause(facts) {
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) { return ''; }
  const finish = facts.finish ? `, finish '${facts.finish}'` : '';
  return ` — it answered only in its reasoning channel (${facts.reasoning} reasoning / ${facts.output} output tokens${finish}), which is not a review`;
}

module.exports = { isPromotedLeg, promotedFacts, reasoningOnlyClause };
```

- [ ] **Step 4: Run the file — expect PASS (6 tests). Run `npm run lint`.**

- [ ] **Step 5: Commit**

```bash
git add src/council/promoted.js tests/council/promoted.test.js
git commit -m "feat(council): the promoted-leg vocabulary — isPromotedLeg, promotedFacts, the reasoning-only clause (#257)"
```

---

### Task 2: mint the fact in headless at the normal terminal return

**Files:**
- Modify: `src/headless.js` — the normal return at `:2103-2126` (anchor: the line `      // #218 PR 3: the engine's finish for the last assistant message, emit-when-set like ttftMs.` followed by `      ...(typeof finish === 'string' ? { finish } : {}),` and then `      exitCode: 0`). NOT the failed return at `:2070-2099`.
- Test: `tests/headless-output-length.test.js` (250 lines; the `:114` pin is REWRITTEN as the deliberate change; new tests appended in the same describe).

**Interfaces:**
- Produces: the headless result carries `promoted: true` when `mirror.promotedOutput.length > 0` at the normal return; never on the failed return; never `false`.
- Declarations above the insertion line (measured): `mirror` at `:976` (`const mirror = createMirrorState();`), `finish` at `:1963`.

- [ ] **Step 1: Read the fixture helper in `tests/headless-output-length.test.js:1-60`** (how a reasoning-only finished message is fed: the test at `:95` "visible reasoning promoted to output (L2/L4)" and `:114` "finish 'stop' rides out as finish" show the shapes). Copy their harness for the two new tests.

- [ ] **Step 2: Rewrite the `:114` pin and add the tests** — the existing test titled `finish 'stop' rides out as finish, and a leg with no finish carries no key` keeps its finish assertions and GAINS the promoted assertion; add two more tests:

```js
  test("finish 'stop' with reasoning only: completes, carries finish, and carries promoted: true (#257)", async () => {
    // same harness as the existing :114 test — a finalized assistant message with a reasoning
    // part, no text part, info.finish 'stop'
    const r = await runWith(/* the :114 fixture */);
    expect(r.completed).toBe(true);
    expect(r.finish).toBe('stop');
    expect(r.promoted).toBe(true);
    expect(r.summary.length).toBeGreaterThan(0); // the stand-in is still the output (solo keeps it)
  });

  test('a leg with answer text carries NO promoted key at all, even after an earlier promotion (#257)', async () => {
    // the :162 shape: an earlier reasoning-only message, then a message WITH text
    const r = await runWith(/* the :162 fixture */);
    expect('promoted' in r).toBe(false);
  });

  test('an L2/L4 death (finish length, reasoning promoted) dies WITHOUT a promoted key — a death has no deliverable to classify (#257, spec R12)', async () => {
    const r = await runWith(/* the :95 fixture */);
    expect(r.completed).toBe(false);
    expect(r.error).toMatch(/^OUTPUT_LENGTH:/);
    expect('promoted' in r).toBe(false);
  });
```

Named mutants, recorded in the test file's docblock: **PROMOTEDDROPPED** (delete the new spread) reds test 1; **PROMOTEDONDEATH** (copy the spread into the failed return at `:2070-2099`) reds test 3; **PROMOTEDCOERCED** (`promoted: !!mirror.promotedOutput` instead of the spread) reds test 2.

- [ ] **Step 3: Run the file — expect the three new/rewritten tests to FAIL (`promoted` undefined).**

- [ ] **Step 4: Insert ONE line in the normal return**, directly after the `...(typeof finish === 'string' ? { finish } : {}),` line that precedes `exitCode: 0` (the NORMAL return, second occurrence of that finish line in the file):

```js
      // #257: the engine answered with no text part and the mirror promoted its reasoning
      // (conversation-mirror.js :: mirrorMessages, `promotedOutput`) — the output IS the stand-in.
      // Emit-when-true; the failed return above never carries it (a death has no deliverable to
      // classify — an L2/L4 OUTPUT_LENGTH death has a non-empty stand-in and is still a death).
      // Named mutants (tests/headless-output-length.test.js): PROMOTEDDROPPED, PROMOTEDONDEATH, PROMOTEDCOERCED.
      ...(mirror.promotedOutput.length > 0 ? { promoted: true } : {}),
```

- [ ] **Step 5: Run the file — expect PASS. Apply each named mutant, confirm its test reds, revert (`git diff` clean).**

- [ ] **Step 6: Commit**

```bash
git add src/headless.js tests/headless-output-length.test.js
git commit -m "feat(headless): a leg whose reasoning was promoted to output carries promoted: true on its result; never on a death (#257)"
```

---

### Task 3: ride the fact onto the council leg and solo metadata

**Files:**
- Modify: `src/sidecar/fanout-leg.js:238` (after the `finish:` rider; anchor `    finish: (result && typeof result.finish === 'string') ? result.finish : undefined,`) and `:57` (the scrub list `for (const k of ['backstop', 'finish', 'ttftMs', 'variant', 'variantUnverified']) { delete meta[k]; }`).
- Modify: `src/sidecar/session-utils.js:112` (after the `isBackstopRecord(opts.backstop)` line), and the four `finalizeSession(` calls: `start.js:212`, `continue.js:258`, `resume.js:263`, `session-finalize.js:83` — each opts object gains `promoted: result && result.promoted`.
- Modify: `src/sidecar/resume.js:118` (the reopen delete line `delete meta.finish; delete meta.variant; delete meta.variantUnverified; delete meta.backstop;`) — append ` delete meta.promoted;` ON THE SAME LINE (the file is at 300).
- Tests: `tests/sidecar/fanout.test.js` (beside LEGVARIANTDROPPED / LEGBACKSTOPDROPPED), `tests/sidecar/session-utils.test.js` (beside SOLOVARIANTDROPPED / STALEVARIANT), `tests/sidecar/resume.test.js` (beside RESUMESTALEVARIANT), `tests/start-terminal-status.test.js` + `tests/continue-resume-spend.test.js` + `tests/shared-server-finalize.test.js` (the opts passthrough pins those files already carry for `variant`).

**Interfaces:**
- Produces: `leg.promoted === true` on the council leg document (`legPatch`), `metadata.promoted === true` on a completed solo/leg `metadata.json`; absent otherwise; a substitute attempt starts clean; a resumed session drops the stale key.

- [ ] **Step 1: Write the failing tests** (copy each sibling `variant` test verbatim and change the field):
  - `fanout.test.js`: `a completed leg whose result carries promoted: true stamps promoted on the leg patch; a result without it stamps no key` (named mutant **LEGPROMOTEDDROPPED**: delete the rider line) and `clearAttemptFields drops promoted before a substitute attempt` (named mutant **SCRUBKEEPSPROMOTED**: remove `'promoted'` from the list).
  - `session-utils.test.js`: `finalizeSession stamps promoted: true from opts and DELETES a stale one when opts carry none` (named mutants **SOLOPROMOTEDDROPPED** / **STALEPROMOTED**).
  - `resume.test.js`: `updateSessionStatus('running') drops a stale promoted` (named mutant **RESUMESTALEPROMOTED**).
  - The three opts-passthrough files: add `promoted` to each existing assertion that lists the opts keys forwarded to `finalizeSession` (grep each file for `variantUnverified` to find the pins).
  - `tests/start-terminal-status.test.js`: `an ERROR result carrying promoted: true stamps NO promoted on metadata (spec R12)`.

- [ ] **Step 2: Run each file — expect FAIL.**

- [ ] **Step 3: Implement** — `fanout-leg.js`, after the `finish:` rider line:

```js
    // #257: the engine answered only in its reasoning channel and the mirror promoted it — emit-when-true,
    // like variantUnverified below. Named mutant "LEGPROMOTEDDROPPED" (tests/sidecar/fanout.test.js).
    promoted: (result && result.promoted === true) ? true : undefined,
```

`fanout-leg.js:57` scrub list → `['backstop', 'finish', 'ttftMs', 'variant', 'variantUnverified', 'promoted']`.

`session-utils.js`, after the backstop line:

```js
  if (opts.promoted === true) { metadata.promoted = true; } else { delete metadata.promoted; } // #257: emit-when-true / delete-when-absent, like finish (named mutants "SOLOPROMOTEDDROPPED" / "STALEPROMOTED", tests/sidecar/session-utils.test.js)
```

Each of the four `finalizeSession(` calls: add `, promoted: result && result.promoted` at the end of the opts object (in place). `resume.js:118`: append ` delete meta.promoted;` to that line and extend its comment's "FOUR deletes" to "FIVE deletes".

- [ ] **Step 4: Run the touched files — expect PASS; mutants red; `npm run check:sizes` exit 0 (resume.js stays 300).**

- [ ] **Step 5: Commit**

```bash
git add src/sidecar/fanout-leg.js src/sidecar/session-utils.js src/sidecar/start.js src/sidecar/continue.js src/sidecar/resume.js src/sidecar/session-finalize.js tests/sidecar tests/start-terminal-status.test.js tests/continue-resume-spend.test.js tests/shared-server-finalize.test.js
git commit -m "feat(sidecar): promoted rides the council leg patch and solo metadata, emit-when-true; a substitute attempt and a resumed session start clean (#257)"
```

---

### Task 4: the wave document and the schemas (extract the rider block first)

**Files:**
- Create: `src/utils/leg-riders.js`
- Modify: `src/utils/result-schema.js:12` (the `isMeasuredTtft` require — keep it ONLY if another site in the file uses it; grep first), `:83-85` (the three rider lines) → one spread.
- Modify: `schemas/run.schema.json` (after the `backstop` property, before the closing `}` at `:95`), `schemas/council-tally.schema.json` (the runStats row `properties`, beside `ttftMs` at `:108`).
- Tests: `tests/utils/leg-riders.test.js` (NEW), `tests/utils/result-schema.test.js`, `tests/schemas.test.js` (beside `:93` the backstop test).

**Interfaces:**
- Produces: `legRiders(metadata) → object` — the spread `{ ttftMs?, finish?, variant?, variantUnverified?, backstop?, promoted? }` in exactly that key order, each emit-when-set/valid exactly as `result-schema.js:83-85` spells them today, plus `promoted: true` when `metadata.promoted === true`.

- [ ] **Step 1: Write the failing tests**
  - `leg-riders.test.js`: for a metadata carrying every rider, `Object.keys(legRiders(m))` is `['ttftMs','finish','variant','variantUnverified','backstop','promoted']`; for `{}` it is `[]`; `promoted: 'true'`/`false`/`1` emit nothing (named mutant **RIDERPROMOTEDCOERCED**); a malformed backstop is dropped (parity with `isBackstopRecord`).
  - `result-schema.test.js`: **BYTE-IDENTITY of the extraction** — build `buildRunResult` on a fixture carrying ttftMs/finish/variant/variantUnverified/backstop (no promoted) and compare `JSON.stringify` against the SAME call made on `git show 7e2fc83f:src/utils/result-schema.js` semantics: encode the expected document literally in the test (write it by hand from the current function's output BEFORE the extraction, i.e. run the current code once in a scratch script, paste the string). Then: a metadata with `promoted: true` yields a document with `promoted: true` placed after `backstop` and before `usage`.
  - `schemas.test.js`: `run.schema.json accepts a recorded promoted: true and rejects promoted: false / "true"`; `council-tally.schema.json` accepts a runStats row carrying `promoted: true`.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement**

```js
// src/utils/leg-riders.js
'use strict';
/**
 * @module leg-riders
 * The emit-when-set rider block of a leg run document, extracted VERBATIM from
 * result-schema.js :: buildRunResult (#257 — that file sat at the 300-line gate
 * and its last rider line already carried three fields). Key ORDER is the
 * contract: ttftMs, finish, variant, variantUnverified, backstop, promoted —
 * the order the wave document has always written. `promoted` (#257) is
 * emit-when-true, like variantUnverified.
 */
const { isMeasuredTtft } = require('./ttft');
const { isBackstopRecord } = require('./no-output-backstop');

function legRiders(metadata = {}) {
  const m = metadata || {};
  return {
    ...(isMeasuredTtft(m.ttftMs) ? { ttftMs: m.ttftMs } : {}),
    ...(typeof m.finish === 'string' ? { finish: m.finish } : {}),
    ...(typeof m.variant === 'string' ? { variant: m.variant } : {}),
    ...(m.variantUnverified === true ? { variantUnverified: true } : {}),
    ...(isBackstopRecord(m.backstop) ? { backstop: m.backstop } : {}),
    ...(m.promoted === true ? { promoted: true } : {}),
  };
}

module.exports = { legRiders };
```

`result-schema.js`: replace lines `:83-85` with `    ...legRiders(metadata), // riders extracted to ./leg-riders (#257) — ttftMs, finish, variant, variantUnverified, backstop, promoted; the named mutants FINISHCOERCED / VARIANTCOERCED / UNVERIFIEDCOERCED / BACKSTOPCOERCED now live beside that module's tests` and add `const { legRiders } = require('./leg-riders');` beside the existing requires; delete the `isMeasuredTtft` require at `:12` ONLY if grep shows no other use in the file (report the grep result in the completion note). Update the `:53` docblock sentence to name `leg-riders.js` as the projection.

`run.schema.json`, after the `backstop` property:

```json
    ,"promoted": {
      "type": "boolean",
      "enum": [true],
      "description": "#257, optional, emit-when-true. The engine's last assistant message carried reasoning and no text part, and conversation-mirror.js promoted the reasoning to the leg's output as a stand-in — so `summary` is the model's deliberation, not its answer. A council treats such a Stage-1 leg as no deliverable (the once-only retry fires; a repeat is a lost seat) and uses such a judge only when its fenced block parses. Absent means the output is the model's answer text. Never present on a leg whose status is 'error'."
    }
```

(Place it syntactically — the leading comma belongs to the previous property; write valid JSON.) `council-tally.schema.json`: the same declaration on the runStats row's `properties`, with the description "…tally.js carries it verbatim from the leg document; a promoted bench seat is excluded from `seatsReviewed.reviewed`."

- [ ] **Step 4: Run the four files + `tests/schemas.test.js` — expect PASS; `npm run check:sizes` (result-schema.js ≤ 299).**

- [ ] **Step 5: Commit**

```bash
git add src/utils/leg-riders.js src/utils/result-schema.js schemas/run.schema.json schemas/council-tally.schema.json tests/utils/leg-riders.test.js tests/utils/result-schema.test.js tests/schemas.test.js
git commit -m "feat(result-schema): the leg rider block extracted to leg-riders.js, byte-identical, and promoted rides the wave document; run and tally schemas declare it (#257)"
```

---

### Task 5: the runStats row and tally's allowlist

**Files:**
- Modify: `src/council/run-stats-entry.js:111` (after the `ttftMs` spread, before `usage:`), `src/council/tally.js:195` (after the `ttftMs` spread, before `usage:`).
- Tests: `tests/council/run-stats-entry.test.js`, `tests/council/runstats-byte-order.test.js` (a G4-style pin), `tests/council/tally.test.js`.

**Interfaces:**
- Produces: a runStats row built from a leg with `promoted === true` carries `promoted: true` between `ttftMs` and `usage`; tally's re-projection keeps it in the same slot; verdict.json copies it (no change there).

- [ ] **Step 1: Write the failing tests**
  - `run-stats-entry.test.js`: `a leg carrying promoted: true stamps it on the row, between ttftMs and usage` (key order asserted with `Object.keys`), `ABSENCE: a non-true promoted (false / 'true' / 1) stamps no key` (named mutant **ROWPROMOTEDCOERCED**: `leg.promoted ? …`), and extend the existing G4-style "every optional field at once" pin in `runstats-byte-order.test.js` with a promoted row (a NEW test, so the existing golden stays byte-identical).
  - `tally.test.js`: `tally keeps promoted: true on a runStats row and drops promoted: false / "true"` (named mutant **TALLYPROMOTEDDROPPED**: delete the allowlist line).
  - `runstats-byte-order.test.js` G7b already asserts input-row key order === tally output key order — a promoted row goes through that test as a new case.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** — `run-stats-entry.js`, after the `ttftMs` spread (hand-spelled; NO `require(`):

```js
    // #257: the engine answered only in its reasoning channel — carried off the leg document like
    // ttftMs above, emit-when-TRUE (the literal), so every row without it is byte-identical.
    ...(leg && leg.promoted === true ? { promoted: true } : {}),
```

`tally.js`, after the `ttftMs` spread:

```js
      // #257: emit-when-true, in buildRunStatsEntry's own slot so G7b's key-order invariant holds.
      ...(r.promoted === true ? { promoted: true } : {}),
```

- [ ] **Step 4: Run the three files — expect PASS; mutants red; the P3 require-free pin still green.**

- [ ] **Step 5: Commit**

```bash
git add src/council/run-stats-entry.js src/council/tally.js tests/council/run-stats-entry.test.js tests/council/runstats-byte-order.test.js tests/council/tally.test.js
git commit -m "feat(council): promoted rides the runStats row and tally's allowlist, emit-when-true, in the ttftMs slot (#257)"
```

---

### Task 6: the census — `reviewed` means "delivered a review"

**Files:**
- Modify: `src/council/verdict-seats-reviewed.js:116` (`reviewed: seats.filter(r => r.status === 'complete').length,`) and the docblock at `:14-15`.
- Test: `tests/council/verdict.test.js` (beside the CENSUSZERO / SUBSETBLIND tests at `:345-363`), `tests/council/report-unverified.test.js:183` (the report/census agreement test — extend with a promoted row to prove `unverified ≤ reviewed` still holds and that a promoted row yields NO render-time row).

**Interfaces:**
- Produces: `seatsReviewed.reviewed` counts bench rows with `status === 'complete' && promoted !== true`; `of` unchanged; no new key.

- [ ] **Step 1: Write the failing tests**

```js
  test('a completed bench seat carrying promoted: true is NOT reviewed — it delivered no review (#257, decision B)', () => {
    const v = buildVerdict(recordWith([
      seatRow('glm', 'complete'), seatRow('qwen', 'complete', { promoted: true }), seatRow('gpt', 'complete'),
    ]));
    expect(v.seatsReviewed).toEqual({ reviewed: 2, unverified: 0, refused: 0, of: 3 });
  });
  // Named mutant CENSUSPROMOTED: delete `&& r.promoted !== true` — the test above reads 3.
  test('only the literal true excludes a row (a hand-assembled "true" string is not a promotion)', () => {
    const v = buildVerdict(recordWith([seatRow('qwen', 'complete', { promoted: 'true' })]));
    expect(v.seatsReviewed).toEqual({ reviewed: 1, unverified: 0, refused: 0, of: 1 });
  });
```

(Use the file's existing row/record helpers — read `tests/council/verdict.test.js:240-300` for their names before writing.)

- [ ] **Step 2: Run — expect FAIL (reviewed 3).**

- [ ] **Step 3: Implement** — `verdict-seats-reviewed.js:116`:

```js
    // #257 (decision B): a promoted leg completed but delivered no review — the seat is a LOSS
    // (dead-seat row, seatLoss, exit 2), never a reviewer. Named mutant CENSUSPROMOTED (verdict.test.js).
    reviewed: seats.filter(r => r.status === 'complete' && r.promoted !== true).length,
```

and in the docblock line `:14-15` extend "`reviewed` is those whose leg completed" with "and delivered a review — a `promoted: true` row (#257) completed with its reasoning as output and is not counted".

- [ ] **Step 4: Run `verdict.test.js`, `report-unverified.test.js` — expect PASS; mutant red.**

- [ ] **Step 5: Commit**

```bash
git add src/council/verdict-seats-reviewed.js tests/council/verdict.test.js tests/council/report-unverified.test.js
git commit -m "fix(council): the census counts a promoted seat as not reviewed — it delivered no review (#257)"
```

---

### Task 7: Stage 1 — reject before materialization, and name the cause everywhere

**Files:**
- Modify: `src/council/run-launch.js:237-251` (`materializeReviews`: one skip after the empty-summary skip at `:242`; two docblock lines).
- Modify: `src/council/run-retry-group.js:236` (the `ff` mint) + a require of `./promoted`.
- Modify: `src/council/run-retry.js:226` (the heal `why`, in place) and `:21-22` (the destructure from `./run-retry-notes`, in place: add `reasoningOnlyClause`).
- Modify: `src/council/run-retry-notes.js:130`, `:171`/`:174`/`:176` (the `retryCause` sites), `:198`; a require of `./promoted`; re-export `reasoningOnlyClause`, `promotedFacts`.
- Modify: `src/council/run-stages.js:119` (the skipped-leg note) and `:30` (the destructure, in place).
- Tests: `tests/council/run-launch.test.js` (materializeReviews describe), `tests/council/run-retry-notes.test.js`, `tests/council/run-retry.test.js`, `tests/council/run-stages.test.js` (the scenario), `tests/council/briefings-stage2.test.js` + `tests/council/chair-packet-seats.test.js` (the tripwire).

**Interfaces:**
- Consumes: `isPromotedLeg`, `promotedFacts`, `reasoningOnlyClause` (Task 1).
- Produces: `materializeReviews` returns nothing for a promoted leg; `firstFailure.promoted` = `promotedFacts(leg)` when promoted (else absent); every cause string gains the clause after "with no usable output".

- [ ] **Step 1: Write the failing tests**
  - `run-launch.test.js`, in `describe('materializeReviews')`: `a complete leg carrying promoted: true is SKIPPED and no review file is written — its text is not a review (#257)`; named mutant **PROMOTEDKEPT** (delete the skip). Also `a leg with promoted: false or "true" is still materialized` (the literal-true discipline).
  - `run-retry-notes.test.js`: for each of `srcLegStillDeadNote`, `retryLegStillDeadNote` (first-leg promoted; retry-leg promoted; both), `missingLegStillDeadNote`: the `why` contains `with no usable output — it answered only in its reasoning channel (40332 reasoning / 1 output tokens, finish 'stop'), which is not a review` in the right position; and — the byte-identity guard — every EXISTING test in the file is untouched and still green.
  - `run-retry.test.js`: the heal note for a promoted first leg reads `its first leg ended 'complete' with no usable output — it answered only in its reasoning channel (40332 reasoning / 1 output tokens, finish 'stop'), which is not a review and was relaunched once`; `data.firstFailure.promoted` equals `{reasoning: 40332, output: 1, finish: 'stop'}`; a promoted RETRY leg is NOT in `recoveredLegs` (it is still-dead — the `usable` set is `materializeReviews`, run-retry.js:186).
  - `run-stages.test.js`: copy the `:744-758` harness (a dead-by-reason leg that is retried) twice: (a) first attempt `{status:'complete', summary:'Let me carefully analyze…', promoted:true, usage:{tokens:{reasoning:40332,output:1}}, finish:'stop'}`, retry returns a real review → ONE `stage1-retry` heal note with the clause, `reviews` carries the retry's text, the seat's row is `role: 'seat'` from the retry leg and the first leg's row is `role: 'superseded'` carrying `promoted: true`; (b) first AND retry promoted → `stillDeadLegs` has the seat, `extraRows` has a dead-seat row with `status: 'complete'` and `promoted: true`, `degraded` is true, the `dead-leg` note's `why` carries the clause TWICE (first leg and retry leg). And the skipped-leg path: `ctx.overBudget()` true → the `:119` note carries the clause.
  - The **tripwire**: in the (a) scenario, assert that `bundle-stage2.md` (if the harness reaches Stage 2) or, more directly, the `reviews` array handed onward contains no entry whose `leg.promoted === true` and no text starting `Let me carefully analyze` — pin the observable in `run-stages.test.js`; add to `briefings-stage2.test.js` a unit pin that `buildJudgeBundle` is called only with reviews from `materializeReviews`' output shape (a promoted leg never reaches it — assert via the run-stages scenario, not by changing the builder).

- [ ] **Step 2: Run the files — expect FAIL.**

- [ ] **Step 3: Implement**

`run-launch.js :: materializeReviews`, after `    if (!text || !String(text).trim()) { continue; }`:

```js
    // #257: a promoted leg is `complete` with text, and the text is not a review — it is the
    // model's deliberation, promoted to output because no answer text ever arrived. Skipping it
    // HERE is what routes it into the once-only retry (run-stages.js's deadLegs0 is "every leg
    // this function rejected", and run-retry.js's `usable` set is this same function over the
    // retry wave). Named mutant "PROMOTEDKEPT" (tests/council/run-launch.test.js).
    if (isPromotedLeg(leg)) { continue; }
```

with `const { isPromotedLeg } = require('./promoted');` beside the file's requires, and the docblock at `:221-223` gaining: "A promoted leg (#257) is skipped too: `complete` with text, but the text is its reasoning."

`run-retry-group.js:236`:

```js
    const ff = { seat, class: 'leg', status: leg.status, reason: leg.error || null,
      ...(promotedFacts(leg) ? { promoted: promotedFacts(leg) } : {}) }; // #257: the facts the notes name (spec R9)
```

with `const { promotedFacts } = require('./promoted');` after the `./run-retry-keys` require at `:8` (a second leaf require — update the header comment at `:5` from "ONE leaf require" to "two leaf requires").

`run-retry-notes.js`: add `const { promotedFacts, reasoningOnlyClause } = require('./promoted');` at the top; in `srcLegStillDeadNote` (`:130`) change `with no usable output; ` to `` with no usable output${reasoningOnlyClause(promotedFacts(leg))}; ``; in `retryLegStillDeadNote` change `:171` `…with no usable output`` → `` …with no usable output${reasoningOnlyClause(promotedFacts(retryLeg))} ``, `:174` the same for the retry leg, `:175-176` → `` `the leg ended '${ff ? ff.status : 'unknown'}'${ff && ff.reason ? `: ${ff.reason}` : ''} ` + `with no usable output${reasoningOnlyClause(ff && ff.promoted)}; its once-only retry also ended '${retryLeg.status}'${retryCause}${reasoningOnlyClause(promotedFacts(retryLeg))}` ``; in `missingLegStillDeadNote` (`:198`) append `${reasoningOnlyClause(ff && ff.promoted)}` after `with no usable output`; add `reasoningOnlyClause, promotedFacts` to `module.exports`.

`run-retry.js:226` (in place, the file is at 300):

```js
              : `its first leg ended '${ff ? ff.status : 'unknown'}' with no usable output${reasoningOnlyClause(ff && ff.promoted)} and was relaunched once`,
```

and the destructure at `:21-22` gains `reasoningOnlyClause` (same lines, no new line).

`run-stages.js:119` (in place): `` why: `the leg ended '${leg.status}'${leg.error ? `: ${leg.error}` : ''} with no usable output${reasoningOnlyClause(promotedFacts(leg))}`, `` and `:30` gains `reasoningOnlyClause, promotedFacts`.

- [ ] **Step 4: Run the six files — expect PASS; every pre-existing wording pin still green (byte-identity); mutants red; `npm run check:sizes` (run-retry.js exactly 300, run-launch.js ≤ 286, run-stages.js 289).**

- [ ] **Step 5: Commit**

```bash
git add src/council/run-launch.js src/council/run-retry-group.js src/council/run-retry.js src/council/run-retry-notes.js src/council/run-stages.js tests/council
git commit -m "feat(council): a promoted Stage-1 leg is no deliverable — materializeReviews skips it, the once-only retry fires, and every announcement names the reasoning channel (#257)"
```

---

### Task 8: Stage 2 — the third judge arm, the info note, the thin-cross-review clause

**Files:**
- Modify: `src/council/run-stage2-notes.js` (97 lines): add `judgeDeadNote(...)` (the block moved VERBATIM from `run-stage2.js:250-266`), `promotedJudgeNote(judge, seat, leg)`, the `fromReasoning` bucket in `thinCrossReviewWhy`.
- Modify: `src/council/run-stage2.js:250-266` → one call; `:268-282` → `fromReasoning` key; one info-note line after the judge-file write block; a require of `./run-stage2-notes` and `./promoted`.
- Modify: `src/utils/degrade.js:49` — register `'judge-reasoning-only'`.
- Tests: `tests/council/run-stages.test.js` (Stage-2 scenarios; grep `stage2-judge` for the existing death-note pins — they must stay byte-identical after the extraction), `tests/council/degrade-contract.test.js` (channel registered; drift pin), `tests/council/degrade-channels.test.js` (thin cross-review clause), a NEW `tests/council/run-stage2-notes.test.js`.

**Interfaces:**
- Produces: `judgeResults[i].fromReasoning: boolean` (true iff the judge leg is promoted and did not die); `thinCrossReviewWhy` clause `<n> answered only in the reasoning channel with no parseable block`; an `info` note on channel `judge-reasoning-only` when a promoted judge's block PARSED.

- [ ] **Step 1: Write the failing tests**
  - `run-stage2-notes.test.js`: `judgeDeadNote` returns the exact record the inline block returned (fixture: a dead judge leg with an error of 300 chars — `why` collapses to 200 via `collapseExcerpt`); `promotedJudgeNote` returns `{ kind: 'info', channel: 'judge-reasoning-only', what: 'judge <judge> answered in its reasoning channel', why: 'its fenced block parsed and was used; the deliberation itself was read by nobody (<reasoning> reasoning / <output> output tokens)', effect: 'the adjudication counts; nothing else changes', data: { judge, seat, reasoningTokens, outputTokens } }`; `thinCrossReviewWhy` with one `{ok:false, died:false, fromReasoning:true}` reads `1 answered only in the reasoning channel with no parseable block` and does NOT also count it as unparseable.
  - `run-stages.test.js`: (a) a promoted judge whose summary ends in a valid ```json block → `ok: true`, its adjudications used, one `judge-reasoning-only` info note, exit unaffected; (b) a promoted judge with no block → `ok: false`, `died: false`, `fromReasoning: true`, and the thin-cross-review `why` (when thin) carries the clause; (c) every existing `stage2-judge` death-note assertion unchanged.
  - `degrade-contract.test.js`: `DEGRADE_CHANNELS has judge-reasoning-only`.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** — `run-stage2-notes.js`: move the `ctx.degrade.note({ channel: 'stage2-judge', … })` OBJECT literal from `run-stage2.js:251-266` into

```js
/** #202's judge-death record, moved verbatim from run-stage2.js (#257 headroom, zero behaviour). */
function judgeDeadNote({ judge, seat, leg, judgesCount, runId }) {
  return {
    channel: 'stage2-judge',
    what: `judge ${judge} did not adjudicate`,
    why: `its Stage-2 leg ended '${leg.status}'` + (leg.error ? `: ${collapseExcerpt(leg.error, 200)}` : ''),
    effect: `the cross-review was adjudicated by fewer than the ${judgesCount} judges the ` + 'bench implies; the run continues and will exit degraded (2)',
    data: { judge, seat: seat ? seat.id : null, waveId: `${runId}-s2`, status: leg.status, reason: leg.error || null },
  };
}
```

(with `collapseExcerpt` required from the module `run-stage2.js` imports it from — grep `collapseExcerpt` there; keep the #219 comment lines with the function), plus:

```js
/** #257 (spec R4/R11): a judge that answered only in its reasoning channel but whose fenced block parsed. */
function promotedJudgeNote(judge, seat, leg) {
  const t = (leg.usage && leg.usage.tokens) || {};
  return { kind: 'info', channel: 'judge-reasoning-only',
    what: `judge ${judge} answered in its reasoning channel`,
    why: `its fenced block parsed and was used; the deliberation itself was read by nobody (${t.reasoning || 0} reasoning / ${t.output || 0} output tokens)`,
    effect: 'the adjudication counts; nothing else changes',
    data: { judge, seat: seat ? seat.id : null, reasoningTokens: t.reasoning || 0, outputTokens: t.output || 0 } };
}
```

and in `thinCrossReviewWhy`: `const fromReasoning = failed.filter(j => j.died === false && j.fromReasoning === true).length; const unparseable = failed.filter(j => j.died === false).length - fromReasoning;` and, after the `unparseable` clause, `if (fromReasoning > 0) { clauses.push(`${fromReasoning} answered only in the reasoning channel with no parseable block`); }`. Export all three new names.

`run-stage2.js`: replace `:250-266` with `      if (legDied) { ctx.degrade.note(judgeDeadNote({ judge, seat, leg, judgesCount: judges.length, runId: o.runId })); }` (keep the #202 explanatory comment above it); in the `judgeResults.push({ … died: legDied, emptyAnswer: legAnsweredEmpty, …` add `fromReasoning: !legDied && isPromotedLeg(leg),` after `emptyAnswer`; after the judge-file write block (`:168-173`) add `    if (leg.status === 'complete' && isPromotedLeg(leg)) { promotedJudge = true; }`? — NO: keep it simpler and local: at the SUCCESS push (after `:285`, where `ok: true` results are pushed — find `ok: true` in the file), add ONE line before the push: `    if (isPromotedLeg(leg)) { ctx.degrade.note(promotedJudgeNote(judge, seat, leg)); }`. Requires: `const { judgeDeadNote, promotedJudgeNote } = require('./run-stage2-notes');` and `const { isPromotedLeg } = require('./promoted');` beside the file's requires. Then `wc -l` — it must be ≤ 300 (expected ≈ 286); if the #202 comment block makes it exceed, move that comment with the function.

`degrade.js:49`: add `'judge-reasoning-only',` on its own line with the comment `// #257: a Stage-2 judge answered only in its reasoning channel and its fenced block still parsed — kind 'info', the adjudication counts.`

- [ ] **Step 4: Run the four files — expect PASS; every existing `stage2-judge` string byte-identical; `npm run check:sizes`.**

- [ ] **Step 5: Commit**

```bash
git add src/council/run-stage2.js src/council/run-stage2-notes.js src/utils/degrade.js tests/council
git commit -m "feat(council): a promoted judge is used only when its block parses, noted on judge-reasoning-only, and named in the thin-cross-review reason; the judge-death note moved to run-stage2-notes for headroom (#257)"
```

---

### Task 9: docs, CHANGELOG, MODEL-NOTES, BACKLOG

**Files:**
- Modify: `CHANGELOG.md` — a new `## [Unreleased]` section above `## [4.13.0] - 2026-09-18` with `### Changed`.
- Modify: `docs/configuration.md:172-184`, `docs/troubleshooting.md` (the `NO_OUTPUT_BACKSTOP`/`OUTPUT_LENGTH` region near `:246-260`: a new symptom entry), `docs/council.md` (the section "Leg completion and `session.status`" — grep it), `docs/usage.md` (grep `variantUnverified` — if the leg fields are listed, add `promoted`), `skills/second-opinion/MODEL-NOTES.md` (grep "answers only in its reasoning channel" — ONLY if the #135 block exists, rewrite its last sentence to "Since <next minor> amicus handles it: …"), `BACKLOG.md` (two lines: R1 solo notice candidate; R10 chair/debate/fallback readers).
- Tests: `tests/docs-quick-sync.test.js`, `tests/docs-plan-refs.test.js`, `npm run check:citations` — all must stay green; this task carries the "docs line?" answer for every ruling (R1–R12): each is either in the CHANGELOG bullet, a doc sentence, or a BACKLOG line.

- [ ] **Step 1: CHANGELOG bullet (write it, then re-read every clause against the code as merged in Tasks 2–8):**

```markdown
## [Unreleased]

### Changed

- **A seat that answers only in its reasoning channel no longer has its deliberation adjudicated
  as its review.** When the engine's last message carried reasoning and no text part, the mirror
  promotes the reasoning to the leg's output (so a solo `amicus start` still shows an answer —
  unchanged, and the leg's `metadata.json` now says `promoted: true`). A council now treats such a
  Stage-1 leg as no deliverable: it is not materialized as a review, the once-only Stage-1 retry
  fires, and a seat whose retry repeats it is a lost seat — dead-seat row, `seatLoss`, a `Notice:`,
  exit 2 — and the census counts it as not reviewed. Every announcement names the cause: `… with
  no usable output — it answered only in its reasoning channel (40332 reasoning / 1 output tokens,
  finish 'stop'), which is not a review …`. A Stage-2 judge that answers this way is used only when
  its fenced block parses (announced as a `Note:` on `judge-reasoning-only`); otherwise the
  thin-cross-review reason says `answered only in the reasoning channel with no parseable block`.
  The fact rides every leg document (`promoted: true`, emit-when-true, declared in
  `run.schema.json` and the tally schema). Measured motive: PR #254 round 1, where 40,332 reasoning
  tokens and 1 output token became a 149 KB "review", 92 % of the Stage-2 bundle; three of four
  judges died on it. **Upgrade note:** a seat that 4.13.0 counted as reviewed on a promoted answer
  is now retried and, if it repeats, counted lost, and the run exits 2; `finish: 'length'` with no
  text is still the `OUTPUT_LENGTH` death it was. (#257; closes the write-back half of #242's item 1
  by removing its worst input)
```

(Do NOT write "closes #242" — the sentence above deliberately says "closes the write-back half", with no bare keyword-number pair; keep it that way.)

- [ ] **Step 2: docs** — `configuration.md:179`'s paragraph gains, after "(L2/L4).": "A `finish: 'stop'` message with reasoning and no text is a different shape — it completes with its reasoning promoted to output, and since <next minor> a council treats that leg as no deliverable (#257): the once-only retry fires and the leg document carries `promoted: true`." `troubleshooting.md`: a new symptom "**Symptom:** a Stage-1 review file opens in the first person (`Let me carefully analyze…`) and carries no fenced block, or a seat is announced with `— it answered only in its reasoning channel …`" with the explanation and what to expect (retry, dead seat, `promoted: true` on `metadata.json`). `council.md` leg-completion section: one paragraph. `usage.md`: the field if the list exists.

- [ ] **Step 3: MODEL-NOTES and BACKLOG** as listed. BACKLOG lines:
  - "#257 R1 — a solo `amicus start` still prints promoted reasoning as the answer with no stderr line; `metadata.json` says `promoted: true`. Candidate: one `Note:` on stderr."
  - "#257 R10 — readers of a completed status this PR did not change: chair-fallback.js:87, run-chair.js:61, run-debate.js:61/84/267, run-debate-revote.js:172/240, fanout-leg-fallback.js:203. A promoted chair verdict or debate defense is the same disease on another surface; the `promoted` fact is on those legs already."

- [ ] **Step 4: Run `npm test` (the full suite, from the worktree) — expect 0 failures; `npm run lint`, `npm run check:sizes`, `npm run check:citations` exit 0.**

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md docs BACKLOG.md skills/second-opinion/MODEL-NOTES.md
git commit -m "docs(council): a promoted reasoning answer is not a deliverable — CHANGELOG with the upgrade note, configuration, troubleshooting, council, the schema field, and two BACKLOG lines (#257)"
```

---

### Task 10: whole-branch verification and the PR package

- [ ] **Step 1:** `git diff main...HEAD --stat`; re-read every sentence the branch adds to `CHANGELOG.md`, `docs/*.md` and every docblock against the final tree (failure modes #10, #43): grep the distinctive phrases repo-wide for twins.
- [ ] **Step 2:** `npm test` full suite from the worktree (writes `.test-passed`); `npm run lint`; `npm run check:sizes`; `npm run check:citations`; `npm run test:integration` (keyless).
- [ ] **Step 3:** Apply every named mutant once more against the FINAL tree and record the red set per mutant in the ledger (`.superpowers/sdd/2026-09-19-257-promoted-reasoning/mutants.md`); revert each; `git status` clean.
- [ ] **Step 4:** Write the PR body (title `council: a promoted reasoning answer is not a deliverable (#257)`; the body states decisions A and B, rulings R1–R12, the CHANGELOG bullet, the test map, the mutant table, and ends with the `🤖 Generated with [Claude Code](https://claude.com/claude-code)` line) to the ledger as `pr-body.md`. NO closing keyword before any issue number. Do NOT push or open the PR — the owner says when.

---

## Self-review (run by the plan author before dispatch)

1. **Spec coverage:** §3.1 → Task 2; §3.2 → Tasks 3, 4, 5; §3.3 → Task 7; §3.4 → Tasks 6, 7; §3.5 → Task 8; §3.6 → Task 7's tripwire; §4 fences → the byte-identity pins in Tasks 4, 5, 7, 8; R1/R10 → Task 9 BACKLOG; R8 → Task 9; R9 → Task 7; R11 → Task 8; R12 → Tasks 2, 3.
2. **Placeholders:** the three headless tests reference "the :114/:162/:95 fixture" — the implementer copies the harness from those existing tests (named by line and title); this is a pointer to real code, not a TBD. Task 6 names the test file's helpers by a range to read. No other pointers.
3. **Type consistency:** `promotedFacts` returns `{reasoning, output, finish}` (Task 1) and Task 7's `ff.promoted` and Task 8's note both read that shape; `reasoningOnlyClause` takes the facts object (or falsy) everywhere; `isPromotedLeg(leg)` is the only truth test; `judgeResults[].fromReasoning` is spelled identically in Tasks 8's producer and consumer.
4. **Line counts (measured on 7e2fc83f, re-measure at each task):** run-retry.js 300 → 300 (in-place only); resume.js 300 → 300 (in-place); result-schema.js 300 → 299; run-stage2.js 298 → ≈286; run-launch.js 282 → ≤ 286; run-stages.js 289 → 289; run-retry-group.js 266 → 267; run-retry-notes.js 226 → ≈ 227; tally.js 202 → 203; run-stats-entry.js 116 → 117; fanout-leg.js 292 → 293; session-utils.js 275 → 276; degrade.js 104 → 105; run-stage2-notes.js 97 → ≈ 135.

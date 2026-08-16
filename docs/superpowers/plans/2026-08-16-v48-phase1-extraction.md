# v4.8.0 Phase 1 — Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move two functions out of two size-gated files as **pure moves**, so the three consumers
that are blocked on `run-assemble.js`'s headroom and the two blocked on `report.js`'s can be built.

**Architecture:** Two PRs, one task each, each a byte-for-byte move into a new sibling module that
is re-exported from the original file so **no caller changes**. Pinned by function **identity**
(`toBe`), by a **mechanical byte-diff** of the moved block, and by **named mutants** that must go
RED. No behaviour changes, no renames, no reordering, no "improvements".

**Tech Stack:** Node.js (CommonJS), Jest, `scripts/check-file-sizes.js`, ESLint.

**Governing record:** `docs/superpowers/plans/2026-08-16-v48-phasing-and-rulings.md` §5 Phase 1 and
§6 "Hard prerequisites". Phase 0 (`…-v48-phase0-truth-pass.md`) landed first and committed the
re-measured size table this plan's numbers come from.

**Base:** `main`, after Phase 0 merges. **Two branches, two PRs** — `v48p1-runstats-extract` and
`v48p1-report-md-extract`.

---

## Why this is a prerequisite, not a cleanup

- **T1.1 gates three separate things** — Phase 3's `rankings[]` seat, #135's TTFT field, and
  carried PR1F-2. One extraction, three consumers.
- **T1.2 gates two** — Phase 2's T2.4 (SI-22.5 adds an "unattributed" column to `toModel`) and
  SI-25.
- `src/council/report.js` is at **298/300 — two lines of headroom.** The 300-line gate blocks the
  COMMIT, not the edit. When it fires the answer is to EXTRACT; shaving comments to fit is the
  documented failure tell in this project.

---

## Global Constraints

- **PURE MOVE. Byte-for-byte.** Not a rewrite, not a tidy-up. Do not rename anything, do not
  reorder statements, do not "fix" a comment inside the moved block, do not change formatting. The
  PR5b shape — byte-for-byte move, re-exported so no caller changes, pinned by function identity —
  earned the PR5 sequence's **only clean verdict (0/0/0/0)**. A behavioural test cannot catch the
  re-implementation drift that produced council-1's B1; only identity and a byte-diff can.
- **Verification by EXECUTION.** "Byte-for-byte" is a claim you must *measure*, not assert. Each
  task specifies a `diff` that must print nothing. Run it; paste the result.
- **Preservation pins are green at HEAD by construction.** Never write a RED-before-GREEN cycle for
  them. Pin each with a **NAMED MUTANT**: apply the mutant, observe the pin go RED, revert the
  mutant, observe GREEN again. Every mutant in this plan is named and its expected failure stated.
- **Commit BEFORE running mutants.** A mutant run over uncommitted work risks losing it.
  **Never run `git checkout -- <path>`** — it destroys uncommitted work. Revert a mutant with a
  precise reverse-edit, then confirm `git status --short` is clean.
- **Comments that describe the file can be invalidated by the move.** This is the exact Critical
  finding Phase 0's whole-branch review caught: a correction silently falsified the note describing
  it. After each move, re-read **every** comment in both touched files — module docblocks
  especially — and correct any the move made false. `src/council/report.js:49` currently describes
  its own import set; T1.2 changes that set.
- **New modules must not grow the gate's problem.** Each new file must be well under 300 lines.
- Hooks live in `.husky` (core.hooksPath). `pre-push` runs the full unit suite and BLOCKS; it skips
  only when `.test-passed` matches **HEAD exactly**. Run `npm test` **after** your final commit, or
  the hook re-runs the whole suite on push.
- `gh` requires `-R BourbonDog/amicus`. A bare `gh` defaults to upstream `jrenaldi79/sidecar`.
- **This repo has NO required status checks** — `gh pr merge --auto` merges IMMEDIATELY. Both PRs
  touch source: watch `gh pr checks <n> -R BourbonDog/amicus` explicitly and merge only when green.
- **Both PRs carry the `council-review` label.** Owner ruling (2026-08-16): *only doc-only PRs skip
  the council tag; everything touching source gets it.* A pure move is still a source change — and
  the drift class these pins exist to catch is exactly what a council reads for. Bench
  glm,qwen,gpt,kimi, chair deepseek, diff cap 240k; CI resolves aliases from
  `src/utils/curated-models.js` with no user config, so CI's glm/kimi are not the ones local
  overrides give you.

### Gates — all four must exit 0 before every commit

```bash
npm test
```
```bash
node scripts/check-file-sizes.js --all
```
```bash
npm run lint
```
```bash
npm run validate-docs
```

Baseline: **529 suites / 7472 passed / 8 skipped / 0 failed.** Each task ADDS tests, so the counts
must rise by exactly the number of tests you add and the failure count must stay **0**.

---

## Task 1: Extract `buildRunStatsEntry` → `src/council/run-stats-entry.js`

**PR A. Branch `v48p1-runstats-extract` off `main`.**

**Files:**
- Create: `src/council/run-stats-entry.js`
- Modify: `src/council/run-assemble.js` (remove `:46-95`, add a require + re-export)
- Test: `tests/council/run-stats-entry.test.js` (new)

**Interfaces:**
- Produces: `src/council/run-stats-entry.js` exporting `buildRunStatsEntry` — the **same function
  object** `require('./run-assemble').buildRunStatsEntry` returns.
- Consumes: nothing. **The new module must have ZERO `require(` calls.**

### Why require-free is a hard requirement, not a preference

`src/council/debate.js` is dependency-injection-free by design — measured:

```bash
grep -c "require(" src/council/debate.js
```
returns **0**. It therefore cannot import `run-assemble.js`, whose graph pulls `fs`, `path`,
`../utils/atomic-write`, `./findings`, `./anonymize`, `./seats` and `./run-verdict-files`. A
require-free `run-stats-entry.js` is importable from anywhere, including `debate.js`. A single
`require` in the new module forecloses that and silently re-couples the graph.

### The precedent to copy

`src/council/run-assemble.js` already does this twice, and says so in its own comments:
`preflightSeats`'s body lives in `./seats` and `writeVerdictFiles`'s in `./run-verdict-files`, each
re-exported "to keep the call spelling … and this file under the size gate". **Match that shape and
that comment style exactly.**

- [ ] **Step 1: Measure the baseline and the exact block**

```bash
awk 'END{print NR}' src/council/run-assemble.js
```
Expected: **297**. If it is not 297, stop and report — Phase 0 guaranteed this.

```bash
grep -c "require(" src/council/debate.js
```
Expected: **0**.

Confirm the block's exact bounds. At Phase 0's HEAD the docblock opens at `:46` (`/**`, the line
after `worseConformance`'s closing `}`), `function buildRunStatsEntry({ leg, model, …` is at `:69`,
and the function's closing `}` is at `:94`, with `:95` blank. **Verify these yourself** — print
`sed -n '44,48p;92,97p' src/council/run-assemble.js` and confirm — then use what you measured.

Record every consumer, so you can prove none of them changed:

```bash
grep -rn "buildRunStatsEntry" src/ tests/ electron/
```

- [ ] **Step 2: Create the new module**

`src/council/run-stats-entry.js`: a file header comment in the house style, `'use strict';`, then
the docblock and function **copied byte-for-byte** from `run-assemble.js:46-94`, then
`module.exports = { buildRunStatsEntry };`.

Header (adapt the wording, keep the facts):

```js
// src/council/run-stats-entry.js
'use strict';

/**
 * @module council/run-stats-entry
 * One runStats row from a leg run document. Extracted verbatim from
 * ./run-assemble (v4.8 Phase 1 T1.1) to give that file headroom under the
 * 300-line gate, and re-exported there so every existing call spelling —
 * `asm.buildRunStatsEntry(...)` and `require('./run-assemble').buildRunStatsEntry`
 * — survives the move untouched.
 *
 * ⚠️ This module is REQUIRE-FREE by design, like ./seats. Consumers that cannot
 * take run-assemble's graph (./debate.js is dependency-injection-free) must be
 * able to import it. Do not add a require here.
 */
```

**Do not edit a single character of the moved docblock or function body.**

- [ ] **Step 3: Rewire `run-assemble.js`**

Delete lines `:46-95` (the docblock, the function, and the trailing blank). Add the require beside
the two existing re-export requires, in the same comment style:

```js
// Same precedent (v4.8 Phase 1 T1.1): buildRunStatsEntry's body lives in
// ./run-stats-entry — which is require-free so consumers outside this file's
// graph can use it — and is re-exported here so every existing call spelling
// survives the move untouched.
const { buildRunStatsEntry } = require('./run-stats-entry');
```

`module.exports` already lists `buildRunStatsEntry` — **leave that line exactly as it is.** The
internal calls at `:217` and `:242` (pre-move numbering) also stay exactly as they are.

- [ ] **Step 4: Prove the move was byte-for-byte**

This is the pin that a behavioural test cannot provide. Extract the block from the **pre-move**
file in git and from the **new module**, by the line numbers you measured, and diff them:

```bash
git show HEAD:src/council/run-assemble.js | sed -n '46,94p' > /tmp/rse-before.txt
```
```bash
sed -n '<first>,<last>p' src/council/run-stats-entry.js > /tmp/rse-after.txt
```
```bash
diff /tmp/rse-before.txt /tmp/rse-after.txt && echo "PURE MOVE CONFIRMED"
```

Replace `<first>,<last>` with the docblock-open and function-close line numbers **in the new file**
— find them with `grep -n "One runStats row" src/council/run-stats-entry.js` and
`grep -n "^}" src/council/run-stats-entry.js`. Sanity-check that both temp files have the same line
count (`wc -l`) before you trust an empty diff.

The requirement is a **`diff` that prints nothing**, not a particular incantation. Paste the
commands and their output into your report. If the diff is non-empty you did not do a pure move:
fix it, do not explain it.

- [ ] **Step 5: Write the pins**

Create `tests/council/run-stats-entry.test.js`:

```js
// tests/council/run-stats-entry.test.js
'use strict';

const fs = require('fs');
const path = require('path');

const asm = require('../../src/council/run-assemble');
const rse = require('../../src/council/run-stats-entry');

describe('run-stats-entry — extraction pins (v4.8 Phase 1 T1.1)', () => {
  test('P1 — re-export is the SAME function object, not a copy', () => {
    expect(asm.buildRunStatsEntry).toBe(rse.buildRunStatsEntry);
  });

  // ⚠️ SUPERSEDED AS IMPLEMENTED (2026-08-16). This P2 was written and then
  // DELETED, its content folded into P1's comment. Two review rounds proved it
  // could never fail independently: CommonJS keeps ONE cache entry per resolved
  // absolute path, so "every consumer import path resolves to the same object"
  // is guaranteed by the module system once P1 holds — it is not pinnable by our
  // code, and a title claiming otherwise is the same overclaim defect this phase
  // exists to remove. Routing the assertion through a real consumer does NOT fix
  // it: the require's value is discarded and resolves to the same cache entry.
  // Ship two pins (P1 identity, P3 require-free), not three.
  test('P2 — every consumer import path resolves to that same object', () => {
    expect(require('../../src/council/run-assemble').buildRunStatsEntry)
      .toBe(require('../../src/council/run-stats-entry').buildRunStatsEntry);
  });

  test('P3 — the module is REQUIRE-FREE, so require-free consumers can import it', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../src/council/run-stats-entry.js'), 'utf8');
    expect(src.match(/require\(/g)).toBeNull();
  });
});
```

- [ ] **Step 6: Verify the size and run the gates**

```bash
awk 'END{print NR}' src/council/run-assemble.js
```
Expected: **247**. Report what you measured. Then all four gates.

- [ ] **Step 7: Commit**

```bash
git add src/council/run-stats-entry.js src/council/run-assemble.js tests/council/run-stats-entry.test.js && git commit -m "refactor: extract buildRunStatsEntry to run-stats-entry.js (pure move, 297 -> 247)"
```

- [ ] **Step 8: Run the named mutants — commit FIRST, then mutate**

Three mutants. For each: apply, run **only** the pin file, confirm the named test goes RED, then
reverse-edit and confirm GREEN. **Never `git checkout`.** Confirm `git status --short` is clean at
the end.

**MUTANT "COPY"** — the drift a behavioural test cannot catch. In `run-assemble.js`, replace the
`require('./run-stats-entry')` line with a duplicate `function buildRunStatsEntry(...)` definition
copied from the new module.
Expected: **P1 and P2 FAIL** (`toBe` — different function objects). If they pass, the pins are
worthless; stop and report.

**MUTANT "IMPORT"** — add `const fs = require('fs');` to `src/council/run-stats-entry.js`.
Expected: **P3 FAILS**.

**MUTANT "DRIFT"** — change one character inside the moved function body in
`run-stats-entry.js` (e.g. `'clean'` → `'cleam'`).
Expected: the **existing** suite fails — name which tests. This shows the moved body is genuinely
under test. Run the focused council tests, not the full suite.

```bash
npx jest tests/council/run-stats-entry.test.js
```

- [ ] **Step 9: Re-run the full gates, then push**

```bash
npm test
```
Run it **after** the final commit so `.test-passed` matches HEAD and the pre-push hook skips.

---

## Task 2: Extract `renderMd` → `src/council/report-md.js`

**PR B. Branch `v48p1-report-md-extract` off `main` (after PR A merges).**

**Files:**
- Create: `src/council/report-md.js`
- Modify: `src/council/report.js` (remove `fmtNum`, `fmtDur`, `renderMd`; drop two now-unused
  requires; make `buildReport`'s md branch a lazy require)
- Test: `tests/council/report-md.test.js` (new)

**Interfaces:**
- Produces: `src/council/report-md.js` exporting `renderMd(m)`, mirroring `report-html.js`'s
  `renderHtml(m)` exactly.
- Consumes: `{ TIER_ORDER, SYMBOL }` from `./report` — the same back-require `report-html.js:12`
  already does, which is proven to work because `buildReport` requires the renderer **lazily**.

### The precedent to copy, and the one deviation

`src/council/report-html.js` **is** this task's template: a renderer in its own module, taking the
neutral model, requiring `TIER_ORDER`/`SYMBOL` back from `./report`, exporting one function, and
invoked from `buildReport` through a **lazy** `require('./report-html').renderHtml(model)`.

**The one deviation from "no caller changes":** `renderMd` was never in `report.js`'s
`module.exports` (`module.exports = { buildReport, toModel, TIER_ORDER, SYMBOL, isSeatSpace }`), so
there is no external call spelling to preserve. Its only caller is `buildReport`, in the same file,
and that one line changes to the lazy-require form — byte-identical in shape to the html branch
directly above it. Everything exported from `report.js` stays exactly as it is.

### What moves, measured

Measured at Phase 0's HEAD (`report.js` = 298 lines) — **re-measure before you cut**:

| Symbol | Lines | Only caller(s) | Verdict |
|---|---|---|---|
| `fmtNum` | `:176` | `:227` (inside `renderMd`) | **moves** |
| `fmtDur` | `:177` | `:281` (inside `renderMd`) | **moves** |
| `renderMd` | `:179-286` | `buildReport` `:294` | **moves** |
| `formatCost` (require `:12`) | — | `:281`, `:282` — both inside `renderMd` | **require moves** |
| `formatDuration` (require `:13`) | — | `fmtDur` only | **require moves** |
| `formatDegrade` (require `:14`) | — | `:198` — inside `renderMd` | **require moves** |
| `sumWaveUsage` (require `:12`) | — | `:156` — inside `toModel` | **stays** |
| `TIER_ORDER`, `SYMBOL` | `:16-17` | `renderMd` **and** `module.exports` **and** `report-html.js:12` | **stay** — `report-md.js` requires them back |
| `isSeatSpace` | `:53` | `:79` inside `toModel`, and exported | **stays** |

So `report.js`'s require block reduces to `const { sumWaveUsage } = require('../utils/pricing');`.

- [ ] **Step 1: Re-measure before cutting**

```bash
awk 'END{print NR}' src/council/report.js
```
```bash
grep -n "fmtNum\|fmtDur\|formatCost\|sumWaveUsage\|formatDegrade\|formatDuration\|TIER_ORDER\|SYMBOL" src/council/report.js
```

Confirm every row of the table above against what you see. **If any helper has a caller outside
`renderMd` that the table missed, stop and report** — moving it would then be a behaviour change,
and duplicating it would be verbatim duplication of a logic block, which this project's review
rubric treats as a defect. Report it; do not decide it yourself.

- [ ] **Step 2: Capture the golden output BEFORE the move**

This is the one-shot proof that the rendered bytes did not shift. It is a **manual** check, not a
committed fixture — the committed pin is P1 in Step 6, which needs no golden blob.

`tests/council/report.test.js` already defines the canonical fixtures — `verdictFixture()` (`:7`,
used by the existing md test at `:13`), plus `lostVerdict()` and `twinCostVerdict()` for the
"what was lost" and twin cost-row paths. **Reuse them; do not invent a thinner one.** Capture all
three at HEAD, before you cut anything:

```bash
node -e "const t=require('./tests/council/report.test.js')" 2>/dev/null || true
```

Those fixtures are file-local to the test, so drive the capture by requiring the source directly
and inlining the same fixture bodies in a throwaway script under the scratchpad (**not** committed
— duplicating a fixture into a committed test would be verbatim duplication, which this project's
review rubric treats as a defect; that is exactly why the committed pin in Step 6 is written as a
self-comparison instead):

```bash
node <scratch>/capture-md.js > /tmp/report-md-golden.txt
```

Capture the md output for all three fixtures into that one file. It is the ground truth for Step 5.

- [ ] **Step 3: Create `src/council/report-md.js`**

House-style header, `'use strict';`, the requires the table says move, the back-require from
`./report`, then `fmtNum`, `fmtDur` and `renderMd` **copied byte-for-byte**, then
`module.exports = { renderMd };`.

```js
// src/council/report-md.js
'use strict';

/**
 * @module council/report-md
 * The markdown renderer for the neutral report model. Extracted verbatim from
 * ./report (v4.8 Phase 1 T1.2) to give that file headroom under the 300-line
 * gate — it was at 298/300, two lines from blocking its own next edit.
 * Mirrors ./report-html exactly: one renderer, one exported function, taking
 * the model ./report's toModel builds, and requiring TIER_ORDER/SYMBOL back
 * from ./report — safe because buildReport requires this module lazily.
 */
```

- [ ] **Step 4: Rewire `report.js`**

Delete `fmtNum`, `fmtDur` and `renderMd`. Delete the two now-unused requires and narrow the pricing
require to `sumWaveUsage`. Change `buildReport`'s md branch to mirror the html branch exactly:

```js
function buildReport(sources, opts = {}) {
  const model = toModel(sources.verdict, sources.wave);
  if (opts.format === 'html') { return require('./report-html').renderHtml(model); }
  return require('./report-md').renderMd(model);
}
```

`module.exports` stays **exactly** as it is.

⚠️ **Now re-read every comment in `report.js`.** `report.js:49` describes this file's own import
set ("six first-party modules and THIS file is one of them (it has imported SYMBOL …)"). You just
changed that set. Correct any comment the move made false — and correct it to what you **measure**,
not to what you assume. This is the exact defect class Phase 0's whole-branch review caught as
Critical: an edit that silently falsifies the note describing it.

- [ ] **Step 5: Prove byte-equality of the rendered output and of the moved block**

```bash
node -e "/* same fixture as Step 2 */ process.stdout.write(buildReport(sources,{format:'md'}))" > /tmp/report-md-after.txt && diff /tmp/report-md-golden.txt /tmp/report-md-after.txt
```
Must print **nothing**.

Then the block byte-diff, same method as Task 1 Step 4 — extract `:176-286` from
`git show HEAD:src/council/report.js` and diff it against the corresponding block in the new
module. Must print **nothing**. Paste both commands and their empty output.

- [ ] **Step 6: Write the pins**

**P1 goes in `tests/council/report.test.js`**, where `verdictFixture()` already lives — so the pin
reuses the canonical fixture instead of duplicating it into a new file. Add one test:

```js
  test('P1 — buildReport(md) routes through the extracted renderer, byte-identical', () => {
    // v4.8 Phase 1 T1.2: renderMd moved to ./report-md. This pins that buildReport's
    // md branch produces exactly what the extracted renderer produces — the move is a
    // route change, not a rewrite. Named mutant: change one character in report-md's
    // renderMd body and this goes RED.
    const { renderMd } = require('../../src/council/report-md');
    for (const v of [verdictFixture(), lostVerdict(), twinCostVerdict()]) {
      expect(buildReport({ verdict: v }, { format: 'md' })).toBe(renderMd(toModel(v)));
    }
  });
```

Check `toModel`'s import and each fixture helper's name against the file before you write this —
`lostVerdict` and `twinCostVerdict` were measured present at `report.test.js:158`/`:241`, but
confirm their spellings and whether `toModel` is already imported there.

**P2 and P3 go in a new `tests/council/report-md.test.js`** — they are module-shape pins and need
no fixture:

```js
// tests/council/report-md.test.js
'use strict';

const { toModel } = require('../../src/council/report');
const { renderMd } = require('../../src/council/report-md');

describe('report-md — extraction pins (v4.8 Phase 1 T1.2)', () => {
  test('P2 — the exported renderer is a stable single object', () => {
    expect(require('../../src/council/report-md').renderMd).toBe(renderMd);
  });

  test('P3 — the require cycle survives loading report-md FIRST', () => {
    // report-md requires ./report at load for TIER_ORDER/SYMBOL; report requires
    // ./report-md lazily inside buildReport. Loading report-md first is the order
    // that breaks if either side becomes eager. Named mutant: MUTANT "EAGER".
    jest.resetModules();
    const md = require('../../src/council/report-md');
    expect(typeof md.renderMd).toBe('function');
    expect(md.renderMd(toModel({ runId: 'x', findings: [], seats: [], judges: [] })))
      .toContain('|');
  });
});
```

The minimal object in P3 must be whatever `toModel` accepts without throwing — check `toModel`'s
guards (`report.js:59-79`) and use the smallest verdict that passes them. If it needs more keys,
add them; do not reach for a full fixture, and do not copy one in.

- [ ] **Step 7: Verify sizes and run the gates**

```bash
awk 'END{print NR}' src/council/report.js
```
Expected: roughly **185** (298 − 111 moved − 2 dropped requires). Report the number you measured;
it does not have to hit 185 exactly, but it must be well clear of 300 and you must explain any
large difference.
```bash
awk 'END{print NR}' src/council/report-md.js
```
Then all four gates.

- [ ] **Step 8: Commit**

```bash
git add src/council/report-md.js src/council/report.js tests/council/report-md.test.js && git commit -m "refactor: extract renderMd to report-md.js (pure move, 298 -> 185)"
```

Use the number you actually measured in the message.

- [ ] **Step 9: Run the named mutants — commit FIRST, then mutate**

**MUTANT "DRIFT"** — change one character inside the moved `renderMd` body in `report-md.js`
(e.g. a table separator `| **Wave total** |` → `| **Wave totaI** |`).
Expected: **P1 FAILS** on byte-equality, and existing `report.test.js` md assertions fail. Name
which.

**MUTANT "STALE"** — in `report.js`, leave `buildReport`'s md branch calling a bare `renderMd(model)`
(now undefined in that scope).
Expected: **P1 and P3 FAIL** with a `ReferenceError`. This pins that the rewire is real and not
shadowed by a leftover local.

**MUTANT "EAGER"** — change `report.js`'s md branch from the lazy `require('./report-md').renderMd(model)`
to a top-of-file `const { renderMd } = require('./report-md');`.
Expected: **P3 FAILS** (or the module throws on load) because the require cycle becomes eager on
both sides. If it does NOT fail, say so — that is a real finding about the cycle's tolerance and it
changes what P3 is worth.

Reverse-edit each mutant, confirm GREEN, and confirm `git status --short` is clean.

- [ ] **Step 10: Re-run the full gates, then push**

```bash
npm test
```
After the final commit, so `.test-passed` matches HEAD.

---

## Done criteria

**PR A:** `src/council/run-assemble.js` = **247**; `src/council/run-stats-entry.js` has **zero**
requires; `asm.buildRunStatsEntry === require('./run-stats-entry').buildRunStatsEntry`; the block
byte-diff is empty; MUTANT "COPY" was observed RED; no consumer file changed.

**PR B:** `src/council/report.js` well under 300 and `report-md.js` created; `buildReport(md)` output
byte-identical to the golden capture; the block byte-diff is empty; MUTANT "DRIFT" was observed RED;
`report.js`'s `module.exports` unchanged; every comment the move falsified corrected.

**Both:** four gates exit 0; suite failures **0**; the `council-review` label applied (both PRs
touch source); checks watched explicitly before merge because this repo has no required status
checks.

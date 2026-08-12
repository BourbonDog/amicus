# v4.8 PR0 — Extractions + fake-launchers taskId Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the line-gate headroom the v4.8 seat-identity waves need, with **zero behavior change** — six file extractions plus one test-helper truthfulness fix.

**Architecture:** Each extraction moves a verified block verbatim into a new sibling module and keeps the old module as the import surface via house-style re-exports (the `fanout-wave-io` pattern: explanatory require comment at the top, re-listed names in the tail `module.exports`). The fake-launchers change makes test fakes emit leg ids the real engine could actually produce (`<waveId>-<i+1>`, per `deriveLegIds`).

**Tech Stack:** Node ≥22.12 CommonJS (**CLAUDE.md:718-722 claims `"type": "module"` ESM — that is FALSE, there is no `type` field; write CommonJS**), jest, eslint.

**Provenance:** spec §PR0 table (`docs/superpowers/specs/2026-08-10-v4.8-ask-anything-count-everyone-design.md:526-542`), re-measured at `e8406db` on 2026-08-12 by an 8-agent recon, then adversarially refuted by a 5-agent pass (155 claims checked, 13 findings — 2 Critical, 5 Important, 6 Minor — all folded into the task text below). Where this plan contradicts the spec table (leg-ids block size, live-model projection, the "unpinned convention" claim), **this plan is the corrected record** — corrections are integrated into task text, never an errata appendix.

## Global Constraints

- Hard **300 lines/file** gate: `scripts/check-file-sizes.js:18-19` — `maxLines: 300`, include `['src/**/*.js', 'electron/**/*.js']` (tests/ and scripts/ are NOT gated). Comparison is `adjustedCount > limit` after stripping one trailing newline: **300 passes, 301 fails.** Pre-commit runs it on staged files; CI runs `--all`.
- `npm test` must run before `git push` — the pre-push hook re-runs the FULL suite unless `.test-passed` matches HEAD.
- Never `npm test -- <path>` — it stamps `.test-passed` and makes pre-push SKIP the suite. Single suites use bare `npx jest <path>`.
- Never pipe gates through `| tail` — it masks exit codes.
- **Documentation Sync HARD RULE** (CLAUDE.md:690-692): any commit that adds a file under `src/` must update CLAUDE.md in the same commit. The pre-commit `generate-docs` step regenerates and **auto-stages** the AUTO sections — expect CLAUDE.md to appear in your commit; do not unstage it.
- Commit style for behavior-preserving splits (house precedent `c4fab67`, `96bee34`, `1dbd0d5`): `refactor(scope): extract X to path.js` with a "zero behavior" note in the body.
- eslint: new `src/` files get `no-console: error`; files under `electron/workspace-ui/` inherit the `.eslintrc.js:49-74` override — browser env, `node: false`, only `module` whitelisted (Task 5 adds `require`), `no-var: off` **deliberately** (never change that to `warn`).
- jest: helpers under `tests/` must NOT end in `.test.js`; `testPathIgnorePatterns` includes `worktrees` — worktrees must be SIBLINGS (`../amicus-wt-*`), never under `.claude/worktrees/`.
- Comment hygiene in `electron/`: write `PR 102`, never `#102` — `electron-token-drift.test.js:80`'s HEX_RE matches `#NNN`.
- Line endings: `.gitattributes` sets `eol=lf`. Edit normally.

---

## Scope note — what is NOT in this plan

- **`retryStage1Losses` stays in `run-retry.js`.** The spec's loose phrase "extract retryStage1Losses" (spec :64/:538) means *relieve the file it lives in*; the function itself (152 lines at `run-retry.js:142-293`) would drag `briefingFor` and every top require with it and gut the module. The Task 2 lift is what the spec's own table row specifies.
- **No BACKLOG.md edits** — its stale citations and queue/history split have their own plan (owner rulings 2026-08-12).
- **No new pin for the leg-id convention** — spec §10.7's "unpinned" claim is FALSE: `tests/sidecar/fanout.test.js:84-93` has pinned `deriveLegIds('deadbeef', 3) → ['deadbeef-1','deadbeef-2','deadbeef-3']` plus TASK_ID_PATTERN conformance since the original F4 commit. It keeps working through Task 6's re-export, untouched.
- **PR1's `seats.js` and everything behavioral** — this PR ships alone, green, zero behavior change.

## File Structure

| Task | From (size at e8406db) | To (new) | After (measured, not the spec's estimate) |
|---|---|---|---|
| 1 | `src/council/run.js` 295 | `src/council/run-finish.js` | ~252 / new ~75 |
| 2 | `src/council/run-retry.js` 295 | `src/council/run-retry-group.js` | ~195 / new ~115 |
| 3 | `src/council/run-stages.js` 291 | `src/council/run-stage1-rows.js` | ~243 / new ~70 |
| 4 | `src/council/briefings-stage2.js` 287 | `src/council/briefings-chair.js` | ~154 / new ~145 |
| 5 | `electron/workspace-ui/live-model.js` 294 | `electron/workspace-ui/live-seats.js` | ~63 / new ~245 (+ `.eslintrc.js`, `index.html`, `script-load-order.js`) |
| 6 | `src/sidecar/fanout.js` 300 | `src/sidecar/leg-ids.js` | ~294 / new ~21 — **buys ~6 lines, not the spec's ~26; kept because 300/300 blocks every future edit** |
| 7 | `tests/council/helpers/fake-launchers.js` 172 + 4 local clones | in place + `tests/council/fake-launchers-ids.test.js` (new) | ~176 |

Every task is independent of the others. Each ends green and committed.

---

## Task 1: Extract the final-tally/ledger/artifact block to `run-finish.js`

**Files:**
- Create: `src/council/run-finish.js`
- Modify: `src/council/run.js` (block `:242-288`; requires near `:36`; destructure at `:240`)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `finishRun({ o, chairRes, debatedInput, debateFindings, appendRunFn, degrade, deadWaves, now })` — void. Later PRs call nothing new; `run.js`'s export surface (`runCouncil`, `pickFallbackChair`, `SIGNAL_EXIT`) is unchanged.

**Verified facts you must respect:**
- The block is `run.js:242-288`: opens with the section comment `// ---- Final tally (chair row included) + ledger + artifacts ----` (:242), last code line is `:287` (`emitStageTerminal(... 'verdict', 'complete', ...)`), `:288` is blank. **There is no closing comment** — `:289` `return finalize(degraded.value ? 2 : 0);` is OUTSIDE the block and stays. Do not overrun.
- Nothing defined in the block (`chairStats`, `giveUpRow`, `finalInput`, `record`, `tallyStage`) is referenced after `:288`, and the block never mutates `degraded.value` — so `finishRun` returns nothing.
- **Name hazard:** `src/council/run-finalize.js` already exists (exit codes + terminal write). The new file's header comment must disambiguate.

- [ ] **Step 1: Baseline the covering suites**

Run: `npx jest tests/council/run-chair.test.js tests/council/run-chair-seam.test.js tests/council/run-debate.test.js tests/council/run-happy.test.js tests/council/run-degrade.test.js`
Expected: PASS (record the counts — they must be identical after the lift).

- [ ] **Step 2: Create `src/council/run-finish.js`**

```js
// src/council/run-finish.js
'use strict';
// Final tally (chair row included) + ledger gate + tally/verdict artifacts.
// Moved verbatim from run.js:242-288 (v4.8 PR0 size-gate split, zero
// behavior). NOT run-finalize.js — that sibling owns exit codes and the
// terminal write; this module builds the final tally, appends the run
// record to the ledger (skipped for lens runs), and writes the
// tally/verdict artifact files + their stage events.
const { tally } = require('./tally');
const { decorateRecord } = require('./debate');
const runState = require('./run-state');
const asm = require('./run-assemble');
const { emitStageStarted, emitStageTerminal } = require('../observe/events');

/**
 * Build the final tally, gate the ledger append, write tally+verdict
 * artifacts and their stage checkpoints. Void — run.js's trailing
 * `return finalize(...)` reads only degraded.value, which this never
 * mutates.
 */
function finishRun({ o, chairRes, debatedInput, debateFindings, appendRunFn, degrade, deadWaves, now }) {
  const { chairLeg, actualChair, chairText, chairConformance, overallVerdict, chairRows, chairAttempts } = chairRes;
  // <BODY: run.js lines 243-287 moved verbatim, unindented one level if
  // the original nesting requires it — the implementer verifies each
  // identifier the body references is either a parameter above, a
  // destructured chairRes field, or one of this file's five requires.>
}

module.exports = { finishRun };
```

The `<BODY: …>` marker is the ONLY non-literal part: the body is a verbatim move of `run.js:243-287` — copy it exactly; do not retype it. If any identifier in the moved body is not covered by the parameters/requires above, STOP and report (that is a plan defect, not something to patch silently).

- [ ] **Step 3: Rewire `run.js`**

Add with the other council requires (near `:36`, alphabetical placement with its neighbors):

```js
const { finishRun } = require('./run-finish');
```

**Delete `const { decorateRecord } = require('./debate');` at `run.js:30`** — its only call site (`:270`) moves into the block, and `no-unused-vars: error` fails the pre-commit lint otherwise (run-finish.js carries its own `./debate` require).

**Delete the `:240` destructure line entirely** — all seven destructured names (`chairLeg`, `actualChair`, `chairText`, `chairConformance`, `overallVerdict`, `chairRows`, `chairAttempts`) are used only inside the moved block (refuter-verified: nothing between `:289` and EOF references any of them). `chairRes` itself stays live (`:239` guard + the `finishRun` argument). `run.js` lands ~250.

Replace lines `:242-288` (comment through blank line, NOT `:289`) with:

```js
    // Final tally + ledger + artifacts live in ./run-finish (v4.8 PR0 size-gate split).
    finishRun({ o, chairRes, debatedInput, debateFindings, appendRunFn, degrade, deadWaves, now });
```

- [ ] **Step 4: Repoint the rotting comment citations**

- `tests/workspace/live-model.test.js:96` cites `src/council/run.js:271` (the lens/ledger gate) — that line moves; repoint to its `run-finish.js` location (verify the number in the new file).
- `tests/workspace/run-detail.test.js:72` cites `run.js:283-285` (already drifted) — repoint to `run-finish.js` while there.
- Leave a note in your report for the PR1 author: the spec's `run.js:271-275`/`:273` appendRun-gate anchors (spec `:317`, `:335`) now live in `run-finish.js`.

- [ ] **Step 5: Re-run the Step 1 suites**

Run: the same `npx jest` command from Step 1.
Expected: PASS with identical counts.

- [ ] **Step 6: Run the whole council set**

Run: `npx jest tests/council`
Expected: PASS, 0 failures.

- [ ] **Step 7: Size-check both files**

Run: `node scripts/check-file-sizes.js --all`
Expected: silent exit 0. (`run.js` ~250, `run-finish.js` ~75.)

- [ ] **Step 8: Commit**

```bash
git add src/council/run.js src/council/run-finish.js tests/workspace/live-model.test.js tests/workspace/run-detail.test.js CLAUDE.md
git commit -m "refactor(council): extract final tally + ledger + artifacts to run-finish.js

Zero behavior. run.js 295 -> ~250; the moved block is run.js:242-288
verbatim; the now-unused decorateRecord require and the fully-block-scoped
chairRes destructure are removed. Export surface unchanged."
```

---

## Task 2: Extract the loss-grouping trio to `run-retry-group.js`

**Files:**
- Create: `src/council/run-retry-group.js`
- Modify: `src/council/run-retry.js` (block `:24-126`; require at top)
- Modify: `electron/workspace-ui/workspace-seats.js:52` and `src/headless.js:177` (comment citations only)

**Interfaces:**
- Consumes: nothing.
- Produces: `run-retry-group.js` exports `{ lensIndexOf, recordFailure, groupStage1Losses }`; `run-retry.js` continues to export `{ groupStage1Losses, retryStage1Losses }` (re-export, import paths stable).

**Verified facts:**
- `:24-126` contains exactly the three symbols (`lensIndexOf` :24-30 with doc, `recordFailure` :32-46, `groupStage1Losses` :48-126); `:23`/`:127` are blank. The block is **pure** — it references only parameters and JS builtins, none of the file's five requires. The new file needs zero requires.
- `retryStage1Losses` calls `groupStage1Losses` at `:158`, so `run-retry.js` needs the require regardless — and the existing `module.exports` line `:295` already names `groupStage1Losses`, making the re-export free.
- The only test importer is `tests/council/run-retry.test.js:4`: `const { groupStage1Losses, retryStage1Losses } = require('../../src/council/run-retry');` — stays green through the re-export.
- `tests/council/run-retry.test.js:419-431` is a source pin that fs-reads `run-retry.js` asserting no `degraded.value =` assignment. The moved block contains no such assignment, but the new file must fall inside `tests/council/degrade-invariant.test.js`'s repo-wide scan — **Step 5 verifies that**.

- [ ] **Step 1: Baseline**

Run: `npx jest tests/council/run-retry.test.js tests/council/degrade-invariant.test.js`
Expected: PASS.

- [ ] **Step 2: Create `src/council/run-retry-group.js`**

```js
// src/council/run-retry-group.js
'use strict';
// Stage-1 loss grouping: lensIndexOf + recordFailure + groupStage1Losses.
// Moved verbatim from run-retry.js:24-126 (v4.8 PR0 size-gate split, zero
// behavior). Pure — parameters and builtins only, no requires.
// run-retry.js re-exports groupStage1Losses so existing import paths
// (tests/council/run-retry.test.js) stay stable.

// <BODY: run-retry.js lines 24-126 moved verbatim.>

module.exports = { lensIndexOf, recordFailure, groupStage1Losses };
```

- [ ] **Step 3: Rewire `run-retry.js`**

At the top, after the existing five requires (`:17-22`):

```js
// Loss grouping lives in ./run-retry-group (v4.8 PR0 size-gate split).
// groupStage1Losses is re-exported below — run-retry.test.js imports it
// from here.
const { groupStage1Losses } = require('./run-retry-group');
```

Delete lines `:24-126` (collapse the doubled blank line at the seam). The `module.exports` line is untouched — it is now the re-export.

- [ ] **Step 4: Update EVERY rotting comment citation in the two files**

- `electron/workspace-ui/workspace-seats.js:52-53` carries FOUR `run-retry.js` refs in one sentence — `:98` plus `:86/:90/:93` — all four fall inside the moved block and now live in `run-retry-group.js` (and the `:86/:90/:93` trio is already off-by-one vs the actual literals at `:87/:91/:94` — fix that while repointing; verify against the new file).
- `src/headless.js` carries TWO refs: `:177` cites `run-retry.js:154` and `:181` cites "(line 186)" — both cited lines stay in `run-retry.js` but shift up ~100 lines; verify the post-edit numbers before writing them.

- [ ] **Step 5: Verify the degrade-invariant scan covers the new file**

Read `tests/council/degrade-invariant.test.js`'s file-collection glob. If `src/council/run-retry-group.js` falls inside it, done. If not, STOP and report — that scan is the invariant's only net over the new file.

- [ ] **Step 6: Re-run Step 1 suites + the council set**

Run: `npx jest tests/council/run-retry.test.js tests/council/degrade-invariant.test.js` then `npx jest tests/council`
Expected: PASS, identical counts on the first pair.

- [ ] **Step 7: Commit**

```bash
git add src/council/run-retry.js src/council/run-retry-group.js electron/workspace-ui/workspace-seats.js src/headless.js CLAUDE.md
git commit -m "refactor(council): extract stage-1 loss grouping to run-retry-group.js

Zero behavior. run-retry.js 295 -> ~195; block :24-126 moved verbatim;
groupStage1Losses re-exported so import paths are stable. Six comment
citations across workspace-seats.js and headless.js repointed."
```

---

## Task 3: Extract the dead-seat rows block to `run-stage1-rows.js`

**Files:**
- Create: `src/council/run-stage1-rows.js`
- Modify: `src/council/run-stages.js` (block `:230-279`; require at top)

**Interfaces:**
- Consumes: nothing.
- Produces: `pushDeadSeatRows({ o, retry, deadLegs0, stillDeadLegs, stillDeadWaves, extraRows, roleFor })` — mutates `extraRows`, returns nothing.

**Verified facts:**
- `:230-279` is **inline statement code inside `runStage1`**, not functions — the lift wraps it in a new named function. Its named bindings are four function-local consts (`supersededAliases` :237, `retryLegByAlias` :261, `attemptedAliases` :263, `deadAliases` :267).
- The label "extraRows" in the spec row is loose: `const extraRows = []` (:120) and the repair-row push (:181) STAY in `run-stages.js`. The block holds only the superseded rows (:230-246) and primary-error dead-seat rows (:248-279).
- **Cycle hazard:** the block calls `roleFor(o, alias)` at `:278`; `roleFor` is defined in `run-stages.js:34` and exported (consumed by `src/observe/council-legs.js:36`). Requiring it back from the new file would recreate the parent-child require cycle `run-stages.js:285-290`'s own comment documents eliminating (v4.4.1 F5). **Pass `roleFor` as a parameter.**
- The same v4.8 spec separately targets `run-stages.js:267-270` (dead-twin collapse) for later seat-keyed rework — landing this lift first is why PR0 exists; do not "improve" the moved code.

- [ ] **Step 1: Baseline**

Run: `npx jest tests/council/run-stages.test.js tests/council/budget-reservation.test.js tests/council/degrade-channels.test.js tests/observe/council-legs.test.js`
Expected: PASS (`run-stages.test.js:566-700` is THE behavior pin for this block).

- [ ] **Step 2: Create `src/council/run-stage1-rows.js`**

```js
// src/council/run-stage1-rows.js
'use strict';
// Superseded-seat rows + primary-error dead-seat rows (v4.7 D2/E4), moved
// verbatim from run-stages.js:230-279 (v4.8 PR0 size-gate split, zero
// behavior). The code ran inline in runStage1; it is now a function.
// roleFor is a PARAMETER, not a require — requiring it back from
// run-stages would recreate the parent-child cycle that file's tail
// comment documents eliminating (v4.4.1 F5).
const { buildRunStatsEntry } = require('./run-assemble');

/** Push superseded-seat and primary-error dead-seat rows onto extraRows. */
function pushDeadSeatRows({ o, retry, deadLegs0, stillDeadLegs, stillDeadWaves, extraRows, roleFor }) {
  // <BODY: run-stages.js lines 230-279 moved verbatim.>
}

module.exports = { pushDeadSeatRows };
```

- [ ] **Step 3: Rewire `run-stages.js`**

Require at top (with the neighboring `./run-assemble` / `./run-stage2` requires):

```js
const { pushDeadSeatRows } = require('./run-stage1-rows');
```

Replace `:230-279` with:

```js
  // Superseded + dead-seat rows live in ./run-stage1-rows (v4.8 PR0 size-gate split).
  pushDeadSeatRows({ o, retry, deadLegs0, stillDeadLegs, stillDeadWaves, extraRows, roleFor });
```

- [ ] **Step 4: Re-run Step 1 suites, then the council + observe sets**

Run: the Step 1 command, then `npx jest tests/council tests/observe`
Expected: PASS, identical counts on the pinned suite.

- [ ] **Step 5: Commit**

```bash
git add src/council/run-stages.js src/council/run-stage1-rows.js CLAUDE.md
git commit -m "refactor(council): extract dead-seat/superseded rows to run-stage1-rows.js

Zero behavior. run-stages.js 291 -> ~243; inline block :230-279 becomes
pushDeadSeatRows(); roleFor passed as a parameter to avoid the v4.4.1-F5
require cycle."
```

---

## Task 4: Extract the chair briefing surface to `briefings-chair.js`

**Files:**
- Create: `src/council/briefings-chair.js`
- Modify: `src/council/briefings-stage2.js` (chunks `:16-20` and `:154-279`, plus `dateLine` `:22-23`; module.exports block `:281-287` becomes the re-export surface)

**Interfaces:**
- Consumes: nothing.
- Produces: `briefings-chair.js` exports `{ dateLine, CHAIR_NO_TOOLS_PREAMBLE, CHAIR_VERDICT_VALUES, VERDICT_SCALE_ADDENDUM, CHAIR_TASK, CHAIR_TASK_NO_FINDINGS, buildChairPacket, buildChairRepairPrompt }` (`orNone` stays private). `briefings-stage2.js` re-exports every one of those names — importers of moved names (`run-chair.js:18`, `run-assemble.js:238`, `briefings-debate.js:14`, three test files) keep their current require paths. Two further importers consume only STAYING judge names and need no edits: `src/council/run-stage2.js:22` (`buildJudgeBundle`, `buildJudgeRepairPrompt`) and `tests/council/run-stages.test.js:992` (`JUDGE_NO_TOOLS_PREAMBLE`).

**Verified facts:**
- **The move is TWO chunks**: `:16-20` (`CHAIR_NO_TOOLS_PREAMBLE` + `CHAIR_VERDICT_VALUES`) and `:154-279` (`VERDICT_SCALE_ADDENDUM` :154-172, `CHAIR_TASK` :174-180, `CHAIR_TASK_NO_FINDINGS` :182-204, `orNone` :206-209 — **unlisted in the spec but chair-only; it moves**, and the contiguous cut captures it — `buildChairPacket` :211-251, `buildChairRepairPrompt` :253-279). Total 131 lines.
- **Circular-require trap:** `dateLine` (:22-23) is used by BOTH the staying `buildJudgeBundle` (:105) and the moving `buildChairPacket` (:236), and `briefings-debate.js:14` imports it from briefings-stage2. If `briefings-chair.js` requires it back from `./briefings-stage2`, the cycle resolves `dateLine` to `undefined` at load and every dated chair packet crashes. **Fix: `dateLine` MOVES to `briefings-chair.js`** — the new file has zero requires; stage2 gets `dateLine` via its require of the new module and keeps re-exporting it.
- `parse-stage2.js:16` has an independent local `CHAIR_VERDICTS` copy — NOT an import; leave it alone.

- [ ] **Step 1: Baseline**

Run: `npx jest tests/council/briefings-stage2.test.js tests/council/briefings-debate.test.js tests/council/briefings.test.js tests/council/run-chair.test.js`
Expected: PASS.

- [ ] **Step 2: Create `src/council/briefings-chair.js`**

```js
// src/council/briefings-chair.js
'use strict';
// Chair briefing surface: packet, repair prompt, verdict scale, task
// templates, no-tools preamble. Moved verbatim from briefings-stage2.js
// (chunks :16-20 and :154-279 at e8406db; v4.8 PR0 size-gate split, zero
// behavior). dateLine lives HERE (not required back from stage2) because
// stage2 requires this module — a back-require would be a cycle that
// resolves dateLine to undefined at load. briefings-stage2.js re-exports
// every public name below so existing import paths stay stable.

// <BODY: briefings-stage2.js lines 16-20, then 22-23 (dateLine), then
//  154-279, each moved verbatim in that order.>

module.exports = {
  dateLine,
  CHAIR_NO_TOOLS_PREAMBLE,
  CHAIR_VERDICT_VALUES,
  VERDICT_SCALE_ADDENDUM,
  CHAIR_TASK,
  CHAIR_TASK_NO_FINDINGS,
  buildChairPacket,
  buildChairRepairPrompt,
};
```

- [ ] **Step 3: Rewire `briefings-stage2.js`**

Require at top:

```js
// Chair surface lives in ./briefings-chair (v4.8 PR0 size-gate split).
// Every chair name is re-exported below — run-chair.js, run-assemble.js,
// briefings-debate.js and the briefings tests import them from here.
const chair = require('./briefings-chair');
```

Delete the moved chunks (`:16-20`, `:22-23`, `:154-279`). Point `buildJudgeBundle`'s `dateLine` use (:105) at `chair.dateLine` (or destructure `const { dateLine } = chair;` — one line, implementer's pick). Rewrite the `module.exports` block so every moved name re-exports from `chair` (e.g. `buildChairPacket: chair.buildChairPacket,`) while the staying judge names export as before.

- [ ] **Step 4: Re-run Step 1 suites + council set**

Run: the Step 1 command, then `npx jest tests/council`
Expected: PASS, identical counts.

- [ ] **Step 5: Commit**

```bash
git add src/council/briefings-stage2.js src/council/briefings-chair.js CLAUDE.md
git commit -m "refactor(council): extract the chair briefing surface to briefings-chair.js

Zero behavior. briefings-stage2.js 287 -> ~154; two chunks moved verbatim
(incl. the unlisted orNone helper); dateLine moves too — a back-require
would cycle to undefined. All names re-exported; import paths stable."
```

---

## Task 5: Extract the seats surface to `live-seats.js`

**Files:**
- Create: `electron/workspace-ui/live-seats.js`
- Modify: `electron/workspace-ui/live-model.js` (block `:53-285`), `electron/workspace-ui/index.html` (script tag), `tests/workspace/helpers/script-load-order.js:22-32` (SCRIPT_LOAD_ORDER), `.eslintrc.js` (workspace-ui override globals), `electron/workspace-ui/workspace-seats.js:47,:73,:108` (comment citations)

**Interfaces:**
- Consumes: nothing.
- Produces: `live-seats.js` defines `dash`, `seatCells`, `SEATS_PANEL_EXCLUDED_ROLES`, `seatsFromRunStats`, `deadSeats`, published as `window.AmicusLiveSeats` (**`window.AmicusSeats` is TAKEN** by `workspace-seats.js:195`) and `module.exports`. `live-model.js` re-exports `dash`, `seatCells`, `seatsFromRunStats`, `deadSeats` on its existing `window.AmicusLive` api — **zero renderer-consumer edits** (`workspace-render.js:203`, `workspace-seats.js:83,:126,:151,:191` keep calling `window.AmicusLive.*`).

**Verified facts (the spec row's ~180 projection is WRONG — never true at any commit):**
- The lift is `:53-285`: `dash` (:53-55) + the contiguous `:57-285` run (`seatCells` :57-95, `SEATS_PANEL_EXCLUDED_ROLES` :97-111 — **unlisted in the spec; used only by `seatsFromRunStats`; it moves** — `seatsFromRunStats` :113-131, `deadSeats` :133-285 whose docblock alone is 76 lines). That is 233 lines: `live-model.js` lands ~63, `live-seats.js` ~245.
- **`dash` moves** (not required back): the block's single in-file dependency. If `live-model.js` re-exports via `require('./live-seats')`, live-seats must NOT require live-model back — the cycle silently yields an empty exports object in jest (module.exports is assigned at IIFE end, `live-model.js:292`).
- **Renderer module pattern** (must match): plain `<script>` tags under strict CSP; each file is an ES5 IIFE with dual export — `if (typeof module !== 'undefined' && module.exports) { module.exports = api; } if (typeof window !== 'undefined') { window.AmicusLiveSeats = api; }`.
- **eslint blocks a bare `require` today**: `.eslintrc.js:49-74` sets `node: false` for `electron/workspace-ui/**` with only `module` whitelisted — add `require: 'readonly'` to that override's globals with a note mirroring the existing `module` note (:52-55).
- Load order: `live-seats` loads BEFORE `live-model` (live-model's bridge reads `window.AmicusLiveSeats` in the browser). Add it to BOTH `SCRIPT_LOAD_ORDER` and `index.html:101-115` — `workspace-ui-static.test.js:25-38` asserts they match.
- Token-drift: the moved block scans clean (verified); keep the `PR 102`-not-`#102` comment convention (`live-model.js:174` models it).

- [ ] **Step 1: Baseline**

Run: `npx jest tests/workspace/live-model.test.js tests/workspace/dead-seat-rows.test.js tests/workspace/workspace-render.test.js tests/workspace/workspace-seats.test.js tests/electron/workspace-ui-static.test.js tests/electron/electron-token-drift.test.js`
Expected: PASS. (**`workspace-ui-static.test.js` lives in `tests/electron/`, not `tests/workspace/`** — jest silently ignores a positional pattern that matches nothing, which would skip the one assertion pinning index.html's script tags to SCRIPT_LOAD_ORDER.)

- [ ] **Step 2: Create `electron/workspace-ui/live-seats.js`**

```js
// electron/workspace-ui/live-seats.js
// Seats surface: dash, seatCells, SEATS_PANEL_EXCLUDED_ROLES,
// seatsFromRunStats, deadSeats. Moved verbatim from live-model.js:53-285
// (v4.8 PR0 size-gate split, zero behavior). Loads BEFORE live-model.js,
// which re-exports these on window.AmicusLive so no consumer changes.
// ES5 IIFE, dual export, strict-CSP <script> loading — same shape as
// every renderer module. Comments write "PR 102", never the hash-number
// form (electron-token-drift HEX_RE trips on it — this file is scanned).
(function () {
  'use strict';

  // <BODY: live-model.js lines 53-285 moved verbatim.>

  var api = {
    dash: dash,
    seatCells: seatCells,
    SEATS_PANEL_EXCLUDED_ROLES: SEATS_PANEL_EXCLUDED_ROLES,
    seatsFromRunStats: seatsFromRunStats,
    deadSeats: deadSeats,
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (typeof window !== 'undefined') { window.AmicusLiveSeats = api; }
})();
```

- [ ] **Step 3: Rewire `live-model.js`**

Replace the deleted block with a bridge near the top of the IIFE:

```js
  // Seats surface lives in ./live-seats (v4.8 PR0 size-gate split), which
  // loads first; re-exported on window.AmicusLive below so consumers are
  // unchanged. In jest, require resolves it; in the renderer, the script
  // load order guarantees window.AmicusLiveSeats exists.
  var seats = (typeof module !== 'undefined' && module.exports)
    ? require('./live-seats')
    : window.AmicusLiveSeats;
```

and spread the four public names into the existing `api` object (`dash: seats.dash, seatCells: seats.seatCells, seatsFromRunStats: seats.seatsFromRunStats, deadSeats: seats.deadSeats`). `SEATS_PANEL_EXCLUDED_ROLES` was never exported from live-model — do not start.

- [ ] **Step 4: Wire loading + lint**

- `.eslintrc.js` workspace-ui override globals: add `require: 'readonly'` with a comment mirroring the `module` note.
- `tests/workspace/helpers/script-load-order.js:22-32`: insert `'live-seats'` immediately before `'live-model'`.
- `electron/workspace-ui/index.html:101-115`: insert the matching `<script>` tag in the same position.

- [ ] **Step 5: Repoint stale live-model citations, grep-driven**

Run `grep -rn "live-model" electron/ src/workspace/` and repoint every citation whose cited code moved. Known at plan time (verify numbers in the new file first): `workspace-seats.js:47` (cites live-model.js:227-241), `:73` (:261-264), `:108` (:128), `:156`, and `workspace-render.js:199` ("seatCells lives in live-model.js, which loads first" — becomes actively false). Test-file comment citations (`tests/workspace/workspace-seats.test.js:250`, `dead-seat-rows.test.js:556`, `src/workspace/live-normalize.js:46`) may ride only if the file is already in this task's diff — otherwise note them in your report.

- [ ] **Step 6: Re-run Step 1 suites + the workspace and electron sets**

Run: the Step 1 command, then `npx jest tests/workspace tests/electron`
Expected: PASS. (The load-order-driven suites — workspace-app-boundary, live-loop, abort-verb, blind-flip, lazy-panel-staleness — pick up the new file via SCRIPT_LOAD_ORDER automatically.)

- [ ] **Step 7: Commit**

```bash
git add electron/workspace-ui/live-seats.js electron/workspace-ui/live-model.js electron/workspace-ui/index.html electron/workspace-ui/workspace-seats.js tests/workspace/helpers/script-load-order.js .eslintrc.js CLAUDE.md
git commit -m "refactor(workspace): extract the seats surface to live-seats.js

Zero behavior. live-model.js 294 -> ~63 (the spec's ~180 undercounted the
block: deadSeats' docblock alone is 76 lines). dash + the unlisted
SEATS_PANEL_EXCLUDED_ROLES move too; window.AmicusLive re-exports keep
every consumer unchanged; require whitelisted for workspace-ui."
```

---

## Task 6: Extract `deriveLegIds` to `leg-ids.js`

**Files:**
- Create: `src/sidecar/leg-ids.js`
- Modify: `src/sidecar/fanout.js` (block `:24-32`; require at top)

**Interfaces:**
- Consumes: nothing.
- Produces: `leg-ids.js` exports `{ deriveLegIds }`; `fanout.js` keeps `deriveLegIds` in its `module.exports` (re-export — `src/mcp-server.js:1226`, `src/sidecar/fanout-retry.js:103`, and both test importers use the `./fanout` path).

**Corrected facts (the spec table's `:30-55 (~26 lines)` was NEVER true — the spec's own line 131 cites `:30-32` correctly):**
- `deriveLegIds` is a 3-line function at `fanout.js:30-32`; with its JSDoc the liftable block is `:24-32` (9 lines). `:34-56` is `runFanout`'s own docblock and STAYS.
- Relief is ~6 lines (300 → ~294, after Step 3's 4-line comment+require insert), not ~26. **Kept anyway**: `fanout.js` is at exactly 300/300, so ANY future addition — including the banked v4.7.1 provenance-flag rider that needs one line here — blocks until something moves.
- The existing shape pin (`tests/sidecar/fanout.test.js:84-93`) imports via `./fanout` and keeps working through the re-export. The `<waveId>-<i+1>` convention is heavily load-bearing (~10 council/observe test files hard-code `-s1-` composites) — which is exactly why the function must move VERBATIM.

- [ ] **Step 1: Baseline**

Run: `npx jest tests/sidecar/fanout.test.js tests/sidecar/retry-failed.test.js`
Expected: PASS.

- [ ] **Step 2: Create `src/sidecar/leg-ids.js`**

```js
// src/sidecar/leg-ids.js
'use strict';
// deriveLegIds — the <waveId>-<i+1> leg-id convention. Moved verbatim from
// fanout.js:24-32 (v4.8 PR0 size-gate split, zero behavior; fanout.js was
// 300/300). The shape is load-bearing: council stage-1 composes
// `${runId}-s1` waves onto it, and ~10 suites plus a replay fixture
// hard-code the composite. Pinned by tests/sidecar/fanout.test.js:84-93
// through fanout.js's re-export.

// <BODY: fanout.js lines 24-32 moved verbatim (JSDoc + function).>

module.exports = { deriveLegIds };
```

- [ ] **Step 3: Rewire `fanout.js`**

After the existing `./fanout-wave-io` require block (`:19-22`), following the same house comment pattern:

```js
// Leg-id derivation lives in ./leg-ids (v4.8 PR0 size-gate split).
// deriveLegIds is re-exported below — mcp-server.js, fanout-retry.js and
// the fanout tests import it from here.
const { deriveLegIds } = require('./leg-ids');
```

Delete `:24-32` (collapse the doubled blank line). `module.exports` (`:297-300`) is untouched — it is now the re-export.

- [ ] **Step 4: Re-run Step 1 suites + the sidecar set**

Run: the Step 1 command, then `npx jest tests/sidecar`
Expected: PASS, the `deriveLegIds` describe (:84-93) green through the re-export.

- [ ] **Step 5: Commit**

```bash
git add src/sidecar/fanout.js src/sidecar/leg-ids.js CLAUDE.md
git commit -m "refactor(sidecar): extract deriveLegIds to leg-ids.js

Zero behavior. fanout.js 300/300 -> ~294; the spec table's ':30-55 ~26
lines' was never true (3-line function, 9 with JSDoc) — the lift buys ~6
lines, kept because 300/300 blocks every future edit. Re-exported;
import paths stable."
```

---

## Task 7: Fake leg ids the real engine could produce

**Files:**
- Create: `tests/council/fake-launchers-ids.test.js`
- Modify: `tests/council/helpers/fake-launchers.js` (mkLeg `:12-16`; `scriptedLaunchers` `:26-39`; `launchersFromScript` `:87-104`)
- Modify (local clones with the same colliding taskId — **beyond the spec row, same intent**): `tests/council/run-launch.test.js:13`, `tests/council/run-stages.test.js:23`, `tests/council/run-cost-unknown.test.js:43`, `tests/council/budget-reservation.test.js:335`

**Interfaces:**
- Consumes: the `<waveId>-<i+1>` convention (`deriveLegIds`, Task 6's module — but referenced only conceptually; no import needed in test helpers).
- Produces: every fake leg carries a per-leg-unique taskId; legs returned by the dispatchers carry exactly `${opts.waveId}-${i+1}`.

**Verified facts:**
- Today `mkLeg` (:12-16) stamps `taskId: `${model}-leg`` — twins in one wave, or the same model across waves, collide. Real fanout ids are always unique.
- **Assertion-safe**: repo-wide grep for `(gemini|gpt|qwen|deepseek)-leg` in assertions returns zero; no test pins mkLeg's current taskId value or absence.
- Only `run-chair.test.js` and `run-cost-bijection.test.js`'s `wLeg` wrapper pass mkLeg's 5th (`waveId`) param; the dispatchers are where wave + position are both known.
- 22 suites require fake-launchers (18 destructure mkLeg) — the spec's "~30" overcounts.
- `TASK_ID_PATTERN` is `/^[a-zA-Z0-9_-]{1,64}$/` (`src/utils/validators.js:25`); the new ids must conform.

- [ ] **Step 1: Write the failing test**

Create `tests/council/fake-launchers-ids.test.js`:

```js
// tests/council/fake-launchers-ids.test.js
'use strict';
// Fakes must never produce leg documents the real engine cannot: fanout
// ids are `${waveId}-${i+1}`, unique per run (v4.8 PR0).
const { mkLeg, okWave, review, scriptedLaunchers, launchersFromScript, happyScriptMap } = require('./helpers/fake-launchers');
const TASK_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

test('twin models in one wave get distinct taskIds', () => {
  const a = mkLeg('gemini', 'first');
  const b = mkLeg('gemini', 'second');
  expect(a.taskId).not.toBe(b.taskId);
  expect(a.taskId).toMatch(TASK_ID_PATTERN);
  expect(b.taskId).toMatch(TASK_ID_PATTERN);
});

test('scriptedLaunchers legs carry engine-shaped ids: `${waveId}-${i+1}`', async () => {
  const launchers = scriptedLaunchers({ 'r-s1': (opts) => okWave(opts.models.map((m) => mkLeg(m, review(m)))) });
  const { wave } = await launchers.launchWave({ waveId: 'r-s1', models: ['gemini', 'gemini'] });
  expect(wave.legs.map((l) => l.taskId)).toEqual(['r-s1-1', 'r-s1-2']);
});

test('launchersFromScript legs carry engine-shaped ids too', async () => {
  const launchers = launchersFromScript(happyScriptMap());
  const { wave } = await launchers.launchWave({ waveId: 'r-s1', models: ['gemini', 'gemini'] });
  expect(wave.legs.map((l) => l.taskId)).toEqual(['r-s1-1', 'r-s1-2']);
});
```

This code was refuter-verified against the helper's REAL API: `launchWave` returns `{ wave: { status, legs }, exitCode }` (destructure `{ wave }`), `happyScript()` takes no arguments (its keys are `abc123-*` — hence the inline script map for `r-s1`), `happyScriptMap()`'s `'r-s1'` entry maps `opts.models` so twin gemini works, and all six imported names are exported at `fake-launchers.js:170-172`. Do not reintroduce `baseOptions()` here — without a tmp argument it throws.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/council/fake-launchers-ids.test.js`
Expected: FAIL — all three tests: mkLeg twins emit `gemini-leg`, dispatcher ids are `['gemini-leg', 'gemini-leg']`.

- [ ] **Step 3: Implement**

In `fake-launchers.js`:
- Module-level counter: `let legSeq = 0;` — **after the `'use strict';` line (`:2`)**, never before it (a statement before the directive silently disables strict mode for the whole file).
- `mkLeg`: `taskId` becomes `` `${waveId !== undefined ? waveId : model}-${++legSeq}` `` — per-leg-unique always, wave-derived when the caller supplies a wave. The existing `...(waveId !== undefined ? { waveId } : {})` spread stays intact.
- In BOTH dispatchers, the re-stamp MUST be guarded — scripts legitimately return `{ wave: null, exitCode: 1, errorDoc }` (`run-chair.test.js:169,:321-322`, `run-degrade.test.js:257-258`), and an unguarded `.legs` read throws TypeError. In `scriptedLaunchers` (`:28-33`), replace `return fn(opts);` (`:32`) with:

```js
      const r = await fn(opts);
      if (r && r.wave && Array.isArray(r.wave.legs)) {
        r.wave.legs.forEach((leg, i) => { leg.taskId = `${opts.waveId}-${i + 1}`; });
      }
      return r;
```

  Make the identical replacement of `return fn(opts);` in `launchersFromScript`'s dispatch (`:94`). `launchSolo` funnels through these in both, so solo legs get `${waveId}-1` with no third change.

- [ ] **Step 4: Run the new test to verify it passes, then the fake-launcher constellation**

Run: `npx jest tests/council/fake-launchers-ids.test.js`, then `npx jest tests/council tests/schemas-degrades-lockstep.test.js tests/f8-tag-parity.test.js tests/observe/council-events.test.js`
Expected: PASS everywhere — the recon verified no assertion pins the old ids; if one fails, read it before touching it and report what it actually pins.

- [ ] **Step 5: Fix the four local clones**

Apply the same per-leg-unique id scheme (counter or wave-positional, matching each clone's context) to the local mkLeg/mk copies at `run-launch.test.js:13`, `run-stages.test.js:23`, `run-cost-unknown.test.js:43`, `budget-reservation.test.js:335`. Re-run each touched suite with bare `npx jest <path>`.

- [ ] **Step 6: Commit**

```bash
git add tests/council/helpers/fake-launchers.js tests/council/fake-launchers-ids.test.js tests/council/run-launch.test.js tests/council/run-stages.test.js tests/council/run-cost-unknown.test.js tests/council/budget-reservation.test.js
git commit -m "test(council): fake legs carry engine-shaped per-leg-unique taskIds

mkLeg's model-keyed id collided for twin benches — exactly what the v4.8
seat-identity waves test with. Dispatchers stamp \${waveId}-\${i+1}
positionally (deriveLegIds' shape); four local clones fixed the same way."
```

---

## Verification before opening the PR

- [ ] `npm run lint` — clean (the `.eslintrc.js` change from Task 5 included).
- [ ] `npm run check:sizes` — clean; spot-check the after-sizes against the File Structure table.
- [ ] `npm test` — 0 failures. Judge health on 0 failures, not the suite count (Task 7 adds a suite).
- [ ] `git diff origin/main --stat` — ONLY the files this plan names (plus CLAUDE.md auto-regen).
- [ ] Open the PR **with the `council-review` label** (repo bench: glm,qwen seats + deepseek chair; the briefing's "Not shown" block should list nothing but this plan doc if it is committed on-branch per R13).

## Self-review

**Spec coverage:** all seven table rows (spec :526-542) map to Tasks 1-7; the fake-launchers row's intent extends to the four local clones (named as beyond-spec, same intent). The table's wrong numbers are corrected in place with recon citations.
**Placeholder scan:** the only `<BODY: …>` markers are verbatim-move instructions naming exact line ranges — the moved code exists and must not be retyped. Task 7 Step 1's second test explicitly instructs adapting the driving code to the helper's real API with a STOP condition.
**Type consistency:** `finishRun`, `pushDeadSeatRows`, `deriveLegIds`, export lists, and global names (`window.AmicusLiveSeats`) are each defined once and referenced consistently.
**Known risk:** Task 1's parameter list and Task 5's bridge are the two places a verbatim move meets new plumbing — both carry STOP-and-report instructions instead of implementer improvisation.

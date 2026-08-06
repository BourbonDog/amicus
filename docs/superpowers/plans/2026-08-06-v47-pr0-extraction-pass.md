# v4.7 PR0 — Extraction Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Free headroom in the three 299–300/300 files v4.7 provably edits — `cli-handlers-run.js`, `cli-handlers-council-run.js`, `run-debate.js` — via verbatim, zero-behavior-change extractions, before PR1 (CA-4) and PR3 (F8) touch them.

**Architecture:** Three independent whole-block moves, one per donor file, each into a receiver chosen by measured constraints (not by theme): `handleFanout` → new `src/cli-handlers-fanout.js` (whole-handler split, the `cli-handlers-resume-continue.js` precedent); the bench/input cluster → new `src/cli-council-run-bench.js` (top-level `cli*.js` name is LOAD-BEARING, see Global Constraints); the five pure debate helpers → existing `src/council/debate.js` (its charter is exactly "PURE, DI-free"). Donors keep their export surfaces via imports/re-exports so no production caller and almost no test changes.

**Tech Stack:** Node (CommonJS), jest, eslint, husky pre-commit gates (`check-file-sizes`, `generate-docs`).

**Spec:** `docs/superpowers/specs/2026-08-06-v4.7-count-is-the-count-design.md` §4 (PR0). Recon measured 2026-08-06 at `main` @ `6fa6c05`.

**⚠️ Deviation from the standing ruling, surfaced at plan review:** the ruling said "next edit extracts; `cli-council-run-render.js` receives." Measured reality: the render-shaped movers total ~21 lines (< the ≥30 target), the ≥30 movers are input-resolution code, and the render file's pinned docblock declares it render-only with zero requires. The bulk mover therefore goes to a NEW `src/cli-council-run-bench.js`; the render file is untouched. The ruling's intent (extract before the next edit) is honored; its named receiver is not. **RULED 2026-08-06 (Christian, at plan review): the bench receiver stands** — `cli-council-run-bench.js` supersedes the render-file shorthand for the bulk mover; the render file stays render-only.

## Global Constraints

- **Zero behavior change.** Every move is verbatim; error strings byte-identical (`tests/pack/cli-council-pack.test.js` pins exact pack-suffix error text).
- **Line gate:** ≤300 counted lines per `src/**` file (trailing-newline-adjusted; 300 exactly PASSES, 301 fails — `scripts/check-file-sizes.js:52-60`). New files are gate-covered from birth; never add anything to the exclude list.
- **Known-flags scan scope (load-bearing naming):** `tests/utils/known-flags.test.js:134-136` scans ONLY top-level `src/cli*.js` (non-recursive) + `bin/amicus.js` for `args.*` reads. Any extracted code that reads `args.*` MUST land in a top-level `src/cli*.js` file.
- **Single-suite runs use bare `npx jest <path>`** — NEVER `npm test -- <path>`: posttest writes HEAD's SHA to `.test-passed` and the pre-push hook then SKIPS the full suite (`.husky/pre-push:27-32`).
- **Lazy requires stay lazy** (they're what lets `jest.mock` intercept at call time, and preflight tests assert "engine never invoked" — `tests/bin/preflight-json-envelope.test.js:103-132`).
- **New modules self-register in CLAUDE.md at commit time** via the pre-commit hook, PROVIDED the file has a leading `/** ... */` docblock and a single object-literal `module.exports`.
- **Never introduce** a `degraded.value =` assignment (repo-wide scan, `tests/council/degrade-invariant.test.js`) or a `process.stderr` write in code extracted from `run-debate.js` (announcements live in `run-debate-stage.js` only).
- Never bare `npm install` (use `--ignore-scripts`); manual CLI checks via `node bin/amicus.js`; `git push` needs a ≥5-minute timeout (pre-push hook reruns the full suite).
- Commits: conventional style, trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Branch: `feat/v4.7-pr0-extractions` (house pattern `feat/v<ver>-pr<N>-<slug>`), created from `main` @ `6fa6c05` or later, in a worktree per `superpowers:using-git-worktrees` (⚠️ if the worktree gets a `node_modules` junction into the main clone: delete the LINK ONLY before `git worktree remove`, and archive `.superpowers/` first).

---

### Task 1: Branch + green baseline

**Files:** none modified.

- [ ] **Step 1: Create the worktree + branch** (via superpowers:using-git-worktrees at execution time)

```bash
git -C C:/Users/sendt/code/amicus worktree add ../amicus-wt-v47-pr0 -b feat/v4.7-pr0-extractions main
```

- [ ] **Step 2: Verify the gates are green before touching anything**

Run (from the worktree root):
```bash
node scripts/check-file-sizes.js --all
npx jest tests/bin/preflight-json-envelope.test.js tests/fanout-cli.test.js tests/fanout-council-cli.test.js tests/cli-council-run.test.js tests/council/run-debate.test.js
```
Expected: sizes exit 0; all 5 suites PASS. Record the three donor counts (`wc -l`): `src/cli-handlers-run.js` 300, `src/cli-handlers-council-run.js` 299, `src/council/run-debate.js` 299. If any number differs, STOP — the tree moved since recon; re-measure before proceeding.

---

### Task 2: `handleFanout` → new `src/cli-handlers-fanout.js`

**Files:**
- Create: `src/cli-handlers-fanout.js`
- Modify: `src/cli-handlers-run.js` (delete lines 124–270; imports; re-export)
- Modify: `tests/fanout-council-cli.test.js:12`, `tests/fanout-cli.test.js:34` (retarget source-scan path)

**Interfaces:**
- Produces: `src/cli-handlers-fanout.js` exporting `handleFanout(args) → Promise<exitCode>` — signature and behavior identical to today's export.
- Consumers stay on `require('./cli-handlers-run')` via re-export: `bin/amicus.js:21` and 4 direct-require suites are NOT edited.

- [ ] **Step 1: Create the receiver with glue code**

```js
/**
 * CLI handler for `amicus fanout` — extracted verbatim from
 * cli-handlers-run.js (v4.7 PR0) to keep that file under the 300-line
 * gate before F8 adds --tag forwarding. Whole-handler split precedent:
 * cli-handlers-resume-continue.js.
 */
const { validateTaskId } = require('./utils/validators');
const { failJson, ERROR_CODES } = require('./utils/error-doc');
const { GATEWAY_MODES } = require('./utils/model-descriptor');

// <PASTE handleFanout here — cli-handlers-run.js lines 124-270 verbatim,
//  jsdoc included. Do not reformat, do not touch lazy requires.>

module.exports = { handleFanout };
```

- [ ] **Step 2: Cut lines 124–270 from `cli-handlers-run.js`** (the `handleFanout` jsdoc + body, verbatim) into the receiver at the marker. In the donor:
  - add `const { handleFanout } = require('./cli-handlers-fanout');` beside the existing requires (line ~15-20 block);
  - keep `module.exports = { handleStart, handleFanout, handleRead };` exactly as-is (now re-exporting the import);
  - delete now-dead module-level imports: `GATEWAY_MODES` is dead (only user was `:152-154`); check `validateTaskId` with `grep -n validateTaskId src/cli-handlers-run.js` — if `handleRead`'s block (ex-`:280-287`) still uses it, KEEP it.

- [ ] **Step 3: Retarget the two source-scan tests** (all 5 scanned strings live inside the moved range):
  - `tests/fanout-council-cli.test.js:12`: `readFileSync(... 'src/cli-handlers-run.js')` → `'src/cli-handlers-fanout.js'`
  - `tests/fanout-cli.test.js:34`: same retarget. Do NOT touch its `bin/amicus.js` scan at `:21-28` (`case 'fanout':` + `handleFanout` both remain true).

- [ ] **Step 4: Run the dependent suites**

```bash
npx jest tests/bin/preflight-json-envelope.test.js tests/fanout-cowork-forward.test.js tests/pack/cli-fanout-start-pack.test.js tests/template/cli-wiring.test.js tests/fanout-council-cli.test.js tests/fanout-cli.test.js
```
Expected: PASS ×6. The `cli-wiring` suite is the canary for the parseModelsList dual-source hazard — its `./sidecar/fanout` mock hand-rolls `parseModelsList` with NO requireActual, so the moved code must keep requiring it from `./sidecar/fanout` (not `fanout-validate`).

- [ ] **Step 5: Gate + lint**

```bash
node scripts/check-file-sizes.js --all && npm run lint
```
Expected: exit 0 both. `wc -l`: cli-handlers-run.js ≈ 153, cli-handlers-fanout.js ≈ 158 (both far under 300).

- [ ] **Step 6: Commit**

```bash
git add src/cli-handlers-run.js src/cli-handlers-fanout.js tests/fanout-council-cli.test.js tests/fanout-cli.test.js
git commit -m "refactor(cli): extract handleFanout to cli-handlers-fanout.js (v4.7 PR0, gate headroom; zero behavior change)"
```
(The pre-commit hook regenerates CLAUDE.md markers and auto-stages them — expected, not drift.)

---

### Task 3: bench/input cluster → new `src/cli-council-run-bench.js`

**Files:**
- Create: `src/cli-council-run-bench.js`
- Modify: `src/cli-handlers-council-run.js` (delete lines 23–88; import)

**Interfaces:**
- Produces: `{ parseList, sanitizeCouncilName, resolveBench }` — signatures unchanged (verbatim move; `resolveBench(args, useJson)` returns `{bench, presetName, droppedMembers}` or `{fail}` exactly as today).
- The handler's export surface at `:299` (`{ handleCouncilRun, renderRunHuman, CHAIR_DEFAULT }`) is BYTE-UNCHANGED — `tests/council/cost-exact-subtree.test.js:202` pins the `renderRunHuman` re-export, `tests/cli-council-run.test.js:9` pins `CHAIR_DEFAULT`.

- [ ] **Step 1: Create the receiver**

```js
/**
 * Bench/input resolution for `amicus council run` — parseList,
 * sanitizeCouncilName, resolveBench, extracted verbatim from
 * cli-handlers-council-run.js (v4.7 PR0). ⚠️ The top-level cli*.js
 * name is LOAD-BEARING: the known-flags source scan covers only
 * src/cli*.js, and resolveBench reads args['dropped-members'].
 */
const { failJson, ERROR_CODES } = require('./utils/error-doc');

// <PASTE lines 23-88 of cli-handlers-council-run.js here verbatim:
//  parseList (23-25), sanitizeCouncilName (27-43), resolveBench (45-88).
//  resolveBench's config/model-catalog requires are lazy — keep them.>

module.exports = { parseList, sanitizeCouncilName, resolveBench };
```

- [ ] **Step 2: Donor edits** — delete lines 23–88; add beside the `:19` require:

```js
const { parseList, sanitizeCouncilName, resolveBench } = require('./cli-council-run-bench');
```
Call sites (`:161` resolveBench, `:176` sanitizeCouncilName, `:195` parseList — post-deletion numbering will differ) are untouched. `CHAIR_DEFAULT` (`:21`) does NOT move.

- [ ] **Step 3: Run the dependent suites**

```bash
npx jest tests/cli-council-run.test.js tests/cli-council-run-flags.test.js tests/pack/cli-council-pack.test.js tests/template/cli-wiring.test.js tests/council/cost-exact-subtree.test.js tests/pack/mcp-auto-open.test.js tests/utils/known-flags.test.js
```
Expected: PASS ×7. `known-flags` is the naming canary (new file matches `^cli`, so the `args['dropped-members']` read stays scanned); `mcp-auto-open`'s negative pin still holds (nothing moved IN); `cli-council-pack` proves the error strings moved byte-identical.

- [ ] **Step 4: Gate + lint** — same commands as Task 2 Step 5. Expected `wc -l`: cli-handlers-council-run.js ≈ 234, cli-council-run-bench.js ≈ 77.

- [ ] **Step 5: Commit**

```bash
git add src/cli-handlers-council-run.js src/cli-council-run-bench.js
git commit -m "refactor(cli): extract council-run bench resolution to cli-council-run-bench.js (v4.7 PR0; ruling deviation recorded in plan)"
```

---

### Task 4: five pure debate helpers → `src/council/debate.js`

**Files:**
- Modify: `src/council/debate.js` (append 5 functions; extend exports)
- Modify: `src/council/run-debate.js` (delete lines 23–64 + 165–178; extend the `:16` require; keep `:299` re-exports)

**Interfaces:**
- `debate.js` additionally exports `{ allNoResponse, nothingToDebate, disputingJudges, debateTargets, bundleFor }` (verbatim, pure, DI-free — the file's charter).
- `run-debate.js` KEEPS exporting `{ runDebate, nothingToDebate, disputingJudges, debateTargets }` (now re-exported imports). This is load-bearing twice: `run-debate-stage.js:49` calls `nothingToDebate` from `./run-debate`, and `tests/council/run-debate-addendum-guard.test.js:22` `jest.mock`s the `run-debate` PATH — re-export keeps the mock interposed.

- [ ] **Step 1: Move the helpers** — cut `allNoResponse` (23–28), `nothingToDebate` (30–35), `disputingJudges` (37–48), `debateTargets` (50–64), `bundleFor` (165–178) from `run-debate.js` verbatim; append to `debate.js` above its `module.exports`; extend that export object with the five names. Do NOT touch `legOpts`, `runDefenseSolo` (:74–113, PR1 edit site `:106`), `runRevoteWave` (:115–163, PR1 edit site `:157`), or `runDebate`.

- [ ] **Step 2: Rewire `run-debate.js`** — extend the existing `./debate` require at `:16` to also destructure the five names; re-export the three previously-exported ones at `:299` unchanged:

```js
module.exports = { runDebate, nothingToDebate, disputingJudges, debateTargets };
```

- [ ] **Step 3: Run the dependent suites**

```bash
npx jest tests/council/run-debate.test.js tests/council/run-debate-stage.test.js tests/council/run-debate-addendum-guard.test.js tests/council/run-claude-review.test.js tests/council/degrade-channels.test.js tests/council/run-no-cost-gate.test.js tests/council/run-launch-spend.test.js tests/observe/council-events.test.js tests/council/debate.test.js tests/council/run-all-clean.test.js tests/council/degrade-invariant.test.js
```
Expected: PASS ×11. `degrade-invariant` auto-scans the grown `debate.js` (moved code assigns no `degraded.value` — safe); `council-events` pins that the debate-revote START still fires from `runRevoteWave` (untouched); `run-no-cost-gate` pins every `legOpts` field (untouched).

- [ ] **Step 4: Gate + lint** — same commands. Expected `wc -l`: run-debate.js ≈ 244, debate.js ≈ 157.

- [ ] **Step 5: Commit**

```bash
git add src/council/run-debate.js src/council/debate.js
git commit -m "refactor(council): move pure debate helpers into debate.js (v4.7 PR0; PR1 edit sites untouched)"
```

---

### Task 5: full verification + PR

**Files:** none beyond the above.

- [ ] **Step 1: Full gates**

```bash
npm test
npm run lint
npm run check:sizes
npm run generate-docs:check
```
Expected: suite ≥494 suites / 0 fail (count grows only if a suite file was added — none should be); the rest exit 0. Known flake classes if CI later reruns: macOS/node24 SIGSEGV and windows/node24 starved-runner headless timeout — rerun before diagnosing.

- [ ] **Step 2: Manual smoke (no spend)**

```bash
node bin/amicus.js fanout --prompt "x"
node bin/amicus.js read
node bin/amicus.js council run --help
```
Expected: the first two fail with today's exact error text (missing models / task_id required — proves the moved guards fire through the re-export); help exits 0.

- [ ] **Step 3: Push + PR** (≥5-min timeout on push)

```bash
git push -u origin feat/v4.7-pr0-extractions
gh -R BourbonDog/amicus pr create --title "refactor: v4.7 PR0 extraction pass (gate headroom for CA-4/F8; zero behavior change)" --body-file .superpowers/pr0-body.md
```
PR body must include: before/after counts table (300→~153 +158, 299→~234 +77, 299→~244, debate.js 98→~157); the ruling-deviation note (bench receiver ≠ render file, reason, owner-approved); riders: stale line-number comments referencing the moved regions (`src/sidecar/start.js:272`, `src/pack/pack-resolve.js:116`, `src/council/run-budget.js:238` renderRunHuman note, `workspace/artifact-guard.js:25`, `workspace-matrix.js:106`, three test-comment cites) — accepted rot, PR1 renumbers them again; do NOT fix in this PR.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

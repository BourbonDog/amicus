# v4.7 PR7 — Panels, Briefing, and the Riders: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four deferred v4.7 items — three stale-paint paths plus three
unhandled-rejection sites in the workspace prose panels (T19-m1+m2), a raw `briefing.md` that
becomes a wave's permanent `--search` corpus (W1-M4), a missing retry marker on the surviving
errored seat row (PR1F-4) — plus the adjudicated riders, and leave the backlog honest.

**Architecture:** Six of the twelve tasks are the T19 cluster, opened by a pure
no-behaviour-change extraction of the lazy-loading machinery out of `workspace-panels.js` into a
new `workspace-lazy.js` (owner ruling, 2026-08-08). W1-M4 lands entirely inside the gate-exempt
`src/mcp-server.js` and adds **zero** lines to `src/sidecar/fanout.js`, which is at exactly
300/300. PR1F-4 lands entirely inside `workspace-seats.js` (132/300). The riders are small,
mostly-prose changes plus two one-line schema refinements.

**Tech Stack:** CommonJS Node 22, jest, Electron renderer scripts written as browser-global
IIFEs (no bundler, no modules — every cross-file reference resolves `window.Amicus*` at CALL
time, never at load time).

---

## Global Constraints

Every task's requirements implicitly include this section.

**Baseline.** Branch `chore/v4.7-pr7-panels-briefing-riders`, worktree
`C:\Users\sendt\code\amicus-wt-v47-pr7`, branched from `bcf4cc3` (= `origin/main`, the v4.7 PR6
merge). Baseline suite measured green at branch point: **504 suites / 6852 passed, 8 skipped,
208.8 s**. Any deviation from 504/6852 at the end of a task is yours to explain.

**The file-size gate.** `scripts/check-file-sizes.js`. It counts `content.split('\n').length` and
**subtracts 1 when the file ends with a newline**. The comparison is `adjustedCount > limit`, so
**exactly 300 passes with zero headroom**. It gates **only** `src/**/*.js` and
`electron/**/*.js` — `tests/**`, `bin/**`, `*.css`, `*.html` and `*.md` are NOT gated.

> ⚠️ **`node scripts/check-file-sizes.js` with no arguments proves nothing.** That is the
> staged-files pre-commit path: it runs `git diff --cached --name-only` and exits 0 when nothing
> is staged. A recon verifier ran it against a deliberately 301-line file and it still exited 0.
> **Always use `node scripts/check-file-sizes.js --all`.**

**Measured budgets at branch point** (gate arithmetic, re-measured 2026-08-08):

```
 300  src/sidecar/fanout.js                       *** AT LIMIT — this PR adds ZERO lines to it
 300  src/pack/pack-resolve.js                    *** AT LIMIT — this PR adds ZERO lines to it
 297  electron/workspace-ui/workspace-render.js   untouched — treat as frozen
 294  electron/workspace-ui/workspace-panels.js   Task 1 drops it to ~140
 294  electron/workspace-ui/workspace-verbs.js    untouched
 294  electron/workspace-ui/live-model.js         untouched — the PR1F-4 helper must NOT land here
 283  src/council/run-budget.js                   Task 11 lands here, net 0 lines
 278  electron/workspace-ui/workspace-app.js      untouched
 249  electron/workspace-ui/workspace-matrix.js   Task 6 lands here, +3
 179  src/cli-handlers-fanout.js
 156  src/utils/session-metadata-tmp-sweep.js
 132  electron/workspace-ui/workspace-seats.js    Task 8 lands here, → ~175
 117  src/pack/pack-validate.js
  96  src/pack/pack-forward.js
  89  src/utils/session-index-tmp-sweep.js        Task 12 edits a comment here
  71  src/sidecar/fanout-budget.js                Task 11 removes 4 lines
1526  src/mcp-server.js                           EXEMPT (exclude list, check-file-sizes.js:27)
```

**House rules.**
- **Never** run a bare `npm install`. `node_modules` is already present (a junction to the main
  clone). If you believe you need a dependency, stop and report BLOCKED.
- Exercise the CLI with `node bin/amicus.js …`, **never** a PATH `amicus` — that resolves the
  globally installed copy, not this branch.
- There is **no `python3`** on this machine. Script any file mutation with node.
- The pre-push hook runs the FULL suite. Never `git push` from a task; the controller pushes.

**Testing rules, all four learned the hard way.**
1. **Jest swallows unhandled rejections.** It converts each into a failed test, so
   `process.on('unhandledRejection')` records **0** inside jest. Any unhandled-rejection
   assertion must be probed with a **raw-node harness** that requires the fake-DOM helper and
   the real renderer scripts directly. Task 5 specifies one.
2. **`--testPathIgnorePatterns` OVERRIDES the project default** (`\.integration\.test\.js$`),
   which is the only reason the Electron e2e suite runs at all when you pass it.
3. **The Electron-CDP e2e suite is contention-sensitive** — it failed 7 of 10 runs on *pristine*
   `main` while other processes drove Electron. Run workspace suites with **`--runInBand`**, and
   never treat a green e2e run as evidence about your code change.
4. **A test that skips on your platform is a test you have not run.** `fs.symlinkSync` fails
   `EPERM` on this box. Any symlink-adjacent test must fake `fs.statSync`/`fs.lstatSync` rather
   than create a real link.

**Plan-authoring failure modes this project keeps hitting.** If you spot one of these *in this
plan*, stop and report it rather than transcribing it:
- **(a)** a fixture literal that the target module's own matcher rejects (it would make the test
  assert nothing);
- **(b)** a snippet that drops a line the real code needs;
- **(c)** a guessed module path — verify every path named here exists before using it;
- **(d)** a guard scoped to typed flags that never asks what a **pack** can push through the same
  door.

**Two standing in-repo rulings that bind this PR.**
- **`electron/workspace-ui/workspace-verbs.js:76-84`** — read it before writing Task 5. A promise
  chain with a separate `onFulfilled` **MUST** use the two-argument `.then(onFulfilled,
  onRejected)` form, never `.then(onFulfilled).catch(onRejected)`: with a trailing `.catch`, a
  throw inside `onFulfilled` is routed to the same handler and silently absorbed. A recon
  verifier proved the consequence for this exact code by execution — with a trailing `.catch`, a
  painter bug becomes a silent blank panel with no console output and an evicted cache, retrying
  forever.
- **The degrade-announcement invariant / product north star** — a correct-but-**silent** degrade
  fails the bar as hard as a crash. Every error path added by this PR must emit something a
  human can see.

**`CLAUDE.md`'s renderer file tree is MACHINE-GENERATED.** `scripts/generate-docs.js:26` has
`TREE_DIRS = ['bin/','src/','electron/','scripts/','evals/']`. Once a new
`electron/workspace-ui/*.js` file exists, `node scripts/generate-docs.js --check` prints
`Stale markers: tree` and exits 1. `.husky/pre-commit` runs it in write mode and auto-stages
`CLAUDE.md`. **Run `node scripts/generate-docs.js`; never hand-edit that tree.** The generated
text comes from the new file's **JSDoc first line**, so write that line deliberately.

**Commit discipline.** One commit per task minimum, more if the task says so. Conventional
commit prefixes, matching the repo's existing log.

---

## File Structure

| File | Disposition |
|---|---|
| `electron/workspace-ui/workspace-lazy.js` | **CREATE** (Task 1) — lazy prose-panel loading machinery: `loaders`, `loading`, `lastWiredRunId`, `loadPanel`, `proseLoader`, `wireLazyPanels`. Behaviour changes land here in Tasks 3-5. |
| `electron/workspace-ui/workspace-panels.js` | 294 → ~140. Keeps name resolution (`sanitizeName`, `resolveArtifactName`), the three panel adapters, `drillIntoJudge`, and thin delegates. |
| `electron/workspace-ui/index.html` | +1 script tag (+ a 2-line comment), Task 1. |
| `tests/workspace/helpers/script-load-order.js` | +1 entry, Task 1. The single shared list feeding both the index.html ordering assert and the fake-DOM require loop. |
| `electron/workspace-ui/workspace-matrix.js` | 249 → ~252, Task 6 (drill wrap). |
| `electron/workspace-ui/workspace-seats.js` | 132 → ~175, Task 8 (PR1F-4). |
| `electron/workspace-ui/workspace.css` | +3 lines, Task 8. NOT gated. |
| `src/mcp-server.js` | +~14, Task 7 (W1-M4/R9) and Task 9 (orphan metadata). EXEMPT from the gate. |
| `src/pack/pack-forward.js` | docblock correction, Task 7. |
| `src/mcp-tools.js` | two schema refinements, Task 9. EXEMPT. |
| `src/council/run-budget.js` | two string literals, net 0 lines, Task 11. |
| `src/sidecar/fanout-budget.js` | −4 lines, Task 11. |
| `src/utils/session-index-tmp-sweep.js` | comment rewrite, Task 12. |
| `BACKLOG.md`, `CHANGELOG.md` | Task 12. |
| `docs/superpowers/plans/2026-08-07-codex-host-parity-scoping.md` | `git add` an existing untracked file, Task 12. |

**Tests created:** `tests/workspace/lazy-panel-staleness.test.js` (Tasks 2-4),
`tests/workspace/lazy-panel-rejection.probe.js` + its jest driver (Task 5),
`tests/workspace/matrix-drill-rejection.test.js` (Task 6), plus cases added to
`tests/pack/mcp-pack-params.test.js` (Tasks 7, 9, 10) and
`tests/workspace/workspace-seats.test.js` (Task 8).

---

## Task 1: Extract the lazy-loading machinery into `workspace-lazy.js` (NO behaviour change)

**Files:**
- Create: `electron/workspace-ui/workspace-lazy.js`
- Modify: `electron/workspace-ui/workspace-panels.js` (294 lines today)
- Modify: `electron/workspace-ui/index.html:101-112`
- Modify: `tests/workspace/helpers/script-load-order.js:18-27`
- Regenerate: `CLAUDE.md` (via the script — do not hand-edit)

**Interfaces:**
- Produces: `window.AmicusLazy = { loadPanel, proseLoader, wireLazyPanels, panelSpec }`. Tasks 3,
  4 and 5 modify `loadPanel`/`wireLazyPanels` inside this new file. `panelSpec(panelId)` exists
  only so `drillIntoJudge` — which stays in `workspace-panels.js` — can ask whether the current
  run has a spec for a panel without the module-private `loaders` map being exported.
- `window.AmicusPanels` keeps **all seven** existing keys and gains nothing that is removed.
  `tests/workspace/workspace-app-boundary.test.js:116` asserts `typeof P[k] === 'function'` for
  `renderSeatsPanel, renderMatrixPanel, renderVerdictPanel, wireLazyPanels, proseLoader,
  drillIntoJudge, sanitizeName`. It is a **presence** check, not an exact-key-set check.

**This is a PURE MOVE. Do not retype the moved code.** Cut the exact line ranges and paste them.
Re-transcribing 161 lines by hand is precisely plan-failure mode (b) — the single most common
defect in this project's history. After the move, `git diff` should show the moved block as a
deletion in one file and an identical addition in the other, with no incidental reflow.

- [ ] **Step 1: Read the source file end to end**

Read `electron/workspace-ui/workspace-panels.js` in full (294 lines) before touching anything.
The region boundaries below are stated as line numbers *at baseline*; verify each one matches
what you actually see before cutting.

- [ ] **Step 2: Create `electron/workspace-ui/workspace-lazy.js`**

Move **lines 70-230 inclusive** (161 lines: the `---- lazy prose panels ----` comment banner, the
`loaders` / `loading` / `lastWiredRunId` module state, `loadPanel`, `proseLoader`, and
`wireLazyPanels`) into the new file, wrapped exactly like this. The header's **first JSDoc line**
becomes the CLAUDE.md tree description, so it is written deliberately:

```js
/**
 * Council Workspace — lazy prose-panel loading (v4.4 §5.2). v4.7 PR7 extraction of the
 * loading machinery out of workspace-panels.js, which was at 294/300 with the T19 stale-paint
 * fixes still to land; the same treatment workspace-seats.js got in v4.6.2 PR4 (D8).
 *
 * Split line: this file owns WHEN and WHETHER an artifact read is issued and which reply is
 * allowed to paint (the `loading` promise cache, the run/issue staleness fences).
 * workspace-panels.js keeps NAME RESOLUTION (sanitizeName / resolveArtifactName — the RN-1
 * disambiguation pair, pinned by tests/electron/workspace-ui-static.test.js) and the panel
 * adapters. Cross-calls resolve `window.Amicus*` at CALL time, never at this file's load time
 * — the house discipline for every renderer script.
 *
 * Loads AFTER workspace-seats.js and BEFORE workspace-panels.js (index.html), whose
 * wireLazyPanels/proseLoader are thin delegates into this namespace.
 */
(function () {
  'use strict';

  // <<< lines 70-230 of workspace-panels.js, moved VERBATIM >>>

  // `loaders` stays module-private; drillIntoJudge (still in workspace-panels.js) needs to ask
  // whether this run has a spec for a panel, and nothing else needs the map itself.
  function panelSpec(panelId) { return loaders[panelId] || null; }

  window.AmicusLazy = {
    loadPanel: loadPanel,
    proseLoader: proseLoader,
    wireLazyPanels: wireLazyPanels,
    panelSpec: panelSpec,
  };
})();
```

The moved block calls `resolveArtifactName(m, 'review' | 'judge' | 'revote')` at three sites
inside `wireLazyPanels`. That function stays in `workspace-panels.js`, so **change those three
call sites to `window.AmicusPanels.resolveArtifactName(...)`** — a call-time lookup, consistent
with how every other cross-file reference in this directory works. That is the *only* edit
permitted to the moved text in this task.

- [ ] **Step 3: Reduce `workspace-panels.js`**

Delete lines 70-230. Then:

Add `resolveArtifactName` to the exports object (it is now consumed cross-file):

```js
  window.AmicusPanels = {
    renderSeatsPanel: renderSeatsPanel,
    renderMatrixPanel: renderMatrixPanel,
    renderVerdictPanel: renderVerdictPanel,
    wireLazyPanels: wireLazyPanels,
    proseLoader: proseLoader,
    drillIntoJudge: drillIntoJudge,
    sanitizeName: sanitizeName,
    resolveArtifactName: resolveArtifactName,
  };
```

Add the two thin delegates where the moved block used to be (same shape as the existing
`renderSeatsPanel` delegate at :42-44):

```js
  // ⚠️ v4.7 PR7 extraction: bodies moved verbatim to workspace-lazy.js
  // (window.AmicusLazy), which loads immediately before this file.
  function proseLoader(panelId) { window.AmicusLazy.proseLoader(panelId); }
  function wireLazyPanels() { window.AmicusLazy.wireLazyPanels(); }
```

`drillIntoJudge` stays in this file and calls `loadPanel`, which has moved. Change its one call
site (baseline `:245`) to `window.AmicusLazy.loadPanel('judges-panel', spec.bodyId, spec.files)`.
It also reads `loaders['judges-panel']` at baseline `:243` — `loaders` is now module state inside
`workspace-lazy.js` and is **not** exported. Use the `panelSpec` accessor defined in Step 2, so
`drillIntoJudge` bails exactly as it does today when there is no spec:

```js
    var spec = window.AmicusLazy.panelSpec('judges-panel');
    if (!spec) { return Promise.resolve(); }
```

Update this file's own header docblock (lines 1-12) to describe the new, smaller
responsibility and to name `workspace-lazy.js` in the load-order list.

- [ ] **Step 4: Register the new script**

`tests/workspace/helpers/script-load-order.js` — insert `'workspace-lazy'` between
`'workspace-seats'` and `'workspace-panels'`, and extend the docblock with a one-line note in the
style of the existing D8 note at `:13-16`.

`electron/workspace-ui/index.html` — insert after the `workspace-seats.js` tag at `:107`:

```html
  <!-- ⚠️ v4.7 PR7 extraction: workspace-lazy.js must load BEFORE workspace-panels.js,
       whose wireLazyPanels/proseLoader delegate to it. -->
  <script src="./workspace-lazy.js"></script>
```

- [ ] **Step 5: Regenerate CLAUDE.md**

Run: `node scripts/generate-docs.js`
Then: `node scripts/generate-docs.js --check`
Expected: the second command exits **0**. If it exits 1 printing `Stale markers: tree`, the first
command did not run or did not write.

- [ ] **Step 6: Prove no behaviour changed**

Run: `npx jest tests/workspace tests/electron --runInBand`
Expected: **the same counts as baseline for these paths — 54 suites / 652 tests passing** (this
invocation does NOT override the project's `testPathIgnorePatterns`, so the `.integration` e2e
suite is excluded; that is intentional here).

Run: `node scripts/check-file-sizes.js --all`
Expected: exit 0, no violations. Record the measured counts for `workspace-panels.js` and
`workspace-lazy.js` in your report — the plan's estimate is ~140 and ~190, but the plan does
**not** assert those as facts and you should not force them.

Run: `npx eslint electron/workspace-ui/workspace-lazy.js electron/workspace-ui/workspace-panels.js`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add electron/workspace-ui/workspace-lazy.js electron/workspace-ui/workspace-panels.js electron/workspace-ui/index.html tests/workspace/helpers/script-load-order.js CLAUDE.md
git commit -m "refactor(workspace): extract lazy prose-panel loading into workspace-lazy.js"
```

---

## Task 2: Pin the RN-1 collision titles BEFORE any staleness change

**Files:**
- Create: `tests/workspace/lazy-panel-staleness.test.js`

**Interfaces:**
- Consumes: `tests/workspace/helpers/fake-workspace-page.js`,
  `tests/workspace/helpers/script-load-order.js` (require the renderer scripts in list order).

**Why this exists.** Two separate proposed fixes for T19 were killed in recon because they
re-derived panel titles by model `name`, which collapses a sanitize-collided bench pair onto one
title. This test is the tripwire that kills that shape if anyone tries it again. **It is GREEN at
baseline and must stay green** — it is a non-regression pin, not a RED-first test. Say so in the
test's own header comment so a future reader does not mistake it for dead weight.

- [ ] **Step 1: Write the pin**

Bench `['vendor/a', 'vendor:a']` — two distinct models that both sanitize to `vendor-a` — with
`state.detail.derived.artifactsByModel === null` (the **legacy fallback** path; with a
disambiguating map present the collapse cannot occur, so a test that forgets this scope
condition is vacuous).

Assert, after opening `reviews-panel`:
- with `state.blind === false`, the rendered section titles are exactly `['vendor/a', 'vendor:a']`
- with `state.blind === true` and `labelByModel` mapping the two to `Review A` / `Review B`, the
  titles are exactly `['Review A', 'Review B']`

Both assertions must be on the **titles**, not the `data-artifact` attributes: both sections
already carry `data-artifact="review-vendor-a.md"` **at baseline**, so that attribute is not
evidence of anything.

- [ ] **Step 2: Run it — it must PASS**

Run: `npx jest tests/workspace/lazy-panel-staleness.test.js --runInBand`
Expected: PASS. If it fails, you have built the harness wrong — the behaviour it describes is
today's behaviour. Do not "fix" production code to make it pass.

- [ ] **Step 3: Prove the pin has teeth**

Temporarily edit `workspace-lazy.js`'s `wireLazyPanels` so the `reviews-panel` title is
`f.name`-derived instead of going through `AmicusRender.display(...)`. Re-read the file to
confirm your edit actually landed (a mutation that silently fails to mutate reads as a PASS).
Run the test: it must FAIL. Then revert with `git checkout -- electron/workspace-ui/workspace-lazy.js`
and re-run: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/workspace/lazy-panel-staleness.test.js
git commit -m "test(workspace): pin RN-1 collision titles before the T19 staleness fixes"
```

---

## Task 3: T19 Step 1 — unconditional cache drop (fixes stale paths A and D)

**Files:**
- Modify: `electron/workspace-ui/workspace-lazy.js` (`wireLazyPanels`, the `sameRun` arm)
- Modify: `tests/workspace/lazy-panel-staleness.test.js`

**Interfaces:**
- Consumes: the harness built in Task 2.

- [ ] **Step 1: Write the failing test**

Add to `tests/workspace/lazy-panel-staleness.test.js`: **open panel at blind OFF → collapse the
panel → flip blind ON → reopen**. Assert both halves:
1. the rendered titles are the blind **labels**, not the raw model ids;
2. a **new** `workspace:read-artifact` request was issued (count the invoke calls for that
   channel; the count after reopen must exceed the count before the flip).

The second assertion is the load-bearing one. Without it the test can pass on a build that paints
correct titles from a stale cache.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/workspace/lazy-panel-staleness.test.js --runInBand`
Expected: FAIL — titles stay `["gemini","gpt"]` while `state.blind === true`, and **zero** new
read-artifact requests are issued.

- [ ] **Step 3: Implement**

In `workspace-lazy.js`'s `wireLazyPanels`, the `sameRun` arm (baseline `workspace-panels.js:227`):

```js
        if (p.open) { delete loading[id]; loadPanel(id, loaders[id].bodyId, loaders[id].files); }
```

becomes:

```js
        // ⚠️ T19-m1 (v4.7 PR7): the cache drop used to be INSIDE the `p.open` guard, so a panel
        // the user had collapsed kept its settled promise across a blind flip — reopening it
        // returned that promise and repainted the previous blind state with no new fetch (recon
        // path A), and a panel collapsed mid-flight repainted the stale wave (path D). Dropping
        // unconditionally costs a re-read of that panel's artifacts on the next open; renderDetail
        // fires on run open, blind toggle, and the live loop's terminal refresh only (the tick
        // calls applyLive, not renderDetail), so this is not a per-poll storm.
        delete loading[id];
        if (p.open) { loadPanel(id, loaders[id].bodyId, loaders[id].files); }
```

- [ ] **Step 4: Run the tests**

Run: `npx jest tests/workspace/lazy-panel-staleness.test.js --runInBand` → PASS (both cases).
Run: `npx jest tests/workspace tests/electron --runInBand` → **zero failures**, and the Task 2
collision pin still green.

> On suite/test counts: the baseline for these two paths is **54 suites / 652 tests**. Each task
> below adds cases, so the totals climb. This plan does **not** state the exact expected total per
> task — a hardcoded count is a number that rots between plan-writing and execution and produces
> false failures. Assert **zero failures** and **report the actual totals** you observed.

State explicitly in your report that this **disables the documented per-panel cache (spec §5.2,
"load on first open, cache") for closed panels**. That is an intended, owner-visible consequence,
not an oversight.

- [ ] **Step 5: Commit**

```bash
git add electron/workspace-ui/workspace-lazy.js tests/workspace/lazy-panel-staleness.test.js
git commit -m "fix(workspace): drop the panel load cache unconditionally on a same-run rewire (T19-m1)"
```

---

## Task 4: T19 Step 2 — monotonic newest-issue-wins token (fixes stale paths B and G)

**Files:**
- Modify: `electron/workspace-ui/workspace-lazy.js` (module state + `loadPanel`)
- Modify: `tests/workspace/lazy-panel-staleness.test.js`

- [ ] **Step 1: Write the two failing tests**

**(B) two waves in flight for one panel, older settles last.** Issue a load, then issue a second
load for the same panel before the first settles, then settle them in reverse order. Assert the
**newer** wave's content is what remains painted.

**(G) same-run manifest growth, older reply lands last.** A same-run refresh where a newly written
artifact has appeared, so the newer request fetches 2 files and the older one fetched 1; settle
the 1-file reply last. Assert the panel keeps **2** sections. No blind toggle is involved in this
path — it is reachable on the live loop's terminal refresh alone.

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest tests/workspace/lazy-panel-staleness.test.js --runInBand`
Expected: both new cases FAIL — the older wave wins the paint, and (G) paints 2 sections then is
overwritten back to 1.

- [ ] **Step 3: Implement**

Beside the existing `loaders` / `loading` / `lastWiredRunId` declarations, add:

```js
  // ⚠️ T19-m1 (v4.7 PR7): the only staleness fence used to be the runId captured at issue time,
  // which cannot distinguish two requests issued for the SAME run — a blind flip, a manifest that
  // grew, or any same-run rewire issues a second load while the first is still in flight, and
  // whichever settles LAST won the paint. Monotonic per-panel issue number: the completion handler
  // paints only if it is still the newest issue. Keys are the three fixed panel-id literals (never
  // a model name), so a bare object is safe here — unlike the model-keyed maps in live-model.js.
  var issue = {};    // panelId -> monotonically increasing issue number
```

In `loadPanel`, immediately after `var runId = A.state.runId;`:

```js
    var token = (issue[panelId] = (issue[panelId] || 0) + 1);
```

and extend the completion guard:

```js
      if (A.state.runId !== runId || issue[panelId] !== token) { return; } // stale: superseded
```

This never re-derives a title, so the positional `name`↔`title` pairing that RN-1 depends on is
untouched — which is exactly why the Task 2 pin stays green.

- [ ] **Step 4: Run the tests**

Run: `npx jest tests/workspace/lazy-panel-staleness.test.js --runInBand` → all PASS, **including
the Task 2 collision pin in both blind states**.
Run: `npx jest tests/workspace tests/electron --runInBand` → zero failures; report the totals.

- [ ] **Step 5: Commit**

```bash
git add electron/workspace-ui/workspace-lazy.js tests/workspace/lazy-panel-staleness.test.js
git commit -m "fix(workspace): newest-issue-wins fence for in-flight panel loads (T19-m1)"
```

---

## Task 5: T19 Step 3 — terminate and evict, announced (T19-m2)

**Files:**
- Modify: `electron/workspace-ui/workspace-lazy.js` (`loadPanel`)
- Create: `tests/workspace/lazy-panel-rejection.probe.js` (raw-node probe, not a jest test)
- Create: `tests/workspace/lazy-panel-rejection.test.js` (jest driver that spawns the probe)

**READ FIRST:** `electron/workspace-ui/workspace-verbs.js:76-84`. It is a written ruling against
the exact construct the original backlog entry proposed. This task implements the form that
ruling requires.

- [ ] **Step 1: Write the raw-node probe**

Jest converts an unhandled rejection into a failed test, so `process.on('unhandledRejection')`
records **0** inside jest and a jest-based assertion here would be meaningless. Write
`tests/workspace/lazy-panel-rejection.probe.js` as a plain node script that:
1. registers `process.on('unhandledRejection', ...)` into an array;
2. builds the fake page via `tests/workspace/helpers/fake-workspace-page.js` and requires the
   renderer scripts in `SCRIPT_LOAD_ORDER`;
3. makes `A.invoke('workspace:read-artifact', …)` **reject**;
4. drives all three call sites — the `proseLoader` toggle listener, the `wireLazyPanels` sameRun
   arm, and `drillIntoJudge`;
5. then makes `invoke` resolve normally and reopens the panel;
6. prints one JSON line: `{"unhandled": [...], "sectionsAfterRecovery": N, "consoleErrors": M}`.

- [ ] **Step 2: Write the jest driver**

`tests/workspace/lazy-panel-rejection.test.js` runs the probe with
`execFileSync(process.execPath, [probePath], { encoding: 'utf8' })`, parses the JSON line, and
asserts `unhandled.length === 0`, `sectionsAfterRecovery > 0`, and `consoleErrors >= 1`.

The `consoleErrors >= 1` assertion is not decoration — it is what stops this fix from being the
silent degrade the product principle rejects.

- [ ] **Step 3: Run to verify it fails**

Run: `npx jest tests/workspace/lazy-panel-rejection.test.js --runInBand`
Expected: FAIL — three unhandled rejections, and the toggle case leaves the panel wedged at
`sections=0` / `dataset.loaded='0'` even after the channel recovers.

- [ ] **Step 4: Implement**

Restructure `loadPanel`'s tail. Today it assigns the chained promise straight into `loading` and
returns it; it needs a local so `onRejected` can self-check before evicting:

```js
    var pending = Promise.all(files().map(function (f) {
      return A.invoke('workspace:read-artifact', runId, f.name).then(function (res) {
        return { name: f.name, title: f.title, text: res.text || '', truncated: res.truncated, error: res.error };
      });
    })).then(function (sections) {
      if (A.state.runId !== runId || issue[panelId] !== token) { return; } // stale: superseded
      window.AmicusRender.renderProseSections(A.$(bodyId), sections.map(function (s) {
        return s.error ? { name: s.name, title: s.title, error: s.name + ' — ' + s.error } : s;
      }));
      A.$(panelId).dataset.loaded = '1';   // display/debug marker only — `loading` is the real gate
    }, function (err) {
      // ⚠️ T19-m2 (v4.7 PR7). Two-argument .then(onFulfilled, onRejected) — NOT a trailing
      // .catch. workspace-verbs.js:76-84 already ruled on this exact construct: with a trailing
      // .catch a THROW inside onFulfilled is routed here too, so a painter bug would be absorbed
      // into a silent blank panel that ALSO evicts its own cache and therefore retries forever.
      // With the two-argument form this handler only ever sees a genuinely rejected invoke().
      // The `=== pending` self-check is load-bearing: without it a late rejection can evict a
      // NEWER in-flight promise and strand the panel. And the log is not optional — a silent
      // eviction is the correct-but-silent degrade the product principle rejects.
      if (loading[panelId] === pending) { delete loading[panelId]; }
      console.error('workspace lazy panel: read-artifact failed for ' + panelId, err);
    });
    loading[panelId] = pending;
    return pending;
```

Note `pending`, not `p` — `p` is already the panel *element* in `wireLazyPanels`, and reusing the
name across the two functions invites a misread.

- [ ] **Step 5: Run the tests**

Run: `npx jest tests/workspace/lazy-panel-rejection.test.js --runInBand` → PASS.
Run: `npx jest tests/workspace tests/electron --runInBand` → zero failures; report the totals.
Run: `node scripts/check-file-sizes.js --all` → exit 0. Report `workspace-lazy.js`'s count.

- [ ] **Step 6: Commit**

```bash
git add electron/workspace-ui/workspace-lazy.js tests/workspace/lazy-panel-rejection.probe.js tests/workspace/lazy-panel-rejection.test.js
git commit -m "fix(workspace): terminate and announce a rejected panel load, self-checked eviction (T19-m2)"
```

---

## Task 6: T19 Step 4 — sync-safe wrap on the matrix drill handler

**Files:**
- Modify: `electron/workspace-ui/workspace-matrix.js:78-80` (249 lines today)
- Create: `tests/workspace/matrix-drill-rejection.test.js`

**Why this is still needed after Task 5.** Task 5 removes the *IPC-rejection* source, but not a
throw raised inside `drillIntoJudge`'s own post-load body — that still escapes through this
listener. Recon measured it escaping through a real dispute-cell click.

- [ ] **Step 1: Write the failing test**

Two cases, driving `renderMatrix` with a dispute cell and clicking it:
1. `onDrill` returns a **rejected promise** → no unhandled rejection escapes, and `console.error`
   is called once.
2. `onDrill` **throws synchronously** → the throw does not escape the click handler, and
   `console.error` is called once.

Case 2 is the one that matters: it is what kills the shape originally proposed for this item.

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/workspace/matrix-drill-rejection.test.js --runInBand`
Expected: both FAIL.

- [ ] **Step 3: Implement**

```js
        if (cell.verdict === 'dispute') {
          // ⚠️ T19-m2 (v4.7 PR7): drillIntoJudge's derived promise was discarded here, so a
          // rejection — or a throw inside its own post-load body, which loadPanel's onRejected
          // does NOT cover — escaped unhandled. `Promise.resolve(onDrill(...))` would NOT fix the
          // synchronous half: onDrill(...) is evaluated BEFORE Promise.resolve sees it, so the
          // throw escapes anyway (measured). Calling it inside the .then callback moves both the
          // sync and async failure modes onto the chain. A trailing .catch is correct HERE
          // (unlike loadPanel — see workspace-verbs.js:76-84) because there is no separate
          // onFulfilled whose throw it could absorb: the callback IS the whole operation.
          td.addEventListener('click', function () {
            Promise.resolve().then(function () { return onDrill(cell.judge, row.id); })
              .catch(function (err) { console.error('workspace matrix: drill into judge failed', err); });
          });
        }
```

- [ ] **Step 4: Run the tests**

Run: `npx jest tests/workspace/matrix-drill-rejection.test.js --runInBand` → PASS.
Run: `npx jest tests/workspace tests/electron --runInBand` → zero failures; report the totals.
Run: `node scripts/check-file-sizes.js --all` → exit 0 (`workspace-matrix.js` ~252/300).

- [ ] **Step 5: Commit**

```bash
git add electron/workspace-ui/workspace-matrix.js tests/workspace/matrix-drill-rejection.test.js
git commit -m "fix(workspace): terminate the matrix drill handler against sync and async failures (T19-m2)"
```

---

## Task 7: W1-M4 — render the briefing at the MCP pre-seed (R9)

**Files:**
- Modify: `src/mcp-server.js:1282-1305` (EXEMPT from the size gate)
- Modify: `src/pack/pack-forward.js:39-42` (docblock correction)
- Modify: `tests/pack/mcp-pack-params.test.js`

**The defect, established by execution.** An MCP fanout wave whose spawned CLI child aborts
before `src/sidecar/fanout.js:145` leaves `<waveDir>/briefing.md` holding the **raw**
(un-templated) prompt forever. `src/sidecar/list-search.js:39-42` reads that file verbatim as the
`--search` corpus, so the wave is permanently unfindable by the text the user actually sees. It
is one-directional: the template interpolates `{{prompt}}`, so raw text stays a substring of
rendered text — searching the raw text still finds it, searching the rendered text does not.

**Why the fix lands in `mcp-server.js` and not in `fanout.js`:** `src/sidecar/fanout.js` is at
**exactly 300/300**. It has zero headroom, and the option previously on file (hoisting the wave
record above the pre-flight returns) throws `ReferenceError: Cannot access 'legs' before
initialization` and breaks the pinned no-wave-dir test at `tests/sidecar/fanout.test.js:738`.

**Parity note that justifies the shape:** the `amicus_start` shared-server path already does
exactly this — `src/mcp-server.js:441` computes
`const renderedPrompt = fwd.renderedPrompt !== undefined ? fwd.renderedPrompt : input.prompt;`
and `:506` persists `briefing: renderedPrompt`. The fanout path is the odd one out.

- [ ] **Step 1: Write the failing test**

Add a case to `tests/pack/mcp-pack-params.test.js` using the **existing**
`callFanoutWithMockedSpawn` idiom at `:568` (verified present) and `waveDirCount` at `:579`.

> ⚠️ **FIXTURE TRAP — plan-failure mode (a), and it is live in this file.** The only template
> fixture already present is `briefing:{template:'review'}`, and pack-forward's fanout dry run
> **rejects** it with `template has {{artifact}} but no --artifact <file> was given`. Reusing it
> yields `isError` and zero wave dirs, and your test would assert nothing. **Write your own user
> template** into the tmp `AMICUS_CONFIG_DIR` at `tmp/templates/<name>.md`, containing a literal
> marker plus `{{prompt}}`, and reference that name from the pack.

Assert four things:
1. `briefing.md` contains the rendered marker;
2. `briefing-input.md` content `===` `input.prompt` exactly;
3. the captured spawn argv's `--prompt-file` value points at `briefing-input.md`, and
   `--template` is still forwarded;
4. **with no pack**: no `briefing-input.md` exists and `briefing.md === input.prompt`.

Do **not** add a case to `tests/list-search.test.js`. `waveSearchMaterial` already reads
`briefing.md` verbatim, so such a case exercises nothing this change alters — it is a tautology,
not coverage.

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/pack/mcp-pack-params.test.js`
Expected: FAIL — `briefing.md` holds the raw prompt and no `briefing-input.md` exists.

- [ ] **Step 3: Implement**

At `src/mcp-server.js:1282`, `let briefingPath;` → add a sibling, and rewrite the write block:

```js
    let briefingPath;
    let childPromptPath;
    try {
      fs.mkdirSync(waveDir, { recursive: true, mode: 0o700 });
      briefingPath = path.join(waveDir, 'briefing.md');
      // ⚠️ W1-M4 (v4.7 PR7): this default is LOAD-BEARING. Omit it and every non-template wave
      // spawns with `--prompt-file undefined`.
      childPromptPath = briefingPath;
      // The prompt goes via file: the spawned command line must NOT carry it,
      // or it re-hits the ~32KB Windows argument cap (F4 spec §4.2).
      // ⚠️ W1-M4: briefing.md is the SEARCH CORPUS — src/sidecar/list-search.js reads it verbatim
      // — and a child that aborts before fanout.js:145 never re-renders it, leaving the wave
      // permanently unfindable by the text the user actually sees. Write the RENDERED text here
      // (parity with the amicus_start path at :441/:506) and hand the child the raw input in a
      // sibling file, so its own later re-render still produces byte-identical output and
      // promptMeta.template provenance survives.
      const briefingText = fwd.renderedPrompt !== undefined ? fwd.renderedPrompt : input.prompt;
      fs.writeFileSync(briefingPath, briefingText, { mode: 0o600 });
      if (fwd.renderedPrompt !== undefined) {
        childPromptPath = path.join(waveDir, 'briefing-input.md');
        fs.writeFileSync(childPromptPath, input.prompt, { mode: 0o600 });
      }
      writeFileAtomic(path.join(waveDir, 'metadata.json'), JSON.stringify({
        taskId: waveId, type: 'wave', status: 'running', legs: legIds,
        models: effectiveModels, headless: true, createdAt: new Date().toISOString(),
        // ⚠️ W1-M4 rider (owner-approved fold): without this the `list` BRIEFING column renders
        // EMPTY for an aborted MCP wave — only fanout.js:147 ever wrote a briefing key, and an
        // aborted child never reaches it.
        briefing: briefingText.slice(0, 200),
        // v4.5 Task 15: additive-only — absent (not null) without a pack.
        ...(packRecord ? { pack: packRecord } : {}),
      }, null, 2), { mode: 0o600 });
```

And in the argv array at `:1305`:

```js
      '--prompt-file', childPromptPath, '--wave-id', waveId,
```

`fwd` is assigned at `:1246` and is in scope here (verified). `checkPackForward` returns literally
`{ notices: [] }` when nothing was forwarded, so the no-pack path stays byte-identical.

- [ ] **Step 4: Correct the docblock this change falsifies**

`src/pack/pack-forward.js:39-42` currently reads: *"Callers that only need the pre-spend
validation (the two spawn paths) ignore the returned `renderedPrompt`."* That is no longer true
of the fanout spawn path. Rewrite those lines to state that the fanout spawn path now uses
`renderedPrompt` for the on-disk `briefing.md` (the search corpus) while still handing the child
the raw input so the child's own render remains the provenance source.

- [ ] **Step 5: Run the tests**

Run: `npx jest tests/pack/mcp-pack-params.test.js` → PASS.
Run: `npx jest tests/mcp tests/pack tests/list-search tests/sidecar/fanout tests/fanout`
Expected: green. Recon measured 60 suites / 969 tests across this selection.
Run: `npx eslint src/mcp-server.js src/pack/pack-forward.js` → exit 0.

- [ ] **Step 6: Report the residue explicitly**

In your report, state: (1) wave dirs now contain one extra file, `briefing-input.md`, and only
when a pack forwarded a template; (2) `src/sidecar/fanout-retry.js:136` reads
`waveDir/briefing.md` as the replay source, so a retried **aborted** wave now replays rendered
rather than raw text — for surviving waves nothing changes, since `fanout.js:145` already
rendered.

- [ ] **Step 7: Commit**

```bash
git add src/mcp-server.js src/pack/pack-forward.js tests/pack/mcp-pack-params.test.js
git commit -m "fix(mcp): render briefing.md at the fanout pre-seed so an aborted wave stays searchable (W1-M4)"
```

---

## Task 8: PR1F-4 — retry marker on the surviving errored seat row

**Files:**
- Modify: `electron/workspace-ui/workspace-seats.js` (132 lines today → ~175)
- Modify: `electron/workspace-ui/workspace.css` (NOT gated)
- Modify: `tests/workspace/workspace-seats.test.js`

**Owner ruling (2026-08-08): trailing flag column.** The seats table's 9th column already exists
and is **unlabeled** (`index.html:51` ends `<th></th>`); it carries `⏳ stalled` on the live path
and is always empty on the terminal path, because `seatsFromRunStats` hardcodes `stalled: false`
(`live-model.js:128`). The retry marker goes there.

**Why not a status-cell suffix:** a dead seat's primary row can legitimately carry
`status: 'complete'` — proven end to end by driving the real `runStage1` with a leg returning
`status:'complete', summary:'   '`. A suffix would render `complete — retried once`, which reads
as "it finished, twice".

**Three constraints from recon, all verified:**
- **Never gate on a closed set of status values.** The live path builds rows as
  `status: meta.status || 'unknown'` (`src/observe/council-legs.js:128`) and
  `src/utils/session-abort.js:74` writes `'timed-out'` there. No allowlist is correct.
- **`firstFailure` has TWO shapes.** Leg-class (`src/council/run-retry.js:98`) carries
  `{seat, class:'leg', status, reason}`; wave-class (`:86/:90/:93`) carries
  `{seat, class:'wave', waveId, reason}` and has **no `status` key**. Use `firstFailure` for
  **truthiness only** — never read `firstFailure.status`.
- **The `kind`/`channel` filter is load-bearing.** `run.degrades[]` also carries `kind:'heal'` /
  `channel:'stage1-retry'` records with the **same** `retryWaveId`/`firstFailure` fields for seats
  that RECOVERED. A field-only scan would tag a recovered seat "retried once".

- [ ] **Step 1: Write the failing tests**

In `tests/workspace/workspace-seats.test.js`, driving `renderSeatsPanel` through the repo's fake
DOM:
1. a seat with a `kind:'degrade'` / `channel:'dead-leg'` degrade carrying `retryWaveId`, whose
   cost row has `role:'seat'` → its row's cell index 8 reads `↻ retried once` and the row carries
   class `seat-retried`;
2. the same but with `status:'complete'` on the cost row → **still** cell 8, and the status cell
   still reads exactly `complete` (proves the honesty property the ruling was made for);
3. a seat whose only degrade is `kind:'heal'` / `channel:'stage1-retry'` with `retryWaveId` → cell
   8 is empty (proves the recovered-seat door is closed);
4. a `channel:'dead-wave'` degrade listing two models → both their rows are marked;
5. a non-reviewing role (e.g. `chair`) with a matching degrade → **not** marked;
6. a `firstFailure` of the **wave** shape (no `status` key) → still marked, and nothing throws.

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest tests/workspace/workspace-seats.test.js --runInBand`
Expected: cases 1, 2, 4 and 6 FAIL (cell 8 empty); 3 and 5 pass vacuously today — keep them, they
are the regression fence.

- [ ] **Step 3: Implement the helper**

Add to `workspace-seats.js`. The predicate **replicates `deadSeats`' own filter verbatim** — read
`live-model.js:227-241` and mirror it; do not paraphrase:

```js
  /**
   * Aliases of seats whose degrade record says they were retried. PR1F-4 (v4.7 PR7).
   *
   * ⚠️ Mirrors window.AmicusLive.deadSeats' own predicate (live-model.js:227-241) EXACTLY, and
   * must keep mirroring it. The kind/channel filter is load-bearing: run.degrades[] also carries
   * kind:'heal' / channel:'stage1-retry' records with the SAME retryWaveId/firstFailure fields
   * for seats that RECOVERED, and a field-only scan would tag a recovered seat "retried once".
   *
   * ⚠️ firstFailure is TRUTHINESS ONLY. It has two shapes — run-retry.js:98 emits
   * {seat, class:'leg', status, reason}; :86/:90/:93 emit {seat, class:'wave', waveId, reason}
   * with NO status key — so any read of firstFailure.status is undefined on every wave-origin
   * seat.
   */
  function retriedAliases(degrades) {
    var out = Object.create(null);
    (degrades || []).forEach(function (d) {
      if (!d || d.kind !== 'degrade') { return; }
      if (d.channel !== 'dead-leg' && d.channel !== 'dead-wave') { return; }
      var data = d.data || {};
      if (!(data.retryWaveId || data.firstFailure)) { return; }
      if (d.channel === 'dead-leg') {
        if (data.seat) { out[data.seat] = true; }
      } else {
        (data.models || []).forEach(function (m) { if (m) { out[m] = true; } });
      }
    });
    return out;
  }

  // Mirrors isReviewing at live-model.js:261-264 — a chair/judge/rebuttal/revote row must not
  // carry a reviewer's retry marker.
  function isReviewingRole(role) {
    return role === 'seat' || role === 'critic' ||
      (typeof role === 'string' && role.indexOf('lens:') === 0);
  }
```

- [ ] **Step 4: Apply it in `renderSeatsPanel`**

> ⚠️ **Carry the `deg` source-selection lines (`:52-57`) intact.** They are a **fallback, never a
> union** — `run.degrades` wins when non-empty, else `verdict.degrades`. Dropping or "simplifying"
> them silently loses the checkpoint-loss case. This is plan-failure mode (b) and it has bitten
> this project before.

`deg` is already computed at `:56-57`, *after* the `renderSeats` call at `:49`. The flag column is
painted by reaching into the rendered rows, so no reordering is needed — mark the rows after
`renderSeats` and before `renderDeadSeatRows`:

```js
    var retried = retriedAliases(deg);
    // ⚠️ Look rows up by data-key, NEVER by position. renderSeats (workspace-render.js:179-216)
    // keys every row on String(seat.id || seat.model) and RN-11 made it REORDER rows to match the
    // composed doc's leg order — so tbody.children[i] is not seats[i]. Build the key exactly the
    // way renderSeats does or the lookup silently misses.
    var rowsByKey = Object.create(null);
    Array.prototype.slice.call(tbody.children).forEach(function (row) {
      rowsByKey[row.dataset.key] = row;
    });
    seats.forEach(function (s) {
      if (!isReviewingRole(s.role) || !retried[s.modelInput || s.model]) { return; }
      var row = rowsByKey[String(s.id || s.model)];
      if (!row || !row.children[8]) { return; }
      // Column 8 is the table's unlabeled trailing flag cell (index.html:51's final <th></th>).
      // It carries '⏳ stalled' on the LIVE path; on this terminal path seatsFromRunStats
      // hardcodes stalled:false (live-model.js:128), so it is always empty here and free to use.
      // If that ever changes, this is the collision site.
      row.className = row.className ? row.className + ' seat-retried' : 'seat-retried';
      row.children[8].textContent = '↻ retried once';
    });
```

> **Scope consequence to state in your report, not to "fix".** `renderSeats` rewrites every cell
> whose text differs, so a subsequent live tick — `applyLive` calls `renderSeats` directly
> (`workspace-verbs.js:129-131`) — wipes this marker until the terminal refresh repaints it. That
> is the same flash-then-vanish shape documented in this file's own HISTORY block at `:25-39`, and
> it is **within** the owner-accepted "terminal-path-only" scope for PR1F-4. Do **not** add a
> live-tick re-append twin for it; do **not** write a test asserting the marker survives a tick.

Add to `electron/workspace-ui/workspace.css` (not gated):

```css
/* PR1F-4: a seat that was retried and still failed — the surviving errored row's own marker. */
.seat-retried td:last-child { color: var(--muted); white-space: nowrap; }
```

- [ ] **Step 5: Run the tests**

Run: `npx jest tests/workspace/workspace-seats.test.js tests/workspace/dead-seat-rows.test.js tests/workspace/live-model.test.js --runInBand`
Expected: all PASS. Baseline for these three was 3 suites / 51 tests.

Two existing pins must remain green and you must confirm each by name in your report:
- `tests/workspace/dead-seat-rows.test.js:111` and `:376` assert the exact string
  `'did not review — retried once'` on a **ghost** (`.seat-dead`) row. This change never touches
  `deadSeats`, so they should be untouched.
- `tests/workspace/dead-seat-rows.test.js:171-187` (test **(b2)**) pins
  `tbody.children.length === 2`, zero `.seat-dead` rows, and `children[1].children[2].textContent
  === 'error'`. Its fixture at `:176-180` carries **neither** `retryWaveId` nor `firstFailure`, so
  the retry-conditional must not fire there.

Run: `node scripts/check-file-sizes.js --all` → exit 0. Report `workspace-seats.js`'s count.

- [ ] **Step 6: Commit**

```bash
git add electron/workspace-ui/workspace-seats.js electron/workspace-ui/workspace.css tests/workspace/workspace-seats.test.js
git commit -m "feat(workspace): mark a retried-and-still-dead seat on its surviving row (PR1F-4)"
```

---

## Task 9: Schema riders — close the pid-less `running` orphan wave

**Files:**
- Modify: `src/mcp-tools.js:344` and `:353` (EXEMPT)
- Modify: `src/mcp-server.js` (the `amicus_fanout` pre-spawn validation block)
- Modify: `tests/pack/mcp-pack-params.test.js`

**The defect, proven twice independently.** `src/mcp-server.js:675-690` seeds `metadata.json`
`status:'running'` after a successful `spawn()`, and a child that exits 1 on a pre-launch gate
never overwrites it — so the MCP caller is told the run started. `src/mcp-tools.js:344` is
`prompt: z.string()` with **no** `.min(1)` and the handler adds no check, so an empty or
whitespace prompt passes schema validation, creates a wave dir, spawns, and the child dies
`MISSING_PROMPT` at `src/cli-handlers-fanout.js:61` — stranding a **pid-less 'running' orphan
wave**. `timeout: z.number().optional()` at `:353` has no `.min()`, so `{timeout: -1}` is
schema-valid and burns a wave dir plus a spawn on a guaranteed `BAD_ARGS`.

> ⚠️ **Failure mode (d) applies here.** `{timeout: -1}` is reachable **both** as a typed MCP param
> **and via a pack**. A guard placed only on the zod schema is half a guard — `validatePack`
> checks option KEY names, never value types. The handler-side check below is the half that
> covers the pack door, and the test must exercise both entrances.

- [ ] **Step 1: Write the failing tests**

In `tests/pack/mcp-pack-params.test.js`, using `callFanoutWithMockedSpawn` and `waveDirCount`:
1. `{prompt: ''}` → `isError` true, `spawnCallCount === 0`, `waveDirCount === 0`;
2. `{prompt: '   '}` (whitespace only) → same;
3. `{prompt: 'ok', timeout: -1}` → same;
4. a **pack** carrying `options: { timeout: -1 }` → same. (This is the door the schema cannot
   close.)

Model the assertions on the existing `I1` test at `:584`, which already pins exactly this
"never strands a pid-less running wave" property for the artifact-template case.

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest tests/pack/mcp-pack-params.test.js`
Expected: all four FAIL — a wave dir is created and spawn is called.

- [ ] **Step 3: Implement**

`src/mcp-tools.js:344`:

```js
      prompt: z.string().min(1, 'prompt must not be empty').describe(
```

`src/mcp-tools.js:353`:

```js
      timeout: z.number().positive('timeout must be a positive number of minutes').optional().describe(
```

Then in `amicus_fanout`, alongside the existing pre-spend validation (the block whose comment at
`:1250-1252` already says "validated BEFORE any wave dir / metadata is written so a bad request
never strands a pid-less 'running' orphan wave" — this is that block's own stated contract, not a
new one), add the handler-side check that also covers the pack door:

```js
    // ⚠️ v4.7 PR7: the zod schema closes the TYPED door; a pack can push the same values through
    // the other one (validatePack checks option KEY names, never value types). Both entrances
    // reach the same spawn, so the check lives here, after pack merge, before any wave dir.
    if (typeof input.prompt !== 'string' || !input.prompt.trim()) {
      return textResult('Error: prompt must not be empty.', true);
    }
    if (input.timeout !== undefined
        && (typeof input.timeout !== 'number' || !Number.isFinite(input.timeout) || input.timeout <= 0)) {
      return textResult('Error: timeout must be a positive number of minutes.', true);
    }
```

Place it **after** the pack-forward merge (so pack-supplied values are covered) and **before**
`fs.mkdirSync(waveDir…)`. Confirm by reading the surrounding code that no wave dir, metadata
write, or `recordSession` call precedes your insertion point.

- [ ] **Step 4: Run the tests**

Run: `npx jest tests/pack/mcp-pack-params.test.js tests/mcp` → PASS.
Run: `npx eslint src/mcp-tools.js src/mcp-server.js` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/mcp-tools.js src/mcp-server.js tests/pack/mcp-pack-params.test.js
git commit -m "fix(mcp): reject an empty prompt or non-positive timeout before stranding a running wave"
```

---

## Task 10: W1-M6/M7 — tripwire test and the declaring comment

**Files:**
- Modify: `tests/pack/mcp-pack-params.test.js`
- Modify: `src/mcp-server.js` (comment only, near the notice loop; EXEMPT)

**There is NO defect here.** The forward-notice plumbing is live on the default path — an
interactive `amicus_start` can never take the shared-server branch, because
`src/mcp-server.js:432` gates on `sharedServer.enabled && input.noUi`. With a synthetic orphanable
knob added to `KIND_OPTIONS.solo` and `COMMON_OPTION_KNOBS`, an interactive `amicus_start`
returns a second content block reading exactly
`Notice: pack 'orphan-pack' sets fooKnob, which amicus_start does not support over MCP —
ignored.` while still spawning once. It is unreachable today only **by invariant**:
`validatePack(mode:'run')` rejects every key outside `KIND_OPTIONS.solo`, and every key inside it
either has a `SOLO_PACK_PARAM_MAP` destination (`src/mcp-server.js:242-247`) or is in
`FORWARDABLE_ARG_KEYS` (`src/pack/pack-resolve.js:191` = `{'max-cost','template'}`).

> ⚠️ **The previously filed test plan for this item cannot be written** — it required a fixture
> `validatePack` structurally rejects (failure mode (a)). And the test named in the recon trace
> (`tests/zz-recon-w1m67b.test.js`) **does not exist on disk in any tree**; it is UNVERIFIED, not
> available to copy. You are deriving this test from committed source. If you conclude it cannot
> be made mutation-sensitive, report **DONE_WITH_CONCERNS** and say so rather than shipping a
> test that only pins a table.

- [ ] **Step 1: Write the tripwire**

Build it as a **notice-behaviour guard**, not a table-coverage assertion. Import the production
`KIND_OPTIONS` and `SOLO_PACK_PARAM_MAP` from source — **never re-type their contents into the
test** (the T15-m5 rule). The guard: for every key in `KIND_OPTIONS.solo`, assert it has either a
`SOLO_PACK_PARAM_MAP` destination or membership in `FORWARDABLE_ARG_KEYS` — and make the failure
message say, in words, that a key with neither is silently dropped and the notice loop near
`src/mcp-server.js:706` is what would surface it.

- [ ] **Step 2: Run it green at baseline**

Run: `npx jest tests/pack/mcp-pack-params.test.js`
Expected: PASS.

- [ ] **Step 3: Prove it has teeth (the mutation that WAS demonstrated)**

Add a synthetic knob `fooKnob` to `KIND_OPTIONS.solo` **and** `COMMON_OPTION_KNOBS` (a two-file
mutation). Re-read both files to confirm the bytes actually changed. Re-run the test: it must
**FAIL**. Then revert both files with `git checkout --` and re-run: PASS. Record both outputs in
your report — a mutation harness that fails to mutate reads as a pass.

- [ ] **Step 4: Add the declaring comment**

Near the notice loop in `src/mcp-server.js` (around `:706`), add a short comment stating that the
loop is **not** dead code: it is the shared idiom with the genuinely reachable `amicus_fanout`
surface (`FANOUT_PACK_PARAM_MAP` has no `contextTurns`/`contextMaxTokens` destination;
`src/mcp-server.js:1373` pushes those notices into `waveContent`, covered by
`tests/pack/mcp-pack-params.test.js:503`), and that on the solo surface it is unreachable only
while the `KIND_OPTIONS`/paramMap invariant holds — which the test from Step 1 guards.

- [ ] **Step 5: Commit**

```bash
git add tests/pack/mcp-pack-params.test.js src/mcp-server.js
git commit -m "test(pack): guard the solo pack knob/param-map invariant behind the forward-notice loop (W1-M6/M7)"
```

---

## Task 11: PR6F-1 — surface-neutral budget prose, and delete the undisplayed trailer

**Files:**
- Modify: `src/council/run-budget.js:156` and `:158` (283/300 — net 0 lines)
- Modify: `src/sidecar/fanout-budget.js:62-65` (71 lines → 67)
- Modify: tests asserting those strings (find them; do not guess)

**Owner ruling: Option N (surface-neutral).** The CLI-flavoured budget string that genuinely
reaches MCP callers is the degrade record built at `run-budget.js:156/158` — persisted to
`run.json` by `src/council/run-degrade.js:36` and handed back verbatim at
`src/mcp-council-awareness.js:188`. Both knobs exist on the MCP surface
(`src/mcp-tools.js:491` `maxCost`, `:508` `noCostGate`, inside `amicus_council_run`), so the only
mismatch is **spelling**. Option S was rejected: it would change `formatDegrade`'s documented
"ONE VOICE for every channel" contract for all channels.

> ⚠️ **Do not cite `src/sidecar/budget.js:67-69`'s docblock as evidence for anything here.** It
> claims the MCP surface has no per-call override — true for start/fanout, **misleading for the
> council path**.

- [ ] **Step 1: Find the pins before editing**

Run: `npx jest -t "max-cost" --listTests` is not sufficient. Grep the test tree for the two exact
literals (`--max-cost ceiling refused it` and `Raise --max-cost, or pass --no-cost-gate`) and list
every file that asserts them. Report the list before changing anything.

- [ ] **Step 2: Update the two literals**

`src/council/run-budget.js:156`:

```js
      why: `the $${maxCost} cost ceiling for this run refused it${message ? `: ${message}` : ''}`,
```

`:158`:

```js
      remedy: "Raise this run's cost ceiling, or turn the cost gate off, to seat them",
```

Net **0** lines. Add no comment here — the file is at 283/300 and the reason belongs in the
CHANGELOG, not in a hot file.

- [ ] **Step 3: Delete the undisplayed trailer**

`src/sidecar/fanout-budget.js:62-65` produces a `--max-cost`/`--no-cost-gate` reservation trailer
that **is produced on every reservation refusal but never displayed to anyone**: its sole producer
`src/council/run-launch.js` sets `quiet: true` at `:134` and forwards only `errorDoc.message` at
`:148`. (It is *undisplayed*, not *dead* — a verifier reproduced the string by execution. Use the
right word in the commit message.) Reduce the return to:

```js
    return {
      ok: false,
      message: 'Error: budget gate refused the wave',
      hint: `Budget gate: estimated total $${estimate.toFixed(4)} does not fit the --max-cost `
        + 'allowance still unclaimed by concurrently launching waves (estimate, not guaranteed).\n'
        + 'The run continues with the waves that did launch.',
    };
```

Leave `:51`'s `formatBudgetError(budget)` **unchanged** — recon established by execution that on a
budget refusal `runFanout` returns `{wave:null, errorDoc, exitCode:1}` and creates **no wave
directory at all**, so that hint reaches only a direct CLI `amicus fanout` invocation, where CLI
flavour is correct.

- [ ] **Step 4: Update the pinned tests and run**

Update every test found in Step 1 to the new literals.
Run: `npx jest tests/council tests/sidecar tests/mcp` → green.
Run: `node scripts/check-file-sizes.js --all` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/council/run-budget.js src/sidecar/fanout-budget.js tests
git commit -m "fix(council): surface-neutral budget refusal prose; drop the never-displayed reservation trailer (PR6F-1)"
```

---

## Task 12: Backlog, changelog, and the rescued riders

**Files:**
- Modify: `BACKLOG.md`
- Modify: `CHANGELOG.md`
- Modify: `src/utils/session-index-tmp-sweep.js:37-41` (comment only; 89/300)
- Add: `docs/superpowers/plans/2026-08-07-codex-host-parity-scoping.md` (untracked file that
  exists only on this disk — `git add` it)

**Spec D17 applies:** every BACKLOG item this PR touches must be explicitly ticked. A fixed-but-
unticked item is false open debt.

- [ ] **Step 1: Tick and annotate what this PR closed**

- **T19-m1** and **T19-m2** — tick both. Note that the shipped shape is: unconditional cache drop,
  monotonic issue token, two-argument `.then` termination with announced eviction, and the
  sync-safe matrix wrap; and that the **three** stale paths closed are A (close/flip/reopen), B
  (two waves in flight) and G (same-run manifest growth). Record that the "capture blind at issue
  time" shape and the "remap titles by name" shape were both **refuted** and why — that is what
  stops a future round from re-proposing them.
- **W1-M4** — tick. Note the fix landed in `mcp-server.js`, not `fanout.js` (300/300), and record
  the `briefing-input.md` residue and the `fanout-retry.js:136` replay consequence.
- **PR1F-4** — tick. Record the flag-column ruling and the `complete`-status case that motivated it.
- **W1-M6/M7** — tick, and **edit the existing six-line note** (BACKLOG.md `1080-1085`) rather than
  appending a fresh one. State that there is no defect, that the premise was wrong twice over, and
  that the invariant is now guarded by a test.
- **PR6F-1** — strike **(b)** entirely and record the verification: the CLI-flavoured text goes to
  stderr, `spawnSidecarProcess` wires stderr to a `debug.log` fd, and nothing under `src/` reads
  that file back. Tick **(a)** with the Option N retarget noted.

- [ ] **Step 2: File the items this PR deliberately did not take**

- **W1-M4 for `amicus_start`** — `src/mcp-server.js:669` writes `briefing.md = input.prompt` with
  the identical raw-vs-rendered divergence. Excluded from PR7 because nobody has executed that half
  end to end. File it with that reason stated.
- **PR1F-4 healed-seat marker** — whether a seat that recovered via retry should also say so. A new
  item, not this one.
- **PR1F-4 live-path retry text** — accepted as terminal-path-only; threading the retry set through
  the composed live doc is a data-layer change.
- **The `statSync`/`lstatSync` divergence** — file it properly (grep confirms **zero** existing
  BACKLOG hits for `statSync`). Record both deltas: the inclusion delta, and the unfiled one —
  `AGE_THRESHOLD_MS` is evaluated against the **target's** mtime because `statSync` follows, so a
  new link to an old file is swept immediately. Note it is not harmful (`unlinkSync` removes only
  the link; dir and dangling symlinks are already filtered by the `isFile()` gate) and that it
  cannot be exercised on this machine (`fs.symlinkSync` → `EPERM`), so any future test must fake
  `fs.statSync`/`fs.lstatSync`.

- [ ] **Step 3: Rewrite the sweep comment (owner ruling: keep `statSync`, state the policy)**

`src/utils/session-index-tmp-sweep.js:37-41` currently calls the divergence "a separate,
**unreviewed** symlink-policy decision left as-is". The word "unreviewed" must leave the source.
Rewrite it as a stated decision with its rationale, and cross-reference the new BACKLOG item.
`src/utils/session-metadata-tmp-sweep.js:28/:38` is its mirrored pair — if you change how the
divergence is described on one side, the other side's note must still read true.

- [ ] **Step 4: Re-append the four rescued PR3-rider items**

Four well-measured BACKLOG items were written on branch `fix/v47-pr3-riders` **after** its PR
merged and never reached `main`. Owner-approved for rescue in PR7. The patch is preserved at
`<scratchpad>/pr7-rescue/pr3-riders-backlog.patch` (99 added lines).

> ⚠️ **`git apply` will REJECT it.** Its `@@` anchor is the then-EOF at line 1239, and that tail
> (PR1F-4) has since grown a `— recon 2026-08-08:` note. The content is a pure append: take the
> added lines from the patch and append them at the **current** EOF. Do not fight a 3-way merge.

The four: `sessions-index.json` unbounded growth (keep every measured figure — 18,874 entries,
0.69 MB, 31.4% dead, `--all` 8,275 ms → 53 ms after prune — and its three costed design options);
council runs invisible to CLI `amicus list`; `continue`/`resume` sessions grouping under
`(unattributed)`; and `--tag` + `--retry-failed` rejected rather than inherited. The last two are
explicitly one policy decision — keep that framing.

- [ ] **Step 5: Track the tabled scoping doc**

`docs/superpowers/plans/2026-08-07-codex-host-parity-scoping.md` is untracked and exists only on
this disk, while its own header says it exists "so the scoping effort is not lost". `git add` it
unchanged. Do not edit its content.

- [ ] **Step 6: CHANGELOG**

Add an `[Unreleased]` entry covering: the three stale-paint paths and the rejection termination;
the rendered fanout briefing (**note the behaviour change**: wave dirs may now contain
`briefing-input.md`, and `--search` now matches rendered text for aborted MCP waves); the retry
marker; the empty-prompt/non-positive-timeout rejection (**behaviour change**: requests that
previously created a wave dir and spawned now fail fast); and the surface-neutral budget prose.

Claim only what shipped. An overstated CHANGELOG was a finding in the last PR's final review.

- [ ] **Step 7: Verify and commit**

Run: `node scripts/check-file-sizes.js --all` → exit 0.
Run: `npx jest tests/utils` → green (the sweep comment is comment-only, but prove it).

```bash
git add BACKLOG.md CHANGELOG.md src/utils/session-index-tmp-sweep.js docs/superpowers/plans/2026-08-07-codex-host-parity-scoping.md
git commit -m "docs: PR7 dispositions, the statSync ruling, and the rescued PR3-rider items"
```

---

## Final gates (controller, after all tasks)

1. `npx jest --runInBand` → expect **≥ 504 suites / ≥ 6852 passing**, zero failures.
2. `node scripts/check-file-sizes.js --all` → exit 0.
3. `node scripts/generate-docs.js --check` → exit 0.
4. `npx eslint .` → exit 0.
5. Fable whole-branch review on the full branch diff, then ONE consolidated fix wave.
6. Push (allow ≥ 5 minutes — the pre-push hook runs the full suite), open the PR with the
   **`council-review`** label, which is what gates `council-review.yml`.

## Self-review notes

- **Spec coverage:** T19-m1 (Tasks 3, 4), T19-m2 (Tasks 5, 6), W1-M4 (Task 7), PR1F-4 (Task 8),
  W1-M6/M7 (Task 10), PR6F-1 a and b (Tasks 11, 12), schema riders (Task 9), statSync (Task 12),
  rescued riders (Task 12). Task 1 is the owner-ruled enabling extraction; Task 2 is the guard that
  kills the refuted title-remap shape.
- **Deliberately out of scope,** filed in Task 12: W1-M4 for `amicus_start`; the PR1F-4 healed-seat
  marker; PR1F-4 on the live path; extracting `src/sidecar/fanout.js` or `src/pack/pack-resolve.js`
  (both 300/300 — no task in this plan adds a line to either).
- **Line-count figures in this plan are estimates except where marked measured.** The
  post-extraction sizes of `workspace-panels.js` and `workspace-lazy.js` are explicitly a range;
  two independent recon extractions produced different numbers because the new file's size depends
  on prose that had not been written. Do not treat a range as a target.

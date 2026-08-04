# v4.6.2 PR4 — Workspace dead-seat rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** spec §7, D6, D8 — a seat the run announced dead renders a row on the Workspace seats
panel ("did not review — retried once" / "did not review") derived from `degrades[]`/`seatLoss`,
when and only when the seat has zero usable legs. The v4.6 announcement invariant finally holds
on the surface users actually watch (field evidence: run `2039b2d1`'s retried dead critic has
no row today — chips/street-cred/verdict/report all carry the loss, the seats panel doesn't).

**Architecture:** D8 extraction FIRST — seats rendering moves from `workspace-panels.js`
(295/300) to a new `electron/workspace-ui/workspace-seats.js`, behavior-identical, with panels
keeping a thin delegate so `workspace-app.js`'s `P.renderSeatsPanel()` call sites are untouched.
Then the feature lands in the NEW file: dead-seat rows appended after live rows, derived from
the run's degrade records, blind-masking honored.

**Tech Stack:** ES5 IIFE renderer style (the no-var exemption zone — match the file, do NOT
modernize), jest fake-DOM harness (`tests/workspace/helpers/fake-workspace-page.js`), house
conventions. Base: `main@0385ae1`.

## Global Constraints

- TDD; commits end `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- D6 verbatim: a dead-seat row renders ONLY when the seat has zero usable legs (no entry in the
  live model's seat map). No ghost when a retry succeeded; no duplicate against the model-keyed
  live rows (the F35/RN-11 lessons — read `live-model.js:81-95`'s warnings first).
- Row content: seat model name (blind-masked exactly as live rows are), status text
  `did not review — retried once` when the degrade record carries `retryWaveId` (the SL-2
  enriched record), else `did not review`; NO cost cell; a distinct muted style class
  (`seat-dead`; find the workspace stylesheet seam and follow its class conventions).
- Data source: the run's `degrades[]` (records with `channel: 'dead-leg'`/`'dead-wave'`, per-seat
  model fields) and `verdict.seatLoss` for the critic — read `src/utils/degrade.js` +
  `src/council/run-degrade.js` record shapes and `run.json`'s persisted `degrades[]` BEFORE
  designing the derivation; verify what the renderer's data layer (`live-model.js`,
  `workspace-app.js`'s run fetch) already exposes and thread additively if absent
  (`live-model.js` is 112/300 — room to grow).
- ES5 style in `electron/workspace-ui/**` (`no-var` is OFF there deliberately — the rewrite is
  its own ruled task; write `var`, match siblings).
- Size gates: `workspace-panels.js` 295/300 (the extraction must land it comfortably below —
  target ≤250), `workspace-render.js` 287/300 (do NOT grow it), new `workspace-seats.js` well
  under 300. Renderer files are served raw under strict CSP — no build step, no require() in
  renderer files; follow the existing namespace/IIFE wiring exactly.
- ⚠️ Parallel-session guard: expect `origin/main` movement (merge + union CHANGELOG before
  push). No `curated-models.js` touches.

---

### Task 1: the D8 extraction (behavior-identical)

**Files:**
- Create: `electron/workspace-ui/workspace-seats.js`
- Modify: `electron/workspace-ui/workspace-panels.js` (remove the moved code; keep a delegate),
  plus whatever loads renderer scripts (find the HTML/script-tag or preload list that includes
  `workspace-panels.js` — the new file must load BEFORE panels if panels delegates to it; read
  `electron/` for the loader and mirror how a sibling file was added historically)
- Test: existing `tests/workspace/` suites must pass UNCHANGED (behavior-identical bar); add
  one thin test pinning the delegate (panels' namespace still exposes `renderSeatsPanel` and it
  renders via the new module).

- [ ] Step 1: read `workspace-panels.js:40-<end of seats code>` + the namespace export at
  `:287`, `workspace-app.js`'s call sites, and the script loader. Map exactly which functions
  move (the seats render block and its private helpers; nothing else).
- [ ] Step 2: move verbatim (var-for-var) into `workspace-seats.js` under the house IIFE/
  namespace pattern; panels delegates. Loader updated.
- [ ] Step 3: run the FULL `tests/workspace/` family — must be green with zero test edits
  (except the one new delegate pin). Any red = the extraction changed behavior; fix the
  extraction, never the tests.
- [ ] Step 4: `npm run lint` + `npm run check:sizes` (report both files' new counts).
- [ ] Step 5: commit `refactor(workspace): extract seats rendering to workspace-seats.js (behavior-identical)`.

---

### Task 2: dead-seat rows

**Files:**
- Modify: `electron/workspace-ui/workspace-seats.js` (the feature), `live-model.js` ONLY if the
  degrade data isn't already exposed (additive), the workspace stylesheet (`seat-dead` class)
- Test: new `tests/workspace/dead-seat-rows.test.js` on the fake-DOM harness

Derivation contract (verify record shapes first per Global Constraints):
- Collect announced-dead seats: from the run doc's `degrades[]`, records of kind `degrade` on
  the `dead-leg`/`dead-wave` channels carrying a seat/model identity; union the critic loss from
  `seatLoss` (`criticRequested && !criticSeated`). De-dup by seat model.
- Filter: drop any seat that HAS a row in the live seat map (D6 — zero usable legs only).
- Render: appended after live rows, model name through the SAME masking path live rows use
  (blind mode must mask dead rows identically — test it), status text per the retry marker
  (`retryWaveId`/`firstFailure` on the record → "did not review — retried once"), `seat-dead`
  class, no cost cell.

- [ ] Step 1: failing fake-DOM tests — (a) dead-critic fixture (model the fixture on the REAL
  run `2039b2d1` shape: one dead critic with firstFailure+retryWaveId, five live legs) renders
  exactly one `seat-dead` row with "did not review — retried once"; (b) a seat that died then
  RECOVERED via retry (has a usable leg) renders NO dead row; (c) blind mode masks the dead
  row's name exactly as live rows; (d) a run with no degrades renders zero dead rows (no
  regression on the happy path).
- [ ] Step 2: RED. Step 3: implement. Step 4: GREEN + full `tests/workspace/` family.
- [ ] Step 5: commit `feat(workspace): announced-dead seats render rows — the invariant reaches the seats panel`.

---

### Task 3: docs + gates

- [ ] `CHANGELOG.md [Unreleased] ### Added` bullet (house style; main's block carries
  PR1/PR2/PR3-era content — append in style). `docs/council.md` or the Workspace section of
  README/docs — ONE line where the seats panel is described, stating dead seats now render
  (find where the panel is documented; if nowhere, skip prose and say so in the report).
- [ ] Gates: `node scripts/generate-docs.js` · `npm run lint` · `npm run check:sizes` · full
  `npm test` (totals + delta attribution).
- [ ] Commit `docs(v4.6.2-pr4): CHANGELOG + workspace docs for dead-seat rows`.

---

### Task 4 (controller-only — implementers skip): GUI smoke + PR

- [ ] Historical-run GUI smoke, zero spend: `node bin/amicus.js watch 2039b2d1 --ui` (the PR2-era
  run with the retried dead critic lives in session history) — the seats panel must show the
  dead-critic row; blind-mode toggle masks it. Screenshot evidence.
- [ ] Merge origin/main + union CHANGELOG; push; PR.

## Plan self-review (done at writing time)

D8 extraction-first ✓ (T1, behavior-identical bar with zero-test-edit discipline); D6
zero-usable-legs rule ✓ (T2 contract + recovered-seat test); blind masking ✓; record-shape
verification mandated before design ✓; ES5/no-var zone respected ✓; renderer CSP/no-require
constraint stated ✓; the 2039b2d1 fixture grounds tests in a real run shape ✓.

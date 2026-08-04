# v4.6.2 PR4b — Mid-poll dead-seat rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Christian's ruling on PR #102's open question — dead-seat rows appear MID-POLL on a
still-running run, as soon as the degrade checkpoint lands, instead of only at terminal.

**Architecture:** thread `degrades` through the live spine (composed status payload →
`normalizeLive` → renderer), then re-append dead rows on every live tick right after
`renderSeats`' repaint (whose leaver-removal wipes them — that wipe+re-append is the same
idempotent pattern `renderSeatsPanel` already uses). The terminal gate in `renderSeatsPanel`
is REMOVED — it existed only to prevent flash-then-vanish, which re-append cures at the root.
All new logic lands in `workspace-seats.js` (106/300); `workspace-verbs.js` (293/300) gains
exactly ONE call line.

**Tech Stack:** ES5 IIFE renderer zone (write `var`, no require()), jest, fake-DOM harness
(`tests/workspace/helpers/fake-workspace-page.js`). Base: PR #102 branch head `ec20859`.

## Global Constraints

- TDD; commits end `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Size gates (hard 300): `src/mcp-council-awareness.js` 282/300 (+≤4 lines), `workspace-verbs.js`
  293/300 (+1 line ONLY — every helper lives elsewhere), `live-normalize.js` 169/300,
  `workspace-seats.js` grows freely (well under 300). `workspace-render.js` untouched.
- D6 still governs: a dead row renders only for a seat with zero usable legs at that instant —
  `deadSeats(degrades, seatLoss, liveSeats)` already enforces it; both call paths reuse it.
- Blind masking: the `(masked)` null-label rule ships in `renderDeadSeatRows` — the live path
  MUST route through that same function (no second renderer).
- Mid-run data truth: a dead-leg/dead-wave record is checkpointed to `run.json` only after that
  seat's retry resolves (no flicker window); `verdict.seatLoss` exists only at terminal — the
  live path passes whatever `state.detail.verdict` holds (absent mid-run is correct; the critic's
  own dead-leg degrade covers it mid-run, proven on run `12c96b6b`).
- ES5/`var` in `electron/workspace-ui/**`; renderer files raw under CSP — no require().

---

### Task 1: thread `degrades` through the live spine

**Files:**
- Modify: `src/mcp-council-awareness.js` (the `buildCouncilStatusPayload` return object)
- Modify: `src/workspace/live-normalize.js` (the normalized `ok:true` payload)
- Test: `tests/observe/council-legs.test.js`, `tests/workspace/live-normalize.test.js`

**Interfaces:**
- Consumes: `run = runState.readRun(ptr.runDir)` already parsed in `buildCouncilStatusPayload`;
  `run.degrades` is the persisted array (may be absent on old runs).
- Produces: composed status doc carries `degrades: run.degrades || []`; `normalizeLive(doc)`
  output carries `degrades: Array.isArray(doc.degrades) ? doc.degrades : []`. Task 2 reads
  `live.degrades`.

- [ ] **Step 1: failing test — composed payload carries degrades.** In
  `tests/observe/council-legs.test.js`, find how existing tests build a run dir + pointer and
  call `buildCouncilStatusPayload`; add one test in that idiom:

```js
test('payload carries run.json degrades[] verbatim; [] when absent', () => {
  // fixture A: run.json with degrades: [{ kind: 'degrade', channel: 'dead-leg',
  //   what: 'seat x did not review', data: { seat: 'x', retryWaveId: 'w2' } }]
  // fixture B: run.json with no degrades key
  // assert payloadA.degrades deep-equals the array; payloadB.degrades deep-equals []
});
```

- [ ] **Step 2: failing test — normalizeLive passes degrades through.** In
  `tests/workspace/live-normalize.test.js`, in the file's existing fixture idiom: a composed doc
  with the same one-record `degrades` → normalized `.degrades` deep-equals it; a doc without
  `degrades` (and one with a non-array `degrades: 'junk'`) → `.degrades` is `[]`.

- [ ] **Step 3: run both suites, confirm the new tests FAIL** (payload/normalized object has no
  `degrades` key).

- [ ] **Step 4: implement.** In `buildCouncilStatusPayload`'s returned object add one line
  (match neighboring key style):

```js
degrades: run.degrades || [],
```

  In `live-normalize.js`'s `ok:true` return add:

```js
degrades: Array.isArray(doc.degrades) ? doc.degrades : [],
```

- [ ] **Step 5: both suites green; then `npm run check:sizes` (report awareness + normalize
  counts — awareness must stay ≤300).**

- [ ] **Step 6: commit** `feat(workspace): live status payload carries degrades[] — the mid-poll spine`

---

### Task 2: renderer — re-append on tick, gate removal

**Files:**
- Modify: `electron/workspace-ui/workspace-seats.js` (new `appendDeadRows(live)`; gate removal
  in `renderSeatsPanel`; header rewrite comes in Task 3)
- Modify: `electron/workspace-ui/workspace-verbs.js` (ONE line in `applyLive`)
- Test: `tests/workspace/live-loop.test.js` (the applyLive/tick suite),
  `tests/workspace/workspace-app-boundary.test.js` (the gate test flips),
  `tests/workspace/dead-seat-rows.test.js` (unit for `appendDeadRows`)

**Interfaces:**
- Consumes: `live.degrades` (Task 1), `live.seats` (existing payload seat objects — same shape
  `deadSeats`' third param takes), `window.AmicusLive.deadSeats(degrades, seatLoss, liveSeats)`,
  `renderDeadSeatRows(tbody, dead, blindOn, labelOf)` (both exist).
- Produces: `window.AmicusSeats.appendDeadRows(live)` — void; reads `AmicusApp` state for
  blind/labelOf/verdict exactly like `renderSeatsPanel` does.

- [ ] **Step 1: failing tests.**
  (a) In `dead-seat-rows.test.js`: `appendDeadRows({ ok: true, seats: [...live seat objs...],
  degrades: [dead-leg record for a model NOT in seats] })` → exactly one `.seat-dead` row in
  `#seats-body`; called twice in a row after a fresh `renderSeats` repaint → still exactly one
  (the wipe+re-append idempotency); a degrade naming a model that IS in `seats` → zero dead rows
  (D6).
  (b) In `live-loop.test.js` (existing tick idiom): a tick whose `workspace:get-live` reply
  carries `seats` + a dead `degrades` record → after the tick, `#seats-body` contains the live
  rows AND the dead row (this is the flash-then-vanish inversion: pre-implementation the tick
  wipes it).
  (c) In `workspace-app-boundary.test.js`: FLIP the existing gate test — `openRun` on a
  NON-terminal run whose fixture carries `degrades[]` now DOES render the dead row (rewrite that
  test's name + assertion; it currently asserts zero).
- [ ] **Step 2: run the three suites — (a) fails on missing `appendDeadRows`, (b) fails with the
  dead row wiped, (c) fails asserting the old gate.**
- [ ] **Step 3: implement.** `workspace-seats.js` — remove the `isTerminal` gate so
  `renderSeatsPanel` always runs the dead block, and add:

```js
  /**
   * Live-tick twin of renderSeatsPanel's dead block (PR4b, Christian's mid-poll
   * ruling on PR #102): applyLive's renderSeats repaint wipes dead:-keyed rows
   * (leaver-removal), so every tick re-appends from the tick's own payload.
   * seatLoss comes from state.detail (absent mid-run — the critic's own
   * dead-leg degrade covers it live; the terminal refresh unions the rest).
   */
  function appendDeadRows(live) {
    var A = window.AmicusApp;
    var d = A.state.detail;
    var seatLoss = d && d.verdict ? d.verdict.seatLoss : null;
    var dead = window.AmicusLive.deadSeats(live.degrades, seatLoss, live.seats || []);
    renderDeadSeatRows(A.$('seats-body'), dead, A.state.blind, A.labelOf);
  }
```

  export it: `appendDeadRows: appendDeadRows,` in the namespace object.
  `workspace-verbs.js` `applyLive`, inside the existing `if (live.seats) { ... }` block, directly
  after the `R.renderSeats(...)` line, add exactly:

```js
      window.AmicusSeats.appendDeadRows(live);
```

- [ ] **Step 4: the three suites green, then the full `tests/workspace/` family green; `npm run
  lint`; `npm run check:sizes` (verbs MUST report ≤294).**
- [ ] **Step 5: commit** `feat(workspace): dead-seat rows appear mid-poll — ruled on PR #102`

---

### Task 3: docs flip + gates

**Files:**
- Modify: `CHANGELOG.md` (the dead-seat bullet's terminal-gated sentences), `docs/council.md:332-334`
  (same flip), `electron/workspace-ui/workspace-seats.js` (header: the NOTE + fix-wave paragraphs
  describe the gate as current design — rewrite as history: the gate shipped, then the mid-poll
  ruling replaced it with tick re-append), `electron/workspace-ui/workspace-app.js` +
  `workspace-verbs.js` headers ONLY if they state terminal-only seats behavior (check; likely not).
- Test: none new (docs/comments only — zero semantic edits outside them).

- [ ] **Step 1: CHANGELOG** — replace the "terminal-gated on purpose / never appear mid-poll"
  sentences: dead rows appear live, as soon as the run checkpoints the loss (post-retry), and the
  terminal refresh unions the critic's `seatLoss`; keep the `(masked)` clause.
- [ ] **Step 2: docs/council.md** — same flip in the file's voice, one sentence.
- [ ] **Step 3: workspace-seats.js header** — one consistent story (checkpoint timing → tick
  re-append → why no flicker: records land post-retry).
- [ ] **Step 4: gates** — `node scripts/generate-docs.js` · `npm run lint` · `npm run
  check:sizes` · full `npm test` (report totals + attribute the delta vs 6453).
- [ ] **Step 5: commit** `docs(v4.6.2-pr4b): mid-poll semantics in CHANGELOG + council docs; seats header history`

---

### Task 4 (controller-only — implementers skip): review, live smoke, ship

- [ ] Per-task reviews already ran; fable pass over the whole PR4b diff (ec20859..head).
- [ ] LIVE mid-run smoke: launch a fresh dead-critic council (the 12c96b6b recipe), open
  `watch <id> --ui` WHILE Stage 1+ still runs, driver-assert the dead row is present while
  `run.status` is non-terminal; screenshot; confirm survival to terminal.
- [ ] Push to the PR #102 branch; verify checks re-launch; update the PR body's owner-decision
  section (ruled + implemented) + a PR comment noting the ruling.

## Plan self-review (done at writing time)

Spec coverage: the ruling = mid-poll appearance ✓ (T1 spine, T2 re-append+gate removal, T3 truth
flip, T4 live proof). Placeholder scan: all code steps carry real code (T1 Step-1 fixture prose
rides existing idioms by instruction — the suites' own builders are the source). Type consistency:
`appendDeadRows(live)` consumes exactly what Task 1 produces (`live.degrades` array, always
present post-normalize); `deadSeats`/`renderDeadSeatRows` signatures verified against head
`ec20859` before writing. Measured: verbs 293 (+1=294 ✓), awareness 282 (+1-2 ✓), normalize 169,
seats 106.

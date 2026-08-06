# v4.7 PR1 — CA-4 Row-per-Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every paid council leg appears on exactly one `runStats` row (spec §5, D1–D7) — the leg–row bijection — so Σ(tally.runStats) ≡ run.json's usage block, test-enforced.

**Architecture:** New non-primary row classes (`chair-attempt`, `repair`, `superseded`) born at each launch site and threaded through the existing assembly spine (`buildRunStatsEntry` → `buildTallyInput` → tally allowlist); primary rows extended with honest error rows for dead seats and the give-up chair; consumers flipped fail-closed (ledger allowlist, seats-panel filter, report suffixes); a D5 invariant suite closes the loop with a reconstructed divergence regression fixture.

**Tech Stack:** Node (CommonJS), jest (TDD — every behavior change RED-first), existing fake-launchers test harness.

**Spec:** `docs/superpowers/specs/2026-08-06-v4.7-count-is-the-count-design.md` §5. Recon re-grounded 2026-08-06 at `main` @ `ccd8d7d` (post-PR0).

## Spec errata (recon findings at `ccd8d7d` — the plan implements THESE; spec §5 gets an errata note in Task 9)

- **E1 (D4 correction):** `seatsFromRunStats` (electron/workspace-ui/live-model.js:98-113) has NO role allowlist today — #108's `isReviewing` filter lives only in `deadSeats()` (:223-226). The plan ADDs a filter excluding ONLY the three new roles; judge/chair/rebuttal/revote rows keep rendering exactly as today (F37 pin live-model.test.js:99-106 stays green).
- **E2 (D4 correction):** the ledger-join allowlist must include legacy role `'council'` (ledger.js:34 default; av-receiver golden fixture rows carry it) → allowlist = `seat`, `critic`, `lens:*`, `chair`, `claude`, `council`; `judge` stays excluded (#83).
- **E3 (D2 refinement):** the give-up chair error row carries **`wasChair: false`** — nobody chaired; this keeps run-chair-seam.test.js:101's "no wasChair row on give-up" pin TRUE in spirit (pin updated to also assert the new error row). A cost-SKIPPED chair (never walked, no launch, already degrade-announced) gets **no row** — bijection: no leg, no row.
- **E4 (D2 gap):** two billed classes the spec's list missed, forced by D1's bijection: **failed SL-2 retry legs** and **failed debate-repair legs**. Unifying rule: *the primary row of a requested seat attributes the seat's FINAL leg; every earlier leg of that seat gets a `superseded` row; every repair launch gets a `repair` row (error status when it failed).* Dead-WAVE-origin healed seats have no first leg at all — no superseded row exists for them (state this in the invariant test comments).
- **E5 (scope pins):** `run-retry.js` (280) and `run-budget.js` (283) take ZERO edits — superseded pairs are computed in run-stages.js from `deadLegs0` (:139) × recovered seats, mirroring the healed-set idiom at :149-152; the invariant test only READS `usageBlock()`.

## Global Constraints

- **TDD is mandatory** — every behavior change lands RED-first; refactor-only steps (Task 1) use the dependent-suite net instead.
- **Additive only:** run.json/tally.json/verdict.json gain fields and rows, never lose or rename; `schemaVersion` values unchanged. Schemas need ZERO edits (council-tally.schema.json:67 and council-verdict.schema.json:168-173 declare runStats items unconstrained — verified; schemas.test.js:170-177 stays green).
- **D7 guard:** `chairAttempts[]` entry shape `{waveId, model, outcome, reason}` and its per-attempt checkpoint (run-chair.js:125) are BYTE-UNTOUCHED — run-chair.test.js:126/152/192 + schemas-degrades-lockstep.test.js:54-80 pin it and must pass unedited.
- **`resolvedModel` is NOT in this PR** (it's PR2/GOA-7's D8). Only `waveId` is added to rows, emit-only-when-set.
- Never introduce `degraded.value =` (repo-wide scan) or stderr writes in council modules whose announcements route through run-debate-stage/run-degrade.
- Line gate ≤300; `run-stages.js` (298/300) MUST be extracted before any edit (Task 1); new files gate-covered from birth.
- Single suites: bare `npx jest <path>` — NEVER `npm test -- <path>` (stamps `.test-passed`, pre-push hook then skips the suite).
- Never bare `npm install`; manual checks via `node bin/amicus.js`; `git push` ≥5-min timeout.
- Commits conventional; body ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Branch `feat/v4.7-pr1-ca4-row-per-launch` from `main` @ `ccd8d7d`+, in a worktree (junction rules: link-only delete before remove; archive `.superpowers` first).

---

### Task 1: Worktree + baseline + the mandatory run-stages extraction

**Files:**
- Create: `src/council/run-stage1-launch.js`
- Modify: `src/council/run-stages.js` (delete lines 32–109; import)

**Interfaces:**
- Produces: `run-stage1-launch.js` exporting `launchStage1(ctx, o)` — signature identical to today's internal function (single call site, run-stages.js:134). NOT re-exported from run-stages (it was never exported).

- [ ] **Step 1:** Worktree + branch:
```bash
git -C C:/Users/sendt/code/amicus worktree add ../amicus-wt-v47-pr1 -b feat/v4.7-pr1-ca4-row-per-launch main
```
Junction node_modules (PowerShell): `New-Item -ItemType Junction -Path <wt>\node_modules -Target <main>\node_modules`. Start `.superpowers/sdd/progress.md` from this plan's header.
- [ ] **Step 2:** Baseline: `node scripts/check-file-sizes.js --all` exit 0; `wc -l src/council/run-stages.js` = 298 (STOP and re-measure everything if not).
- [ ] **Step 3:** Create `src/council/run-stage1-launch.js`:
```js
/**
 * Stage-1 launch pass for the council engine.
 *
 * launchStage1 moved verbatim from run-stages.js (v4.7 PR1 Task 1) to free
 * gate headroom before the row-per-launch edits land there.
 */
'use strict';

// <PASTE run-stages.js lines 32-109 verbatim (launchStage1 + its docblock).
//  Its requires (briefings, runState, isAbortExit from ./run-launch) come
//  along: add exactly the require lines the moved body references.>

module.exports = { launchStage1 };
```
- [ ] **Step 4:** In run-stages.js: delete 32–109; add `const { launchStage1 } = require('./run-stage1-launch');`; delete any module-level imports that became dead (grep each).
- [ ] **Step 5:** Dependent suites (refactor net, no TDD):
```bash
npx jest tests/council/run-stages.test.js tests/council/run-happy.test.js tests/council/run-retry.test.js tests/council/run-all-clean.test.js tests/council/degrade-channels.test.js
```
Expected: PASS. Then `node scripts/check-file-sizes.js --all` exit 0 (run-stages ≈ 221, new file ≈ 85) and `npm run lint` clean.
- [ ] **Step 6:** Commit: `refactor(council): extract launchStage1 to run-stage1-launch.js (v4.7 PR1 headroom; zero behavior change)`

---

### Task 2: waveId on rows (D3) — plumbing end to end

**Files:**
- Modify: `src/council/run-assemble.js` (buildRunStatsEntry), `src/council/tally.js` (allowlist), `src/council/run-debate.js` + `src/council/debate.js` (thread waveId through the 6-key strip into debateRunStatsRows)
- Test: `tests/council/run-assemble.test.js`, `tests/council/tally.test.js`, `tests/council/debate.test.js`, `tests/council/helpers/fake-launchers.js` (mkLeg gains waveId — additive)

**Interfaces:**
- Produces: every runStats row built from a leg carries `waveId: leg.waveId` emit-only-when-set (absent key when the leg has none — old fixtures byte-stable); tally allowlist passes it through identically.

- [ ] **Step 1 (RED):** In run-assemble.test.js add:
```js
test('buildRunStatsEntry carries the leg waveId, absent when the leg has none', () => {
  const row = buildRunStatsEntry({ leg: { ...mkLeg('m1'), waveId: 'r1-s1' }, model: 'm1', role: 'seat', wasChair: false });
  expect(row.waveId).toBe('r1-s1');
  const bare = buildRunStatsEntry({ leg: null, model: 'claude', role: 'claude', wasChair: false });
  expect('waveId' in bare).toBe(false);
});
```
In tally.test.js extend the exact-key pin (:174-182) with a waveId-carrying row case: the allowlisted output keeps `waveId`; the no-waveId row's key set is UNCHANGED (byte-compat).
- [ ] **Step 2:** Run both suites — RED (waveId undefined / key missing).
- [ ] **Step 3 (GREEN):** buildRunStatsEntry: `...(leg && leg.waveId ? { waveId: leg.waveId } : {})`. tally.js allowlist (:115-130): `...(r.waveId ? { waveId: r.waveId } : {})`. Debate: in run-debate.js, add `waveId: l.waveId` to the 6-key leg strip; in debate.js `debateRunStatsRows`, carry it into the row with the same emit-only-when-set guard. mkLeg in fake-launchers gains `waveId` param (default undefined — existing callers unchanged).
- [ ] **Step 4:** `npx jest tests/council/run-assemble.test.js tests/council/tally.test.js tests/council/debate.test.js tests/council/run-happy.test.js` → PASS (run-happy's length-7 pin at :69 unaffected — repair-free fixture).
- [ ] **Step 5:** Commit: `feat(council): runStats rows carry waveId (v4.7 D3, emit-only-when-set)`

---

### Task 3: chair-class rows (failed attempts, ch4 repair, give-up error row)

**Files:**
- Modify: `src/council/run-chair.js` (accumulate rows; widen return), `src/council/run.js` (:237-244 append block)
- Test: `tests/council/run-chair.test.js`, `tests/council/run-chair-seam.test.js`

**Interfaces:**
- Produces: `runChair(...)` return gains `chairRows: []` — non-primary rows only: one `{role:'chair-attempt', wasChair:false, waveId, model, status, durationMs, usage}` per FAILED attempt with a rawLeg (null rawLeg = no wave = no money = no row), plus one `{role:'repair', wasChair:false}` row for a launched ch4 (repair.leg non-null). run.js appends chairRows always, and on give-up — chairLeg null AND the walk actually happened, keyed on the recorded `chairAttempts` being non-empty (NOT on chairRows: attempts that died pre-wave record an outcome but produce no row) — appends `buildRunStatsEntry({leg:null, model:o.chair, role:'chair', wasChair:false})` (status 'error', usage null, no waveId). Cost-skipped chair (skippedForCost, zero attempts): chairRows empty, NO give-up row.
- Consumes: buildRunStatsEntry (import into run-chair.js or build rows in run.js from returned rawLegs — implementer's choice; run-chair.js has 78 lines of headroom, prefer building in run-chair via a passed-in builder to keep run.js small).

- [ ] **Step 1 (RED):** run-chair.test.js: three new tests —
```js
test('a failed ch1 followed by a successful ch2 yields one chair-attempt row carrying ch1 usage', ...)
test('a launched ch4 repair yields a repair row; an unlaunched one yields none', ...)
test('give-up after a walk: chairRows carry every failed attempt; no row has wasChair true', ...)
```
(Drive through the existing attemptChair fakes; assert `waveId` matches `${runId}-ch1` etc.) run-chair-seam.test.js:101: extend the pin — give-up still yields NO `wasChair:true` row AND now yields exactly one `role:'chair', status:'error', usage:null` row for the requested chair.
- [ ] **Step 2:** RED run.
- [ ] **Step 3 (GREEN):** In recordAttempt (:120-126), when the attempt failed and `attempt.rawLeg` is non-null, push a row into a local `chairRows` (builder passed via deps or imported); after the ch4 block, push the repair row when `repair.leg` non-null. Widen the return (:217-219) with `chairRows`. In run.js: replace the single-append block (:237-244) — primary chair row as today, then `finalInput.runStats.push(...chair.chairRows)`, then the give-up row per the Interfaces contract. D7: do NOT touch the chairAttempts push or checkpoint.
- [ ] **Step 4:** `npx jest tests/council/run-chair.test.js tests/council/run-chair-seam.test.js tests/council/run-happy.test.js tests/schemas-degrades-lockstep.test.js` → PASS (lockstep pins prove chairAttempts untouched).
- [ ] **Step 5:** Commit: `feat(council): chair-attempt, ch4-repair and give-up error rows (v4.7 D2 chair classes)`

---

### Task 4: Stage-1 rows (repair solos, dead-seat error rows, superseded retry pairs)

**Files:**
- Modify: `src/council/run-stages.js` (repair loop :~140-166 post-extraction; reviews assembly; return), `src/council/run-assemble.js` (buildTallyInput consumes the new channels)
- Test: `tests/council/run-stages.test.js`, `tests/council/run-retry.test.js`, `tests/council/run-assemble.test.js`

**Interfaces:**
- Produces: `runStage1` return gains `extraRows: []` — (a) one `role:'repair'` row per `-p<N>` launch (from `solo.leg`, error status included when the repair failed); (b) one primary error row per dead seat with NO surviving review: `buildRunStatsEntry({leg: <seat's final leg>, model: alias, role: roleFor(o, alias), wasChair:false})`; (c) one `role:'superseded'` row per replaced first leg (deadLegs0 × recovered seats — leg-origin losses only; dead-wave-origin seats have no first leg, no row; a FAILED retry leg becomes the seat's final leg for (b) and the original dead leg gets the superseded row). buildTallyInput appends extraRows after the primary review rows.
- Consumes: `roleFor` (exported, run-stages.js:298-region), `deadLegs0` (:139), the healed-set idiom (:149-152). run-retry.js is NOT edited (E5).

- [ ] **Step 1 (RED):** run-stages.test.js: four tests — repair row born per -p launch (usage attributed, waveId `-p1`); dead seat (no retry) yields a primary error row with the dead leg's usage and role from roleFor; healed seat yields superseded row for the first leg + primary carries the retry leg (today's primary behavior pinned unchanged); failed-retry seat yields primary error row from the RETRY leg + superseded row for the original. run-assemble.test.js: buildTallyInput appends extraRows; the length-7 pin at :67 stays valid for extras-free input.
- [ ] **Step 2:** RED run.
- [ ] **Step 3 (GREEN):** implement per Interfaces; collection array threaded through the repair while-loop and the post-retry reconciliation.
- [ ] **Step 4:** `npx jest tests/council/run-stages.test.js tests/council/run-retry.test.js tests/council/run-assemble.test.js tests/council/run-happy.test.js tests/council/run-all-clean.test.js` → PASS.
- [ ] **Step 5:** Commit: `feat(council): stage-1 repair, dead-seat error and superseded rows (v4.7 D2)`

---

### Task 5: Stage-2 judge-repair rows

**Files:**
- Modify: `src/council/run-stage2.js` (repair loop :87-106; return :123)
- Test: `tests/council/run-stage2.test.js` (or the suite currently covering judge repair — locate by `-q` waveId assertions)

**Interfaces:**
- Produces: `runStage2` return gains `extraRows: []` — one `role:'repair'` row per `-q<N>` launch from `solo.leg`. Judge primary rows unchanged (#83 attribution comment preserved verbatim). run.js/run-assemble consume via the same extraRows path as Task 4 (append once in buildTallyInput; the two channels concatenate).

- [ ] **Step 1 (RED):** test: a judge whose Stage-2 output needed one repair yields the judge's primary row (original wave leg, per the :113-116 comment) PLUS one repair row carrying the `-q1` solo's usage.
- [ ] **Step 2:** RED. **Step 3 (GREEN):** implement. **Step 4:** `npx jest <located suite> tests/council/run-assemble.test.js` → PASS. **Step 5:** Commit: `feat(council): stage-2 judge-repair rows (v4.7 D2)`

---

### Task 6: debate rows (superseded pre-repair legs, failed-repair rows)

**Files:**
- Modify: `src/council/run-debate.js` (the leg2-replacement sites in runDefenseSolo/runRevoteWave — retain both legs), `src/council/debate.js` (debateRunStatsRows emits the extra rows)
- Test: `tests/council/run-debate.test.js`, `tests/council/debate.test.js`

**Interfaces:**
- Produces: when a debate repair launched (`leg2` attempted): repair succeeded → primary rebuttal/revote row keeps the post-repair leg (today's behavior) + the ORIGINAL leg gets a `superseded` row; repair failed → primary keeps the original (today's behavior) + the failed `leg2` gets a `repair` row with error status. debateRunStatsRows signature gains the retained-leg lists; run-debate passes them.

- [ ] **Step 1 (RED):** debate.test.js: both branches asserted with waveIds (`-d1` vs `-d1r`). run-debate.test.js: integration case through runDebate with a repairing fake.
- [ ] **Step 2:** RED. **Step 3 (GREEN):** retain both legs at the replacement sites (`const legOriginal = leg; if (leg2) { leg = leg2; }` + push the loser to a retained list), extend debateRunStatsRows. **Step 4:** `npx jest tests/council/run-debate.test.js tests/council/debate.test.js tests/council/run-debate-stage.test.js tests/observe/council-events.test.js` → PASS (event-ownership + abort-ordering pins untouched). **Step 5:** Commit: `feat(council): debate superseded and failed-repair rows (v4.7 D2/E4)`

---

### Task 7: fail-closed consumers (D4 + D6 + E1/E2)

**Files:**
- Modify: `src/council/ledger.js` (:24 join → allowlist), `electron/workspace-ui/live-model.js` (seatsFromRunStats filter), `src/council/report.js` (role suffixes)
- Test: `tests/council/ledger.test.js`, `tests/workspace/live-model.test.js` (or tests/electron equivalent — locate F37's home), `tests/council/report.test.js`

**Interfaces:**
- ledger join allowlist: `new Set(['seat','critic','chair','claude','council'])` + `r.role.startsWith('lens:')`; judge and everything else excluded — replaces the skip-set. av-receiver golden fixture ('council' rows) stays green.
- seatsFromRunStats: skip rows whose role ∈ `{'chair-attempt','repair','superseded'}` — nothing else changes (F37: rebuttal/revote still render; judge/chair rows render as today).
- report.js: suffix map extends the judge pattern — ` (chair-attempt)`, ` (repair)`, ` (superseded)`; the judge suffix output stays byte-identical (report.test.js:189-199 pin unedited).

- [ ] **Step 1 (RED):** ledger.test.js: a chair-attempt row for a bench model must NOT overwrite that model's seat row (the exact last-wins corruption recon proved possible); extend the #83 judge pin's pattern for all three new roles. live-model tests: new-role rows produce no seat row; F37 case unedited. report.test.js: new-role rows render suffixed.
- [ ] **Step 2:** RED. **Step 3 (GREEN):** implement all three. **Step 4:** `npx jest tests/council/ledger.test.js <live-model suite> tests/council/report.test.js` → PASS with F37 and the judge-suffix pins UNEDITED. **Step 5:** Commit: `feat(council): fail-closed row consumers — ledger allowlist, seats filter, report suffixes (v4.7 D4/D6)`

---

### Task 8: the D5 invariant suite + divergence regression fixture

**Files:**
- Create: `tests/council/run-cost-bijection.test.js`
- Modify: `tests/council/helpers/fake-launchers.js` (only if a scenario needs a new fake shape — additive)

**Interfaces:**
- Consumes: full `runCouncil` runs via fake-launchers (the 19-suite pattern); `usageBlock` output on run.json; `sumWaveUsage` from utils/pricing.

- [ ] **Step 1 (RED before Task 3-6 would be ideal but ordering forbids it — instead prove the test bites):** write the suite, then temporarily revert ONE row source (comment out the Task 4 repair-row push in a scratch diff) and confirm the suite FAILS; restore. Record this RED proof in the task report.
```js
// core assertions, per terminal run scenario:
const legged = run2.tally.runStats.filter(r => r.waveId);
const rows = sumWaveUsage(legged);
expect(rows.cost.amount).toBeCloseTo(run2.run.usage.cost.amount, 10);
expect(rows.reportedLegs).toBe(run2.run.usage.reportedLegs);
expect(rows.unpricedLegs).toBe(run2.run.usage.unpricedLegs);
// bijection literally: every budget-counted leg's waveId+model appears on exactly one row
```
Scenarios: clean run (cross-foot identity — the 120636cb shape); repair run (the 12c96b6b divergence shape, RECONSTRUCTED with a repairing fake — never referencing the gitignored archive); chair-walk-failure run; debate-repair run; retry-healed run. Non-legged rows (claude, give-up chair) explicitly excluded with a comment citing E3/E5 and the dead-wave asymmetry (E4).
- [ ] **Step 2:** `npx jest tests/council/run-cost-bijection.test.js` → PASS; the scratch-revert proof documented.
- [ ] **Step 3:** Commit: `test(council): the count is the count — leg-row bijection invariant suite (v4.7 D5)`

---

### Task 9: docs + spec errata

**Files:**
- Modify: `docs/superpowers/specs/2026-08-06-v4.7-count-is-the-count-design.md` (errata block E1–E5 appended to §5), `docs/council.md` (runStats row inventory — all roles + waveId), `CHANGELOG.md` `[Unreleased]`

- [ ] **Step 1:** CHANGELOG lines under Added/Changed: new row classes; waveId; **totals now include previously-omitted legs — tally/report cost reads HIGHER than v4.6.x for identical runs (intended)**; ledger join fail-closed; seats panel excludes non-seat rows.
- [ ] **Step 2:** `npm run generate-docs` (auto-stages CLAUDE.md); `npm run generate-docs:check` exit 0.
- [ ] **Step 3:** Commit: `docs: v4.7 PR1 spec errata (E1-E5), runStats inventory, CHANGELOG`

---

### Task 10: full gates + PR

- [ ] **Step 1:** `npm test` (full, expect ~495 suites incl. the new one, 0 fail), `npm run lint`, `npm run check:sizes`, `npm run generate-docs:check` — all exit 0.
- [ ] **Step 2:** No-spend smoke: `node bin/amicus.js council run --help` exit 0.
- [ ] **Step 3:** Push (≥5-min timeout), `gh -R BourbonDog/amicus pr create` — title `feat: v4.7 PR1 — the count is the count (CA-4 row-per-launch)`, body from `.superpowers/pr1-body.md`: the row-class table, the E1–E5 errata with recon citations, the invariant statement, behavior-change callout (higher totals), riders. If checks don't appear within ~3 min, remember the webhook-drop class: `gh api .../commits/<sha>/check-suites` then close/reopen the PR.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

# v4.9 W2+W3 — restructures (SI-16 splits · seatKey consolidation) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Discharge the two deferred restructures — SI-16's three over-long council functions
split at measured seams, and SI-DUP disposition (b)'s seatKey consolidation — before the
task-mode waves touch the same files.

**Architecture:** W2 = three in-file function decompositions (function length is the target,
not file size; all three files have headroom), each guarded by a named mutant proving the moved
block is still covered. W3 = route the two standalone copies of the seat-or-alias rule through
the exported `run-retry-keys.js :: seatKey`, re-run the SI-DUP Count-2 census, and update the
BACKLOG census. Restructures only — zero behavior change anywhere; R14 discipline (no defect
work rides along).

**Tech Stack:** Node 22, Jest. No new modules; W3 adds requires only.

**Spec:** `docs/superpowers/plans/2026-08-25-v49-phasing-and-rulings.md` §3 (SI-16 seams,
seatKey census) — seams were measured 2026-08-25 pre-W1; W1 added one line to
`run-stage2.js` (:178 area) and ~+5 to `run-stages.js` tests only. **Re-brace-match every seam
before cutting.**

## Global Constraints

- Zero behavior change. Preservation is proven by (a) the focused suites green unchanged, and
  (b) one **named mutant** per extraction: hand-apply the mutant inside the MOVED block,
  record the red set (suites/tests), revert byte-exact. A green suite over an uncovered moved
  block is the failure mode this guards.
- Gate rule 300 lines; current: `run-debate.js` 273, `run-debate-revote.js` 268,
  `run-stage2.js` ~208, `run.js` 285. In-file splits add a few lines each — verify with
  `node scripts/check-file-sizes.js` after each task.
- Never `git add -A`. No git commands for implementer agents (the lead commits).
- Sweep the three axes after each task; comments/docblocks that name the OLD structure (e.g.
  "the tail stays here") must be re-derived, not left.

---

### Task A (W2): `run-stage2.js :: runStage2` → extract `bindStage2Seats`

**Files:** Modify `src/council/run-stage2.js`. Tests: existing `tests/council/run-stages.test.js`
(stage-2 cases live there) + any suite matching stage2.

- [ ] Re-brace-match `runStage2` (was :47-205, 159 lines pre-W1). Re-locate the seam (was
  :89-124): from `const s2WaveId = …` through the close of the unbound-seat degrade loop.
  Verify the block's self-containment claims before cutting: `s2WaveId` referenced only inside;
  the only value read downstream is `judgeSeatOf` (next read was :135); side effects are
  `ctx.degrade.note` calls only.
- [ ] Extract as an in-file function above `runStage2`:
  `function bindStage2Seats(ctx, { reviews, judges, s2Legs, runId }) → { s2WaveId, judgeSeatOf }`
  — exact parameter set derived from what the block actually reads (measure; do not guess).
  Move the block byte-faithfully; keep its comments, re-derive any that describe position
  (the :85-88 "Only this site's TAIL stays here" comment must stay TRUE — re-read it against
  the new shape).
- [ ] Focused suites green: `npx jest tests/council/run-stages.test.js tests/council/ --maxWorkers=2`
  (record the tail).
- [ ] Named mutant `S2BINDDROP`: inside the moved block, drop the unbound-seat degrade note
  (or the seat binding itself — pick the most load-bearing line). Run the focused suites —
  record the red set (must be ≥1 test). Revert byte-exact; re-run green.

### Task B (W2): `run-debate.js :: runDebate` → extract `runDefenseWave`

**Files:** Modify `src/council/run-debate.js`. Tests: `tests/council/run-debate.test.js`,
`tests/council/debate.test.js`.

- [ ] Re-brace-match `runDebate` (was :106-271, 166 lines). Seam was :141-162 (+ the :131-140
  section comment): `const raisers = …` through the `if (byRaiser.claude)` seed. Verify:
  consumes ctx, byRaiser, aliasOf, seatById; produces exactly `defenseResults` (read later at
  ~:169, :206, :210-211, :251) and `defenseByRaiser` (~:204); the abort short-circuit at ~:147
  must propagate as a return value.
- [ ] Extract in-file:
  `function runDefenseWave(ctx, { byRaiser, aliasOf, seatById }) → { aborted, defenseResults, defenseByRaiser }`
  — caller maps `aborted` to its own `{ aborted, contested, disputed }` return exactly as the
  inline code did.
- [ ] Focused suites green (record tail).
- [ ] Named mutant `DEFWAVEDROP`: make the defense wave skip launching (return empty
  defenseResults with aborted:false). Record red set; revert byte-exact; green.

### Task C (W2): `run-debate-revote.js :: runRevoteWave` → extract `repairRevoteLeg`

**Files:** Modify `src/council/run-debate-revote.js`. Tests:
`tests/council/run-debate.test.js` (the revote cases), `tests/council/run-stages.test.js` if
it covers revote, plus any suite matching revote.

- [ ] Re-brace-match `runRevoteWave` (was :153-266, 114 lines). Seam was :196-219: the
  one-bounded-repair block `if (alive && !parsed.ok) { … }`. Verify: consumes ctx, waveId,
  key, judge, leg, parsed, expectedIds; outputs are reassignments of parsed/conformance/outLeg
  plus at most one push to supersededLegs or repairLegs; abort at ~:211 propagates as return.
- [ ] Extract in-file:
  `function repairRevoteLeg(ctx, { waveId, key, judge, leg, parsed, expectedIds }) → { aborted, parsed, conformance, outLeg, supersededRow, repairRow }`
  — caller pushes the non-null rows. The trailing-`r` repair-id rule comments (:199-204) move
  with the block intact.
- [ ] Focused suites green (record tail).
- [ ] Named mutant `RVREPAIRDROP`: skip the repair entirely (treat every failed parse as
  final). Record red set; revert byte-exact; green.

### Task D (W3): seatKey consolidation + Count-2 census (AFTER Task C merges its edits)

**Files:** Modify `src/council/run.js` (:232 area), `src/council/run-debate-revote.js`
(:69 area — post-Task-C line numbers), possibly `src/council/run-stage1-rows.js` (:142 —
evaluate); Modify `BACKLOG.md` (the SI-DUP census). Tests: suites already covering these
paths; plus `tests/council/seat-space.test.js` house-style identity pins if a re-export is
added (it is not — this is require-and-call).

- [ ] Count 1 consolidation: replace `run.js`'s local `const seatKey = (s, alias) => (s ? s.id : alias);`
  (:232, one caller :233) and `run-debate-revote.js`'s `function seatKey` (was :69, one caller
  was :190) with `const { seatKey } = require('./run-retry-keys');` (same directory; the
  exported copy at `run-retry-keys.js:15` is byte-identical — verify before replacing).
  Do NOT touch: `run.js:235`'s hand-inlined spelling (its `|| byJudge.get(r.model)` fallback
  is load-bearing), the two `keyOf` variants (`run-stage1-rows.js:68`, `run-stages.js:96` —
  their else branch is `l.modelInput || l.model`, a sibling form, not this rule).
  EVALUATE `run-stage1-rows.js:142`'s `const join = s ? s.id : alias`: route it through the
  import ONLY if the module can require run-retry-keys without a cycle (check its requires);
  otherwise record exclusion with the reason.
- [ ] Named mutant `SEATKEYSKEW`: in run-retry-keys.js, flip the exported rule to
  `(s ? s.alias : alias)` — record the red set across the consolidated call sites' suites
  (must red MORE suites than before consolidation would have — it now guards three sites).
  Revert byte-exact; green.
- [ ] Count-2 census re-run (post-emit string-form `X.seat || X.model/judge` reads): grep
  src/ + electron/, enumerate every occurrence, and UPDATE the SI-DUP census in BACKLOG.md
  (locate by heading `SI-DUP`): add the post-2026-08-21 members with inclusion rulings —
  `briefings-chair.js:180/:183` (SI-25-born, unambiguous members), `street-cred.js:242`,
  `report-md.js:86`, `report-html.js:57` (decide include/exclude each, with the counting rule
  restated beside the number, per the census's own discipline). Record that electron/ sites
  stay structural (renderer modules cannot require src/ — SI-DUP's recorded position).
- [ ] Focused suites green; `node scripts/check-file-sizes.js --all` clean;
  `node scripts/check-citations.js --all` clean.

### Task E: wave gates (lead)

- [ ] Full `npm test 2>&1 | tail -10` green; lint; sizes; citations; docs check.
- [ ] Three-axis sweep over the wave diff (phrase / symbol / bare pointers into touched files).
- [ ] Commit W2 (Tasks A-C) and W3 (Task D) as two commits on `v49-kickoff`.

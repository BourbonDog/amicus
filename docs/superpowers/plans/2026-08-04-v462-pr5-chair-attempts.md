# v4.6.2 PR5 — Chair-attempt records (LC-5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** spec §8 — `run-chair.js` records each attempt of the fallback walk as
`{ waveId, model, outcome: 'completed'|'error'|'timeout'|'no-output', reason }` into an additive
`chairAttempts[]` on `run.json`, checkpointed incrementally (a mid-walk kill preserves the
attempts so far), and the `chair-failed` degrade's `why` cites the per-attempt causes — which the
report's "What was lost" section then renders through the existing ONE-voice `formatDegrade`
(zero `report.js` edits).

**Architecture:** a small pure classifier + an attempts array in `runChair`'s walk; one
`runState.checkpoint(o.runDir, { chairAttempts })` after EACH resolved attempt (ch1/ch2/ch3).
The ch4 VERDICT-repair launch is NOT an attempt — the chair leg already succeeded; only the
verdict line is being repaired, and spec §8's outcome enum deliberately has no fit for it (state
this in a code comment). Schema + the three-way lockstep suite extend additively.

**Tech Stack:** node/CJS src style, jest. Base: `main@29f567b` (post-#102). Measured at write
time: `run-chair.js` 173/300, `report.js` 209/300 (untouched), `schemas/council-run.schema.json`
carries top-level `degrades` already; lockstep suite = `tests/schemas-degrades-lockstep.test.js`.

## Global Constraints

- TDD; commits end `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Size gates (hard 300): `run-chair.js` 173/300 (+~35 lines fits comfortably; report the landing
  count). `run-stages.js` (298/300) must NOT be touched — spec D8's PR5 contingency ("extracts
  from run-stages first if its seam needs edits there") is NOT triggered: the walk lives entirely
  in `run-chair.js`.
- `chairAttempts[]` is ADDITIVE on `run.json` — `schemaVersion` unchanged; absent on cost-skipped
  (chairless) runs and on every pre-PR5 run; consumers must never require it.
- Outcome classification (verify the leg-doc contract in `src/sidecar/fanout-leg.js` — `reason`
  is the classifier alias on run docs — before finalizing):
  `leg == null` → `'error'` (reason from `errorDoc.message`/`errorDoc.reason` when present, else
  `'no leg document'`); `leg.status === 'timeout'` → `'timeout'`; `leg.status === 'complete'`
  with empty/whitespace `summary` → `'no-output'`; `leg.status === 'complete'` with real summary
  → `'completed'`; anything else → `'error'` with `leg.reason || leg.error || leg.status`.
- The `chair-failed` degrade keeps its channel and voice; only its `why` gains the walk causes:
  `` `no chair leg completed after the fallback walk — ${attempts.map(a => `${a.waveId.split('-').pop()} ${a.model}: ${a.reason || a.outcome}`).join(' · ')}` ``
  (the "ran but unparseable VERDICT" branch keeps its existing why untouched — the chair leg
  completed; the walk didn't fail).
- ⚠️ CHANGELOG race: PR #103 is OPEN touching `[Unreleased]` — expect a union merge at push time
  (the #91-class hazard; the loser re-merges and unions).
- Launch nothing paid from tests; the live smoke is Task 4 (controller).

---

### Task 1: the attempt recorder in `runChair`

**Files:**
- Modify: `src/council/run-chair.js`
- Test: the existing chair suite (locate it: `grep -rln "runChair" tests/` — extend that file in
  its idiom; if multiple, the one unit-testing the fallback walk)

**Interfaces:**
- Consumes: `attemptChair(model, waveId)`'s `{ leg, exitCode }` — WIDEN it to also return the
  `errorDoc` `launchSolo` already provides (`const solo = await launchers.launchSolo(...)` →
  return `{ leg: ok ? solo.leg : null, exitCode: solo.exitCode, errorDoc: solo.errorDoc,
  rawLeg: solo.leg }` — `rawLeg` so the classifier sees a failed leg doc, since `leg` is nulled
  on failure).
- Produces: `classifyChairAttempt(rawLeg, errorDoc)` → `{ outcome, reason }` (exported for the
  lockstep suite); `chairAttempts` entries `{ waveId, model, outcome, reason }` checkpointed
  after each attempt.

- [ ] **Step 1: read the leg-doc contract** (`src/sidecar/fanout-leg.js` + how `launchSolo`'s
  wave legs carry `status`/`reason`/`summary`) and the chair suite's existing fixture idiom
  (launchers are ctx-injected — the suite already fakes `launchSolo`).
- [ ] **Step 2: failing tests** in the chair suite's idiom:

```js
// (a) happy path: ch1 completes → run.json checkpoint carries
//     chairAttempts: [{ waveId: '<runId>-ch1', model: '<chair>', outcome: 'completed', reason: null }]
// (b) N-attempt walk: ch1 leg null w/ errorDoc {message:'OpenRouter spend limit'},
//     ch2 leg status 'complete' summary '' (→ 'no-output'), ch3 fallback leg status 'timeout'
//     → THREE entries in order, outcomes ['error','no-output','timeout'], reasons carried;
//     AND the chair-failed degrade's why contains 'ch1 <model>: OpenRouter spend limit · ch2'
// (c) chairless (overBudget() true from the start): chairAttempts NEVER checkpointed (absent)
// (d) kill-mid-walk: ch1 resolves (error), the ch2 launch returns an abort exit →
//     runChair bails, but the LAST checkpoint already carries the ch1 attempt
//     (assert via the suite's runState/checkpoint spy or the run.json fixture file)
```

- [ ] **Step 3: RED** — run the chair suite; the four fail (no `chairAttempts`, no enriched why).
- [ ] **Step 4: implement.**

```js
/**
 * Outcome taxonomy for one fallback-walk attempt (spec §8, LC-5). The ch4
 * VERDICT repair is deliberately NOT an attempt: its chair leg already
 * completed — only the verdict line is being re-prompted — and the outcome
 * enum has no honest value for it.
 */
function classifyChairAttempt(rawLeg, errorDoc) {
  if (!rawLeg) {
    const reason = (errorDoc && (errorDoc.message || errorDoc.reason)) || 'no leg document';
    return { outcome: 'error', reason };
  }
  if (rawLeg.status === 'timeout') { return { outcome: 'timeout', reason: rawLeg.reason || null }; }
  if (rawLeg.status === 'complete') {
    const hasOutput = rawLeg.summary && String(rawLeg.summary).trim();
    return hasOutput ? { outcome: 'completed', reason: null }
      : { outcome: 'no-output', reason: rawLeg.reason || null };
  }
  return { outcome: 'error', reason: rawLeg.reason || rawLeg.error || String(rawLeg.status) };
}
```

  In the walk: `const chairAttempts = [];` before ch1; after EACH `attemptChair` resolution
  (ch1, ch2, ch3 — including when the next line bails on abort, so record BEFORE the
  `isAbortExit` check):

```js
    const cls = classifyChairAttempt(attempt.rawLeg, attempt.errorDoc);
    chairAttempts.push({ waveId: `${o.runId}-ch1`, model: o.chair, outcome: cls.outcome, reason: cls.reason });
    runState.checkpoint(o.runDir, { chairAttempts });
```

  (waveId/model per attempt site; ch3 uses the fallback model). Enrich the chair-failed why per
  Global Constraints ONLY in the `!chairLeg` branch. Export `classifyChairAttempt` alongside
  `runChair, pickFallbackChair`.
- [ ] **Step 5: GREEN** — chair suite green; then the council-run family
  (`npx jest tests/ -t chair` is too narrow — run `npx jest tests/council-run` plus the chair
  suite file, then any suite the seam's DEPENDENT modules own per the controller lesson: grep
  for suites requiring `run-chair`).
- [ ] **Step 6: commit** `feat(council): chairAttempts[] — the fallback walk records each attempt (LC-5)`

---

### Task 2: schema + three-way lockstep

**Files:**
- Modify: `schemas/council-run.schema.json` (additive `chairAttempts` property)
- Test: `tests/schemas-degrades-lockstep.test.js` (extend in its established three-way idiom)

**Interfaces:**
- Consumes: `classifyChairAttempt` export (Task 1) and the walk's entry shape.
- Produces: schema property pinned to the producer's shape.

- [ ] **Step 1: read the lockstep suite** — how it pins `degrades` three ways (schema ↔ producer
  ↔ fixture); mirror the pattern for `chairAttempts`.
- [ ] **Step 2: failing test** — extend the suite: the schema must declare `chairAttempts` as an
  array of objects with exactly `waveId` (string), `model` (string), `outcome` (enum
  `completed|error|timeout|no-output`), `reason` (string or null), no additionalProperties
  beyond the suite's house convention; and a producer-shaped sample entry (build one via
  `classifyChairAttempt` on a fixture leg) must validate.
- [ ] **Step 3: RED** (schema lacks the property). **Step 4:** add to
  `schemas/council-run.schema.json`'s properties (match the file's style for optional arrays;
  `schemaVersion` untouched):

```json
"chairAttempts": {
  "type": "array",
  "items": {
    "type": "object",
    "required": ["waveId", "model", "outcome"],
    "properties": {
      "waveId": { "type": "string" },
      "model": { "type": "string" },
      "outcome": { "enum": ["completed", "error", "timeout", "no-output"] },
      "reason": { "type": ["string", "null"] }
    }
  }
}
```

- [ ] **Step 5: GREEN** + run the whole schema/lockstep family (`npx jest tests/schemas`).
- [ ] **Step 6: commit** `feat(schema): council-run carries chairAttempts[] — lockstep-pinned`

---

### Task 3: docs + gates

- [ ] `CHANGELOG.md [Unreleased] ### Added` bullet in house voice: the fallback walk now records
  every attempt on `run.json` (`chairAttempts[]` — waveId/model/outcome/reason, additive), and a
  degraded chair's "What was lost" line names each attempt's cause.
- [ ] Docs: find where `run.json`'s fields or the chair fallback chain are documented
  (`docs/council.md` — grep `fallback` / `chair`); ONE sentence noting the walk is recorded. If
  documented nowhere, skip prose and say so in the report.
- [ ] Gates: `node scripts/generate-docs.js` (no new src module — expect no-op; commit it if it
  changes) · `npm run lint` · `npm run check:sizes` (report `run-chair.js`'s landing count) ·
  full `npm test` (totals + delta attribution vs 6462 at this branch's base).
- [ ] Commit `docs(v4.6.2-pr5): CHANGELOG + chair-walk docs for chairAttempts`

---

### Task 4 (controller-only — implementers skip): review, live smoke, PR

- [ ] Per-task reviews already ran; fable whole-diff review over the branch.
- [ ] Live smoke (~$0.10): one cheap real council (the 12c96b6b bench recipe with a HEALTHY
  chair) → assert `run.json` `chairAttempts` = exactly `[{ ...ch1, outcome: 'completed' }]`;
  plus re-use the walk-failure unit evidence (no paid forced-walk needed — §9 mandates the
  cheap smoke, not a paid failure walk).
- [ ] Fetch origin; if #103 merged first, merge + UNION `[Unreleased]`; push (full-suite
  pre-push); `gh pr create`.

## Plan self-review (done at writing time)

§8 coverage: recording ✓ (T1), checkpoint-per-attempt kill survival ✓ (T1 d), report citation via
degrade-why ✓ (T1 b — zero report.js edits, ONE voice preserved), schema+lockstep ✓ (T2),
additive/schemaVersion ✓ (T2 + constraints). §9 PR5 tests all present: happy/N-attempt/chairless
(T1 a/b/c), kill-mid-walk (T1 d), lockstep (T2). Placeholders: none — classifier and schema code
are complete; fixture prose rides the named suites' own idioms by instruction. Type consistency:
`classifyChairAttempt` return `{outcome, reason}` consumed verbatim in the walk snippet and T2's
producer-shaped sample. run-stages.js untouched (D8 contingency not triggered — stated).

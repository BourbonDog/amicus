# v4.9 W11 — PR1F-2: the runStats builders unify — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** The three residual hand-rolled runStats builders fold into `buildRunStatsEntry`, so
every non-primary row shares one shape and future fields (seat, findingsUnverified, ttftMs)
reach debate rows automatically — closing PR1F-2 as filed.

**Architecture:** Byte-order goldens FIRST (existing pins are order-insensitive — the filing's
own warning), then a minimal entry extension, then the three folds, then re-goldens with every
key change NAMED. Own PR (R14 discipline: consolidation never rides a defect PR).

**Spec:** BACKLOG's PR1F-2 entry (recon-verified 2026-08-25: prerequisite extraction shipped
`49fd7de8`; residuals `run-debate-revote.js :: legRow` (emits a `summary` field the entry
never does), `debate.js :: debateRunStatsRows :: mk` (`l.status || 'unknown'` vs the entry's
`leg ? leg.status : 'error'`; key ORDER differs — mk emits status/durationMs/usage BEFORE its
spreads, the entry AFTER), `run-assemble.js :: claudeRunStatsRow` (measure its shape)).

## Global Constraints

- Byte-order pins are stringify-based, written BEFORE any fold, capturing the PRESENT bytes.
- Every key-order or key-set change on any row is a NAMED, deliberate diff in the commit
  message — none rides silently.
- The status-default divergence (`'unknown'` vs `'error'`) is decided by a MEASURED census of
  reachable statuses at the mk call sites — report the census, pick the honest value.
- `debate.js` remains require-light: it already requires `./peer-split`; requiring the
  require-free `./run-stats-entry` is consistent with its own contract (recon-measured).
- Focused suites `--maxWorkers=2`; sizes/citations/lint clean; no git mutations (lead commits).

### Task A: goldens + entry extension
- [ ] Stringify goldens for: a debate round's full runStats rows (mk output, waveId-carrying),
  a revote leg row (legRow output incl. `summary`), the claude row. Byte-exact `toBe` on
  JSON.stringify — these are the order-sensitive pins the filing demanded.
- [ ] Extend `buildRunStatsEntry` minimally: `summary` emit-when-set (the legRow need).
  Measure whether claudeRunStatsRow needs anything else. Absence pins.

### Task B: the three folds
- [ ] Fold `mk` (debate.js), `legRow` (run-debate-revote.js), `claudeRunStatsRow`
  (run-assemble.js) into calls to `buildRunStatsEntry`. Status census first; re-golden with
  each byte diff named (key order WILL move for debate rows — that is the point; enumerate).
- [ ] Named mutant `UNIFYDRIFT`: re-introduce one hand-rolled builder — must red the goldens.
- [ ] Check every consumer of the changed rows (ledger join excludes non-primary roles —
  re-verify; workspace cost rows read model/status/durationMs/cost — re-verify shapes).

### Task C (lead): gates + commit.

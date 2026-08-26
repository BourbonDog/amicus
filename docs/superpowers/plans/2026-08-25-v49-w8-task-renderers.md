# v4.9 W8 — task renderers and consumer surface — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every human-facing surface renders a task run honestly — the concurrence qualifier,
task-worded terminal labels (`ANSWER:` never `VERDICT:` on a task run), an honest losses
table, and a self-diagnosing stats surface — completing the task-mode feature.

**Architecture:** `intent` rides the render model from `verdict.intent` (absent = review).
Renderers fork one word or one line each; electron renderers get intent through the panel
payload (they cannot require src/). Review-run byte identity everywhere.

**Tech Stack:** Node 22, Jest. No jsdom — GUI assertions are on generated strings (the
standing limitation).

**Spec:** v4.8 design spec §5.4 (honesty requirement) + accumulated handoffs: W5.1's
losses-table kind predicate, W7-F3's fold/matrix labels, W7 fix-round's `fold-format.js:68`
rot, spec §10.6's COUNCIL_INTENT_MISMATCH claim (evaluate by measurement — likely wrong).

## Global Constraints

- `report.js` is 296/300 — measure your net; if the qualifier + intent + losses filter push
  it over, extract a small helper to a receiver with room (report-md.js 151-ish) FIRST, as
  its own step, pinned by identity.
- electron/**: a literal `#` followed by digits trips the hex-colour guard — write "issue NNN".
- Review-run byte identity: absence pins per surface (no qualifier, `VERDICT:` label, losses
  table unchanged).
- No git mutations; focused suites only, `--maxWorkers=2`.

---

### Task T-A: the report surface

**Files:** Modify `src/council/report.js` (`toModel` gains `intent: verdict.intent || 'review'`
— ~+1 line; the header `runType` line forks on it; the losses/degrades table),
`src/council/report-md.js`, `src/council/report-html.js`, `docs/council.md` (the
`overallVerdict` enumeration line ~:760 — now six values), their suites.
- [ ] `toModel`: add `intent`; the header word: a task run's report header says `task`
  (measure how `runType` currently renders and fork the minimal honest word — do not rename
  `runType` itself).
- [ ] Concurrence qualifier (spec §5.4, verbatim intent): when `model.intent === 'task'`,
  BOTH renderers print one line with the tier table:
  `Tiers report peer concurrence, never verification.` — placed where a reader of the tiers
  sees it (immediately under the tier counts/table header). One line per renderer, absent on
  review runs (pins both ways).
- [ ] Losses table honesty (W5.1 handoff): `report.js:278`'s `kind !== 'heal'` admits `info`
  records into "What was lost". Scope the losses table to `kind === 'degrade'`; render
  `info` records (if any) under a separate one-line `Notes:` list in both renderers —
  an announcement is not a loss. Pin: a task run with the `ledger-skipped` info note shows it
  under Notes, NOT under What was lost; review runs byte-identical.
- [ ] Terminal-line label: find every `VERDICT` literal in report-md/report-html (grep) — any
  that labels `overallVerdict` forks to `ANSWER` when `model.intent === 'task'`. Report what
  you find; if the renderers only print the raw phrase (no keyword), say so and skip.
- [ ] `docs/council.md` overallVerdict line: state both scales (review three + task three,
  with the intent condition).
- [ ] Named mutant `QUALIFIERDROP` (qualifier never renders) — red set recorded in-file.

### Task T-B: workspace, fold, and stats

**Files:** Modify `src/workspace/fold-format.js` (:85 label fork + the :68 rotted comment),
`src/workspace/run-detail.js` (verdict panel payload gains `intent`),
`electron/workspace-ui/workspace-matrix.js` (:129 chip label fork — payload-driven), any other
`'VERDICT: '` literal in src/workspace/ + electron/ (grep and enumerate), `src/cli-handlers-council.js`
(stats: one line when the ledger has zero rows), their suites.
- [ ] `fold-format.js`: the fold's terminal line reads `ANSWER: <phrase>` on a task fold
  (`verdict.intent`), `VERDICT:` otherwise; fix the :68 comment ("a canonical CHAIR_VERDICTS
  phrase" — false since W7; reword to cover both scales).
- [ ] `run-detail.js :: verdictPanel`: payload gains `intent` (emit-when-task or
  always-with-default — match the panel's existing style; renderer treats absent as review).
- [ ] `workspace-matrix.js`: chip renders `(vp.intent === 'task' ? 'ANSWER: ' : 'VERDICT: ')
  + vp.overallVerdict` (string-assertion tests — no jsdom).
- [ ] Stats self-diagnosis (V5/R10): when `amicus council stats` finds zero ledger rows, one
  extra line: `Task runs never write reliability rows; a task-only install has no history
  here.` (find the stats handler's zero-rows branch — if none exists, add the line to
  whatever renders for an empty ledger). Pin + review-control.
- [ ] Spec §10.6 evaluation BY MEASUREMENT: drive the real CLI paths on TASK artifacts —
  `runTally` on a task tally-input (expect: tally works, meta.intent rides, NO ledger row)
  and `council verdict` on that tally (expect: verdict.intent present, renderers fork). If
  both work end to end, the spec's "must fail with COUNCIL_INTENT_MISMATCH" claim is WRONG —
  record the measured deviation in the BACKLOG v4.9 records section (one bullet, past
  tense); build NOTHING. If something genuinely breaks, report before building.
- [ ] Named mutant `FOLDLABELSTUCK` (fold label ignores intent) — red set in-file.

### Task T-C (lead): wave gates + branch PR
- [ ] Full `npm test` tail -10, lint, sizes, citations, docs check; three-axis sweep;
  commit; push `v49-task-mode`; open the PR (council-review label at creation).

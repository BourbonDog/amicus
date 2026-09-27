# A row with no checked output says `conformance: none` (#244 residue) — design

**Date:** 2026-09-27 · **Branch:** `fix/244-conformance-none` (off `main` `8e08a63d`, v4.14.0 + two
unreleased commits) · **Status:** approved by the owner in brainstorming, 2026-09-27

This is what remains of the "Wave 4 Cluster B" verdict-surface PR after the owner's 2026-09-27
rulings (§2). Four of its five items were closed without code; this spec covers the fifth.

## 1. The defect (measured at `8e08a63d`)

`conformance` is the asks-to-parse axis of a `runStats` row: `clean` = the first ask parsed,
`repaired` = a later ask parsed, `unstructured` = no ask parsed. A row whose leg never returned,
or whose output was never used, had no ask checked at all, and it still says `clean`:

- `src/council/run-stats-entry.js :: buildRunStatsEntry` writes `conformance: conformance || 'clean'`.
  Of its 13 production call sites, five pass no conformance. Four of them describe a leg whose
  output nobody checked:
  - `run-stage1-rows.js :: pushDeadSeatRows` (a dead seat: `error`, `timeout`, `leg: null`, or a
    #257 promoted leg that is `complete`);
  - `run-stage1-superseded.js :: supersededRows` (a first attempt the retry replaced, including
    `complete` legs that were empty or promoted);
  - `run-chair.js` `recordAttempt` (a `chair-attempt` row, pushed only when the attempt yielded
    no usable leg);
  - `run-finish.js :: finishRun`'s chair give-up row (`leg: null`).

  The fifth, `run-assemble.js :: claudeRunStatsRow`, is a real success: the orchestrator's
  validated review file.
- `run-stage2-judge.js :: adjudicateJudgeLeg` stamps an unusable judge
  `conformance: leg.status === 'complete' ? 'unstructured' : 'clean'`, which is an explicit
  `clean` for a judge that never returned.
- The false value leaves the run. Dead seats join the reliability ledger (`ledger.js ::
  buildLedgerRows` folds a model's bench legs), and `ledger-stats.js` counts each row's
  conformance into `amicus council stats`. So every dead leg is reported there as a clean
  findings JSON, and a flaky model looks cleaner than it is.
- 4.14.0 documented the default as a contract: `docs/council.md` (the `judge-reasoning-only`
  paragraph) says *"a row for a leg that never returned carries `clean` by default — there was no
  ask to parse; read `status` with it"* and *"whose three values are unchanged"*.

Reported as #244's secondary observation (four dead legs, all `"conformance": "clean"` beside
`"status": "error"`). #244 was closed on 2026-09-17 with this residue carried to the verdict-surface
PR. PR #254 round 1's `verdict.json` had five `status: error` rows, all `clean`.

## 2. Rulings (owner, 2026-09-27)

| # | Item | Ruling |
|---|---|---|
| R1 | Exit code for unverified / refused seats | **No exit change.** The census, the report's rows, the CI title and the end-of-run stderr line keep carrying the signal. Supersedes the 2026-09-16 ruling ("exit 2 when `unverified + refused ≥ half the bench`"), which was never built. |
| R2 | #242 item 3 (grading how vacuous an unverified repair was) | **Refused, no code.** The unverified row already names the seat, a seat with no findings has no rows in the findings table, and the token-ratio heuristic has no measured threshold. #242 stays open for item 1 (write-back). |
| R3 | #259 (the chair re-tiers findings) | **Closed, no code.** The CI comment's tier lists and the report already carry the tally's tiers. The filing's Ask 2 named `report.html`, which never renders the chair's prose (only `chair-output.md` holds it, and only the Workspace verdict panel renders that). |
| R4 | #256 Ask item 3 (a distinct "refused by the provider" class) | **Refused, no code.** The dead-seat notice already quotes the provider's refusal verbatim on every surface (`run-retry-notes.js :: retryLegStillDeadNote`, retry cause since 4.12.0), the CI credit preflight (#264) addresses the root, and a classifier over vendor prose would need a verdict-schema change for one label. |
| R5 | #244 residue | **Build it (this spec)**, with the value `none`. |
| R6 | Packaging | R1–R4 are recorded in `BACKLOG.md` by the backlog consolidation, not by this PR, so that file is rewritten once. |

## 3. Design

**The rule:** a row says `clean` only when a check said so. `conformance` gains a fourth value,
`none`: no ask was checked, because the leg never returned or its output was never used.

Four code sites:

1. `run-stats-entry.js :: buildRunStatsEntry`: the default becomes `conformance || 'none'`. The
   docblock states the rule and names `claudeRunStatsRow` as the one caller that must pass
   `clean` itself.
2. `run-assemble.js :: claudeRunStatsRow` passes `conformance: 'clean'` explicitly. Its review
   file was validated before any launch (`run-assemble.js :: preflightClaudeReview`), so `clean` is a fact.
3. `run-stage2-judge.js :: adjudicateJudgeLeg`: the unusable-judge row becomes
   `leg.status === 'complete' ? 'unstructured' : 'none'`.
4. Both `CONFORMANCE_RANK` tables (`run-assemble.js`, and its documented local copy in
   `ledger.js`, R4b-4) gain `none: -1`. Both worst-wins merges (`worseConformance`,
   `mergeConformance`) then never let `none` beat a real value:
   - The Stage-1/Stage-2 merge in `run.js` (a seat's review × its own judge row) returns the same
     value as today on every input. The review side is never `none` (only materialized, completed
     legs are reviews), and the judge side's old `clean` ranked 0 against a review ranked ≥ 0
     with the review as the accumulator. So the review won then, and `none` at −1 loses now.
   - The ledger fold over a model's twin legs becomes order-independent for `none`: a dead twin
     beside a clean twin folds to `clean` in either order, and two dead twins fold to `none`.
     Without the −1, an unknown value ranks 0 and the fold's accumulator wins the tie, so
     `['none','clean']` would fold to `none` (the order effect the fold's T13c pin documents).

**Untouched, deliberately:**
- The `|| 'clean'` fallbacks in `tally.js :: tally`'s re-projection and in the ledger fold. They
  serve legacy and hand-assembled rows that carry no conformance at all (`docs/council.md`'s
  blessed hand-assembled tally input). A builder row now always carries one, so they no longer
  fire for engine-written rows.
- Every explicit `unstructured` (repair rows, debate stubs and superseded or repair rows,
  re-votes). It is not a false claim: no ask parsed.
- Schemas. No schema enumerates conformance values: `council-tally.schema.json`'s `runStats`
  items declare only `ttftMs`, `promoted` and `rescued`, and `council-stats.schema.json` types
  `conformance` as a plain object.

## 4. What users see

- New `runStats` rows in `tally-input.json`, `tally.json` and `verdict.json` read `none` for
  dead, superseded, promoted, chair-attempt and chair give-up legs, and for dead judges.
- New ledger rows carry `none` for a model whose only bench leg produced nothing. So
  `amicus council stats` gains a `none` count in the conformance histogram. Old ledger rows are
  append-only and stay as written. A model's history therefore mixes old `clean`-for-dead rows
  with new `none` rows. The CHANGELOG says so, since no migration runs.
- Nothing else renders conformance: not the report, the Workspace, the CI workflow or the MCP
  tools (swept at `8e08a63d`).

## 5. Docs and CHANGELOG

- `CHANGELOG.md` `[Unreleased]`, **`### Changed`** (it changes documented 4.14.0 behaviour).
  Three points: a row for a leg that never returned, or whose output was never used, now says
  `conformance: none` instead of `clean`; `amicus council stats` counts those as `none`; and
  existing ledger rows are unchanged.
- `docs/council.md`:
  - the stats table's `conformance` row (`{clean, repaired, unstructured}` → add `none`, and say
    what it counts);
  - the `judge-reasoning-only` paragraph's two sentences quoted in §1 (the default and "three
    values").
- `skills/second-opinion/SKILL.md` (the Stage-6 `conformance` list) and
  `skills/second-opinion/MANUAL-ORCHESTRATION.md` (the conformance a hand-assembled `runStats`
  records): add `none` for a leg that produced nothing to check.
- The implementer sweeps `docs/`, `skills/`, `README.md` and `CHANGELOG.md`'s `[Unreleased]`
  for every other sentence that states the vocabulary or the default. The sweep runs two ways
  (#12): the phrase (`three values`, `clean` by default) and the target (`conformance`).

## 6. Tests

Classified per assertion (#7 corollary):

- **RED at HEAD** (they assert `none`): a dead-seat row with `leg: null`, with an `error` leg and
  with a promoted `complete` leg; a superseded row; a `chair-attempt` row; the chair give-up
  row; a dead judge row (`adjudicateJudgeLeg`'s unusable arm with a non-complete leg); and a
  ledger row for a model whose only leg died, plus its `council stats` histogram entry.
- **GREEN at HEAD, proven by a named mutant:**
  - The Claude seat row stays `clean`. Mutant: delete the explicit `conformance: 'clean'` in
    `claudeRunStatsRow`.
  - A clean twin wins over a dead twin in both fold orders, in the ledger and in
    `worseConformance`. Mutant: delete `none: -1` from each rank table in turn; the pin for that
    table must red.
  - A materialized review merged with its dead judge row keeps the review's value (`clean` and
    `repaired`). Mutant: rank `none` above `clean`.
- **Existing tests that assert `clean` on a dead row encode the defect.** The implementer lists
  each one (from the suite run after the change), updates it to `none`, and says so in the
  report. It never weakens an assertion to pass.
- Byte-order pins (`tests/council/runstats-byte-order.test.js`) must stay green: `conformance`
  keeps its key position, and only its value changes.

The full `npm test` runs before any push. No jest selector overrides on the command line, ever.

## 7. Out of scope

Everything in R1–R4. `reasoning-absent` (still needs a "known to reason" baseline design). #242
item 1 (write-back). Rewriting old ledger rows.

## 8. Risks

- **Tests that encode the defect** (§6). They are expected, and each one is named, not silently edited.
- **A reader that treats an unknown conformance as `clean`.** `ledger-stats.js` counts raw values,
  so `none` gets its own bucket. The rank tables are the only other place a value is interpreted.
- **Legacy rows with no conformance** keep folding to `clean` through the untouched fallbacks.
  That is the documented legacy-read behaviour and not a regression.

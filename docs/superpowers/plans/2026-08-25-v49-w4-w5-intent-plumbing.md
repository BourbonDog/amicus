# v4.9 W4+W5 — task-mode substrate: chair-walk extraction + intent plumbing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the `intent: review | task` run property end to end — CLI/MCP flag, meta,
run.json, verdict.json, the three ledger gates, the non-degrading announcement, and the V12
claude-review block — with zero behavior change for review runs (byte-identity), after freeing
run-chair.js's headroom with one pure extraction.

**Architecture:** W4 = one byte-for-byte module move (PR5b shape: move + re-export + identity
pin). W5 = plumbing only: no briefing text forks yet (W6/W7); a `--intent task` run in this
wave still composes review-framed prompts — deliberate, the train lands the channel before the
content. `intent` is emit-when-`'task'` EVERYWHERE (run.json / meta / verdict.json — one
idiom); `undefined` means review and `'review'` is never materialized (.optional() never
.default()).

**Tech Stack:** Node 22, Jest, zod ^3 (MCP schemas).

**Spec:** `docs/superpowers/specs/2026-08-10-v4.8-ask-anything-count-everyone-design.md`
§5.3, §5.6, §6, §7.4 + `docs/superpowers/plans/2026-08-25-v49-phasing-and-rulings.md` rulings
V5, V9, V12. **One recorded deviation from the spec:** §5.3 declares verdict-`intent`
"mandatory" while §7.5 promises byte-identical review-run verdict.json — both cannot hold;
this wave ships emit-when-task (the §7.5 side), because renderers fork equally well on an
absent key, and records the deviation in BACKLOG.

## Global Constraints

- Review-run byte identity: every artifact of a run WITHOUT `--intent` is byte-identical to
  pre-wave (the existing suites are the proof; plus explicit absence pins per task).
- `.optional()` never `.default()` on MCP zod; internal representation: `o.intent` is
  `'task'` or absent — never `'review'`.
- Gate rule 300; current relevant: run-chair.js 294 (W4 fixes), run.js 285, mcp-council-run.js
  291, cli-handlers-council-run.js 283, run-finish.js 70, verdict.js 260, run-state.js 208.
- No `git add -A`; implementers run no git; focused suites only, `--maxWorkers=2`.
- Three-axis sweep per task; wrapped-comment sweeps must use fragment/multiline grep.

---

### Task W4: extract `chair-fallback.js` (pure move)

**Files:** Create `src/council/chair-fallback.js`; Modify `src/council/run-chair.js`;
Create `tests/council/chair-fallback.test.js`.
**Interfaces:** Produces `chair-fallback.js :: pickFallbackChair(statsRows, bench, failedChair)`
and `:: classifyChairAttempt(rawLeg, errorDoc)` — byte-identical bodies; `run-chair.js`
re-exports both so no caller changes.
- [ ] Move `pickFallbackChair` (with its full docblock) and `classifyChairAttempt` (ditto)
  byte-for-byte into the new module (header comment: moved verbatim from
  `run-chair.js@<HEAD sha>:25-104` — use the real sha and re-derive the range at cut time).
- [ ] `run-chair.js` requires them and keeps `module.exports = { runChair, pickFallbackChair,
  classifyChairAttempt }` via re-export.
- [ ] Identity pin (house style, `tests/council/seat-space.test.js` shape): require both
  paths, assert `toBe` identity for both functions across the two import paths.
- [ ] Focused suites green: `npx jest tests/council/run-chair.test.js tests/council/ --maxWorkers=2`.
  Verify `node scripts/check-file-sizes.js` clean and run-chair.js now ≤ ~220.

### Task W5.1: `kind: 'info'` + channel `'ledger-skipped'`

**Files:** Modify `src/utils/degrade.js` (KINDS, DEGRADE_CHANNELS, formatDegrade); Test:
`tests/degrade.test.js` or the suite covering makeDegrade (find: `grep -rln makeDegrade tests/`).
**Interfaces:** Produces: `makeDegrade({kind:'info',…})` valid; `formatDegrade` lead for info
= `Note`; channel `'ledger-skipped'` valid.
- [ ] TDD: failing tests — `makeDegrade({kind:'info', channel:'ledger-skipped', what,why,effect})`
  returns a record (today: throws unknown kind); `formatDegrade` renders `Note: …`;
  and the non-degrading property at the SINK: drive the real `createDegradeSink` with an
  info note → `degraded.value` stays false, `resolveTerminalExit({exitCode:0,…})` returns 0
  (mirror the T5.5 pin shape in `tests/council/` — find the existing degrade-sink +
  run-finalize pins and extend beside them). Control: a kind:'degrade' note on the same
  channel still degrades.
- [ ] Implement: add `'info'` to KINDS, `'ledger-skipped'` to DEGRADE_CHANNELS (council
  runtime group, with a one-line comment naming v4.9 task mode), formatDegrade lead map
  `degrade→Notice, heal→Recovered, info→Note`.
- [ ] Check every consumer that branches on `kind`: grep `\.kind` across src/ + electron/ —
  verify each site's predicate treats 'info' correctly (deriveSeatLoss's `!== 'heal'` filter
  admits info into `real` but the channel filters exclude 'ledger-skipped'; record that in
  the W9 handoff rather than changing it here).

### Task W5.2: CLI + MCP intent surface

**Files:** Modify `src/cli.js` (council run options + usage), `src/cli-handlers-council-run.js`,
`src/mcp-council-run.js`, `src/mcp-tools.js`; Tests: the existing council-run handler suites
(`grep -rln "handleCouncilRun" tests/ | head`), `tests/mcp-pack-params.test.js` neighborhood,
plus docs-command-coverage if it pins option lists.
**Interfaces:** Produces `o.intent === 'task' | undefined` on the options object handed to
`runCouncil`, from either transport.
- [ ] TDD CLI: `--intent task` → options carry `intent:'task'`; `--intent review` → options
  carry NO intent key; `--intent bogus` → BAD_ARGS exit pre-spend with a hint naming the two
  values; absent → no key. Implement parse+validate in `cli-handlers-council-run.js`
  (17 lines free; if the file lacks room put the tiny resolver in
  `src/cli-council-run-bench.js` (87 lines) and import). Register the option + one usage line
  in `cli.js` (grandfathered).
- [ ] TDD MCP: `amicus_council_run` inputSchema gains
  `intent: z.enum(['review','task']).optional()` (mcp-tools.js); `mcp-council-run.js` read
  site maps `'task'` → `intent:'task'`, `'review'`/absent → no key (9 lines free — measured
  fit; do not add more than ~6 lines here).
- [ ] TDD MCP tally meta: the `meta` z.object in mcp-tools.js (the council_tally shape, ~:410)
  gains `intent: z.string().optional()` — pin that a meta.intent survives the MCP parse
  (today zod strips it: write the pin RED first against the raw shape).
- [ ] `docs/usage.md`: add `--intent` + the MCP param rows (keeps F-1's undocumented-key count
  from growing; W12 will pin the full list).

### Task W5.3: engine plumbing — validation, meta, run.json, verdict

**Files:** Modify `src/council/run.js` (preflight neighborhood + mkInput),
`src/council/run-state.js` (checkpoint idiom only if needed), `src/council/verdict.js`
(buildVerdict), `schemas/council-tally.schema.json`, `schemas/council-verdict.schema.json`;
Tests: `tests/council/run-assemble.test.js` area for mkInput/meta, `tests/council/verdict.test.js`.
**Interfaces:** Produces: `meta.intent === 'task'` on tally-input/tally for task runs (absent
otherwise); `run.json` top-level `intent: 'task'` (absent otherwise); `verdict.intent === 'task'`
(absent otherwise). Consumed by W6-W8 dispatch and renderers.
- [ ] TDD: engine-level validation — `runCouncil` with `intent:'bogus'` exits BAD_ARGS
  pre-spend (place beside the existing preflight validations near `preflightSeats`' call).
- [ ] TDD V12: `runCouncil` with `intent:'task'` AND `claudeReviewFile` set → BAD_ARGS
  pre-spend, message naming the limitation ("--claude-review enters a REVIEW as review N+1
  and has no task-mode meaning"). CLI/MCP handlers need no extra gate (they flow through
  runCouncil) — verify by test through the handler if cheap.
- [ ] TDD meta: `mkInput` (run.js ~:245-254) spreads `...(o.intent === 'task' ? { intent: 'task' } : {})`
  into meta; absence pin for review runs (assert `'intent' in meta === false`).
- [ ] TDD run.json: checkpoint `intent` beside the run-start checkpoint (run.js ~:134-135
  neighborhood), emit-when-task; absence pin.
- [ ] TDD verdict: `buildVerdict` forwards `record.meta && record.meta.intent === 'task'`
  → `intent:'task'` on the verdict literal (verdict.js — the closed `out` literal; add
  emit-when-task); absence pin (byte-identity: build a review verdict before/after this wave's
  code — the existing golden/fixture suites are the real pin; run them).
- [ ] Schemas: add optional `intent` (`enum: ['review','task']` — accepts an explicit
  'review' from hand-assembled inputs even though the engine never emits it) to
  council-tally.schema.json's meta and council-verdict.schema.json top level. Run the schema
  validation suites.

### Task W5.4: the three ledger gates + the promotion-step announcement

**Files:** Modify `src/council/run-finish.js` (:51-54), `src/cli-handlers-council.js` (:38-39
neighborhood), `src/mcp-server.js` (:1427 neighborhood), `src/council/run-chair.js` (the
promotion step; W4 freed the room); Tests: `tests/council/run-finish` suites (find them),
the council CLI tally suite, the MCP tally suite, `tests/council/run-chair.test.js`.
**Interfaces:** Consumes `o.intent` (engine) and `record.meta.intent` (the two hand-fed tally
paths — measure the record shape first: open `tally.js :: tally` and confirm meta rides the
returned record; if it does not, gate on the parsed INPUT's meta instead and say so).
- [ ] TDD gate 1 (engine): task run → `appendRunFn` never called; review run → called.
  Implement `if (!o.lenses && o.intent !== 'task')` at run-finish.js:51. Named mutant
  `LEDGERGATE1` (drop the intent conjunct) — record red set.
- [ ] TDD gate 2 (CLI runTally): a tally record whose meta.intent === 'task' → no appendRun;
  meta.intent absent → appends. Named mutant `LEDGERGATE2`.
- [ ] TDD gate 3 (MCP amicus_council_tally): same, through the MCP handler path. Named mutant
  `LEDGERGATE3`.
- [ ] TDD announcement (V5): drive `runChair` with `o.intent==='task'` and a walk that reaches
  the promotion step (both same-chair attempts fail) → exactly one `ledger-skipped` note,
  `kind:'info'`, and `degraded.value === false` with terminal exit 0 on an otherwise-clean
  run (extend the T5.5-shaped end-to-end pin). Content: what = 'task runs write no
  reliability rows', why = 'ledger-driven chair promotion draws only on review-run history —
  task rankings measure concurrence, never defect confirmation', effect = 'fallback
  candidates come from review runs only; a task-only install has none'. Review-run control:
  no such note.
- [ ] Byte/behavior identity: full `tests/council/` green.

### Task W5.5: wave gates + BACKLOG record (lead)

- [ ] Full `npm test` (tail -10) green; lint; sizes; citations; docs check.
- [ ] BACKLOG: record the §5.3-vs-§7.5 deviation (emit-when-task ruling) as a dated line in
  the v4.9 W1 record section (rename it "v4.9 records" if cleaner); note W6-W8 are the
  content waves.
- [ ] Three-axis sweep (fragment/multiline grep).
- [ ] Commit as `feat(v4.9 W5): intent plumbing — the task-mode channel, no content yet`
  (W4 commits separately first as `refactor(v4.9 W4): extract chair-fallback.js (pure move)`).

# v4.9 W13 — bench signals: the TTFT probe, the alias-shadow warning, honest pins, CI headroom — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** The #135/#129 remainder that survives triage: measure time-to-first-token so the
next rev can derive per-model backstops from evidence (R12: probe first, derive later); warn
when a local alias shadows a curated pin (the kimi case); refresh the two curated pins that
are a model generation behind; buy the CI council the backstop headroom the 4.8.1 stall
analysis named, and file the retry-policy issue.

**Architecture:** Stacked on `v49-w10-engine` (shares `headless.js`). The probe is
emit-when-set all the way down: headless measures the first *substantive* activity delta,
rides the result doc → leg patch → runStats row. No derivation, no knob, no behavior change —
a pure data foundation.

**Spec:** phasing memo §3 (kimi/qwen NOT implicated — the stall class is CI-side; W1-4 ruling
carried C5 + the C2 probe) + v4.8 spec §8-C (TTFT is the honest quantity — the backstop kills
silent seats, not slow ones).

## Global Constraints

- Emit-when-set everywhere: a leg that never produced output carries NO ttft key; existing
  artifacts byte-identical when the field is absent (absence pins).
- `run-retry.js` is 300/300 and `run-stats-entry.js` is small — measure nets; the entry's
  allowlist gains one key.
- CI workflow edits: remember the two-spellings rule (any new env/input must be single-spelled
  or drift-pinned like fail_on/models).
- No git mutations; focused suites `--maxWorkers=2`; all gates clean.

---

### Task A: the TTFT probe (R12 — probe only)

**Files:** Modify `src/headless.js` (measure), `src/utils/result-schema.js` (carry),
`src/sidecar/fanout-leg.js` (leg patch), `src/council/run-stats-entry.js` (runStats
emit-when-set), `schemas/council-tally.schema.json` (optional field), their suites
(`tests/no-output-backstop-wiring.test.js` neighborhood for the measure,
`tests/council/run-stats-entry.test.js`, the fanout suite).
- [ ] Measure: in `runHeadless`, record `ttftMs` = elapsed from session-prompt send to the
  FIRST tick where the backstop's own `progressed` predicate is true (reuse the exact
  predicate the no-output backstop reads — one definition, not a twin; find it and cite by
  symbol). Emit-when-set on the result doc (`result-schema.js`, beside `opencodeSessionId`'s
  precedent) and the leg patch (`fanout-leg.js`, `|| undefined` omit-if-absent precedent).
- [ ] Carry: `buildRunStatsEntry` gains `...(typeof ttftMs === 'number' ? { ttftMs } : {})`
  (the seat-field precedent); thread from the leg at the callers that hold a leg. Schema:
  optional integer on the runStats row items.
- [ ] Pins: a leg with first output at t → row carries ttftMs ≈ t (fake-timer driven); a leg
  with NO output carries no key; review/task/legacy artifacts byte-identical when absent.
  Named mutant `TTFTDROP` (measure never emits) — red set in-file.
- [ ] Do NOT derive anything from it (no backstop change, no threshold). The C2 derivation
  waits for real observations, per R12 — state that in the module comment.

### Task B: the alias-shadow warning (C5) + curated pin refresh + CI headroom + the issue

**Files:** Modify `src/utils/curated-models.js` (kimi → `openrouter/moonshotai/kimi-k3`,
qwen → `openrouter/qwen/qwen3.8-max`), the alias-resolution site that can see BOTH the local
override and the curated pin (measure: `config.js :: getEffectiveAliases` merges them — find
where a council run resolves bench aliases and can compare; `models --check` too),
`.github/workflows/council-review.yml` (backstop env), their suites
(`tests/scripts/council-review-workflow.test.js` pins the workflow; the curated-table suites).
- [ ] Curated refresh: the two CARDLESS pins move one generation forward (they are the
  fallback floor for callers/forks without a CI alias map — both the owner's machine and CI
  already run the newer ids). Run the curated-table suites; the council-review workflow pin
  asserting bench aliases exist in `toDefaultAliases()` must stay green.
- [ ] Alias-shadow warning: when resolving a council bench (and in `amicus models --check`),
  if a user-config alias shadows a curated alias with a DIFFERENT id, print one notice line:
  `alias '<a>' resolves to <local> (curated ships <curated>)` — self-diagnosis, no behavior
  change, once per run. Measure the right site so BOTH CLI and MCP council paths get it
  (the shared resolution helper, not a handler). Pins: shadow-with-different-id notices;
  same-id silent; no-local silent. Named mutant `SHADOWSILENT`.
- [ ] CI headroom: in `council-review.yml`, set `AMICUS_NO_OUTPUT_BACKSTOP_MS: '480000'` on
  the council-run step's env, with a comment carrying the evidence (2026-08-24/25: five
  councils, kimi/qwen/glm all hit NO_OUTPUT_BACKSTOP at 300 s first-attempt on OpenRouter;
  glm survived only via its single retry; #196's run was a 2-of-4 bench). Single-spelled;
  extend the workflow drift suite if it pins step envs.
- [ ] File the GitHub issue (via `gh issue create -R BourbonDog/amicus`): title
  "CI council stage-1: one retry is the whole difference between a full bench and 2-of-4" —
  body: the measured 4.8.1-cycle tally (5 runs; kimi 2 hard fails on two different pins,
  qwen 2, glm 3 first-attempt stalls all healed by its single retry; #196 verdict on 2-of-4),
  the NO_OUTPUT_BACKSTOP-at-300s signature, and the two candidate levers (second stage-1
  retry in CI; staggered launch) — explicitly a brainstorming filing, not a scoped fix.
  Record the issue number in the wave report.

### Task C (lead): wave gates
- [ ] Full `npm test` tail -10, lint, sizes, citations, docs check; three-axis sweep; commit;
  push; PR (council label) AFTER #201 merges or as stacked PR onto it — lead's call at the
  time.

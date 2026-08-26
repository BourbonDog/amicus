# v4.9 W12 — the carried items and the ship-it tails — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the last carried v4.9 items — F-1, F-5, the CLI `list` merge, W1-M4 — plus the
two merged PRs' ship-it tails, so W14 inherits nothing but docs and the ritual.

**Spec:** BACKLOG's F-1/F-5/CLI-list/W1-M4 entries (recon-verified, refuter-confirmed) + the
#200/#201 final-round tails (session ledger). All measured 2026-08-25/26; re-verify anchors.

## Global Constraints
- Focused suites `--maxWorkers=2`; sizes/citations/lint clean; no git mutations (lead commits).
- The fence neutralization must cover BOTH house outbound-fence surfaces with ONE mechanism.

### Task A: docs-adjacent batch (F-1 · F-5 · #200 tails)
**Files:** `docs/usage.md`, `docs/configuration.md`, `tests/docs-command-coverage.test.js` (or
a new pin suite), `src/mcp-tools.js` (descriptions only), `src/council/briefings-stage2-task.js`
+ `src/prompt-builder.js` (fence close-tag neutralization), `src/council/run-chair.js`
(chair-failed effect wording), `tests/where-things-live-docs.test.js`, their suites.
- [ ] F-1: REMEASURE the undocumented-key set (was 19/105 pre-W5; W5 documented intent).
  RULE: document every user-settable key with an honest one-liner in usage.md; allowlist ONLY
  harness-injected keys (measure which of amicus_start's contextSince/includeContext/
  coworkProcess/parentSession/windowPosition a user could meaningfully set — decide per key,
  record each). Then the pin: every tool's Object.keys(inputSchema) ⊆ documented ∪ allowlist,
  allowlist entries each carrying a WHY.
- [ ] F-5: routing.tier + tier_onboarded documented in configuration.md's Routing section
  (by-symbol anchors: config.js :: hasTierOnboarded/markTierOnboarded/getCostTier/setCostTier),
  covering the priced picker end to end (#196 made it reachable from both setup surfaces);
  add the where-things-live pin.
- [ ] #200 tail B1: mcp-tools' amicus_verdict description gains one sentence — hand-trimmed
  records must PRESERVE meta.intent or a task rebuild loses its scale.
- [ ] #200 tail B2/C2: neutralize the fence close tag inside embedded untrusted text — ONE
  helper (measure where: beside the fence builders), replacing any occurrence of the close
  tag (and its prompt-builder sibling's) inside the embedded body with a defanged spelling;
  applied at BOTH outbound fence surfaces. RED-first with an escaping fixture; review-path
  byte identity where the text contains no close tag (pins).
- [ ] #200 tail C4: the chair-failed degrade's effect text forks its noun on intent (the
  what/why already fork) — net-0 mode-ternary.

### Task B: code batch (CLI list merge · W1-M4 · #201 tails)
**Files:** `src/sidecar/read.js`, `src/mcp-council-awareness.js` (only if a param is needed),
`src/mcp-server.js` (W1-M4), `src/utils/engine-log-parse.js` + `src/utils/engine-log.js`
(#201 tails), their suites.
- [ ] CLI list merge (rulings made at kickoff): `listSidecars` concats `listCouncilRuns(cwd)`;
  each surface owns its truncation (the CLI re-truncates the 80-char preview to its own 30);
  the MODEL cell renders `council (<stage>)` mirroring `wave (N legs)`. MEASURE the ordering
  story (how rows sort today; council rows join that order honestly). Pins: council rows
  appear with stage cell + width; review rows byte-identical.
- [ ] W1-M4: the amicus_start spawn-fallback writes the RAW prompt to briefing.md
  (mcp-server.js ~:669; zero rot as of 2026-08-25). THE WORK IS THE REPRO DRIVE: force the
  fallback path in a test (measure the flag/env selecting it), read the briefing file a real
  child would search — RED with the raw prompt where a rendered one was forwarded, then the
  Task-7 shape (rendered → briefing.md, raw → briefing-input.md, parity comment mirroring
  the amicus_fanout fix at ~:1310-1327).
- [ ] #201 tail C1 (solid): isErrorLine's logfmt branch uses a substring regex for
  level=ERROR — a quoted value containing the delimited text false-classifies. Tokenized
  top-level field check (the tokenizer is right there). RED-first.
- [ ] #201 tail C2 (solid): the death-path scan re-stats and re-reads per firing. Memoize the
  dir listing + tails per process with a short TTL (measure a sane value, e.g. 10 s — a wave
  of N dying seats fires within one window) — bounded, and a cold call after TTL refreshes.
  Absence-of-change pins (same excerpts, fewer stats — count via an fs seam).

### Task C (lead): gates + commit + PR.

---
title: F7 — Launch Readiness: Council v3 + Comprehensive Docs Refresh
date: 2026-06-10
status: finalized (ready for writing-plans)
owner: BourbonDog
---

# F7 — Launch Readiness: Council v3 + Comprehensive Docs Refresh

## 1. Summary

F7 is the final milestone before launch. It has two sequenced phases:

- **Phase 1 — Council v3 + launch-blocking gaps.** Rewrite the `second-opinion`
  (LLM Council) skill to consume the F4 engine primitives (`amicus fanout --json`,
  `--prompt-file`, structured run/wave JSON), prune the now-obsolete F1-era
  workarounds, and close the three small code gaps the launch story depends on
  (council ships + installs, wizard title, package.json identity fields).
- **Phase 2 — Comprehensive docs refresh.** Rewrite every user-facing doc surface
  (README, docs/, site/, skills, new CONTRIBUTING + CHANGELOG) against the
  Phase-1 product, repositioned per the product spec: **the council is the hero
  feature; the parallel window is the engine underneath.**

Phase 2 does not start until Phase 1's real-LLM smoke gate passes, so the docs
describe shipped behavior only.

This spec implements the "F7 comprehensive README/docs refresh" milestone from
the product spec (`2026-06-07-amicus-product-design.md`) and pulls forward two
tracked follow-ups into it: the F4 follow-on (council skill rewrite to use
fanout/JSON) and the F1 payoff (delete the single-read / no-glob / no-narration
ritual and poller false-alarm checks).

## 2. Decisions locked (traceability)

Confirmed during brainstorming on 2026-06-10:

| Decision | Choice |
| --- | --- |
| Scope boundary | Docs + launch-blocking gaps (council shipping, wizard title, package.json fields). No launch mechanics. |
| Install story | npm-first (`npm install -g amicus`), with an install-from-source/GitHub subsection |
| Skill depth | **Full fanout rewrite now** (F4 follow-on pulled into F7; subsumes the F1 workaround pruning) |
| Secondary surfaces | site/ landing page, new CONTRIBUTING.md, drop the upstream demo video, new CHANGELOG.md — all in |
| Packaging | One spec, one two-phase plan, one subagent-driven execution (Phase 1 → hard checkpoint → Phase 2) |
| Council v3 depth | **Plumbing + light mechanics polish** — Stage 0–6 brain unchanged; transport swapped to fanout/JSON; polish = wave-degrade rules + run stats in the report |
| Positioning | Council-as-hero across README and site (per product spec §1) |
| Chat skill name | Stays `sidecar` (F6 decision; not re-litigated) |

Standing non-goal (product spec §2): the council **stays a skill** — Claude
orchestrates; the Stage 0–6 flow is not reimplemented as deterministic code.
The fanout rewrite swaps the skill's *plumbing*, not its *brain*.

## 3. Phase 1 — Council v3 + launch-blocking gaps

### 3.1 Council SKILL.md transport rewrite (`skills/second-opinion/SKILL.md`)

The v2 mechanics — Stage 0–6 flow, anonymized cross-review, street-cred scoring,
Confirmed/Contested/Singleton tiers, chair synthesis + fallback chain,
Claude-in-council toggle, scale-down levels — are **unchanged**. The transport
changes:

- **Stage 1 (independent reviews)** becomes one background call:

  ```
  amicus fanout --models <m1,m2,m3> --prompt-file <briefing.md> --json \
    --agent Plan --no-context --summary-length verbose --timeout <min>
  ```

  The wave JSON returns every leg's status and summary in one parse. This
  replaces N parallel `amicus start` Bash launches and prose-scraping.
- **Red-team variant:** fanout legs share a single prompt by design. When one
  model gets a distinct red-team brief, launch it as a parallel solo
  `amicus start --json --prompt-file <redteam-briefing.md>` alongside the wave
  for the symmetric reviewers.
- **Stage 2 (cross-review)** is the ideal fanout case — the identical anonymized
  bundle goes to every judge: one wave call, same flags.
- **Stage 3 (chair)** stays a single headless `amicus start --json` with the
  chair packet via `--prompt-file`.
- **All briefings go through `--prompt-file`** temp files (BOM-safe, no ~32 KB
  Windows arg cap, no shell-quoting hazards). Inline `--prompt` is no longer
  used for briefings of any size.
- **JSON-first result handling.** Leg status and summaries come from the wave
  JSON (`schemaVersion: 1`; wave: `{waveId, status, counts, legs[]}`; leg:
  `{taskId, model, status, summary, error}`). Re-reads use
  `amicus read <taskId> --json`. Wave exit codes: 0 = complete, 2 = partial,
  1 = error/aborted. Model *content* (findings lists, rankings, verdicts)
  remains structured markdown inside the summaries — Claude parses it; weaker
  models are not forced to emit JSON.
- **Scale-down transport:** 1-model runs use plain `start --json` (no fanout);
  2-model runs use a 2-leg wave with the existing thin-ranking disclosure.
- **Dual transport documented.** CLI via background Bash is primary
  (notification-driven, no polling). Where Bash is unavailable (Cowork), use the
  MCP tools `amicus_fanout` → `amicus_status` → `amicus_read`. The council's
  `--no-context` design sidesteps the known MCP fanout context-pinning gap
  (F4 follow-up): council briefings are always self-contained.
- **Delete the F1-era ritual** from all briefing templates: the strict
  single-read / no-glob / no-narration instruction, and any "launch the wave
  before waiting" choreography that fanout now owns. Pre-extracting large or
  marked-up sources to clean temp files **stays** — that is briefing hygiene
  (token cost, model focus), not a poller workaround.

### 3.2 Light mechanics polish (the only brain-adjacent changes)

- **Wave-degrade rules (new, explicit):**
  - Stage 1: a leg ends `error`/`timeout`/`crashed`/`aborted` → proceed when ≥2
    reviews survive; below 2, offer re-run of the dead leg or a disclosed
    downgrade to single-pass mode (existing v2 rule, now wired to wave counts).
  - Stage 2: a judge leg dies → tally rankings/adjudications over the surviving
    judges; disclose the reduced bench in `crossreview-matrix.md`. Tiers are
    already defined over "judges engaged", so the scoring rule itself is
    unchanged.
  - Stage 3: chair failure keeps the existing v2 fallback chain (re-run →
    promote next-best non-Claude → Claude-chairs-with-disclosure).
- **Run stats in `report.md`:** a compact per-leg table — model, status, and
  timing derived from the wave JSON timestamps. (The schema carries no cost
  data; do not promise cost figures.)

### 3.3 MODEL-NOTES.md v3 pruning (`skills/second-opinion/MODEL-NOTES.md`)

**Delete (obsolete — fixed by F1/F2/F4/PR#6):**
- The entire "headless poller trap" section, including the single-read /
  no-glob / no-narration mitigations and the `Polling loop exited` false-alarm
  note (F1 activity-aware completion).
- The ~32 KB inline-arg-cap guidance (superseded by `--prompt-file`).
- The absolute-path / cwd-persistence trap (F2 Windows path robustness).
- "Always `--no-ui` because the GUI hangs" — resolved 2026-06-10. Headless
  remains the council rule, reframed: council runs are *autonomous by design*.
- `~/.config/sidecar/.env` → `~/.config/amicus/.env` (legacy path still read
  via shim; document the new one).

**Keep (durable knowledge):**
- Per-model behavioral notes, reworded minus poller framing (e.g. Gemini's
  narrate-then-glob quirk becomes a verbosity/preamble note, not a failure mode;
  DeepSeek resilience; GPT verbosity + discount-self-votes).
- The reviewer-reliability table, its data, and its update protocol.
- The o3 / o3-pro cost guardrail.
- Stage-2 briefing format tips (`FINAL RANKING:` block, label+id adjudication).
- Different-families rule; citation-verification rule.
- The lessons changelog (append a v3-migration entry).

### 3.4 Design doc consolidation

The skill folder now ships to end users (§3.6), so it carries **one** design
doc: rewrite `V2-COUNCIL-DESIGN.md` into `COUNCIL-DESIGN.md` (v3) documenting
the fanout-native transport, degrade rules, and run stats; delete the V2 file
(git history preserves it). `SKILL.md`'s Files section points at the new name.

### 3.5 Chat skill accuracy pass (`skill/SKILL.md`)

Accuracy-only: current flags and commands (including `fanout`, `models`,
`--prompt-file`, `--json`), `amicus_*` MCP tool names, config paths, and removal
of the same obsolete engine-workaround advice. The skill keeps its `sidecar`
name and install path `~/.claude/skills/sidecar/` (F6 decision). Mention the
boundary with `second-opinion` (already present) and with `fanout` (parallel
same-prompt asks ≠ council review).

### 3.6 Launch-blocking code gaps

- **Ship the council:** add `skills/` to package.json `files`.
- **Install the council:** `scripts/postinstall.js` installs both skills —
  - chat skill → `~/.claude/skills/sidecar/` (as today, always overwritten);
  - council → `~/.claude/skills/second-opinion/`: `SKILL.md` and
    `COUNCIL-DESIGN.md` are product code, **always overwritten** on
    install/update; `MODEL-NOTES.md` is user data (the evolving reliability
    table), **copy-if-missing only** — never clobber an existing copy.
  - Idempotent; keep the existing warn-don't-fail behavior (a failed skill copy
    never breaks `npm install`).
  - One-time owner migration: as part of F7 execution, manually sync the
    owner's live `~/.claude/skills/second-opinion/` copy to v3 (copy-if-missing
    would otherwise leave the pre-v3 notes in place).
- **Wizard title:** `electron/setup-ui.js` `<title>` "Sidecar Setup" →
  "Amicus Setup".
- **package.json identity:** `repository`/`bugs`/`homepage` →
  github.com/BourbonDog/amicus; `author` → BourbonDog (John Renaldi remains in
  LICENSE and NOTICE); keywords gain `council`, `second-opinion`, `fanout`
  (keep `sidecar` for discoverability).

### 3.7 Phase-1 validation (hard gate for Phase 2)

- Unit tests for the new postinstall behavior (both-skills install,
  MODEL-NOTES copy-if-missing, overwrite semantics, warn-don't-fail).
- Tarball check: `npm pack --dry-run` (or equivalent test) shows `skills/**`
  included.
- Suite stays green (baseline 1848 pass / 4 skip / 0 fail); lint clean.
- **Real-LLM council smoke on this machine:** a 2-cheap-model council
  (gemini-flash-lite + deepseek via OpenRouter) driven end-to-end through
  Stages 1–3 per the new SKILL.md — fanout wave completes, JSON parses, the
  four run-folder artifacts are written, thin-ranking disclosure appears, and
  (if a leg is artificially killed) the degrade rule fires and is disclosed.

## 4. Phase 2 — Comprehensive docs refresh

Written strictly against the Phase-1 product. Accuracy rule for every surface:
**every documented command, flag, env var, path, and behavior is verified
against `--help` output and code** — no aspirational documentation.

### 4.1 README.md — full rewrite (the centerpiece)

Repositioned: council = hero, parallel window = engine. Target structure:

1. **Hero** — "Multi-model LLM Council for Claude Code" framing; existing
   Amicus hero image; npm/license/node/CI badges pointed at BourbonDog/amicus.
   **Removed:** the WIP-rebrand banner; the upstream YouTube demo embed; the
   jrenaldi79 last-commit/stars badges.
2. **What is Amicus** — one install delivers: the LLM Council skill, the
   chat/fork/fold parallel window, the `amicus` CLI + MCP server, and a
   self-updating model catalog.
3. **Quick start** — `npm install -g amicus` → `amicus setup` → first council
   ("give Claude a document and say *council review this*") → first sidecar
   fork. Subsection: install from GitHub for end users
   (`npm install -g github:BourbonDog/amicus` — postinstall runs and registers
   everything, same as npm). Contributor dev setup (with `--ignore-scripts`)
   lives in CONTRIBUTING.md, not here.
4. **The Council** — flow overview (independent reviews → anonymous
   cross-review → chair verdict → tiered accept/deny decisions), what a run
   produces (run folder artifacts, reviewed copy), Claude-in-council toggle,
   one-paragraph cost/shape disclosure example.
5. **The parallel window** — fork/work/fold; interactive + headless; context
   sharing and isolation flags.
6. **Commands** — all 11 (`start`, `fanout`, `list`, `resume`, `continue`,
   `read`, `models`, `abort` incl. `--all`, `setup`, `update`, `mcp`) with
   `--json`, `--prompt-file`, and exit codes (0/2/1, 130/143).
7. **Models** — the F5 story: live OpenRouter catalog with TTL cache, `amicus
   models` / `--refresh` / `--check`, aliases as a curated *seed* (the frozen
   20-row alias table is deleted; point at `amicus models` instead), full-id
   passthrough, searchable wizard picker, keyless fetch.
8. **MCP integration** — complete `amicus_*` tool table including
   `amicus_fanout`; async start→status→read pattern; manual registration.
9. **Configuration** — env table including the F1/F4/PR#6 knobs:
   `AMICUS_STABLE_IDLE_POLLS`, `AMICUS_POLL_INTERVAL_MS`,
   `AMICUS_STABLE_FINISHED_POLLS`, `AMICUS_POLL_CALL_TIMEOUT_MS`,
   `AMICUS_MAX_CONSECUTIVE_POLL_FAILURES`, `AMICUS_GUI_LOAD_TIMEOUT_MS`,
   `AMICUS_DEBUG_PORT`, plus the existing key/config/timeout vars.
10. **JSON output** — the `schemaVersion: 1` run and wave document shapes, for
    scripting and agent consumption.
11. **Windows** — first-class support callout (green suite on Windows 11,
    native-bin PATH handling, no WSL needed) as a differentiator.
12. **Troubleshooting** — rewritten; dead rows pruned (GUI-hang row, stale
    poller advice), new rows for catalog validation messages and fanout
    partial-wave exit code 2.
13. **Documentation index / Contributing pointer / Built on OpenCode /
    Attribution + License** — attribution text moves from the WIP banner into a
    proper closing section (fork of jrenaldi79/sidecar, MIT, NOTICE).

### 4.2 docs/ refresh

- `architecture.md`, `configuration.md`, `usage.md`, `troubleshooting.md`,
  `opencode-integration.md`, `testing.md`, `electron-testing.md` — amicus-ify
  residual `sidecar` strings, fold in F1–F5 features (fanout, models, JSON
  schema, new env knobs, hooks setup), prune stale claims. `usage.md` gains the
  fanout section (no separate `docs/fanout.md` — YAGNI).
- `publishing.md` — correct the trusted-publisher claim (current OIDC config
  belongs to the upstream `jrenaldi79/sidecar` repo); document what `amicus`
  needs at launch (npm package creation, trusted publisher or token, the
  publish.yml API-key requirement). Maintainer-facing; stays.
- `doc-system.md` — fix the stale plans-index section against what
  `scripts/generate-docs.js` actually generates today.
- `SHIMS.md` — accurate; unchanged (add a one-line "removal scheduled
  post-launch" note only if missing).
- `CLAUDE.md` — regenerate auto sections (`npm run generate-docs`); manual
  sections get a sanity pass for stale claims.
- SVG/PNG assets — fix `sidecar` text residue in `hero.svg`,
  `social-card.svg`, `architecture.svg`; re-render PNGs only where visible text
  changed.

### 4.3 site/index.html

Same council-as-hero repositioning and content as the new README: clean the 19
`sidecar` references, current features/commands, install instructions matching
§4.1.3. `social-card-render.html` residue fixed alongside. (GitHub Pages
enablement itself is launch mechanics — out of scope.)

### 4.4 CONTRIBUTING.md (new)

Dev setup (clone; `npm install --ignore-scripts --omit=optional` + the
postinstall-mutates-global-config warning; `node scripts/setup-hooks.js`;
electron install recipe), gates (lint-staged, secrets, 300-line file size,
generate-docs, pre-push green-suite), test commands (`npm test`,
`test:integration`, evals pointer), worktree guidance, PR flow (auto-review via
OAuth, codex-audit), CDP UI-testing pointer to `docs/electron-testing.md`.
The README's "PRs Welcome" badge now resolves.

### 4.5 CHANGELOG.md (new)

Keep-a-Changelog format. One launch entry summarizing the fork's delta vs
upstream v0.5.2: rebrand + shims, F1 headless reliability, F2 Windows green
suite, F3 process lifecycle + alias correctness, F4 fanout + JSON schema, F5
dynamic model catalog, council v3, both-skills install, plus an `[Unreleased]`
section. (Version number/date filled at launch; the entry can sit under
`[Unreleased]` until then.)

### 4.6 .env.example

Verify variable names and comments are current (`AMICUS_*` forms, catalog/
poller knobs present, no stale `SIDECAR_*`-only guidance).

### 4.7 Phase-2 validation

- `npm run validate-docs` and `npm run generate-docs:check` green.
- Link check passes across README, docs/, site/ (no `CONTRIBUTING.md` 404).
- Spot-verify: every command/flag/env var named in README exists in real
  `--help` output / code.
- Residue sweep: zero unintentional `sidecar` references in README, docs/
  (excluding `superpowers/` history and `SHIMS.md`), site/, skills.
  Intentional survivors: chat-skill name + install path, attribution/NOTICE,
  shim documentation, historical specs/plans.
- Suite green, lint clean.

## 5. Sequencing & execution

One plan, subagent-driven like F3/F4/F5: isolated git worktree, two-stage
review per task (spec compliance, then quality), final holistic review before
merge. **Phase 1 → hard checkpoint (all §3.7 gates pass) → Phase 2.** The
checkpoint is also the natural pause point for owner inspection of the
rewritten council before the docs wave. Commit to main locally, push at the
milestone per the established flow.

## 6. Risk handling

- **Council rewrite risk** — contained by: the v2 brain is untouched (transport
  swap only); the §3.7 real-LLM smoke gate runs before any doc depends on the
  new flow; failure modes are themselves designed (wave-degrade rules) rather
  than rolled back.
- **Docs drift risk** — contained by the accuracy rule + §4.7 gates.
- **Install risk** — postinstall keeps warn-don't-fail; MODEL-NOTES
  copy-if-missing prevents data loss; unit-tested.
- **Owner's live council copy** — explicitly migrated once (§3.6), preventing
  a stale global skill from shadowing the v3 behavior.

## 7. Acceptance criteria

1. A packed tarball contains `skills/**`; postinstall installs both skills with
   the §3.6 overwrite/copy-if-missing semantics (unit-tested).
2. Council v3 completes a real 2-model smoke run end-to-end via fanout/JSON
   with correct artifacts and disclosures (§3.7).
3. Zero unintentional `sidecar` references across README, docs/, site/, skills
   (intentional list per §4.7).
4. Every documented command/flag/env var is real; `validate-docs`,
   `generate-docs:check`, and the link check pass.
5. CONTRIBUTING.md and CHANGELOG.md exist and are accurate; the setup wizard
   window titles "Amicus Setup"; package.json identity fields point at
   BourbonDog/amicus.
6. Suite green at the 1848/4 baseline (plus new tests); lint clean.

## 8. Non-goals / deferred (tracked, not dropped)

- Launch mechanics: version bump, npm publish, repo-public flip, GitHub Pages
  enablement, new demo video.
- Backward-compat shim removal (`docs/SHIMS.md` backlog).
- Council mechanics redesign beyond §3.2 (scoring, tiers, stages, chair rules
  unchanged).
- Remaining F5 follow-ups: openai direct-route verification, failed-refresh
  memo, Step-3 alias editor live-fetch consolidation.
- evals/ system changes; archiving `BourbonDog/Second-Opinion` (post-launch,
  per product spec).
- MCP fanout Cowork context-pinning (F4 follow-up) — council sidesteps it via
  `--no-context`; the engine gap itself stays tracked.

## 9. Staleness inventory (input for the plan writer)

Findings from the 2026-06-10 survey, for task scoping:

- **README:** WIP banner; jrenaldi79 badges; upstream YouTube embed; no
  `fanout`/`models` commands; frozen 20-row alias table; missing env knobs
  (F1/F4/PR#6); `[SIDECAR_FOLD]` token mentioned in Features (the token is
  still the engine's real protocol string in `src/headless.js` /
  `src/prompt-builder.js` — docs may describe it, but renaming the token is
  out of scope); `CONTRIBUTING.md` badge 404; council barely mentioned.
- **package.json:** `repository`/`author` upstream; `files` lacks `skills/`;
  no `bugs`/`homepage`.
- **postinstall:** installs chat skill only.
- **electron/setup-ui.js:27:** `<title>Sidecar Setup</title>`.
- **Residue counts (case-insensitive `sidecar`):** docs/ non-superpowers = 38
  across 9 files incl. SVGs (SHIMS.md's 9 are intentional); site/ 22 across
  2 files; skill/SKILL.md 37 (name-intentional plus stale engine advice);
  skills/second-opinion/ 18 across 3 files.
- **MODEL-NOTES:** poller-trap section, 32 KB cap, cwd trap, GUI-hang rule,
  `~/.config/sidecar/.env` — all superseded (see §3.3).
- **doc-system.md:** references `docs/plans/` + `docs/archive/plans/` which do
  not exist.
- **publishing.md:** trusted-publisher claim belongs to the upstream repo.
- **CLI surface to document (from live `--help`):** `start`, `fanout`, `list`,
  `resume`, `continue`, `read`, `models`, `abort [--all]`, `setup
  [--api-keys] [--add-alias]`, `update`, `mcp`; `--prompt-file`, `--json`,
  `--no-validate-model`, `--position`, `--fold-shortcut`, `--opencode-port`.
- **Wave JSON contract:** `schemaVersion: 1`; wave `{waveId, status:
  running|complete|partial|error|aborted, counts{total,complete,error,timeout,
  aborted}, legs[]}`; leg `{taskId, waveId, model, status, summary, error}`;
  exit codes 0/2/1 + 130/143.

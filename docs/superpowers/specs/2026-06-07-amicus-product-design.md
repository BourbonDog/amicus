---
title: Amicus — Product Design Spec
date: 2026-06-07
updated: 2026-06-08
status: finalized (name + scope locked; ready for implementation planning)
owner: BourbonDog
supersedes: 2026-06-07-second-opinion-product-design.md (renamed at rebrand)
---

# Amicus — Product Design Spec

## 1. Summary

**Amicus** is a single, owned, shareable product that bundles a maintained
fork of the `sidecar` multi-model engine with the `second-opinion` (LLM Council) and
`sidecar` (ad-hoc chat) skills, installable in one step.

- The **council is the hero feature**; **sidecar is the engine underneath**.
- The council **stays a skill** — Claude orchestrates it. We are owning the *engine*,
  not rewriting the *brain* in code.
- Distributed as **one repo** ("just clone/install one thing → councils run").
- Built by hard-forking `jrenaldi79/sidecar` (MIT, third-party, plausibly stalled —
  last commit ~2 months ago, 12 open issues) and taking ownership going forward.
- **Repo:** github.com/BourbonDog/amicus (private; flip public at launch).
  **Local clone:** `C:\Users\sendt\dev\amicus` (kept outside OneDrive so
  node_modules/Electron don't thrash sync). `upstream` remote → `jrenaldi79/sidecar`
  retained for cherry-picks.

## 2. Goals & non-goals

**Drivers (why this exists):**
- **Product / share** — a recognizable "entity" tied to the BourbonDog brand, shared as a repo.
- **Convenience** — one install instead of skill + engine + API config + MODEL-NOTES wired by hand.

**Audience:** the owner + other **Claude-ecosystem** users (Claude Code / Desktop / Cowork).
The orchestrator is always Claude — so the product does **not** need to carry its own LLM brain.

**Non-goals (explicitly out):**
- Reimplementing the Stage 0–6 council flow as deterministic code. The council stays a skill.
- A standalone orchestrator for non-Claude users (would require rebuilding an agent loop). Out of scope.
- Reliability/CI/headless-automation as a *primary* driver — those were the un-chosen drivers;
  any automation benefit is incidental.

## 3. Decisions locked (traceability)

Each confirmed during brainstorming on 2026-06-07 (name finalized 2026-06-08):

| Decision | Choice |
| --- | --- |
| Driver | Product/share + convenience (not reliability, not run-standalone) |
| Audience | Owner + other Claude-ecosystem users; shared as one repo |
| Engine relationship | **Full fork** of `jrenaldi79/sidecar`, keep the GUI, own it long-term |
| Product name | **Amicus** (council = hero, sidecar = engine) |
| CLI binaries | `amicus` (primary) + `am` (short alias) |
| npm package name | `amicus` (verified free on npm) |
| v1 size | **Bigger v1** — fixes *and* engine improvements |
| Council implementation | Stays a skill (Claude orchestrates); not absorbed into engine code |
| Council source-of-truth | The **Amicus monorepo** is canonical; council vendored at `skills/second-opinion/`. Old `BourbonDog/Second-Opinion` repo archived once Amicus proves out. |

**Name rationale:** "Amicus" was chosen after rejecting "Second Opinion" and "Roundtable" —
both crowded/taken in the AI niche (npm taken; `roundtable.ai` is a funded YC company; multiple
AI-roundtable repos exist, including a Claude Code skill). `amicus` is free on npm.

## 4. Progress (as of 2026-06-08)

**Done — repo established (commit `0fee04d`):**
- Repo created from a full hard-fork: complete engine history + 23 tags imported.
- **License/attribution:** original `LICENSE` (MIT, © 2025 John Renaldi) preserved in full;
  `NOTICE` added (© 2026 BourbonDog modifications; documents the bundle + upstream remote).
- **Council bundled** at `skills/second-opinion/`; the `sidecar` ad-hoc chat skill ships at `skill/`.
- README banner establishing Amicus.

**Not yet done (this is v1):**
- **Code rebrand:** `package.json` is still `name: claude-sidecar` v0.5.2 with bin
  `sidecar`/`claude-sidecar`. Rename to `amicus` (+ `am`) across package.json, README,
  skill launch commands, and CI workflows.
- F1–F5 engine/feature work and F6 one-step install (below).

## 5. Architecture

One monorepo. Components are bounded by responsibility; exact internal file layout follows
the upstream fork and is mapped during the first implementation pass (code exploration).

1. **Engine (forked transport core)** — OpenCode SDK integration, provider auth, session
   lifecycle, the headless runner + poller. *Responsibility:* given (model, prompt, agent mode),
   run it and return a result/summary. **All reliability fixes land here.**
2. **CLI** — command surface (`start`, `list`, `read`, `resume`, `continue`, `setup`, new `models`,
   new `fanout`). *Responsibility:* validate inputs, drive the engine, format output. Bins: `amicus` / `am`.
3. **GUI (Electron app)** — interactive multi-model window, model picker, fold. *Responsibility:*
   human-in-the-loop conversations. **The Windows hang fix lands here.** Kept per the full-fork choice.
4. **MCP server** — exposes engine capabilities as MCP tools to Claude clients; auto-registers on
   `setup`. *Responsibility:* let Claude drive the engine without shelling out to the CLI.
5. **Model Catalog (new component)** — fetches the current model list from OpenRouter's
   `/api/v1/models`, maps to aliases, caches, refreshes on demand. *Responsibility:* keep the model
   list current automatically. Feeds CLI `--model` resolution, the GUI picker, and the existing
   `[SIDECAR_CONFIG_UPDATE]` alias-table mechanism. (Builds on the existing `scripts/list-models.js`.)
6. **Council layer (skills, not code)** — `skills/second-opinion/` (SKILL.md + MODEL-NOTES.md + design
   docs) and `skill/` (the `sidecar` chat SKILL.md). *Responsibility:* orchestration, executed by Claude.
   Bundled and installed by `setup`; **not** reimplemented.
7. **Installer / `setup`** — one-step bring-up. *Responsibility:* install the CLI, register the MCP,
   copy both skills + MODEL-NOTES into `~/.claude/skills/`, run API-key auth, seed the model catalog.

**Data flow (council run, unchanged in principle):**
Claude (skill) → CLI/MCP → Engine → provider (via OpenCode SDK) → summary back to Claude → Claude
anonymizes/scores/presents. The engine fixes make each hop reliable enough to delete the skill's
current workarounds.

## 6. v1 feature set

### F1 — Reliability core *(Engine)*
- **Poller fix.** Headless runs must neither exit prematurely on a quiet tool-call gap (#16) nor hang
  past `--timeout` (#19).
  - *Acceptance:* a run that pauses >8s mid-tool-call still completes with full output; a genuinely
    stuck run is killed at `--timeout`. The Gemini "narrate-then-glob" pattern completes **without** the
    single-read workaround.
- **Context isolation (#17).** `--no-context` guarantees zero parent-conversation bleed.
  - *Acceptance:* a `--no-context` run cannot reference any parent-conversation content.
- *Payoff:* the skill can delete the single-read / no-glob / no-narration ritual and the
  "Polling loop exited" false-alarm checks from MODEL-NOTES.

### F2 — Windows + GUI *(GUI, Engine/CLI)*
- **GUI hang fix.** The Electron GUI reaches an interactive state on Windows 11 (no infinite
  "Starting up… | 0 messages").
  - *Acceptance:* launching interactively opens a usable window on the owner's machine.
- **Windows path robustness.** Path/cwd handling so a persisted `cd` cannot silently no-op a launch
  (the absolute-path/cwd-persistence trap in MODEL-NOTES).
  - *Acceptance:* launches succeed regardless of prior cwd changes; no silent empty-prompt failures.

### F3 — Process & aliases *(Engine)*
- **Session lifecycle (#20, #15).** Killing the parent aborts the sidecar session; no orphaned
  sessions or zombie shells.
  - *Acceptance:* parent kill → child session terminates; `list` shows no orphans afterward.
- **Alias correctness (#18).** Aliases resolve to real, current model IDs (e.g. the broken `codex`
  alias). Largely subsumed by F5.

### F4 — Council-native engine features *(Engine, CLI, MCP)*
- **Parallel fan-out.** One command/tool launches N models on the same prompt and collects results.
  - *Acceptance:* `fanout --models a,b,c --prompt …` returns all three results in one call.
- **Structured JSON output.** A machine-parseable summary mode.
  - *Acceptance:* a `--output json` (or equivalent) mode yields a stable schema the skill parses
    instead of scraping prose.
- *Note:* the council skill may later adopt these to simplify its mechanics; the skill rewrite is a
  follow-on, not a v1 blocker.

### F5 — Dynamic OpenRouter model catalog *(Model Catalog)* — owner-requested
- Auto-sync the available model list from OpenRouter's `/api/v1/models` so the catalog evolves
  **without manual editing**.
  - *Acceptance:* `models --refresh` updates the catalog from OpenRouter; new models appear in
    `--model` resolution and the GUI picker; first-run `setup` seeds it automatically; no manual
    alias-file editing is required for new models.
  - *Implementation note:* **audit the existing `scripts/list-models.js` first** — model-listing
    plumbing is likely partly built and should be extended rather than rewritten.

### F6 — Bundle + one-step install + rebrand *(Installer)*
- **One-step install.** From a clean machine, one documented sequence (install → `setup`) yields
  working councils, the GUI, the MCP, both skills, and a seeded model catalog.
- **Rebrand (in progress).** License preserved + `NOTICE` added and the council is already bundled
  (see §4). Remaining: rename the package to `amicus` (bins `amicus` / `am`), and purge
  `sidecar`/`claude-sidecar` from README, skill launch commands, and CI workflows.
  - *Acceptance:* the product installs and runs end-to-end under `amicus`/`am` with no reference that
    implies it is upstream `claude-sidecar`.

## 7. Scope boundaries / backlog

Deferred to backlog (not dropped):
- Upstream **#25** (Linux/nvm `opencode` ENOENT) — owner is Windows-first; cross-platform parity later.
- Upstream **#23** (boolean@3.2.0 deprecation), **#4** (Obul pay-per-use), **#8** (auto-skill-invocation proposal).
- Publishing to the npm registry / a plugin marketplace listing — "share a repo" is the v1 bar.
- Council skill rewrite to *use* F4 (fan-out / JSON) — follow-on once the engine features land.
- Broader "improve sidecar" feature ideas beyond the five v1 bundles.

## 8. Risks & open questions

- **Forking an unread codebase.** Internal structure is unknown until explored; estimates are rough.
  *Mitigation:* first implementation step is a dedicated code-exploration pass before any change.
- **GUI hang root cause unknown** — the single riskiest item; could be a deep Electron/Windows issue.
  *Mitigation:* timebox diagnosis; the council works headless regardless, so it does not block F1/F3/F5.
- **Poller fix touches core engine behavior** in two opposite directions (premature exit vs. hang).
  *Mitigation:* regression tests for both failure modes before merging.
- ~~**npm name availability**~~ — **resolved:** `amicus` is free; package + bins (`amicus`/`am`) chosen.
- ~~**License compliance**~~ — **resolved:** MIT `LICENSE` preserved; `NOTICE`/attribution to
  `jrenaldi79/sidecar` added.
- ~~**Spec/repo location**~~ — **resolved:** repo exists (github.com/BourbonDog/amicus); this spec now
  lives in-repo at `docs/superpowers/specs/`.
- ~~**Council skill source-of-truth**~~ — **resolved:** the Amicus monorepo is canonical; council
  vendored at `skills/second-opinion/`; old `BourbonDog/Second-Opinion` archived once Amicus proves out.

## 9. Distribution & maintenance posture

- **Distribution:** one GitHub repo; install = clone/`npm i -g` then `amicus setup` (or `am setup`).
  Optionally a Claude Code plugin wrapper later.
- **Maintenance:** hard-fork (upstream stalled); cherry-pick upstream fixes if it revives; consider
  upstreaming the reliability fixes (#16/#17/#19) as good OSS citizenship.
- **Compounding learning:** keep `MODEL-NOTES.md` as the council's evolving memory; as engine fixes land,
  prune the now-obsolete workarounds it documents.

## 10. Next step

Run the superpowers **writing-plans** skill on this finalized spec to produce the v1 implementation
plan (starting with a code-exploration pass, then the rebrand, then F1–F6), then execute it.

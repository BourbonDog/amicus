<div align="center">

# Amicus

**A multi-model LLM Council for Claude — with a parallel AI window underneath.**

![Amicus: an LLM Council and a parallel AI window for Claude](./docs/hero.png)

Hand Claude a plan, a design, a diff, an architecture decision, a manuscript — anything — and say *council review this*: Amicus routes it through several models from different families, has them anonymously cross-review each other, and a non-Claude chair synthesizes a verdict you turn into accept/deny edits. Or skip the ceremony and **fork** a single conversation to Gemini, GPT, DeepSeek, or any other model — it works in parallel with full context, and you **fold** the result back when you're ready. Claude orchestrates throughout; you stay in your editor.

[![npm version](https://img.shields.io/npm/v/amicus?color=D97757&labelColor=1A1C29)](https://www.npmjs.com/package/amicus)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?labelColor=1A1C29)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen?labelColor=1A1C29)](https://nodejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?labelColor=1A1C29)](./CONTRIBUTING.md)

> **Supported clients:** Claude Code CLI and Claude Cowork are fully tested and supported. Claude Code web and Claude Desktop are experimental.

</div>

---

## Table of Contents

- [What is Amicus](#what-is-amicus)
- [Quick start](#quick-start)
- [Requirements & Dependencies](#requirements--dependencies)
- [The Council](#the-council)
- [The parallel window](#the-parallel-window)
- [Commands](#commands)
- [Models](#models)
- [MCP integration](#mcp-integration)
- [Configuration](#configuration)
- [JSON output](#json-output)
- [Windows](#windows)
- [Troubleshooting](#troubleshooting)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [Built on OpenCode](#built-on-opencode)
- [Attribution & License](#attribution--license)

---

## What is Amicus

One install delivers four things that work together:

- **The `second-opinion` LLM Council skill.** Structured multi-model review: independent reviews → anonymized peer cross-review → a non-Claude chair verdict → tiered accept/deny decisions. This is the hero.
- **The `sidecar` chat skill.** Ad-hoc fork/work/fold — spin up one other model in a real window (or headless), work alongside it, fold the summary back.
- **The `amicus` CLI (with an `am` alias) and an MCP server.** The engine underneath both skills: launches sessions, shares context, runs parallel waves, and exposes the same surface to Claude as MCP tools.
- **A self-updating model catalog.** Aliases and validation resolve against a live catalog fetched from provider APIs (cached locally), so model names stay current without a hard-coded table.

Claude is the orchestrator. The council and chat skills run *on top of* the engine; you talk to Claude, and Claude drives Amicus.

![What one install delivers: council skill, chat skill, CLI + MCP, live catalog](./docs/what-is-amicus.png)

---

## Quick start

> **Two install channels — read this first.** Amicus ships two ways, and CLI commands look different in each:
>
> - **npm global** (`npm install -g amicus` or the install script) puts `amicus`/`am` on your `PATH`. Every `amicus <command>` example in this README works as written.
> - **Claude Code plugin** (`/plugin install amicus@bourbondog-amicus`) does **not** put a CLI on your `PATH`. CLI calls go through `npx -y amicus@latest <command>` instead — e.g. `amicus doctor` becomes `npx -y amicus@latest doctor`. In exchange, the plugin channel gets two things npm does **not**: the slash commands `/amicus:council` and `/amicus:sidecar`. **These are plugin-channel-ONLY — npm users don't get them** and drive the same skills by saying "council review this" / talking to Claude instead.
>
> **Convention used throughout this README:** plugin-channel users: prefix CLI examples with `npx -y amicus@latest` (skip the bare `amicus`/`am`). Individual code blocks are not duplicated per channel — this note is the one translation you need.

**Install** — pick whichever fits. Every path delivers the MCP server and both skills; the `amicus`/`am` CLI lands on your PATH with the **npm and install-script paths** (the plugin path runs the CLI on demand via `npx -y amicus@latest <command>`):

**As a Claude Code plugin** — the most native path if you use Claude Code:

```text
/plugin marketplace add BourbonDog/amicus
/plugin install amicus@bourbondog-amicus
/reload-plugins
```

Claude Code registers the MCP server and both skills for you — nothing to configure. It also gets you two slash commands the npm/install-script paths don't: **`/amicus:council`** (run a full council review) and **`/amicus:sidecar`** (fork a conversation to another model). (The plugin does not put `amicus` on your PATH — CLI calls go through `npx -y amicus@latest <command>`; the standalone Electron window is npm-only; and the first council/sidecar call downloads the OpenCode engine.)

**With the install script** — macOS, Linux, or Windows (needs [Node.js](https://nodejs.org) ≥ 18):

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/BourbonDog/amicus/main/install.sh | sh
```

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/BourbonDog/amicus/main/install.ps1 | iex
```

**With npm** — the canonical path (needs [Node.js](https://nodejs.org) ≥ 18):

```bash
npm install -g amicus
```

For the **npm** and **install-script** paths, a postinstall auto-configures everything — no manual registration:

- Registers the **MCP server** in Claude Code and in Claude Desktop / Cowork, so the Amicus tools appear natively.
- Installs **both skills** into `~/.claude/skills/` — `second-opinion` (the council) and `sidecar` (the chat skill).

**Configure:**

```bash
amicus setup
# plugin-only install (no CLI on PATH):
npx -y amicus@latest setup
```

This opens a graphical wizard:

| Step | What it does |
|------|--------------|
| **1. API Keys** | Enter keys for OpenRouter, Google, OpenAI, Anthropic, and/or DeepSeek. Each is validated live against the provider's API. Written to `~/.config/amicus/.env` with `0600` permissions. |
| **2. Default Model** | Pick your go-to model from a searchable live picker (backed by the catalog). Used whenever you omit `--model`. |
| **3. Model Routing** | Decide which provider serves each model — e.g. route Gemini through a direct Google key and everything else through OpenRouter. |
| **4. Review** | Confirm the configuration before saving. |

> **Headless environments:** if Electron can't open a window, the wizard falls back to a readline-based setup in the terminal.

**Your first council** — no flags to learn. In Claude Code or Cowork, give Claude a document and say:

> *council review this*

Plugin-channel users can also type **`/amicus:council`** directly instead of phrasing it as a request — same skill, explicit invocation.

Claude prepares the material, recommends a bench of models, discloses the run shape and cost, and orchestrates the rest. You make the accept/deny calls at the end. (The `second-opinion` skill is what teaches Claude to recognize this — if nothing happens, run `amicus doctor` (or `npx -y amicus@latest doctor`). npm/install-script installs place the skill at `~/.claude/skills/second-opinion/`; plugin installs keep it inside the plugin itself — check `/plugin` in Claude Code to confirm amicus is enabled.)

**Your first sidecar.** The sidecar is the lower-level path — you can invoke it by phrase through Claude too, but the CLI gives you the flags directly:

```bash
amicus start --model gemini --prompt "Fact-check the auth approach Claude just proposed"
```

A window opens alongside your editor with Gemini ready, pre-loaded with your conversation. Work with it, then **Fold** the summary back.

### Install from GitHub

The npm package is the primary path. To install straight from the repo instead — the postinstall runs **identically** (same MCP registration, same two skills) — you just need `git` on your `PATH`:

```bash
npm install -g github:BourbonDog/amicus
```

See [Requirements & Dependencies](#requirements--dependencies) for the full prerequisite list.

### Contributor setup

Cloning to develop Amicus? See **[CONTRIBUTING.md](./CONTRIBUTING.md)** for the dev setup, git-hook wiring, and test commands.

---

## Requirements & Dependencies

Everything you need before your first run, and what's optional.

**Runtime**

- **Node.js ≥ 18** — `node --version` to check. This is the only hard runtime prerequisite.
- **An active Claude Code or Cowork session** — Amicus is orchestrated by Claude; it is not a standalone chatbot.

**Install path & the git toolchain**

- **From the npm registry (recommended):** `npm install -g amicus`. No build toolchain required — the package ships prebuilt.
- **From GitHub:** `npm install -g github:BourbonDog/amicus` runs **identically** — same MCP registration, same two skills, same postinstall. The one extra requirement is a working **git** on your `PATH`, since npm clones the repo to install it (`git --version` to check).

**Model API keys** — at least one is required

- **OpenRouter** covers the most models with one key, or use a **direct Google / OpenAI / Anthropic / DeepSeek** key. Add one with `amicus setup` or `amicus key <provider> <key>`; keys live in `~/.config/amicus/.env`. The supported env vars are `OPENROUTER_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` (the legacy `GEMINI_API_KEY` is still accepted), `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `DEEPSEEK_API_KEY`.
- ⚠️ **OpenRouter keys need purchased credits.** A brand-new, zero-credit key *passes* setup's live validation but then fails at runtime with a **402** on the first real call. Buy a small amount of credit before you run a council.

**Electron — optional (GUI only)**

- Electron is an **optional** dependency. It powers the graphical setup wizard and the parallel sidecar window. **Headless runs and the full council work without it** — if Electron is absent or can't open a window, `amicus setup` falls back to a readline wizard and sidecars run headless. `amicus doctor` reports Electron's presence accurately and never treats its absence as fatal.

**The OpenCode engine**

- The bundled **`opencode-ai`** engine (the conversation runtime) installs automatically as a normal dependency — you don't install it separately. Its own postinstall lays down ~11 per-platform binaries; a **transient** failure there (a spawn `ENOENT`, or an antivirus file-lock) can roll back the atomic install. If install fails partway or `amicus doctor` reports the OpenCode binary "not found", just **re-run** `npm install -g amicus` (clear the cache first if it persists: `npm cache clean --force`).

**OS support**

- **Windows 11, macOS, and Linux** are all supported; Amicus is first-class on **Windows** (developed and tested there, no WSL required). See the [Windows](#windows) section for platform specifics.

**What a run costs.** A sidecar is a single model call. A full council is typically **~5–8 paid model calls** (e.g. 3 reviewers across 2 fan-out waves + 1 chair). Amicus shows an estimate before each council and enforces a built-in budget gate that refuses ultra-expensive models (o3-pro class) unless you opt in with `--no-cost-gate`. You pay your providers directly for the tokens; Amicus itself is free and open-source.

---

## The Council

> Trigger it by saying *"council review this"* to Claude, or, on the plugin channel, run **`/amicus:council`** directly.

**Why multi-model.** Any single model — including the one running your session — has consistent blind spots. Route the *same* material through models from *different* families and the disagreements surface: missed issues, overstated confidence, claims one model alone would have waved through. The council is the structured version of that idea.

**The flow, in five beats:**

1. **Independent reviews.** Each council model reviews the artifact on its own (one parallel wave), producing a structured findings list — claim, severity (`blocker | major | minor | nit`), location, rationale.
2. **Anonymized cross-review.** Claude relabels every review (Review A, B, C…) and sends the identical bundle to every model. Each model ranks the reviews and adjudicates every finding (`agree | dispute | neutral`) — *unknowingly judging its own*, so self-bias washes out. This yields a **street-cred** ranking and sorts findings into **Disputed / Confirmed / Contested / Singleton** tiers.
3. **Chair verdict.** A designated **non-Claude** chair receives the de-anonymized picture — all reviews, rankings, and adjudications — and synthesizes an independent verdict. Claude presents it verbatim; Claude does not synthesize.
4. **Tiered decisions.** Confirmed findings get one bulk accept/deny; Contested and Singleton findings are decided one at a time (accept / deny / modify).
5. **Outputs applied.** Accepted findings are written into a reviewed copy of the source; the full run is captured in the run folder.

**What a run produces** (in `output/<stem>-council/`):

- `review-<model>.md` × N — each model's independent review.
- `crossreview-matrix.md` — the adjudication grid plus the de-anonymized street-cred table.
- `verdict.md` — the chair's synthesis.
- `report.md` — synthesis + the full decision log + a per-call run-stats table.
- `report.html` — the deterministic renderer output (adjudication matrix, street-cred table,
  findings-by-tier, cost — no chair prose). This is the default artifact handed to the user.
- For an **editable source**, the accepted edits land in `<stem>-reviewed.<ext>` next to the original.

**Claude in the council** (default off): you can add Claude's own fresh review to the bundle so the bench ranks and adjudicates it — Claude is *judged* but never votes or chairs, so the verdict stays independent.

**Cost is disclosed up front.** Before any model launches, you see the run shape — for example:

> This run uses 3 council models across 2 fanout waves + 1 chair call (~7 model runs).

Then the council waits for your confirmation.

The skill lives at **[`skills/second-opinion/SKILL.md`](./skills/second-opinion/SKILL.md)**; the design spec behind it is **[`skills/second-opinion/COUNCIL-DESIGN.md`](./skills/second-opinion/COUNCIL-DESIGN.md)**. For what `amicus council tally|verdict|report|stats` actually take as input and produce — field-by-field schemas, verdict.json's provenance, and a full worked example run against the real CLI — see **[docs/council.md](./docs/council.md)**.

**Free council (zero-cost).** Want the cross-examination without the model spend? `amicus setup` offers a **Free OpenRouter council** mode — readline wizard option 2, and the Electron **Models** step. It detects the free `:free` models live from the catalog, lets you multi-pick (Enter takes a vendor-diverse default), and saves them as `councils.free` — a first-class `councils` config primitive seeded under collision-safe `free-*` aliases. Your `config.default` is left untouched, and all you need is an `OPENROUTER_API_KEY`.

Run it anywhere a council runs:

```bash
amicus fanout --council free --prompt "Review this design"
```

The `amicus_fanout` MCP tool takes the same `council` parameter, and the `second-opinion` skill reads `councils.free` automatically. A member that gets delisted is dropped with a warning — the council still runs as long as ≥2 survive. Free models are **rate-limited and quality-variable**, and some return 404 unless you enable data-sharing at [openrouter.ai/settings/privacy](https://openrouter.ai/settings/privacy).

**Council presets.** Save your own named member lists with `amicus council save <name> --models a,b,c` (≥2 resolvable aliases or `provider/model` IDs), then run them with `--council <name>` anywhere a council runs. `amicus council list` shows saved presets plus three built-in benches that work with no setup at all — `free` (the same zero-cost dynamic pick described above, used when you haven't seeded `councils.free`), `budget` (cheap workhorses, one per vendor family), and `frontier` (premium flagships, one per vendor family). `amicus council show <name>` resolves any of them (saved or built-in) and reports which members are currently usable. A saved council always shadows a built-in of the same name — exactly how the wizard's `councils.free` seeding already worked.

---

## The parallel window

When you don't need a full council — just one other model's take — fork a conversation. Amicus extracts your current Claude Code context, opens a session pre-loaded with it, you **work** alongside it, and you **fold** a structured summary back into Claude's context when you're done.

**Interactive (default):** a real window opens next to your editor. Switch models mid-conversation with the model switcher, then click the **FOLD** button (or press `Cmd+Shift+F`) to generate the summary. Customize the shortcut with `--fold-shortcut`.

**Headless (`--no-ui`):** the agent works autonomously and emits the fold summary when it finishes — ideal for bulk work like test generation or documentation. Pair with `--json` for a machine-readable run document.

**How the fold handoff actually works.** A fold is a summary handoff, not a live handback — once you fold, the sidecar model's context is gone. Mechanically: clicking **FOLD** asks the model for a structured summary, then writes it to the Electron process's stdout as a `[SIDECAR_FOLD]`-tagged block; the amicus runner that spawned Electron captures that stdout and persists it as the session's `summary.md` (under the session directory, alongside `metadata.json` and `conversation.jsonl`). Nothing pushes the result back to you automatically — your orchestrating agent picks it up on request, via `amicus read <taskId>` (CLI) or the `amicus_read` MCP tool. Either path returns the summary wrapped in an `<untrusted_sidecar_output>` fence, since it's prose from another model entering your context and should be treated as data, not instructions.

**Context sharing.** Your conversation history is passed automatically. Tune it:

- `--context-turns <N>` — max conversation turns to include (default 50).
- `--context-since <duration>` — time window (e.g. `2h`); overrides turns.
- `--context-max-tokens <N>` — cap the context size (default 80000).
- `--no-context` — skip parent history entirely.

**MCP inheritance.** Amicus discovers the MCP servers your Claude Code session uses and passes them through, so the forked model has the same tools you do. Control it:

- `--no-mcp` — don't inherit any parent MCP servers.
- `--exclude-mcp <name>` — drop a specific server (repeatable).
- `--mcp <name=url|name=command>` — add one.

**Safety.** Amicus warns on **file conflicts** (a file changed externally while the session ran) and on **context drift** (the shared context may be stale relative to your current session), so a fold never silently overwrites newer work.

**Auto-update.** Amicus checks the npm registry at most once every 24 hours (cached background check). When an update exists, the CLI prints a notice and the Electron toolbar shows a one-click **Update** banner. Or run it yourself:

```bash
amicus update
```

![The parallel-window architecture: fork, work, fold](./docs/architecture.png)

---

## Commands

| Command | What it does |
|---------|--------------|
| `amicus start` | Launch a new session (interactive or `--no-ui`). |
| `amicus fanout` | Run N models on the same prompt in parallel (headless). |
| `amicus list` | Show previous sessions. |
| `amicus resume` | Reopen a previous session with full history. |
| `amicus continue` | Start a new session building on a previous one. |
| `amicus read` | Output a session's summary / conversation / metadata. |
| `amicus status <id>` | One-shot status for a session or fan-out wave (human or `--json`; `--wave <id>` alternative spelling). |
| `amicus models` | List, search, refresh the catalog, or audit aliases. |
| `amicus doctor` | Diagnose your setup — keys, default model, catalog, aliases, OpenCode binary, Electron, skills, MCP registration, OpenRouter credit (`--json`; `--fix` self-heals what it can). |
| `amicus spend` | Cross-run cost rollup from the spend ledger — total + per-model spend, tokens, and source mix, most-expensive first (`--since 7d` windows it; `--json` for a versioned doc; shows remaining OpenRouter credit when a key is configured). |
| `amicus key` | Manage API keys non-interactively: `amicus key <provider> <key>` saves after live validation; `--remove`; bare `amicus key` lists providers. |
| `amicus council` | Council math: `tally <input.json>` (deterministic tiers + ledger append), `stats` (reviewer reliability), `report <verdict.json> [--md\|--html]`, `validate <file>` (findings-block check, exit 0/2/1), `verdict <tally.json> [--decisions <d.json>] [-o <out.json>]` (build + write verdict.json). Presets: `save <name> --models a,b,c`, `list [--json]`, `show <name> [--json]` — see [The Council](#the-council) for the built-in `free`/`budget`/`frontier` benches. |
| `amicus abort` | Abort a running session (or `--all`). |
| `amicus setup` | Configure default model, API keys, and aliases. |
| `amicus update` | Update to the latest version. |
| `amicus mcp` | Start the MCP server (stdio transport). |

The `am` alias is interchangeable with `amicus` everywhere.

**Every flag, every subcommand, every example** — including the full `amicus start` option table, `amicus fanout` (supports `--session-id`, `--council <name>` as an alternative to `--models`), council presets, and every other command — lives in **[docs/usage.md](./docs/usage.md)**, the canonical CLI reference. What follows here is just enough to see the shape of a run.

`amicus status <id>` output. Human-readable:

```
$ amicus status demo123
Task:     demo123
Status:   complete (terminal)
Elapsed:  5m 0s
Model:    google/gemini-2.5-flash
```

`--json`:

```
$ amicus status demo123 --json
{
  "taskId": "demo123",
  "status": "complete",
  "elapsed": "5m 0s",
  "version": "2.0.0",
  "model": "google/gemini-2.5-flash",
  "phase": "terminal"
}
```

`amicus list --status` accepts `running`, `complete`, `error`, `timed-out`, `aborted`, `crashed`, `idle-timeout`. Full field-by-field docs (a running session's `messages`/`STALLED` reporting, wave-ID status shape, etc.) are in [docs/usage.md](./docs/usage.md).

---

## Models

Amicus does **not** ship a frozen table of model names. Aliases and validation resolve against a **live catalog** fetched from provider APIs and cached at `~/.config/amicus/model-catalog.json` (24-hour TTL; the fetch works without an API key). Run `amicus models` to see exactly what resolves on *your* machine — that's the source of truth, not this README.

```bash
amicus models                 # list the catalog
amicus models --search gemini # filter by substring
```

`start`/`fanout` validate your model against the catalog before launching (skip with `--no-validate-model`). You can also always bypass aliases and pass a full `provider/model` or `openrouter/provider/model` ID directly. Catalog internals, alias management, and the full-id passthrough table are in **[docs/usage.md § Models](./docs/usage.md#amicus-models--the-model-catalog)**.

---

## MCP integration

The MCP server is auto-registered on install (Claude Code and Claude Desktop / Cowork). It exposes fourteen tools:

| Tool | What it does |
|------|--------------|
| `amicus_start` | Spawn a session; returns a task ID immediately. |
| `amicus_status` | Poll a task (or a fanout wave) for completion. |
| `amicus_wait` | Block inside one tool call until a session/wave finishes or the wait window closes. |
| `amicus_read` | Read results: summary, conversation, metadata, or JSON. |
| `amicus_list` | List past sessions. |
| `amicus_resume` | Reopen a session. |
| `amicus_continue` | New session building on a previous one. |
| `amicus_abort` | Stop a running session. |
| `amicus_setup` | Open the setup wizard. |
| `amicus_guide` | Return usage guidance (model choice, briefings, polling). |
| `amicus_fanout` | Launch a same-prompt wave; returns `{ waveId, taskIds[] }`. |
| `amicus_council_tally` | Aggregate a council wave's reviews into a scored tally. |
| `amicus_council_stats` | Reviewer-reliability stats from past council runs. |
| `amicus_verdict` | Build the final council verdict from a tally + decisions. |

The async pattern is **start → status → read** — `amicus_start`/`amicus_fanout` return immediately, then you poll `amicus_status` and call `amicus_read`; `amicus_wait` collapses that poll loop into one blocking call.

> Legacy `sidecar_*` tool names were removed entirely in v2.0.0 — only `amicus_*` tools exist now. `AMICUS_LEGACY_ALIASES=1` is a no-op left over from the v1.8.0 opt-in switch. See [docs/SHIMS.md](./docs/SHIMS.md).

Manual registration and per-tool detail are in **[docs/usage.md § MCP Server](./docs/usage.md#mcp-server)**.

---

## Configuration

`amicus setup` is the recommended way to configure Amicus — it writes API keys to `~/.config/amicus/.env` (`0600`) and persists your default model and aliases. Every environment variable (API keys, behavior tuning, headless poller, GUI/debug, process lifecycle) is documented in **[docs/configuration.md](./docs/configuration.md)**. v2.0.0 removed the legacy `SIDECAR_*` → `AMICUS_*` env-var mapping entirely; see [docs/SHIMS.md](./docs/SHIMS.md) for the removal record and rename table.

**New to the disk footprint?** The config tree's file-by-file contents, session storage layout, where (and whether) logs are written, `config.json`'s exact shape, and full uninstall instructions all live in **[docs/configuration.md § Where things live](./docs/configuration.md#where-things-live)**.

---

## JSON output

With `--json`, Amicus emits stable, versioned run/wave documents on stdout — built for scripting and agent consumption:

```json
{
  "taskId": "...", "model": "...", "modelInput": "...", "agent": "...",
  "status": "complete", "summary": "...", "error": null,
  "createdAt": "...", "completedAt": "...", "durationMs": 0
}
```

The wave-document shape (for `fanout`), field meanings, and the full exit-code table are in **[docs/usage.md § JSON Output](./docs/usage.md#json-output)**.

---

## Windows

Amicus is **first-class on Windows** — developed and tested on Windows 11, no WSL required.

Most Claude-adjacent tooling assumes macOS/Linux; Amicus doesn't.

- The full unit suite runs green on Windows 11.
- Native-binary PATH handling resolves the OpenCode binary correctly under Windows.
- Session-path encoding is handled natively (the Claude project-path encoding that trips up naive `~/.claude/projects` lookups is accounted for).
- For long briefings, `--prompt-file` sidesteps the ~32 KB Windows command-line argument cap.

---

## Troubleshooting

Run `amicus doctor` first — it checks keys, catalog, OpenCode binary, Electron, skills, and MCP registration in one pass and prints a targeted fix for whatever's failing. For symptoms not covered below, or more diagnostic depth on any of these, see **[docs/troubleshooting.md](./docs/troubleshooting.md)**.

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| "council review this" does nothing | The `second-opinion` skill isn't installed | Check `~/.claude/skills/second-opinion/SKILL.md` exists; re-run `npm install -g amicus` (postinstall installs both skills) |
| `npm install -g amicus` fails with `EEXIST: … claude-sidecar` | The old upstream `claude-sidecar` package is still installed globally; npm won't overwrite another package's bin shims | `npm uninstall -g claude-sidecar`, then `npm install -g amicus`. Your keys and past sessions are not lost, but v2.0.0 no longer reads the old paths automatically — see [docs/SHIMS.md](./docs/SHIMS.md) for the one-time migration steps (rename `~/.config/sidecar/` and any `.claude/sidecar_sessions/` dirs). |
| Install fails partway, or `amicus doctor` reports the OpenCode binary "not found" | A **transient** error during the OpenCode engine's own postinstall (a spawn `ENOENT`, or an antivirus file-lock while it lays down its 11 per-platform binaries) can roll back the whole atomic install — retrying usually succeeds | Just re-run `npm install -g amicus`. If it still fails, clear the cache first: `npm cache clean --force && npm install -g amicus`. |
| `401` / auth error | API key missing, or the model prefix doesn't match the key you have | Run `amicus setup`; make sure the prefix (`openrouter/…` vs `google/…` vs `openai/…` vs `anthropic/…`) matches the credentials you configured. |
| `402` / "Payment Required" on first council review / `start` / `fanout` call | Your OpenRouter key is real but has no credit. Key save (`amicus key openrouter <key>` or the setup wizard's key step) only checks that the key **authenticates** — it doesn't check balance, so a zero-credit key saves cleanly and only fails later, on the first real model call. (The `amicus council` subcommand itself is deterministic math and never calls a model.) | Add credit at [openrouter.ai/credits](https://openrouter.ai/credits), **or** switch to a zero-cost council: `amicus setup` → option 2 (Free OpenRouter council) builds one from live `:free`-suffixed models and saves it as `councils.free` — then run `amicus fanout --council free …`. See "Free council (zero-cost)" under [The Council](#the-council) above. |
| Session not found | No session matches the given ID | Run `amicus list`, or omit `--session-id` to use the most recent. |
| No conversation history found | Project-path encoding | Check `~/.claude/projects/`; `/` and `_` in the project path are encoded as `-` in the directory name. |
| Headless run never finishes | Task is bigger than the default timeout | Raise it: `--timeout 30`. |
| Wrong session picked up | Multiple active sessions resolve ambiguously | Pass `--session-id` explicitly. |
| Fold summary looks corrupted | Debug output leaking into stdout | Re-run with `LOG_LEVEL=debug` to see what's printing. |
| Model fails catalog validation | The model isn't in the cached catalog (renamed, or cache stale) | `amicus models --refresh`, or bypass with `--no-validate-model`. |
| `fanout` exits `2` | Partial wave — at least one leg failed | Read the wave document's `legs[]` and inspect each failed leg's `status` / `error`. |

**Debug logging:**

```bash
LOG_LEVEL=debug amicus start --model gemini --prompt "test" --no-ui
```

---

## Documentation

| Doc | Description |
|-----|-------------|
| [docs/usage.md](./docs/usage.md) | The complete CLI & MCP reference — every flag, every subcommand, every example. |
| [docs/council.md](./docs/council.md) | Council pipeline reference: `tally`/`verdict`/`report` schemas, provenance, and a worked example. |
| [docs/configuration.md](./docs/configuration.md) | Full configuration and environment reference. |
| [docs/architecture.md](./docs/architecture.md) | How the engine, Electron shell, and context sharing fit together. |
| [docs/opencode-integration.md](./docs/opencode-integration.md) | How Amicus drives the OpenCode runtime. |
| [docs/troubleshooting.md](./docs/troubleshooting.md) | Extended troubleshooting. |
| [docs/electron-testing.md](./docs/electron-testing.md) | Chrome DevTools Protocol patterns for UI testing. |
| [docs/testing.md](./docs/testing.md) | Test suite layout and how to run it. |
| [docs/publishing.md](./docs/publishing.md) | Release and publish process. |
| [docs/SHIMS.md](./docs/SHIMS.md) | v2.0.0 removal record for the pre-rebrand `sidecar*` compatibility shims — what was removed and how to migrate. |
| [skills/second-opinion/SKILL.md](./skills/second-opinion/SKILL.md) | The LLM Council skill. |
| [skills/sidecar/SKILL.md](./skills/sidecar/SKILL.md) | The `sidecar` chat skill. |
| [evals/README.md](./evals/README.md) | End-to-end eval harness for LLM interactions. |

---

## Contributing

Contributions are welcome. The dev setup, git-hook wiring, and test commands live in **[CONTRIBUTING.md](./CONTRIBUTING.md)**.

The autonomous Electron-UI testing approach (driving the real window over the Chrome DevTools Protocol) is documented in **[docs/electron-testing.md](./docs/electron-testing.md)**.

---

## Built on OpenCode

Amicus is a harness built on top of [**OpenCode**](https://opencode.ai), the open-source AI coding engine. OpenCode provides the conversation runtime, tool-execution framework, agent system, and web UI. Amicus adds context sharing from Claude Code, the Electron shell, the fold/summary workflow, session persistence, parallel fanout waves, the multi-model council, and multi-client support (CLI, MCP, Cowork). OpenCode handles the hard parts of LLM interaction so Amicus can focus on the council-and-parallel-window workflow.

---

## Attribution & License

Amicus is inspired by [**Claude Sidecar**](https://github.com/jrenaldi79/sidecar) by [John Renaldi](https://github.com/jrenaldi79), used under the MIT License. The original copyright (© 2025 John Renaldi) is preserved in full in [LICENSE](./LICENSE). The engine modifications, the multi-model council, and the skill bundling are © 2026 Christian Wagner, also under the MIT License. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE) for the complete attribution.

**MIT.**

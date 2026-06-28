# Changelog

All notable changes to Amicus are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow semver.

## [Unreleased]

### Added
- **Free OpenRouter council**: a new `amicus setup` option (readline wizard + Electron Models step)
  that stands up a zero-cost council of free `:free` OpenRouter models, saved as a first-class
  `councils` config primitive. Run it with `amicus fanout --council free` or the `amicus_fanout` MCP
  `council` param; the second-opinion skill reads `councils.free`. Free-model picks are detected
  live from the catalog (the `:free` suffix is authoritative), seeded under collision-safe `free-*`
  aliases, and a delisted member degrades gracefully (dropped with a warning) instead of failing the
  wave. Needs only an `OPENROUTER_API_KEY`; the wizard discloses the free-tier caveats (rate limits,
  variable quality, the OpenRouter data-sharing prerequisite). `config.default` is left untouched.

## [1.3.0] - 2026-06-24

Making the mature council/fan-out engine legible: live per-leg progress, cost
surfaced in human output, the deterministic council spine reachable over MCP,
and a shareable verdict/disagreement report. Every change is presentation over
data the engine already records — no schema change.

### Added
- **Live per-leg fan-out progress**: a running `amicus fanout` now prints a per-leg rollup on each
  heartbeat — every model's stage, message count, and latest action — instead of a generic "still
  running". `amicus_status` reports per-leg `latestActivity` plus a `stalled` flag, so you can see
  at a glance which model is working, which is quiet, and which is wedged.
- **Cost in human output**: the `amicus fanout` / `amicus read` human view now shows a per-leg `$`
  cost cell and a `Wave cost:` total, and `amicus council tally` shows a run cost line. Each figure
  is tagged by source (reported, `~` estimated, `?` unknown) so it can never be mistaken for an
  authoritative number it isn't — surfaced straight from the existing usage telemetry.
- **Council over MCP**: three new MCP tools — `amicus_council_tally`, `amicus_council_stats`, and
  `amicus_verdict` — expose the deterministic council spine (peers-only tier cascade, street-cred,
  the reliability ledger, and verdict merge) to Claude directly, with no Bash round-trip.
- **`amicus council report`**: render a shareable disagreement + verdict report from a
  `verdict.json` — the adjudication matrix (finding × judge), peers-only street-cred, findings
  grouped by tier (Disputed first), and per-model + wave cost — as Markdown (`--md`, default) or a
  self-contained HTML page (`--html`). Pass `--wave <wave.json>` to fold in the wave-level cost
  total. The council skill's Stage-5 step now drives this renderer instead of hand-assembling the
  report.

## [1.2.1] - 2026-06-24

### Fixed
- **`amicus models --check` / `amicus doctor` stale deepseek warning is now clearable**: the
  built-in deepseek direct fallback (`deepseek/deepseek-chat`) has been updated to
  `deepseek/deepseek-v4-pro`. Additionally, stale curated-route warnings are now suppressed when
  the same alias already resolves live via any other source (default openrouter route or a
  user-set alias), so the suggested `--add-alias` fix actually clears the warning instead of
  leaving it permanently unresolvable.

## [1.2.0] - 2026-06-24

A post-launch enhancement program: reliability and cost made real, the council's
trust machinery turned from hand-math into deterministic code, plus first-run
diagnostics, a Claude Code plugin, and an observable interactive surface.

### Added
- **`amicus doctor`**: a one-screen first-run health check — configured providers, default-model
  resolution vs. the live catalog, catalog freshness, the OpenCode binary, Electron, installed
  skills, and MCP registration. Each red line carries the exact fix command; `--json` lets skills
  self-diagnose.
- **Claude Code plugin**: Amicus is now installable from the marketplace —
  `/plugin marketplace add BourbonDog/amicus` then `/plugin install amicus`. The plugin ships both
  skills and the MCP server; npm stays the engine/CLI. (The plugin channel skips the global
  postinstall via `AMICUS_SKIP_POSTINSTALL` so it can't double-register.)
- **Per-leg cost & token telemetry**: the run/wave schema (now `schemaVersion: 2`) carries a
  `usage` block — input/output/reasoning tokens and a `$` cost tagged by source (reported >
  estimated > unknown). Surfaced in `fanout --json` and council run-stats.
- **Enforced budget gate**: a per-`$/Mtok` threshold (on by default — blocks o3-pro-class models
  before a wave launches) plus an optional `--max-cost` total ceiling. `--no-cost-gate` is the
  explicit escape hatch.
- **`amicus council tally|stats`**: deterministic council scoring — a structured findings
  contract, a peers-only tier cascade with self-vote-corrected street-cred, a compounding
  reviewer-reliability ledger, and a machine-readable `verdict.json`. The council stays a skill;
  the engine owns only the arithmetic and schemas.
- **Structured `--json` error envelope**: pre-flight failures now emit a typed
  `{ ok: false, error: { code, message, hint } }` document on stdout (stable codes like
  `MISSING_KEY`, `BAD_MODEL`, `BUDGET_EXCEEDED`) instead of bare text on stderr.

### Changed
- **Interactive GUI sessions now persist live**: `conversation.jsonl` and `progress.json` are
  written as the session runs, so the CLI heartbeat, `amicus status`, and
  `amicus read --conversation` work for GUI sessions — and **closing the window without folding no
  longer loses the transcript**. Interactive runs also record token/cost usage. (Headless and
  interactive now share one persistence transform.)
- **Reliability**: a single source of truth for terminal state (exit code and `metadata.status`
  always agree; the idle backstop no longer exits 0 with `running` metadata), and an
  activity-driven interactive watchdog that won't kill an actively-working-but-quiet GUI session.
- **CI**: a real matrix (Ubuntu / Windows / macOS × Node 18 / 20 / 22) plus lint, secret-scan, and
  size-gate now gate every push and the publish.
- Repo layout: the chat skill moved to `skills/sidecar/` (both skills live under `skills/`); npm
  `homepage` now points at the live site; README and the landing page gained a "Prerequisites &
  cost" section.

### Fixed
- **MCP stderr fd leak**: `spawnSidecarProcess` opened a `debug.log` descriptor for the child's
  stderr but never closed the parent's copy — a descriptor leak that, on Windows, also held the
  file open and blocked session-dir cleanup.
- Platform-correct missing-key guidance (PowerShell `$PROFILE`/`setx` on Windows; leads with
  `amicus key`); the committed-secret scan now knows all five providers; `amicus models` marks
  your **actual** aliases (not curated defaults); OpenRouter's `-1` "variable pricing" sentinel
  renders as `—` instead of a nonsense negative price.

## [1.1.0] - 2026-06-11

### Added
- **DeepSeek as a direct API provider**: DeepSeek card and API key step in the setup wizard,
  live model fetch from DeepSeek's `/models`, and a direct `deepseek/...` route used
  automatically when no OpenRouter key is configured.
- **`amicus key`**: headless API key management — `amicus key` lists configured providers with
  masked hints, `amicus key <provider> <key>` validates and saves, `--remove` deletes. No GUI
  required.
- **Live quick picks in the setup wizard (Step 2)**: recommended models resolve per family
  against the live catalog when the window opens (no stale pinned ids), with always-visible
  labeled search and a write-preview showing exactly which alias will change.

### Changed
- **Setup wizard finish is now read-modify-write**: picking a model sets the default and
  upgrades only that one alias; untouched aliases are never rewritten and deleted aliases stay
  deleted. (Previously, finishing setup could silently rewrite every card alias.)
- Readline (no-Electron) setup parity: free-form model ids and the same no-clobber behavior.
  `amicus models --check` now also warns when a curated pinned fallback drifts from the live
  catalog.
- Council skill (Stage 6): the proposed MODEL-NOTES diff is written to a run-folder file and
  the approval prompt carries the file path — approval dialogs can hide chat text.
- Chat skill docs: single-model sidecars default to interactive (GUI) mode; headless remains
  the default for fanouts and bulk runs.
- Attribution: npm package author is Christian Wagner; "Inspired by" fork wording in
  CONTRIBUTING.

### Fixed
- **Electron preload crash on every page**: `window.sidecar` (contextBridge) is now exposed
  before DOM injection, and the injected CSS guards against a null `documentElement` — the
  silent TypeError previously killed both the bridge and the anti-white-flash styling.
- DeepSeek provider pill showed `undefined` in the wizard model step.

## [1.0.0] - 2026-06-10

Everything since the fork from upstream `claude-sidecar` v0.5.2 — the Amicus launch line.

### Added
- **LLM Council** (`skills/second-opinion/`): structured multi-model review — independent
  reviews, anonymized peer cross-review with street-cred scoring, non-Claude chair verdict,
  tiered accept/deny decisions. v3 runs natively on the fanout/JSON engine primitives.
- **`amicus fanout`**: run N models on one prompt in parallel over a single shared engine
  server; stable JSON wave output (`schemaVersion: 1`), exit codes 0/2/1.
- **`amicus models`**: live OpenRouter model catalog (TTL cache, keyless fetch) with search,
  refresh, and alias auditing (`--check` suggests replacements for stale aliases). Model
  validation on `start`/`fanout`/`continue`/`resume` (`--no-validate-model` to skip).
- **`--prompt-file`** (start/fanout): briefings from a file — no shell quoting, no Windows
  ~32 KB argument cap. **`--json`** structured output for `start` and `read`.
- **`amicus abort --all`**; searchable live model picker in the setup wizard; catalog seeding on
  first-run setup; GUI load failsafe (`AMICUS_GUI_LOAD_TIMEOUT_MS`).
- Council ships in the npm package and installs to `~/.claude/skills/second-opinion/`
  (MODEL-NOTES is seeded once and never overwritten — it's user data).

### Changed
- **Rebranded** `claude-sidecar` → `amicus` (bins `amicus`/`am`; MCP tools `amicus_*`; config
  `~/.config/amicus`; env `AMICUS_*`). Every legacy `sidecar*` form still works as a deprecated
  shim — see `docs/SHIMS.md`.
- Headless reliability: activity-aware completion (quiet tool-call gaps no longer end runs
  early), absolute `--timeout` enforcement, OpenCode idle-status as authoritative completion,
  dead-server fast-exit.
- Windows is first-class: the full unit suite is green on Windows 11; session-path encoding,
  path-separator, and native-binary PATH bugs fixed; process lifecycle (abort/teardown) works
  cross-platform.

### Fixed
- Orphaned sessions and zombie servers on abort (cross-platform PID capture + graceful
  teardown with force-exit net); broken `codex`/`grok` aliases (validation now catches stale
  aliases); update checks (ESM updater loading); session-dir gitignore leak.

### Attribution
Amicus is an independent MIT fork of [Claude Sidecar](https://github.com/jrenaldi79/sidecar)
by John Renaldi. See `LICENSE` and `NOTICE`.

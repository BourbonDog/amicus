# Changelog

All notable changes to Amicus are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow semver.

## [Unreleased]

## [1.7.5] - 2026-07-01

A batch of fixes from an independent DeepSeek V4 Pro code review, each verified against source.

### Fixed
- **Long prompts no longer truncate on Windows.** The `amicus_start` and `amicus_continue` MCP
  handlers passed the full prompt inline on the spawned command line, which silently truncated once
  it crossed Windows's ~32 KB argument cap — so a sidecar could run against a corrupted briefing with
  no error. Both paths now write the prompt to a `briefing.md` in the session directory and pass
  `--prompt-file`, matching the existing fanout handler; the CLI `continue` command learned
  `--prompt-file` as well.
- **`getMessages` no longer masks SDK error responses.** An error-shaped response with no `data`
  array was indistinguishable from "zero messages" in the poll loop; it now logs a warning carrying
  the session id and surfaced error while still returning `[]`.
- **`getSessionDir` rejects path-traversal task ids.** A defense-in-depth containment guard (the same
  check style used elsewhere in the codebase) throws on a task id that would escape the sessions dir.
- **Cross-platform `auth.json` discovery.** The one-time OpenCode key-import path was hardcoded to the
  Unix XDG location; it now probes `$XDG_DATA_HOME`, `~/.local/share`, and `%APPDATA%` (Windows) and
  uses the first that exists.

### Changed
- **The fold-completion marker is harder to spoof.** A bare `[SIDECAR_FOLD]` echoed mid-output (e.g. a
  model reproducing these instructions or summarizing a prior sidecar session) no longer forces a
  premature fold — the marker now completes a run only when it is the final non-empty line of output,
  with the existing idle/timeout fallbacks unchanged so a run can never hang.
- **The conversation-mirror tool-call buffer is bounded.** Capped at 2000 entries with a separate
  dedup set, so a very long tool-heavy session can't grow it without limit.
- **Unknown `--no-*` flags are treated as boolean.** They no longer swallow the following positional
  argument (`--no-x=value` still records its inline value; allowlisted flags are unchanged).
- **`--prompt-file` validation is order-independent.** `validateStartArgs` now resolves the prompt
  source itself, so validation no longer depends on the handler having resolved it first.

### Docs
- **Corrected the `tiktoken` dependency note.** It is declared but unused; token sizing uses a
  `length/4` heuristic. Added caveat comments at both estimators. (Removing the unused dependency is
  tracked as a follow-up.)

## [1.7.4] - 2026-06-30

### Fixed
- **The Electron GUI self-heal survives a stalled `extract-zip` on Node 24.** On some Node 24 boxes the
  bundled `extract-zip@2.0.1` (its latest release — it cannot be bumped) stalls mid-extract: its promise
  never resolves *and* never rejects. Because the self-heal `await`s it, the event loop drains and the
  process exits `0` with a half-extracted `dist/` and **no `electron.exe`** — so the repair looked like it
  "did nothing." Extraction is now hardened two ways: `extract-zip` is bounded by an idle + max timer (a
  stall becomes a caught error instead of a silent hang, and the live timer prevents the premature exit),
  and if it stalls, throws, or produces no files, amicus falls back to a **native OS unzip** (Windows:
  bundled `bsdtar`, then PowerShell `Expand-Archive`; macOS: `ditto`, then `unzip`; Linux: `unzip`, then
  `tar`) — each verified to extract the exact Electron zip that `extract-zip` choked on. Success is still
  reported **only** when the real binary lands on disk (the existing exe-stat verify is unchanged), so no
  path can claim a false repair.

## [1.7.3] - 2026-06-30

### Fixed
- **The Electron self-heal no longer wedges itself.** A repair that was killed or hung mid-run (or a
  pre-1.7.3 build) could leave an orphaned single-flight lockfile, after which *every* subsequent repair
  — including `amicus doctor --fix` and the GUI launch — reported "another electron repair is already in
  progress" and did nothing. The lock now records the holder's PID + timestamp and reclaims an orphaned
  lock (dead holder, older than a 15-minute TTL, or the old empty format), so the GUI can self-heal
  again; a live, recent holder still yields honest contention (no double-extract). The controlled
  download is time-boxed (and the last-resort installer bounded) so a stalled fetch can't recreate the
  stuck lock. **After upgrading, an already-stuck lock clears itself on the next repair.**

## [1.7.2] - 2026-06-30

The Electron self-heal now tells the truth, heals the cases it can, and clearly explains the ones it can't.

### Fixed
- **The Electron self-heal no longer claims success when it didn't heal.** `repairElectron`'s
  installer-fallback path always reported the GUI as "provisioned"/"fixed" even when the binary wasn't
  actually on disk — so `amicus doctor --fix` and the install-time prewarm could falsely report
  success. Every self-heal / provision path now declares success **only** when the Electron binary is
  verified present on disk.

### Changed
- **The GUI repair is now controlled and introspectable.** Instead of blindly re-running Electron's own
  installer (the postinstall npm had already silently suppressed), the repair downloads and extracts the
  binary itself (via `@electron/get`) and verifies the result; a corrupt cached download is cleared and
  re-fetched once.
- **Antivirus quarantine is detected and explained, not retried forever.** When Windows Defender / AV
  removes `electron.exe` right after extraction (the common Windows failure), amicus now tells you to
  allow-list the binary and re-run `amicus doctor --fix`, instead of silently looping a repair that
  cannot win.
- **Clear, actionable error when the OpenCode engine binary is missing.** The engine ships via
  per-platform binaries that npm can silently skip (or AV can quarantine); when it's absent, amicus now
  surfaces a specific instruction (run `amicus doctor`, reinstall, allow-list `opencode.exe`) instead of
  an opaque spawn failure.

## [1.7.1] - 2026-06-30

### Fixed
- **The Electron GUI now shows the current rail-yard brand mark.** The window/taskbar icon, the setup
  wizard's header and footer, and the session toolbar were still rendering the pre-redesign squiggle
  mark; they now use the shipped clay→gold rail-yard mark (matching the site favicon). The inline
  glyphs stay token-bound (clay tracks / gold mainline) so they follow the design system.

## [1.7.0] - 2026-06-30

Electron self-heal, a real `amicus doctor`, and the GUI on the design system — plus MCP/diagnostics correctness.

### Added
- **Electron self-heal.** Amicus now detects a broken or quarantined Electron install (a half-extracted
  or AV-removed binary) and repairs it from the local download cache — **fully offline**. New
  `amicus doctor --fix` heals in place, the GUI lazily provisions itself on first use, and an opt-in
  `AMICUS_PREFETCH_ELECTRON=1` aggressively prewarms it. Install-time provisioning is cache-only (no
  network during `npm install`) and never fails the install.
- **`amicus doctor` is now a recovery hub.** Checks carry copy-paste remediation hints, report
  OpenRouter credit/free-tier status, and warn when the resolved project root looks like an app/install
  directory rather than your repo.
- **Running version in MCP responses.** `amicus_status` / `amicus_guide` now report the running amicus
  version and warn when the on-disk package is newer (restart your MCP client to load it).
- **The GUI is on the design system.** The embedded OpenCode session UI is themed to the clay/gold
  tokens, the load-failsafe error page and window backgrounds are token-driven, and a drift guard keeps
  new hardcoded colors/fonts out of `electron/`.

### Fixed
- **Electron no longer reads "installed" when the binary is missing.** Runtime checks (including
  `amicus doctor` and the GUI launch path) now stat the actual executable instead of trusting
  `path.txt`, so a quarantined/half-extracted Electron is correctly detected — the root cause of the
  silently-broken setup wizard.
- **`amicus_fanout` forwards Cowork session pinning** (`--cowork-process` / parent session) to its
  spawned legs, so context-inheriting fan-outs pin the right parent.
- **`amicus_status` annotation corrected** — it is no longer declared read-only/idempotent, since its
  wave branch updates metadata during crash detection.
- **Wave counts account for crashed / idle-timeout legs** (documented remainder rule), so consumers
  summing the named buckets no longer mismatch the total.

## [1.6.1] - 2026-06-30

Project-directory and session-addressing correctness — agents, sessions, and the interactive GUI now agree on which project they're in.

### Added
- **`AMICUS_PROJECT_DIR` + MCP `roots` support.** When the project is not passed explicitly, the MCP
  server now resolves the working directory from the client's first `file://` workspace root (falling
  back to `AMICUS_PROJECT_DIR`, then the process cwd) — so a stdio MCP server spawned by a desktop
  client no longer roots agents in the app install directory where they can't see your files.
- **Global session index.** `amicus_status` / `amicus_read` / `amicus_list` now consult a global
  `taskId -> project` index on a per-project miss, so a session created in one project is still found
  when looked up from another.
- **Per-command help for the rest of the CLI.** `amicus council --help` (and `continue`, `resume`,
  `doctor`, `setup`, `key`, `mcp`) now print their own scoped usage instead of the full global help.

### Fixed
- **Interactive `--cwd`: follow-up prompts no longer fail "unable to retrieve session."** When the
  launch directory differs from `--cwd` (the normal sidecar-skill pattern), the OpenCode session is now
  scoped to the project directory and the Electron Web-UI route is built from the **server-echoed**
  session directory rather than a guessed one, so turn 2+ resolve correctly.
- **Shared-server MCP sessions are scoped to the project directory** — every create and follow-up call
  carries the directory, so headless MCP sessions are found on a server shared across projects.
- **`amicus_read` surfaces the failure reason** for crashed / timed-out / aborted runs that wrote no
  summary, instead of a bare "No summary available."
- **`amicus_abort`'s "session not found"** now names the resolved project, matching `status` / `read`.
- Internal: a single `canonicalProjectPath()` now normalizes project paths (slash direction, drive-letter
  case, trailing slash, UNC shares) so creation and lookup always agree.

## [1.6.0] - 2026-06-30

Install resilience and council-failure correctness — the first two blocks of the post-1.5 backlog program.

### Added
- **Per-subcommand help.** `amicus <command> --help` now prints only that command's options instead of
  the full global usage; bare `amicus --help` is unchanged.
- **Zero-credit OpenRouter key warning at setup.** Setup now does a non-blocking `GET /api/v1/key`
  check and warns when a key is free-tier or has no remaining credit, so a credit-less key is flagged
  up front instead of 402-ing on the first paid model call.
- **`amicus doctor` engine-recovery guidance.** The opencode-engine check now explains the
  transient install-rollback failure mode and gives copy-paste recovery steps.
- **Postinstall verifies the Electron binary.** When the optional Electron download/extract fails (or
  AV quarantines the binary), the install now prints a clear non-fatal notice that headless runs and
  the council still work — instead of silently leaving a broken GUI to discover later.
- **CI tarball guard.** A new `check:tarball` step asserts every lifecycle-referenced script actually
  ships in the published package, so a future packaging change can't silently drop it.
- **README "Requirements & Dependencies" section** consolidating Node, git, OpenRouter credits, API-key
  env vars, the optional Electron GUI, the bundled opencode engine, and OS support.

### Fixed
- **Council / headless runs no longer report success when every model call fails.** On the shared-server
  MCP path, a run whose calls all errored (e.g. an OpenRouter 402) was finalized as `complete` with a
  0-byte summary, so `amicus_status` showed success and the error was lost. Non-2xx/402 responses are
  now detected at the OpenCode client boundary even when no assistant message is emitted, the
  shared-server finalize routes through the same terminal-state classifier as the CLI, and a failed run
  can never silently default to `complete`; `amicus_read` surfaces the failure reason.
- **`amicus_status` elapsed time** is now bounded by the run's completed/aborted/crashed timestamp
  instead of wall-clock-since-start, so a finished run reports its real duration.
- **`amicus_setup` (MCP)** no longer claims an Electron window appeared when Electron is unavailable —
  it pre-flights and returns an honest error directing you to the headless terminal wizard.
- **Clearer "session not found"** — the message now names the resolved project so you know to pass the
  original `project`.
- **Non-fatal postinstall.** An internal skill-copy / MCP-registration failure no longer exits non-zero
  and rolls back the entire global install; it warns and continues.
- **`github:` install on Windows now runs identically to the registry install.** Removed the
  consumer-facing `prepare` lifecycle that triggered npm's clone→prepare→nested-install→cached-pack
  path (the rollback source); git hooks are still configured for contributors via `postinstall`.

## [1.5.1] - 2026-06-29

A headless-reliability fix for reasoning-heavy models.

### Fixed
- **Gemini (and other reasoning-only models) no longer hang headless with "No Output."** On the
  direct-Google provider path, Gemini 3.x returns its answer as a `reasoning` part with no separate
  `text` part. The conversation mirror only accumulated `text` parts, so it captured zero output, the
  headless completion gates (which key on `output.length > 0`) never fired, and the run burned the full
  timeout — while still billing input/thinking tokens. The mirror now accumulates reasoning into a
  dedicated buffer and promotes it to the output **only when a finished assistant message produced no
  visible text**, so models that emit both a reasoning part and a text part are unaffected (their
  thinking never pollutes the answer). Fixes `--model gemini` / `gemini-pro` and any direct `google/*`
  alias in headless `start`, `fanout`, and council runs.

## [1.5.0] - 2026-06-29

A visual refresh plus a council-reliability fix and a config-dir consolidation.

### Added
- **Amicus design system**: the Electron app (setup wizard, toolbar, fold overlay), the council
  HTML report, and the marketing site now render from one shared token layer (`src/design/tokens.css`
  + a `src/design/tokens.js` loader) — the clay/gold rail-yard brand on a neutral-black ramp, with
  bundled Outfit + IBM Plex Mono fonts. Previously each surface defined its own colors independently;
  the site is pixel-identical to before, now bound to the shared tokens by a drift-guard test.

### Fixed
- **Council reliability ledger now persists.** `amicus council tally` (and the MCP
  `amicus_council_tally`) computed the tally record but never wrote it, so `council-ledger.jsonl`
  stayed empty and `amicus council stats` always reported "No council runs recorded yet." The tally
  finalize step now auto-appends the row(s) — best-effort, so a ledger write failure never fails the
  tally — and a new `--no-ledger` flag computes a record without recording it (e.g. a re-tally).

### Changed
- **Unified config directory.** On startup Amicus now migrates a legacy `~/.config/sidecar` directory
  onto the canonical `~/.config/amicus` once, non-destructively (copy; the legacy dir is kept as a
  backup). This collapses the two-directory split that could let config resolution flip between them
  and orphan your config, catalog, and ledger. A `CONFIG_DIR` override opts out.

## [1.4.0] - 2026-06-28

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

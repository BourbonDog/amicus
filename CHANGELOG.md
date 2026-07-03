# Changelog

All notable changes to Amicus are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow semver.

## [Unreleased]

Phase 17: documentation overhaul (the external docs-review cluster).

### Added
- **`docs/council.md` — the council pipeline documented end-to-end**: the stage flow, the tally-input and
  tally-record schemas field-by-field (test-locked against the real validators), verdict.json provenance,
  presets, and a complete worked example whose every command and output was executed against the binary.
- **"Where things live"** (docs/configuration.md): the full config-dir tree (config.json shape, catalog
  cache + refresh-outcome fields, both ledgers, tmp files and the doctor sweep), per-client session
  storage, log reality (stderr-only — `LOG_LEVEL` never writes a file), and honest uninstall instructions
  covering what `npm uninstall -g` does NOT clean.
- README now leads with the **two install channels** (npm global vs Claude Code plugin, with the
  `npx -y amicus@latest` translation note) and surfaces **`/amicus:council`** in the quick start and
  council sections.

### Changed
- **README restructured for audience separation**: discovery + quick start + compact command table with
  pointers; `docs/usage.md` is now the complete CLI reference (the ~30% duplicated content has one
  canonical home each — nothing was dropped); deep dives live under `docs/`.
- The second-opinion skill's Stage-2 briefing prose reads cleanly again (hardening sentence moved before
  the sentence it interrupted), and `report.md`'s contract is stated once, coherently: `report.html` is
  the deterministic renderer default; `report.md` is the chair-synthesis document that embeds the
  rendered Markdown as one section.

### Fixed
- `amicus council --help` now lists `save`/`list`/`show` (the Phase-16 usage-string omission caught by
  this phase's binary-verification pass).

Phase 16: council & catalog UX — closes GitHub issues #12, #13, and #27.

### Added
- **`amicus council validate <file>` and `amicus council verdict <tally.json>`** — thin CLI wrappers over the
  existing findings-validation and verdict-builder internals, making the second-opinion skill's council
  transport fully deterministic. `validate` exits 0 (ok) / 2 (validation failed) / 1 (bad args); `verdict`
  writes atomically to `-o` (default `./verdict.json`), `--decisions` optional. The skill's Stage-1 and
  Stage-5 instructions now invoke these commands, and the Stage-2 recipe persists the tally record to
  `<run-folder>/tally.json` (previously it existed only on stdout — the verdict step had nothing to read).
- **Council presets: `amicus council save/list/show <name>` + built-in `free`/`budget`/`frontier` benches.**
  Built-ins resolve only when the name isn't in your config (your saved councils shadow them; `list` marks
  shadowing). `free` resolves dynamically against the catalog (pinned offline fallback); `budget` and
  `frontier` are alias-based (cheapest / most premium distinct-vendor picks) so alias drift tooling covers
  them. `show` resolves against the cached catalog, including the dynamic free pick.
- **Per-run cost ledger + `amicus spend`.** Every completed run (headless, interactive, fanout legs)
  appends a best-effort JSONL row (`spend-ledger.jsonl` in the config dir); `amicus spend` rolls up total
  and per-model cost/tokens/source-mix with `--since <N>d` windowing and `--json`, plus an OpenRouter
  remaining-credit footer when a key is configured. Ledger appends can never fail a run.

### Fixed
- **Setup wizard Step 3 (alias editor) now consumes the same TTL-cached catalog as Step 2** (#12) — one
  catalog load for the whole wizard instead of a separate uncached network fetch per run; the redundant
  `fetch-models` IPC channel is removed.
- **Stale catalog data is now labeled** (#13): a failed refresh records the attempt and reason in the cache
  doc (never touching the good data), `amicus models` shows a stale memo when refreshing keeps failing,
  `amicus models refresh` reports failure honestly instead of "Refreshed catalog: 0 models" (and its
  `--json` reports the real stale `fetchedAt` instead of `null`), and the wizard shows a stale hint.
- **The free-council picker is readable** (#27): models grouped by provider with friendly names (raw id as
  the mono secondary line), a roomier scroll area, and a provider count — selection values remain raw model
  ids throughout.

Phase 15: engine correctness sweep.

### Added
- **`amicus_read` paging and size caps.** Responses are capped at ~50KB (default: the TAIL of the content,
  with a truncation notice reporting true byte counts at the start of the body); new optional `offset`,
  `limit`, and `tail` params page through large content. Under-cap reads are byte-identical to before;
  slicing happens before the untrusted-output fence is applied; `metadata` mode is param-exempt but
  defensively capped.
- **Per-tool-call stall detector in headless runs.** A wedged tool call (pending `tool_use`, no result, no
  other progress for `AMICUS_TOOL_CALL_STALL_MS`, default 3 min) now fails fast with a distinct
  `Tool call stalled: …` reason instead of burning the full run timeout. Fanout legs inherit automatically.
- **`amicus doctor --fix` sweeps orphaned sessions-index tmp files** (atomic-write artifacts from killed
  processes; only files older than 60s are removed).

### Changed
- **The fold completion marker is now per-run nonced: `[SIDECAR_FOLD:<nonce>]`.** Model output that
  genuinely ends with a bare `[SIDECAR_FOLD]` can no longer force premature completion — the detector
  requires the run's own nonce (BL-7's final hardening layer). The nonce is crypto-random, threaded through
  every mode (headless, fanout, MCP shared-server, interactive GUI), and instructed to the model in the
  prompt; `amicus resume` re-derives it from the transcript.
- **All session/wave metadata writes are atomic** (`writeFileAtomic` tmp+rename), retiring the torn-read
  race class that pollers previously tolerated via missed-tick workarounds.

### Fixed
- **Orphaned `opencode serve` processes on macOS/Linux.** Server teardown now SIGTERMs the Go binary
  directly and escalates to SIGKILL after a bounded grace window on a ref'd poll (the old unref'd 2s timer
  silently died with fast-exiting parents). Windows semantics unchanged.
- **Aborting a wave immediately after starting it can no longer flip its status back to `running`** — the
  wave metadata merge now honors abort-wins precedence (same rule the per-leg writer already had).
- **`kill(pid, 0)` throwing `EPERM` now classifies a process as ALIVE** (signal denied ≠ dead) in
  `isProcessAlive`/`checkSessionLiveness` and both MCP crash-detection probes. EPERM no longer marks
  healthy sessions crashed.
- **A committed successful terminal status can no longer be clobbered to `error`** by a cleanup-step
  failure in the MCP shared-server finalize chain (the Phase-5 review's residual gap).
- **`discoverCoworkMcps` now checks `%APPDATA%\Claude` on Windows** instead of the XDG path — Claude
  Desktop discovery and doctor's Cowork signal were always wrong on win32.

## [1.9.1] - 2026-07-03

### Fixed
- **`server.json`'s description now fits the MCP Registry's 100-character cap.** The registry rejected
  v1.9.0's publish (its first-ever attempt) with HTTP 422 — the description was 199 chars against a
  100-char limit the schema doesn't advertise. Shortened to 98 chars; the cap is pinned by
  `tests/scripts/package-manifest.test.js` (characters and UTF-8 bytes), and `docs/DISTRIBUTION.md` §3 now
  documents that content-level 422s are not recoverable by workflow re-run (the re-run checks out the tag)
  — fix `server.json` on main and use the manual path or the next tag. v1.9.0 itself shipped fully to npm
  and GitHub Releases; this patch exists to land the registry publish.

## [1.9.0] - 2026-07-03

Engine pull-forwards, release-rail hardening, docs sync, and a new Council Review GitHub Action.

### Added
- **`/amicus:council` slash command and a `/amicus:sidecar <model> <prompt…>` argument surface.** `commands/council.md`
  wraps the `second-opinion` skill end-to-end via `$ARGUMENTS`; `skills/sidecar/SKILL.md` gained an
  `argument-hint` and a slash-invocation section binding `$1` (model alias, falling back to gemini for
  non-model-looking input) and `$ARGUMENTS` (full prompt). **Slash commands are plugin-channel-only:**
  `commands/` ships in the npm tarball (via `package.json`'s `files` array) but the npm/`install.sh`/
  `install.ps1` postinstall flow never copies it into a Claude Code commands directory — only
  `skills/sidecar` and `skills/second-opinion` are installed that way. npm/postinstall users do not get
  `/amicus:council` or `/amicus:sidecar`; only plugin installs (`claude plugin install`) do. This is a
  known, accepted gap, not a bug — carried forward from the 9.1 review as a note that must keep
  reappearing in release-facing docs so it doesn't get silently "fixed" into a false claim.
- **MCP Registry wiring.** `package.json` gained `mcpName: "io.github.BourbonDog/amicus"`; `server.json`
  (repo root) describes the stdio launch (`npx amicus mcp`). `.github/workflows/publish.yml` now publishes
  to `registry.modelcontextprotocol.io` via `mcp-publisher`, authenticated over the same GitHub OIDC token
  used for npm Trusted Publishing — no registry secret required. This fires automatically on every `v*` tag
  push, strictly after `npm publish` succeeds (npm-side ownership validation reads the published
  `package.json`). See `docs/DISTRIBUTION.md` §3 for the full flow, the release-order dependency on the
  Phase 4 tool-surface de-bloat, and the manual recovery path if the registry publish fails in CI.
- **Marketplace submission runbook and preflight guard.** `docs/DISTRIBUTION.md` documents the
  `claude-community` submission process (individual-author Console form route), the preflight checklist
  (`claude plugin validate . --strict`, `claude --plugin-dir .` smoke test, `npm test`), and what the
  Anthropic review pipeline is expected to check.
- **Council Review GitHub Action (v1).** A new reusable, label-gated workflow (`.github/workflows/council-review.yml`)
  runs an `amicus fanout` review wave (default cheap bench `deepseek,gemini,glm`, cost- and time-bounded) over a
  pull request's diff and posts one sticky synthesis comment with the individual reviews collapsed underneath. v1 is
  fanout-only — independent reviews plus a one-leg synthesis, no adjudicated verdict (that needs the skill-orchestrated
  Stage-2 cross-review, which a code-only pipeline can't produce; deferred to v2). Fork-safe and no-checkout by
  design: PR code is never checked out or executed, only its diff (capped, via `gh pr diff`) is read; the job soft-skips
  with a notice when `OPENROUTER_API_KEY` is unavailable (e.g. a fork PR without repo secrets) rather than failing the
  check; every use of PR-controlled text (title/body) reaches the shell only through `env:` indirection, never inlined
  into a `run:` script. Untrusted model output is neutralized before it enters the PR comment — case-insensitive,
  whitespace-tolerant rules strip anything that could forge the sticky-comment marker (and hijack the next run's
  update), forge the "not an adjudicated verdict" footer disclosure, or break out of the comment's own `<details>`
  wrapper — and the real footer is echoed last, after all model text, so its position can't be forged. The label
  gate (`council-review`) is enforced with a string-safe comparison (`format('{0}', inputs.require_label) == 'false'`)
  to avoid a loose-equality bug where GitHub coerces an empty `pull_request`-event input to falsy and would otherwise
  bypass the gate on every same-repo PR. **Inert by default:** the workflow only runs once a repo both adds the
  `OPENROUTER_API_KEY` Actions secret and applies the `council-review` label to a PR — installing it does nothing on
  its own. Locked by `tests/scripts/council-review-workflow.test.js`.

### Changed
- **Every prose channel that returns another model's output is now wrapped in the
  `<untrusted_sidecar_output>` fence** (`amicus_status`/`amicus_list` previews remain sanitized-and-truncated
  instead, by design — `sanitizePreview()` in `src/sidecar/progress-fields.js` defangs fence/tag characters
  and caps length so the full untrusted text is only ever reachable through the fenced `amicus_read` path),
  extending the protection `amicus_read` summaries already had: MCP wave and conversation reads, CLI
  `amicus read` summary/conversation/wave output, and the foreground summary echo after
  `start`/`continue`/`resume`. This is visible in CLI output. JSON output (`--json`), metadata mode, and
  on-disk artifacts (`wave.json`, `summary.md`, `conversation.jsonl`) are byte-identical to before — the
  fence is applied only at output time, never at write time.
- Internal: `interactive.js`'s Electron process helpers extracted to `src/sidecar/interactive-process.js`
  (size-gate headroom; no behavior change).

### Fixed
- **`plugin.json`'s unrecognized `bugs` field removed.** `claude plugin validate . --strict` now passes
  clean (exit 0); it previously reported an unknown-field warning that `--strict` promotes to an error.
- **The Fold handoff is now documented operationally** (README + usage.md): the `[SIDECAR_FOLD]` stdout
  block, where the summary lands (`summary.md`), and how the orchestrator reads it back (fenced, via
  `amicus read`/`amicus_read`).
- **README↔usage.md drift corrected against the binary:** `amicus fanout` documents `--council`
  (mutually exclusive with `--models`, exactly one required) in both files; `amicus list --status`
  documents the full 7-value set (`running, complete, error, timed-out, aborted, crashed, idle-timeout`)
  — note the `--json` schema's distinct `timeout` vocabulary is deliberately unchanged; fanout
  `--session-id` support documented; `amicus status` gained real human and `--json` output examples;
  `start --setup` documented as NOT relaxing the `--prompt`/`--prompt-file` requirement (with the exact
  error string users see).
- **OpenRouter 402 recovery** added to the README troubleshooting table and docs/troubleshooting.md:
  key save/validation never checks account balance, so the first council review / `start` / `fanout` call
  can 402 (the `amicus council` subcommand itself is deterministic math and never calls a model) — recovery
  via openrouter.ai/credits, `:free` models, and the non-blocking `amicus doctor` credit probe.
- docs/DISTRIBUTION.md's stale `/v0.1/` registry API path synced to `/v0/`.
- All of the above locked by `tests/docs-quick-sync.test.js` (17 pins).
- **Closing the GUI window no longer loses the session summary.** Closing without folding previously
  destroyed the window immediately — the session finalized as `complete` with a placeholder summary, and
  closing during an in-flight fold discarded the summary about to land. The window close is now intercepted
  by a close guard (`electron/close-guard.js`): a close with no fold auto-triggers the same fold flow
  (overlay + summary + `[SIDECAR_FOLD]` handoff) and then closes; a close during an in-flight fold lets it
  finish — regardless of whether the fold was close-initiated or started from the toolbar/shortcut — instead
  of falling through and destroying the window mid-summary; a failed or timed-out fold still closes the
  window (the user is never trapped). This relies on `electron/fold.js` exposing a finer-grained
  `isFolding()`/`hasCompleted()` split (a fold is "in flight" from the moment `triggerFold` is entered until
  its `[SIDECAR_FOLD]` stdout write actually succeeds) alongside the original `hasFolded()`, so the guard can
  tell "still running" apart from "actually done" — and a fold that settles without completing (including a
  synchronous throw from the post-write nudge-overlay update, which the old code's `.catch()` couldn't
  observe) still safely falls back to closing the window rather than leaving it permanently stuck open.
  External abort remains immediate and never waits on a fold.
- **The MCP server no longer hardcodes `--client cowork`.** Under Claude Code — the primary caller — that
  hardcode silently broke `includeContext:true` (empty context), parent-MCP discovery, and session-dir
  resolution. The server now detects its caller from the MCP handshake's `clientInfo` (claude-code →
  `code-local`; Claude Desktop/Cowork → `cowork`; unknown callers keep today's `cowork` behavior with a
  one-time stderr notice) and threads the detected client through every spawn path and the in-process
  shared-server path. A new `AMICUS_MCP_CLIENT` env var (set it in the MCP registration's `env` block)
  explicitly overrides detection. One consequence: MCP-spawned GUI chat sessions under Claude Code now keep
  the default SE-focused base prompt — `opencode-client.js`'s Cowork-specific general-purpose prompt swap
  (`buildCoworkAgentPrompt()`) only fires when `options.client === 'cowork'`, which no longer matches a
  Claude Code caller now that it's correctly tagged `code-local`.
- **Release-workflow re-runs now recover a half-published release instead of dead-ending.** A `publish.yml`
  re-run after a post-`npm publish` failure previously died on `EPUBLISHCONFLICT` before ever reaching the
  step that failed. Now the npm publish is skipped (loudly) when `amicus@<version>` is already live (E404
  means not-published and proceeds; any other `npm view` error fails loud rather than skipping), a
  tag↔`package.json` lockstep check fails fast before anything publishes, the MCP Registry publish is
  skipped when the version is already registered (pre-check tolerates transport-level failures and falls
  through to publishing), `mcp-publisher login github-oidc` gained the same 5×20s retry the publish call
  already had, and `gh release create` is guarded by an existence check. `docs/DISTRIBUTION.md` §3 now
  documents re-run as the primary recovery path, with the manual path as fallback. Locked by
  `tests/scripts/publish-workflow.test.js`.
- **The `second-opinion` skill's frontmatter description no longer exceeds Claude Code's 1024-char cap.**
  It was 1441 chars, so the router silently truncated the tail — which was the NOT-clause routing quick
  single-model asks ("ask Gemini…", "what does DeepSeek think") to the `sidecar` skill. Rewritten to
  988 chars with every trigger phrase and the NOT boundary intact (same fix pattern as the sidecar skill's
  1.8.1 overhaul); locked by `tests/skill-second-opinion-docs.test.js`. Existing installs pick the fix up
  when postinstall refreshes skill copies on the next upgrade.

## [1.8.1] - 2026-07-02

Docs & skills accuracy sprint from the Phase-8 whole-branch review — no engine changes. Every item fixed a claim
that actively misdirected Claude or users, plus one headless completion-state bugfix.

### Changed
- **`report.html` is now the default final council artifact**, and an inline verdict summary in chat is
  MANDATORY at Stage 5 of the second-opinion skill.
- **The `sidecar` skill's frontmatter dropped the "second opinion from another model" trigger** — those requests
  now route to the `second-opinion` skill instead.
- **MODEL-NOTES seed updated** with durable lessons from council runs 4-7 (new Grok/Kimi/Mistral/Claude-in-council
  sections; shipped/local split defined). Existing installs: the machine-local copy is installed only-if-missing —
  merge/refresh manually by pointing at the shipped file.
- **Council mechanics hardened:** mandatory no-tools preamble for judges and chair (plus scratch-cwd advice);
  `--max-cost` / `--no-cost-gate` pass-through documented for repair and chair calls (the false solo-start
  cost-gate exemption was removed); `--models` lists quoted in every example; current-date injection rule for
  time-sensitive artifacts.

### Fixed
- **Plugin quick-start now states the truth:** plugin installs do not put `amicus` on `PATH`; use
  `npx -y amicus@latest <cmd>`. Both skills gained an npx-fallback/transport rule.
- **README/usage now document `doctor`, `key`, and `council`;** troubleshooting leads with `amicus doctor`; the
  false "`amicus list` shows active servers" claim is replaced with real `netstat`/`lsof` guidance.
- **Headless runs that finish via idle detection no longer write `status:"error"` / `reason:"Incomplete"` to
  `metadata.json`.** The poll loop's two genuine idle-completion exits — the SDK-authoritative `session.status`
  idle signal and the stable-poll activity heuristic (both gated on real output, F1 #16) — broke out of the loop
  without setting `completed`, so `resolveTerminalState` fell through to error and poisoned `amicus_list` /
  `amicus_status` / wave rollups for successful runs, while the stdout `--json` doc correctly said
  `status:"complete"`. Both exits now mark the run completed, matching the fold-marker branch. Dead-server
  classification is unchanged: the consecutive-poll-failure fast-exit (F4) and crash paths still report an error.

## [1.8.0] - 2026-07-02

### Added
- **`amicus_wait` MCP tool: blocking wait for a session or fan-out wave.** Blocks inside one tool call until the
  target reaches a terminal state or the wait window closes, replacing the sleep+`amicus_status` polling loop with
  a single call. Returns the same JSON shape as `amicus_status` plus `waitedMs` and `{timedOut: true}` (with a
  `hint`) on expiry — re-call it while it keeps returning `timedOut: true`. Works for sessions or waves started by
  other processes, not just the caller. Torn-read tolerant: a transient read of `metadata.json` mid-write is
  treated as a missed poll tick, not a hard failure. Legacy alias `sidecar_wait` is available under
  `AMICUS_LEGACY_ALIASES=1`.
- **Agent-visible progress.** A new `amicus status <task_id>` (or `--wave <id>`) one-shot CLI command delegates
  directly to the MCP status handler — same crash detection and wave-leg rollup, zero duplicated logic.
  `amicus_status` and `amicus_list` are enriched with agent-facing `mode`, `phase`, `messageCount`,
  `lastActivityAt`, and `latestPreview` (the pinned raw `stage` field is unchanged for back-compat; wave legs
  additionally surface the raw `stage` alongside the coarse `phase`). Interactive (Electron GUI) runs now write
  the same lifecycle progress stages headless runs always have (`initializing`, `server_ready`, `session_created`,
  `prompt_sent`), and long-thinking turns emit periodic thinking-delta progress ticks instead of at most one ever
  — so a live GUI run no longer reads "Starting up... | 0 messages" forever.
- **`amicus doctor` duplicate-registration check.** A new `mcp-legacy` check flags plugin-channel installs
  (`AMICUS_SKIP_POSTINSTALL=1`) that never ran the postinstall migration and still carry a duplicate legacy
  `sidecar` MCP registration; `doctor --fix` cleans it up.

### Fixed
- **`amicus abort` now actually stops interactive sessions and wave legs.** Marker-first, honest output — reports
  what really happened including the unkillable-pid case — and no-ops cleanly with a clear message when the
  target isn't running.
- **Legacy-MCP remediation's `claude mcp add-json` (CLI) path no longer drops a user's custom `env`** on
  re-registration — it now merges the previous registration's `env` the same way the file-fallback path already did.

### Changed
- **Legacy `sidecar_*` MCP tool aliases are now opt-in** via `AMICUS_LEGACY_ALIASES=1` (breaking-adjacent —
  carrying release must be a MINOR, v1.8.0). The default client-visible surface is the `amicus_*` toolset (14
  tools as of this release); saved allowlists that still reference `mcp__amicus__sidecar_*` stop resolving unless
  you opt back in.
- **Postinstall no longer registers a separate `sidecar` MCP server** and auto-removes a verified-identical
  duplicate left over from pre-1.8 installs. A customized `sidecar` entry or a sole `sidecar` registration (no
  `amicus` twin) is never touched.

## [1.7.7] - 2026-07-01

Correctness patch from the 2026-07-01 full product review (multi-agent review, every finding adversarially
verified against source), executed subagent-driven with per-task adversarial review plus a final whole-branch review.

### Fixed
- **Terminal errors now show their actionable hint.** Human-mode errors printed only the message while `--json`
  carried a `hint` field; the hint now prints on a second `  → …` line. Budget-gate refusals finally tell you the
  offending model, the threshold, and the `--max-cost` / `--no-cost-gate` overrides.
- **Spawned sidecars no longer inherit Amicus's own MCP server.** The recursive-spawn guard only excluded a server
  literally named `sidecar`, but the product registers as `amicus` — so every child model inherited the full
  Amicus toolset and could spawn recursively. Children now exclude any inherited entry that *is* Amicus, matched
  by name **or** by what the command actually runs (`amicus mcp`, `npx … amicus … mcp`, a `bin/amicus.js … mcp`
  path). Note: this strip has no opt-out — a deliberately configured nested Amicus MCP entry is also removed from
  spawned children.
- **Shared-server crash detection actually works.** The crash/restart machinery listened on an event emitter the
  real server handle never exposed, so it was dead code — a dead engine silently degraded every later session.
  A pid liveness poll now drives detection and restart, and shutting down during the restart backoff cancels the
  pending restart instead of spawning a server nobody asked for.

### Changed
- **`amicus continue` and `amicus resume` now report failures truthfully** (behavior change): error exits 1,
  timeout exits 2, abort exits 130/143/2 — previously both always exited 0 and recorded the session as
  `complete` even when the model errored or timed out. The session record now finalizes `error`/`timed-out`
  accordingly (interactive sessions that legitimately end with an empty summary still finalize `complete`).
  Scripts that gated on exit code 0 for these verbs will now see real failures.

## [1.7.6] - 2026-07-01

A second independent review (GLM 5.2), adversarially verified against source, then fixed across 11 lanes.
20 of 22 confirmed findings fixed; 2 partial (deferred as follow-ups). Full unit suite green.

### Security
- **The `project`/`cwd` MCP input is now sandboxed.** Previously any caller could pass an arbitrary directory
  (e.g. a system path) and Amicus would create session files and spawn a sidecar there. A new project-root
  allow-list rejects out-of-bounds paths **before** any filesystem write or spawn, while still allowing paths
  under your home directory, the current working directory, `AMICUS_PROJECT_DIR`/`AMICUS_PROJECT_ROOTS`, or the
  MCP client's advertised root — so legitimate `--cwd` use is unaffected.
- **Folded-back sidecar summaries are fenced as untrusted output.** `amicus_read`'s returned summary — produced
  by an arbitrary model — is now wrapped in a read-only fence (mirroring the outbound conversation fence), so
  model prose entering the orchestrator's context is marked as data, not instructions.
- **The Electron content view no longer shares the privileged bridge.** The embedded OpenCode web view gets a
  minimal preload that exposes nothing privileged, and IPC handlers validate the sender, so only the toolbar can
  trigger update/settings actions.

### Fixed
- **A crashed OpenCode server is now detected.** The shared-server crash/restart machinery was unreachable (no
  exit listener was ever attached); a server exit is now wired to the restart path.
- **Session metadata is written atomically** (temp file + rename), so a crash mid-write can no longer corrupt
  `metadata.json` and silently mask an abort marker.
- **Port lookup works on Windows.** The stale-process cleanup used a hardcoded `lsof` (a no-op on Windows); it
  now uses the cross-platform `netstat`-based lookup.
- **A fan-out leg whose setup throws no longer sinks the whole wave** — the leg is turned into an error result
  and `wave.json` is still written.
- **The setup window can't hang on a spawn failure** — a spawn error now resolves cleanly instead of leaving the
  launch promise pending forever, and the Electron child is killed on parent exit.
- **Project-scoped `opencode.json` resolves against the target project**, not the launcher's working directory.
- Smaller correctness/cleanup fixes: single-peer-agreed council findings now count as corroborated; unknown
  council verdicts are guarded; tool-call turns render a summary instead of blank; quote-aware `--mcp` command
  parsing; a model-object shape guard; a single shared duration formatter; timed mirror teardown; a lock on the
  continuation session; and canonical session-route separators.

### Known follow-ups
- Fencing `amicus_council_tally`/`amicus_verdict` (they return JSON records, so they need a field-level fence).
- Removing the now-dead top-level `tool_use` formatter branch (blocked on an unrelated test assertion).

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

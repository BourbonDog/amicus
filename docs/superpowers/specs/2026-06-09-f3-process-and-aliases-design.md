---
title: F3 — Process Lifecycle & Alias Correctness — Design Spec
date: 2026-06-09
status: implemented (2026-06-09 — subagent-driven; full suite green, lint clean)
owner: BourbonDog
references:
  - docs/superpowers/specs/2026-06-07-amicus-product-design.md (§6 F3, §6 F5)
  - upstream issues jrenaldi79/sidecar #15, #18, #20
supersedes: none
---

# F3 — Process Lifecycle & Alias Correctness

> **Implemented 2026-06-09** (branch `f3-exec`, subagent-driven, 8 tasks + final-review fixes).
> - **#15** — cross-platform Go-server reap via captured `server.goPid` (`port-pid.js`, `opencode-client.js` `buildServerHandle`) + one-shot force-exit watchdog (`lifecycle.js`, `bin/amicus.js`).
> - **#20** — SIGTERM/SIGINT/SIGBREAK abort in `runHeadless` (`session-abort.js`, `markAborted`, `goPid` recorded to metadata) + `amicus abort --all` (legacy-dir aware).
> - **#18 (full)** — TTL'd OpenRouter catalog cache (`model-catalog.js`), default-on validation w/ `--no-validate-model` (`model-validator.js` `validateAgainstCatalog`, `start-helpers.js`), pinned+verified `codex`, real `scripts/refresh-model-capabilities.js`.
> - Result: full unit suite green (1662 passed, 5 skipped, 0 failed), `npm run lint` clean.
> - Follow-ups (out of F3 scope): `grok` default alias is stale on the live catalog (caught by `models:check`); `continue`/`resume` don't run catalog validation; pre-existing `bin/sidecar.js` integration-test breakage (tracked in PR #2).

## 1. Summary

F3 is the third engine milestone for Amicus. It closes three upstream issues that
all bite the documented multi-LLM workflow (launching parallel headless sidecars):

- **#15** — a completed headless run leaves its **parent process running** (zombie).
- **#20** — killing the parent **orphans the OpenCode session** (burns API credits).
- **#18** — the `codex` alias resolves to a **non-existent model**, surfacing as a
  misleading "needs more credits" error.

Per the product design spec §6, #15/#20 are "Session lifecycle" and #18 is "Alias
correctness." The owner elected to pull the F5 **dynamic OpenRouter catalog** forward
so #18 validates against a live model list rather than a hand-edited table.

## 2. Scope & decisions locked

Confirmed with the owner during brainstorming (2026-06-09):

| Decision | Choice |
| --- | --- |
| Issues in this pass | **All three** — #15, #20, #18 |
| #18 depth | **Full** — pull the live OpenRouter catalog forward (cache + refresh + validation); accept some F5 overlap |
| #15/#20 exit strategy | **Graceful teardown + force-exit safety net** (cross-platform: Windows-first owner, macOS where issues were filed) |
| `abort --all` | **Include it** (directly requested in #20) |

**Out of scope (stays F5):** the full GUI model-picker rewrite, `setup` first-run
seeding polish, and any broader "models command suite" beyond what #18 validation needs.

## 3. Current state (code findings)

Ground-truth from the repo at `main` (HEAD `1c3d1fb`), gathered during brainstorming:

**#15 — process exit**
- Neither `bin/amicus.js` `main()` nor `startSidecar()` (`src/sidecar/start.js:143`)
  calls `process.exit(0)` on the happy path; exit relies on the event loop draining.
- A partial fix exists: `startServer()`'s `close()` wrapper (`src/opencode-client.js:466`)
  SIGTERMs the OpenCode Go server and force-kills after 2s — but it finds the PID via
  **`lsof` (`src/opencode-client.js:474`), which does not exist on Windows** and silently
  no-ops. The comment there (`:457`) ties the lingering Go server to Node's loop staying alive.

**#20 — parent kill**
- Abort today is **file-poll only**: the headless loop watches `metadata.json` for
  `status:'aborted'` (`src/headless.js:294`), which `amicus abort <id>` writes.
- There is **no SIGTERM/SIGINT handler** on the start/headless path. The only signal
  handlers live in the long-lived MCP server (`src/mcp-server.js:486`). `bin/amicus.js`
  installs `uncaughtException`/`unhandledRejection` handlers, but only when `--task-id`
  is present (`:26`), and none of them abort the OpenCode session.

**#18 — alias correctness**
- `DEFAULT_ALIASES` (`src/utils/config.js:15`) maps `codex` → `openrouter/openai/gpt-5.3-codex`
  (non-existent). It is the **only** stale alias; the rest were bumped to current models.
- Validation infra exists but is gated: `validateFallbackModel()` (`src/utils/start-helpers.js:43`)
  runs **only** when `--validate-model` is passed **and** the model is a direct-API fallback
  (`detectFallback`). `validateDirectModel()` (`src/utils/model-validator.js:46`) returns early
  with no direct provider key (`:55`), so the **common OpenRouter path is never validated**.
- The live fetch already exists: `model-fetcher.js` `fetchModelsFromProvider('openrouter', key)`
  hits `https://openrouter.ai/api/v1/models` (`src/utils/model-fetcher.js:28`) and normalizes
  to `openrouter/<id>`, with a 5s timeout and graceful `[]` fallback.
- There is **no catalog cache**.
- The `refresh-models` / `models:info` / `models:check` npm scripts point at
  **`scripts/refresh-model-capabilities.js`, which does not exist** (dangling references).
  `scripts/list-models.js` is an unrelated CDP helper that scrapes the GUI dropdown.

## 4. Design

### 4.1 #15 — Clean process exit

- **Cross-platform server reap.** Replace the `lsof`-only PID lookup in
  `startServer().close()` with a cross-platform mechanism: prefer the Go server child
  PID the SDK already holds (avoids port-scanning entirely); fall back to a port→PID
  finder that branches by platform (Windows: `netstat -ano` / `Get-NetTCPConnection`;
  Unix: `lsof`). Keep the existing SIGTERM-then-force-kill escalation. Shared with #20.
- **Teardown + force-exit net.** For the one-shot commands (`start`, `continue`, `resume`)
  only: after the command's async work resolves, run teardown (close server, clear the
  update-check and any other timers), then arm a short **`unref()`'d watchdog** (~1.5s).
  If the loop has not exited by then, flush stdout/stderr and `process.exit(code)`.
  - The watchdog is the safety net for the "graceful teardown missed a handle" case; the
    happy path still exits naturally before it fires.
  - **Never** apply this to the `mcp` command — that server is intentionally long-lived.

*Acceptance:* a completed headless run returns control to the shell (parent process exits;
no zombie). A run that pauses >8s mid-tool-call still completes and exits (ties to F1).

### 4.2 #20 — Abort session on parent kill

- **Signal handlers.** Around the headless run (in `startSidecar` for one-shot commands),
  register `SIGTERM`, `SIGINT`, and `SIGBREAK` (Windows) handlers that, best-effort and
  time-boxed: (1) mark session metadata `status:'aborted'`, (2) call
  `abortSession(client, sessionId)`, (3) kill the Go server child (via the §4.1
  cross-platform reap), (4) exit. Complements — does not replace — the existing file-poll abort.
- **`amicus abort --all`.** Enumerate sessions with `status:'running'` and abort each,
  reusing the existing `handleAbort` path. Reports a count.

*Acceptance:* killing the parent (SIGTERM/SIGINT) terminates the child session; afterward
`amicus list --status running` shows no orphans. `abort --all` clears any that accumulate.

*Limitation (documented, not fixed in v1):* SIGKILL / `taskkill /F` cannot be trapped.

### 4.3 #18 — Alias correctness via live catalog

- **Catalog cache.** Persist the OpenRouter model list to `~/.config/amicus/model-catalog.json`
  with a TTL (~24h). Reads come from cache; a miss/expiry triggers a fetch via
  `fetchModelsFromProvider`. Offline or fetch-failure → degrade gracefully (use stale cache
  if present; otherwise warn and **do not block** the launch — preserving today's behavior).
- **Validation default-on.** Validate the resolved model (including the OpenRouter path)
  against the cached catalog before launch. Opt-out via `--no-validate-model`. A model
  absent from the catalog **fails fast** with a clear, actionable message listing valid
  alternatives for that alias — replacing the misleading "needs more credits" error.
  The existing opt-in `--validate-model` flag (`src/utils/start-helpers.js:45`) is
  superseded; keep it as an accepted no-op alias for back-compat rather than removing it.
- **Fix `codex`.** Repoint `DEFAULT_ALIASES.codex` (`src/utils/config.js:20`) to a
  currently-valid model, confirmed via a live OpenRouter fetch at implementation time.
  Validation remains the safety net for future model drift.
- **Repair the refresh plumbing.** Create a real `scripts/refresh-model-capabilities.js`
  (backing `refresh-models` / `models:info` / `models:check`) that fetches and writes the
  cache. The CLI surface for refresh (e.g. an `amicus models --refresh`) may be folded in
  here or deferred to F5 — to be settled in the plan; the npm scripts must at minimum
  stop dangling.

*Acceptance:* `--model codex` either runs on a valid model or fails fast with a clear error
and suggested alternatives; new/renamed models validate from the live catalog without
hand-editing the alias table; the refresh npm scripts execute successfully.

## 5. Components touched

| Component | Files (indicative) | Change |
| --- | --- | --- |
| Server lifecycle | `src/opencode-client.js` | cross-platform child reap; expose/track server PID |
| CLI entry / teardown | `bin/amicus.js`, `src/sidecar/start.js` | teardown + force-exit net; signal handlers |
| Abort | `src/cli-handlers.js`, `src/cli.js` | `abort --all` |
| Alias / validation | `src/utils/config.js`, `src/utils/start-helpers.js`, `src/utils/model-validator.js` | codex fix; default-on validation; OpenRouter-path validation |
| Catalog cache | new `src/utils/model-catalog.js` (or extend `model-fetcher.js`) | cache read/write + TTL |
| Refresh script | new `scripts/refresh-model-capabilities.js` | back the dangling npm scripts; seed cache |

## 6. Testing strategy

- **Preserve the green baseline** (default unit suite: 0 failed / 1625 passed / 5 skipped).
  Run the **full** suite when scoping (`tests/` **and** `evals/tests/`) — a prior phase
  missed an `evals/` failure by scoping too narrowly.
- **Unit:** cross-platform PID-finder (mock per platform); catalog cache (fresh / stale /
  corrupt / offline); validation (model present / absent / catalog-unavailable);
  `abort --all` enumeration; codex resolution.
- **Integration** (`test:integration`, platform-sensitive): spawn a headless child →
  SIGTERM → assert session marked aborted and absent from `list --status running`; a
  headless run with a >8s tool gap still exits cleanly (cross-check with F1).

## 7. Risks & open questions

- **Windows kill semantics (highest).** How Claude Code's Bash background-task kill /
  TaskStop terminates on Windows (SIGTERM vs SIGKILL vs `taskkill` tree) must be confirmed
  empirically during implementation; it determines whether signal handlers suffice. The
  parent-liveness heartbeat from #20 is a stretch fallback, explicitly not v1.
- **Force-exit net masking a real leak.** The watchdog could paper over a genuinely
  un-closed handle. Mitigation: log when the watchdog (rather than natural drain) ends the
  process, so leaks remain visible.
- **Catalog network dependency.** Default-on validation adds a network call; mitigated by
  the TTL cache + graceful degradation (never block a launch on a catalog miss).
- **F3/F5 overlap.** Pulling the catalog forward risks scope creep into F5. Boundary held
  at "cache + refresh + validation"; GUI picker and setup-seeding stay F5.

## 8. Execution

New branch `f3/process-and-aliases` off `main`. Run `writing-plans` on this spec to produce
the implementation plan, then execute subagent-driven (impl + spec-marking + quality review
per task), as with F6/F1/F2. Local-merge to `main`, then push to origin per milestone.

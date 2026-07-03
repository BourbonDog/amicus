# Architecture Details

## Data Flow

```
User: amicus start --model google/gemini-2.5 --briefing "Debug auth issue"
       ↓
CLI parses args (cli.js)
       ↓
buildContext() extracts from ~/.claude/projects/[project]/[session].jsonl
       ↓
buildPrompts() creates system prompt + user message
  Interactive: context in system prompt (hidden from UI)
  Headless: context in user message (no UI)
       ↓
startOpenCodeServer() → createSession() → sendPromptAsync()
       ↓
[Interactive]                    [Headless]
Electron BrowserView opens       OpenCode async API (promptAsync)
User converses with model        Agent works autonomously
FOLD clicked →                   Polls for [SIDECAR_FOLD:<nonce>] marker
  Model generates summary            ↓
  (SUMMARY_TEMPLATE prompt)     extractSummary() captures output
       ↓                              ↓
Summary output to stdout → Claude Code receives in context
```

## Fold Mechanism

When the user clicks **Fold** (or presses `Cmd+Shift+F`) in interactive mode:

1. UI shows overlay with spinner ("Generating summary...")
2. `SUMMARY_TEMPLATE` is sent to the model via OpenCode HTTP API (`prompt_async`)
3. Electron polls `/session/:id/message` for the model's response
4. Model generates a structured summary with: Task, Findings, Attempted Approaches, Recommendations, Code Changes, Files Modified, Assumptions, Open Questions
5. Summary is written to stdout with `[SIDECAR_FOLD]` metadata header
6. Electron window closes, `start.js` captures stdout and finalizes session

In headless mode, the agent outputs `[SIDECAR_FOLD]` autonomously when done, and `headless.js` extracts everything before the marker.

**Wire-format token:** The wire-format token emitted by the model in headless mode is `[SIDECAR_FOLD:<nonce>]` — a per-run random nonce, generated once per run before prompt construction (`src/utils/fold-marker.js`), embedded in headless mode instructions by `src/prompt-builder.js`, and required by `src/headless.js`'s detector (`findTrailingFoldMarker`, final-non-empty-line match on the exact nonced marker). This closes a hardening gap (#BL-7): a static, public marker meant model output that merely echoed it (prior instructions, a scraped doc, another run's transcript) could force a premature completion; requiring the run's own nonce means only a model that actually finished can produce it. The bare `[SIDECAR_FOLD]` literal (no `:<nonce>`) is kept only as a legacy/back-compat constant (`FOLD_MARKER` in `src/headless.js`) for callers with no nonce context — it is never accepted by the detector. Tracked in `docs/SHIMS.md`.

## Shared Server Architecture

Multiple Amicus invocations share a single OpenCode Go binary when `AMICUS_SHARED_SERVER=1` (the default). This eliminates per-invocation cold-start latency and reduces memory overhead.

```
Before (per-process):                After (shared server):
MCP Server                           MCP Server
  +-- amicus CLI (port 4096)           +-- Shared OpenCode Server (port 4096)
  |     +-- OpenCode Go binary               +-- Session A
  +-- amicus CLI (port 4097)               +-- Session B
  |     +-- OpenCode Go binary               +-- Session C
  +-- amicus CLI (port 4098)
        +-- OpenCode Go binary
```

The shared server restarts automatically on crash, up to 3 times within any 5-minute window. After 3 restarts the server is considered unstable and will not restart again; use `AMICUS_SHARED_SERVER=0` to fall back to per-process mode.

## Fanout Wave Architecture

`amicus fanout` runs N models on the same prompt concurrently using **one shared OpenCode server** (external-server mode). Key design properties, each traceable to source:

- **One server, N legs.** A single OpenCode server is started once (`src/sidecar/fanout.js` line 170–175) and passed via `options.client` / `options.server` to every `runHeadless` call.
- **Context built once.** `buildContext()` and `buildPrompts()` are called once before the leg loop (fanout.js lines 153–162); the resulting `systemPrompt` and `userMessage` are reused by all legs without per-leg re-serialisation.
- **Legs are ordinary sessions.** Each leg is an independent `runHeadless` session. Leg IDs follow the pattern `<waveId>-1`, `<waveId>-N` derived by `deriveLegIds()` (fanout.js line 37–39). Leg metadata carries `parentWave: waveId` (fanout-leg.js line 52).
- **Atomic wave document.** After all legs settle, `wave.json` is written atomically via a `.tmp` + rename sequence in the wave session directory (fanout.js lines 222–224). If the file is absent (e.g. hard kill), `buildWaveResultFromSession()` rebuilds it live from per-leg metadata.json files (`src/utils/result-schema.js` lines 179–217).
- **Per-leg watchdog backstop.** Each leg runs its own `IdleWatchdog` set to `timeoutMs + 60s` (fanout-leg.js lines 59–70). On timeout it marks only that leg aborted; it never calls `server.close()` or `process.exit()` — shared server safety.
- **Dead-server fast-exit.** Consecutive poll failures against a dead server exit immediately instead of burning the full timeout. The threshold is `AMICUS_MAX_CONSECUTIVE_POLL_FAILURES` (default 15, ≈ 30 s at 2 s polls), defined at `src/headless.js` line 33.
- **Signal handling.** On SIGINT or SIGTERM, the wave marks itself and all leg directories aborted, closes the server, then arms an exit watchdog. A second signal causes an immediate `process.exit(130/143)`. The control flow then proceeds through step 7 (aggregate + write `wave.json` + emit), so even an aborted wave produces a parseable JSON document (fanout.js lines 183–195, 227–229).
- **Wave status aggregation** (`src/utils/result-schema.js` lines 83–90):
  - Any leg still running → `running`
  - All legs complete → `complete`
  - ≥ 1 complete, others failed → `partial`
  - 0 complete, ≥ 1 aborted → `aborted`
  - All failed (no complete, no aborted) → `error`
- **Exit codes** (result-schema.js lines 97–101): `complete` → 0, `partial` → 2, all other statuses → 1.

## IdleWatchdog State Machine

Each Amicus process runs an `IdleWatchdog` that transitions between two states:

- **BUSY**: A prompt is in flight or a session was recently active. Idle timer is paused.
- **IDLE**: No active requests for the configured idle period. Process (or shared server) self-terminates.

Transitions: `BUSY → IDLE` when the last active session goes quiet; `IDLE → BUSY` on any new incoming request. The idle clock resets on each BUSY→IDLE transition.

Timeout resolution priority (highest wins):
1. Per-mode env var: `AMICUS_IDLE_TIMEOUT_HEADLESS`, `AMICUS_IDLE_TIMEOUT_INTERACTIVE`, `AMICUS_IDLE_TIMEOUT_SERVER` (in minutes; legacy `SIDECAR_IDLE_TIMEOUT_*` honored via env-compat shim — see `docs/SHIMS.md`)
2. Blanket env var `AMICUS_IDLE_TIMEOUT` (legacy `SIDECAR_IDLE_TIMEOUT`) in minutes
3. Constructor `timeout` option in milliseconds
4. Mode defaults: headless=15 m, interactive=60 m, server=30 m

Set the appropriate per-mode env var to `0` to disable self-termination for that mode entirely.

## Electron BrowserView Architecture

The Electron shell (`electron/main.js`) uses a **BrowserView** to avoid CSS conflicts between the OpenCode SPA and the Amicus toolbar:

- **BrowserView** (top): Loads the OpenCode web UI at `http://localhost:<port>`. Gets its own physical viewport, no CSS interference with the host window.
- **Main window** (bottom 40px): Renders the Amicus toolbar (branding, task ID, timer, Fold button) via a `data:` URL.
- On resize, `updateContentBounds()` adjusts the BrowserView to fill `height - 40px`.

This replaced earlier CSS-based approaches (`padding-bottom`, `calc(100dvh - 40px)`) which failed because OpenCode's Tailwind `h-dvh` class resolves to the actual browser viewport and ignores parent element overrides.

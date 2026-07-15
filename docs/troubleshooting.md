# Troubleshooting (Extended)

> Quick reference is in the [README Troubleshooting table](../README.md#troubleshooting).
> This document covers the same symptoms with more diagnostic depth.

## First: run `amicus doctor`

Before working through any symptom below, run `amicus doctor` (plugin-only installs: `npx -y amicus@latest doctor`). It checks, in order: Node version, config directory, API keys, default model, catalog freshness, alias staleness, the OpenCode binary, Electron, installed skills, MCP registration, OpenRouter credit, and the project root — and prints a targeted fix hint for every failing check. `amicus doctor --fix` self-heals what it can (e.g. re-installs a broken Electron in place); `--json` gives machine-readable output.

---

## Install Fails with `EEXIST: … claude-sidecar`

**Symptom:** `npm install -g amicus` fails with `npm error code EEXIST` naming a `claude-sidecar` (or `sidecar`) file under your global npm bin directory.

**Cause:** The old upstream `claude-sidecar` package is still installed globally. Through v1.x, Amicus shipped `sidecar`/`claude-sidecar` as deprecated bin aliases, which could also collide here — v2.0.0 no longer ships those aliases at all (removed in #19), so on a current install this is purely leftover from the old package.

**Fix:**

```bash
npm uninstall -g claude-sidecar
npm install -g amicus
```

Your keys and past sessions are not deleted by this swap, but v2.0.0 no longer reads them from the old locations automatically: config data was auto-migrated forward on every v1.x run, but if you're jumping straight from a pre-rebrand install, copy `~/.config/sidecar/` to `~/.config/amicus/` and rename any `.claude/sidecar_sessions/` dirs to `.claude/amicus_sessions/` by hand. See [docs/SHIMS.md](./SHIMS.md) for the full removal record.

---

## Auth / 401 Errors

**Symptom:** `401 Unauthorized`, `invalid_api_key`, or `OPENROUTER_API_KEY is not set`.

**Key resolution order** (highest priority first, implemented in `src/utils/env-loader.js`):
1. `process.env` — environment variables already set in the shell at launch. Never overwritten.
2. `~/.config/amicus/.env` — keys saved via `amicus setup`. The legacy `~/.config/sidecar/.env` fallback was removed in v2.0.0 — see [docs/SHIMS.md](./SHIMS.md). If you're migrating a pre-rebrand install directly to v2.0.0, copy the file over by hand.
3. `~/.local/share/opencode/auth.json` — OpenCode SDK credential store (lowest priority; Amicus only reads, never writes here).

**Diagnostic steps:**
- `amicus setup` — re-enters the wizard and writes the key to `~/.config/amicus/.env`.
- Check the model prefix matches the key: `openrouter/…` requires `OPENROUTER_API_KEY`; `google/…` requires `GOOGLE_GENERATIVE_AI_API_KEY`; `openai/…` requires `OPENAI_API_KEY`; `anthropic/…` requires `ANTHROPIC_API_KEY`.
- `LOG_LEVEL=debug amicus start …` will log which source each key was loaded from.

---

## OpenRouter 402 / "Payment Required" on First Call

**Symptom:** `amicus setup` and `amicus key openrouter <key>` both report the key as valid, but the first council review / `start` / `fanout` call against an OpenRouter model fails with `402 Payment Required`. (The `amicus council` subcommand itself is deterministic math and never calls a model, so it can't trigger this.)

**Cause:** Key save only checks that the key **authenticates** (`validateApiKey` — a `GET` against `openrouter.ai/api/v1/models`, which succeeds for any real key regardless of balance). It does not check credit; a zero-credit or free-tier-only key saves cleanly and only fails later, on the first paid-model call. `amicus doctor` DOES probe credit (the "OpenRouter credit" check, non-blocking) and the interactive `amicus setup` wizard prints a warning at the end if it detects zero credit or free-tier — but neither runs automatically after `amicus key`.

**Fix:**
- Run `amicus doctor` to confirm: it reports `openrouter-credit` as `warn` with the remaining-balance message if the key is zero-credit or free-tier-only.
- Add credit at [openrouter.ai/credits](https://openrouter.ai/credits), **or**
- Build a zero-cost council instead: `amicus setup` → option 2 (Free OpenRouter council) detects live `:free`-suffixed models and saves them as `councils.free`; then run `amicus fanout --council free …` (or let the `second-opinion` skill pick it up automatically).

---

## Session Not Found

**Symptom:** `Session <id> not found`, `Error: no recent session`.

**Causes and fixes:**
- **Explicit ID mismatch:** Run `amicus list` to see available sessions, then pass `--session-id <id>` explicitly.
- **Wrong project directory:** Amicus looks for sessions under `<project>/.claude/amicus_sessions/`. If you run from a different cwd, the session won't be found. Pass `--project <path>` to override.
- **Pre-rebrand sessions:** Sessions created before the Amicus rebrand live under `.claude/sidecar_sessions/`. The dual-read shim that used to resolve those automatically was removed in v2.0.0 — Amicus now only reads `.claude/amicus_sessions/`. Rename the directory to make old sessions visible again. See [docs/SHIMS.md](./SHIMS.md).

---

## No Conversation History Found

**Symptom:** `No conversation history found` or empty context injected into the Amicus run.

**Cause:** Amicus reads Claude Code's session JSONL files from `~/.claude/projects/<encoded-path>/`. The project path is encoded by replacing `/`, `\`, `:`, and `_` with `-` (implemented in `src/session.js` `encodeProjectPath()`).

**Common encoding gotchas:**
- On Windows, `C:\Users\alice\myproject` encodes to `C--Users-alice-myproject` (the drive-letter colon becomes a dash, backslashes become dashes).
- Underscores in the path also become dashes, which can make two different paths collide.

**Diagnostic steps:**
- Run `ls ~/.claude/projects/` (or `dir` on Windows) to see what encoded directories exist.
- Compare the encoded name to `encodeProjectPath(process.cwd())` output: `node -e "console.log(require('./src/session').encodeProjectPath(process.cwd()))"` from the project root.
- If the directory is missing, Claude Code may not have run in that project yet — open a Claude Code session first.

---

## Headless Run Never Finishes / Timeout

**Symptom:** `amicus start --no-ui` hangs or exits with `timedOut: true`.

**Primary knob:** `--timeout <minutes>` (default 15). Example: `--timeout 30`.

**Poller tuning** (env vars, all in `src/headless.js`):

| Variable | Default | Effect |
|----------|---------|--------|
| `AMICUS_POLL_INTERVAL_MS` | `2000` | Poll cadence in ms |
| `AMICUS_STABLE_FINISHED_POLLS` | `2` | Polls to wait after `time.completed` is set |
| `AMICUS_STABLE_IDLE_POLLS` | `30` | Polls to wait when no `time.completed` signal (~60 s) |
| `AMICUS_POLL_CALL_TIMEOUT_MS` | `30000` | Per `getMessages` call timeout |
| `AMICUS_MAX_CONSECUTIVE_POLL_FAILURES` | `15` | Bail out after N consecutive poll errors (~30 s) |

For full headless configuration, see [docs/configuration.md](./configuration.md).

---

## Multiple Active Sessions / Wrong Session Picked Up

**Symptom:** Amicus resumes or reads from the wrong session.

**Fix:** Pass `--session-id <id>` explicitly. When multiple sessions exist and no ID is specified, Amicus picks the most recent one by creation time. Run `amicus list` to inspect what's available.

---

## Fold Summary Looks Corrupted

**Symptom:** The summary output contains debug log lines, JSON blobs, or other non-summary text.

**Cause:** `LOG_LEVEL` is set to a verbose level (`debug` or `info`) and those log lines are reaching stdout instead of stderr.

**Fix:** Re-run with `LOG_LEVEL=debug amicus start …` to confirm what is leaking, then check that no `console.log` or `logger.*` call in the hot path writes to stdout. All Amicus log output should go to stderr. The summary is captured from stdout only.

---

## "Council Review This" Does Nothing

**Symptom:** Typing `council review this` (or similar) in Claude Code produces no response or an error about the skill not being found.

**Cause:** The `second-opinion` skill is not installed in `~/.claude/skills/`.

**Fix:**
1. Check whether the skill file exists: `~/.claude/skills/second-opinion/SKILL.md`.
2. If absent, re-run `npm install -g amicus` — the postinstall script installs both the `sidecar` chat skill and the `second-opinion` council skill automatically.
3. If the file exists but Claude Code still ignores it, verify that `~/.claude/skills/` is on Claude Code's skill search path (check your `~/.claude/settings.json`).

---

## Model Fails Catalog Validation

**Symptom:** `Error: model 'xyz' not found in catalog` on `amicus start` or `amicus fanout`.

**Cause:** The model name isn't in the locally cached catalog (`~/.config/amicus/model-catalog.json`), either because the catalog is stale or the model was renamed upstream.

**Fix:**
- `amicus models --refresh` — fetches the current catalog from the OpenRouter API and updates the cache.
- `amicus models --search <term>` — search the catalog for the correct model ID.
- `--no-validate-model` — bypass catalog validation for this run (the model is still validated by the OpenCode server at prompt time).

---

## Fanout Exits 2 (Partial Wave)

**Symptom:** `amicus fanout` exits with code 2.

**Meaning:** Exit code 2 means `partial` — at least one leg completed successfully and at least one did not. Exit code 1 means all legs failed (`error` or `aborted`). Exit code 0 means all legs completed.

**Diagnostic steps:**
1. Read the wave document: `amicus read <waveId> --json` or inspect `<project>/.claude/amicus_sessions/<waveId>/wave.json`.
2. Find legs with `status !== "complete"` in the `legs[]` array.
3. Read the individual leg: `amicus read <legId> --json` for the `error` field and the summary.
4. Re-run the failed leg independently: `amicus start --model <model> --prompt "…" --no-ui`.

---

## Electron Download Fails Behind a Corporate Proxy

**Symptom:** The first interactive `amicus start` (or `amicus doctor --fix`) hangs or errors while "provisioning Electron", on a network that requires an HTTP/HTTPS proxy.

**Cause:** Amicus downloads the Electron binary via `@electron/get`. As of `@electron/get` 5.x (shipped with the Electron 43 upgrade), the downloader uses Node's native `fetch`, which — unlike the older `got`-based path — does **not** honor `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` automatically. Proxied and authenticated-proxy environments are therefore not auto-detected.

**Fix:**
- **Manual install (most reliable):** on a machine/network with direct access, run any `amicus start` once to populate the Electron cache, then copy the cache directory to the target machine — `%LOCALAPPDATA%\electron\Cache` (Windows), `~/Library/Caches/electron` (macOS), `$XDG_CACHE_HOME/electron` or `~/.cache/electron` (Linux). Amicus reuses a valid cached binary without re-downloading.
- **Point at your own mirror:** set `ELECTRON_MIRROR` (and `ELECTRON_CUSTOM_DIR` if needed) to an internal Electron mirror that is reachable without a proxy.
- Headless runs and the full council never need Electron — use `--no-ui` if the GUI is not required.

---

## GUI Load Failsafe

**Symptom:** Interactive Amicus window shows a load-error page instead of the OpenCode UI, with a message about the UI not responding.

**Cause:** The OpenCode web UI did not load within the allowed window (default 15 000 ms). This can happen if the Go server is still cold-starting, or if the port is already in use.

**Fix:**
- Increase the timeout: `AMICUS_GUI_LOAD_TIMEOUT_MS=30000 amicus start …`
- Check whether another process is already using the target port: `netstat -ano | findstr <port>` (Windows) or `lsof -i :<port>` (macOS/Linux). (`amicus list --status running` shows running *sessions*, which may still hold a server — it does not list ports.)
- `AMICUS_SHARED_SERVER=0` forces a fresh per-process server if the shared server is in a bad state.

---

## Shared Server Crash Loop

**Symptom:** `amicus start` fails repeatedly; logs show `Shared server crashed` followed by restart attempts.

**Cause:** The OpenCode Go binary is crashing on startup or shortly after. The `SharedServerManager` allows up to 3 restarts in a 5-minute window, then stops retrying.

**Fix:**
- `LOG_LEVEL=debug amicus start …` to capture the crash output from the Go process.
- `AMICUS_SHARED_SERVER=0` to fall back to per-process mode (bypasses the shared server entirely).
- Reinstall: `npm install -g amicus` to ensure the bundled `opencode-ai` binary is intact.

---

## Amicus Process Not Self-Terminating

**Symptom:** `amicus start --no-ui` keeps running after the task completes.

**Cause:** The idle watchdog is disabled or has a very long timeout.

**Diagnostic steps:**
- Check per-mode overrides first: `AMICUS_IDLE_TIMEOUT_HEADLESS`, `AMICUS_IDLE_TIMEOUT_INTERACTIVE`, `AMICUS_IDLE_TIMEOUT_SERVER` (in minutes).
- The blanket `AMICUS_IDLE_TIMEOUT` overrides all modes.
- Setting any of these to `0` disables self-termination for that mode.
- `LOG_LEVEL=debug amicus start …` traces watchdog state transitions (`IdleWatchdog`).

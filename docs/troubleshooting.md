# Troubleshooting (Extended)

> Quick reference is in the [README Troubleshooting table](../README.md#troubleshooting).
> This document covers the same symptoms with more diagnostic depth.

---

## Install Fails with `EEXIST: … claude-sidecar`

**Symptom:** `npm install -g amicus` fails with `npm error code EEXIST` naming a `claude-sidecar` (or `sidecar`) file under your global npm bin directory.

**Cause:** The old upstream `claude-sidecar` package is still installed globally. Amicus ships `sidecar`/`claude-sidecar` as deprecated bin aliases, and npm refuses to overwrite bin shims owned by a different package.

**Fix:**

```bash
npm uninstall -g claude-sidecar
npm install -g amicus
```

Nothing is lost in the swap: your config (`~/.config/sidecar/`), saved keys, and past sessions are all still read by Amicus through the legacy-path shims (see `docs/SHIMS.md`).

---

## Auth / 401 Errors

**Symptom:** `401 Unauthorized`, `invalid_api_key`, or `OPENROUTER_API_KEY is not set`.

**Key resolution order** (highest priority first, implemented in `src/utils/env-loader.js`):
1. `process.env` — environment variables already set in the shell at launch. Never overwritten.
2. `~/.config/amicus/.env` — keys saved via `amicus setup`. Legacy fallback: if this file does not exist, `~/.config/sidecar/.env` is used instead (DEPRECATED shim — see `docs/SHIMS.md`).
3. `~/.local/share/opencode/auth.json` — OpenCode SDK credential store (lowest priority; Amicus only reads, never writes here).

**Diagnostic steps:**
- `amicus setup` — re-enters the wizard and writes the key to `~/.config/amicus/.env`.
- Check the model prefix matches the key: `openrouter/…` requires `OPENROUTER_API_KEY`; `google/…` requires `GOOGLE_GENERATIVE_AI_API_KEY`; `openai/…` requires `OPENAI_API_KEY`; `anthropic/…` requires `ANTHROPIC_API_KEY`.
- `LOG_LEVEL=debug amicus start …` will log which source each key was loaded from.

---

## Session Not Found

**Symptom:** `Session <id> not found`, `Error: no recent session`.

**Causes and fixes:**
- **Explicit ID mismatch:** Run `amicus list` to see available sessions, then pass `--session-id <id>` explicitly.
- **Wrong project directory:** Amicus looks for sessions under `<project>/.claude/amicus_sessions/`. If you run from a different cwd, the session won't be found. Pass `--project <path>` to override.
- **Pre-rebrand sessions:** Sessions created before the Amicus rebrand live under `.claude/sidecar_sessions/`. Amicus reads both directories via the compatibility shim in `src/session-manager.js`, so they should resolve automatically. If not, check that `resolveExistingSessionDir` can see the directory.

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

## GUI Load Failsafe

**Symptom:** Interactive Amicus window shows a load-error page instead of the OpenCode UI, with a message about the UI not responding.

**Cause:** The OpenCode web UI did not load within the allowed window (default 15 000 ms). This can happen if the Go server is still cold-starting, or if the port is already in use.

**Fix:**
- Increase the timeout: `AMICUS_GUI_LOAD_TIMEOUT_MS=30000 amicus start …`
- Check whether another process is already using the target port: `amicus list` shows active servers.
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

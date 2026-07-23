# Configuration Reference

`amicus setup` is the recommended way to configure Amicus. It opens a graphical wizard that validates your API keys live, lets you pick a default model from the live catalog, and saves everything to `~/.config/amicus/.env` (permissions `0600`). The environment variables below are for overrides and advanced tuning — most users only need the API keys section.

---

## API Keys

Amicus reads API keys from `~/.config/amicus/.env` and from `process.env`. Environment variables already set in your shell win; the `.env` file fills in anything unset; `auth.json` is the last fallback. Keys written by `amicus setup` are never silently overridden by something with higher priority.

| Variable | Purpose |
|----------|---------|
| `OPENROUTER_API_KEY` | OpenRouter — routes to any provider from a single key. |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Direct Google Gemini access (bypasses OpenRouter). |
| `OPENAI_API_KEY` | Direct OpenAI access. |
| `ANTHROPIC_API_KEY` | Direct Anthropic access. |
| `DEEPSEEK_API_KEY` | Direct DeepSeek access. |

**Running models locally?** None of the above are required — `amicus provider` configures Ollama, LM Studio, vLLM, or any other OpenAI-compatible endpoint as an additional provider at $0 marginal cost, no entry in this table needed. See [docs/usage.md § `amicus provider`](./usage.md#amicus-provider) and the `providers` key under [Config file format](#config-file-format) below.

**Bare `provider/model` is the canonical, policy-routed form.** Amicus routes it **direct-first**:
your direct provider key when one is configured, falling back to `OPENROUTER_API_KEY`
automatically when it isn't. `openrouter/provider/model` is an **explicit override** that always
forces OpenRouter, even when a direct key exists — reach for it deliberately, or for gateway-only
vendors with no direct integration (Qwen, Grok, Mistral, GLM, …), which require this form. See
[Routing](#routing) below for the full picture (`routing.prefer`, `--gateway`, the migration
notice).

| Model prefix | Credential consumed |
|-------------|-------------------|
| `provider/model` (bare, canonical) | Direct key for that vendor if configured, else `OPENROUTER_API_KEY` |
| `openrouter/provider/model` | `OPENROUTER_API_KEY`, always |

Per vendor, the bare form's direct key is: `google/...` → `GOOGLE_GENERATIVE_AI_API_KEY`,
`openai/...` → `OPENAI_API_KEY`, `anthropic/...` → `ANTHROPIC_API_KEY`, `deepseek/...` →
`DEEPSEEK_API_KEY`.

---

## Routing

`routing.prefer` in `config.json` sets the global default gateway policy; `--gateway` (CLI) or the
MCP `gateway` param overrides it per call.

| Setting | Values | Default | Effect |
|---------|--------|---------|--------|
| `routing.prefer` (config.json) | `"direct"` \| `"openrouter"` | `"direct"` | Global default: prefer the direct provider key when one exists, or always prefer OpenRouter. |
| `--gateway <mode>` (CLI, all commands that resolve a model) | `auto` \| `direct` \| `openrouter` | `auto` | Per-call override. `auto` means direct-first (honors `routing.prefer`); `direct`/`openrouter` force a specific gateway for this call and error if the required key is missing. |
| `gateway` (MCP: `amicus_start`, `amicus_continue`, `amicus_fanout`) | `"auto"` \| `"direct"` \| `"openrouter"` | `"auto"` | Same semantics as `--gateway`, for MCP callers. |

There is no `amicus setup` wizard step for `routing.prefer` yet — set it by hand-editing
`~/.config/amicus/config.json`'s top-level `routing.prefer` field (see the config.json example
below).

**One-time migration notice.** If you hold both an OpenRouter key and a direct key for a vendor,
the first launch that resolves a bare canonical id to that vendor via direct-first auto-routing
prints a one-time notice, e.g.:

```
Routing openai via direct API (previously OpenRouter).
Set routing.prefer: "openrouter" (or use --gateway openrouter) to restore.
```

The notice fires once per vendor (tracked in `config.json`'s `routing.migration_notified` map) —
not on every launch, and not when you explicitly chose the gateway with `--gateway`. Set
`routing.prefer: "openrouter"` (or pass `--gateway openrouter` per call) to keep routing everything
through OpenRouter as before.

---

## Behavior

| Variable | Purpose | Default |
|----------|---------|---------|
| `LOG_LEVEL` | Log verbosity: `error` \| `warn` \| `info` \| `debug`. Keep `error` (the default) for clean LLM consumption; use `debug` to diagnose poll issues. | `error` |
| `AMICUS_CONFIG_DIR` | Override the entire config directory — keys, model catalog, session index. Useful for isolated test environments. | `~/.config/amicus` |
| `AMICUS_ENV_DIR` | Override just the `.env` file directory (keys only). The legacy `SIDECAR_ENV_DIR` name was removed in v2.0.0 — only `AMICUS_ENV_DIR` is read now. | `~/.config/amicus` (the config dir) |
| `AMICUS_FANOUT_MAX_LEGS` | Cap the number of concurrent legs in a single fanout wave. Protects against accidental runaway costs when `--models` is a long list. Non-positive or non-integer values fall back to the default. | `10` |
| `AMICUS_MCP_CLIENT` | Force the MCP server's `--client` value (`code-local`, `code-web`, or `cowork`) instead of auto-detecting it from the caller's MCP `initialize` handshake (`clientInfo.name`). Invalid values are ignored (with a warning) and detection proceeds normally. Note: `code-web` requires an explicit `--session-dir` and is not usable for MCP-spawned sessions. | auto-detected |
| `AMICUS_MAX_SESSIONS` | Maximum number of concurrent sessions the shared OpenCode server (`src/utils/shared-server.js`) will track before rejecting new ones. Renamed from `SIDECAR_MAX_SESSIONS` in v2.0.0. | `20` |

---

## Headless Poller Tuning

These variables control the polling loop that drives headless sessions. The defaults are conservative and work for almost all workloads. You only need them if you are running against unusually slow or fast model endpoints, or if you are building tooling on top of Amicus and need tighter completion detection.

| Variable | Purpose | Default |
|----------|---------|---------|
| `AMICUS_POLL_INTERVAL_MS` | Delay between poll cycles in milliseconds. Lower values detect completion faster but add more API calls; raise it if you see rate-limit warnings from the OpenCode server. | `2000` |
| `AMICUS_POLL_CALL_TIMEOUT_MS` | Per-poll `getMessages` call timeout in milliseconds. If a poll call hangs longer than this, it is abandoned and counted as a consecutive failure. | `30000` |
| `AMICUS_STABLE_FINISHED_POLLS` | Number of consecutive idle polls required after the SDK reports the session as `completed` before the headless runner exits. A small number (2) guards against a race where the assistant message is flagged complete but trailing content is still streaming. | `2` |
| `AMICUS_STABLE_IDLE_POLLS` | Number of consecutive idle polls required when no explicit completion signal is received (approximately 60 s at the 2 s default). This is the fallback heuristic for models or SDK versions that don't emit a clean completion event. | `30` |
| `AMICUS_MAX_CONSECUTIVE_POLL_FAILURES` | Consecutive poll failures before the headless runner bails. At the 2 s interval this is approximately 30 s. Prevents a dead server from burning the full session timeout on futile polls. | `15` |

---

## GUI and Debug

| Variable | Purpose | Default |
|----------|---------|---------|
| `AMICUS_GUI_LOAD_TIMEOUT_MS` | Maximum wait in milliseconds for the Electron UI to load before the load-failsafe fires. If the OpenCode web UI fails to respond within this window, Amicus shows a load-error page instead of hanging invisibly. | `15000` |
| `AMICUS_DEBUG_PORT` | Chrome DevTools Protocol port for the Electron window. Increment (e.g. `9223`) to avoid conflicts with a running Chrome or another Amicus window. | `9222` |
| `AMICUS_MOCK_UPDATE` | Mock the update-notification state for UI development. Values: `available` \| `updating` \| `success` \| `error`. Has no effect outside development. | *(unset)* |

---

## Process Lifecycle

Amicus processes self-terminate after a configurable idle period. The idle watchdog is active in all modes — headless, interactive, and shared-server.

| Variable | Purpose | Default |
|----------|---------|---------|
| `AMICUS_IDLE_TIMEOUT` | Blanket override for all modes (minutes; `0` = disabled). | *(mode default)* |
| `AMICUS_IDLE_TIMEOUT_HEADLESS` | Per-mode override for headless sessions (minutes). | `15` |
| `AMICUS_IDLE_TIMEOUT_INTERACTIVE` | Per-mode override for interactive sessions (minutes). | `60` |
| `AMICUS_IDLE_TIMEOUT_SERVER` | Per-mode override for shared-server sessions (minutes). | `30` |

Legacy `SIDECAR_IDLE_TIMEOUT*` names were removed in v2.0.0 — rename to the `AMICUS_IDLE_TIMEOUT*` forms above. See [docs/SHIMS.md](./SHIMS.md).

Set `AMICUS_IDLE_TIMEOUT=0` to disable self-termination entirely.

### Shared server

The shared-server mode (`AMICUS_SHARED_SERVER=1`, which is the default) lets multiple Amicus sessions reuse a single OpenCode Go binary process rather than spawning one per invocation, eliminating cold-start latency on the second and subsequent calls. Disable it with `AMICUS_SHARED_SERVER=0` if you need per-process isolation or are diagnosing a crash loop.

---

## Model Names Reference

Amicus does **not** ship a frozen model list. Aliases and validation resolve against a live catalog fetched from provider APIs and cached at `~/.config/amicus/model-catalog.json`.

```bash
amicus models                   # list the full catalog
amicus models --search gemini   # filter by substring (id + display name)
amicus models --refresh         # force-fetch from provider APIs (bypasses the 24h TTL)
amicus models --check           # audit your configured aliases against the catalog
```

**Catalog mechanics:**

- **24-hour TTL.** The catalog is fetched at most once per 24 hours. `amicus models --refresh` bypasses the TTL immediately.
- **Keyless fetch.** The initial catalog fetch works without an API key — provider model lists are public. Keys are only needed when you actually launch a session.
- **Floor-only refresh guard.** A background or offline `--refresh` can never clobber a good cache with an empty or truncated response. If the fresh fetch returns fewer models than the cached catalog, Amicus keeps the existing cache and logs a warning. This protects against transient network errors.
- **Catalog location.** `~/.config/amicus/model-catalog.json` — human-readable JSON; safe to inspect or delete (it rebuilds on next use).

**Spend ledger.** Every completed run/leg appends one row to `~/.config/amicus/spend-ledger.jsonl` (tokens + resolved cost). `amicus spend` reads it for a cross-run rollup; safe to delete (starts fresh, loses history only).

**Validation on launch.** `amicus start` and `amicus fanout` validate the model against the catalog before launching. For an explicit `--model` this is **blocking** (a typo'd model name fails fast with same-vendor suggestions); for a model inherited from a previous session via `continue`/`resume` it is **advisory** (a warning is printed but the session still starts). Skip catalog validation with `--no-validate-model`, or refresh the catalog with `amicus models --refresh`.

**`amicus models --check` in CI.** The command exits with the **number of stale aliases** (capped at 100) and prints replacement suggestions for each, so it integrates cleanly into a CI gate:

```bash
amicus models --check && echo "aliases ok"
```

---

## Model Aliases

Aliases are short names that resolve to full provider-prefixed model IDs. `amicus setup` seeds a curated default set (e.g. `gemini`, `gpt`, `opus`, `deepseek`) to the bare canonical form for direct-capable vendors. You add or override aliases with:

```bash
amicus setup --add-alias fast=google/gemini-3.1-flash-lite-preview
```

Aliases are stored in `~/.config/amicus/config.json`. The source of truth for what resolves on your machine is `amicus models`, not this document.

**Full-id passthrough.** You can always bypass aliases and specify a model by its full ID — bare `provider/model` (canonical, direct-first) or `openrouter/provider/model` (explicit force-OpenRouter override):

```bash
amicus start --model google/gemini-3-pro-preview --prompt "..."       # bare canonical, direct-first
amicus start --model anthropic/claude-opus-4 --prompt "..."           # bare canonical, direct-first
amicus start --model openrouter/google/gemini-3.1-flash-lite-preview --prompt "..."  # explicit override
```

---

## Where things live

New to Amicus's disk footprint? This section maps everything it reads and writes, verified against
the source that actually writes it — not aspirational. If a claim here and the code ever disagree,
the code wins; file an issue.

### The config tree

Everything lives under `~/.config/amicus/` (`getConfigDir()` in `src/utils/config.js`):

- **Override:** set `AMICUS_CONFIG_DIR` to relocate the entire tree — keys, catalog, session index,
  both ledgers. Useful for isolated test environments.
- **Legacy fallback — removed in v2.0.0:** `getConfigDir()` no longer falls back to
  `~/.config/sidecar/` at all. Through v1.x, config data was auto-migrated forward on every run
  (a one-time, non-destructive copy into `~/.config/amicus/` the first time it didn't exist yet),
  so most installs already have everything in the new location. If you jumped straight from a
  pre-rebrand install to v2.0.0 without ever running a v1.x build, copy `~/.config/sidecar/` to
  `~/.config/amicus/` by hand. See [docs/SHIMS.md](./SHIMS.md).

| File | Written by | Contains |
|---|---|---|
| `config.json` | `amicus setup` / `saveConfig()` (`src/utils/config.js`) | Top-level keys: `default` (your default model alias), `aliases` (your alias → `provider/model` map), `councils` (saved council presets, e.g. `councils.free`), `providers` (user-defined local / OpenAI-compatible providers added via `amicus provider add`, or by hand — id → `{type, baseURL, flavor, name?, apiKeyEnv?, pricing}`; see [`amicus provider`](./usage.md#amicus-provider)), `routing` (`prefer`: `"direct"` \| `"openrouter"`; `migration_notified`: per-vendor flags for the one-time direct-migration notice — see [Routing](#routing)). `0600` permissions. |
| `.env` | `amicus setup` / `amicus key` | API keys (`OPENROUTER_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`). `0600` permissions. |
| `model-catalog.json` | `refreshCatalog()` (`src/utils/model-catalog.js`) | The cached provider model list, schema-versioned, with a **24-hour TTL**. Also carries refresh-outcome fields — `lastRefreshAttempt` and `lastRefreshError` — stamped on a *failed* refresh without touching the last-good `models`/`fetchedAt` (a bad fetch never clobbers a good cache). Human-readable JSON; safe to delete, it rebuilds on next use. |
| `sessions-index.json` | `session-index.js` (`recordSession`, written at session start) | A **global** map of `taskId → project path`, consulted only when a per-project session lookup misses (e.g. an MCP server whose cwd differs from where the session was created). Navigation aid only, never authoritative — a corrupt index degrades to "no entry," never a crash. |
| `council-ledger.jsonl` | `src/council/ledger.js` (`appendRun`), on every `council tally` | One row per council model per run — findings raised, severity breakdown, street-cred, conformance. Read back by `amicus council stats`. |
| `spend-ledger.jsonl` | `src/utils/spend-ledger.js` (`appendSpend`), new in Phase 16 | One row per completed run/leg — tokens + resolved cost. Read back by `amicus spend` for the cross-run rollup. Append is best-effort and can never fail the run it's recording; safe to delete (starts fresh, loses history only). |

**Tmp-file pattern.** Several writers (`model-catalog.json`, `sessions-index.json`, session
metadata) use an atomic write: a temp file named `.<target>.<pid>.<random>.tmp` is written
alongside the target, then renamed into place. A process killed between the write and the rename
leaves an orphaned `.tmp` file behind forever — harmless, but it accumulates. `amicus doctor --fix`
sweeps orphaned `sessions-index.json.*.tmp` files (only ones older than 60 seconds, so a live
writer's in-flight tmp file is never touched); `amicus doctor` (without `--fix`) just reports the
count.

### Session storage

Session data is split across two different roots — don't confuse them:

**1. The session root** (`getSessionRoot()` in `src/environment.js`) — resolved per client, mostly
relevant for how Claude Code/Cowork discovers *your current conversation's* context to share:

| Client | Root |
|---|---|
| `code-local` (default on macOS, or when a `DISPLAY`/`WAYLAND_DISPLAY` is present) | `~/.claude/projects/<encoded-cwd>` — the cwd is encoded by replacing `/`, `\`, the drive-letter colon, and `_` with `-` (matches Claude Code's own scheme). |
| `cowork` | Platform-specific: macOS `~/Library/Application Support/Claude/local-agent-mode-sessions`, Windows `%APPDATA%\Claude\local-agent-mode-sessions`, Linux `~/.config/Claude/local-agent-mode-sessions`. |
| `code-web` | No default — `--session-dir` is **required**; there's nothing to resolve. |

**2. Amicus's own per-session directories** — where the actual session data (metadata, conversation,
summaries) is written. These live **project-scoped**, under `.claude/amicus_sessions/<taskId>/` in
the project directory (`SESSIONS_DIR` in `src/session-manager.js`; not under the session root
above). The legacy `.claude/sidecar_sessions/` dual-read was removed in v2.0.0 — that directory is
no longer read at all. If you have session history there, rename `.claude/sidecar_sessions/` to
`.claude/amicus_sessions/` to make it visible to `amicus list`/`amicus read` again. See
[docs/SHIMS.md](./SHIMS.md).

Per-session directory contents:

| File | Written by | Notes |
|---|---|---|
| `metadata.json` | `createSession()` | Model, project, briefing, mode, thinking level, status. Atomic write. |
| `conversation.jsonl` | Appended as the session runs | One JSON line per message. |
| `progress.json` | Headless polling | Live progress snapshot (message count, latest activity, stage) — read by `amicus status` and the fanout wave heartbeat. |
| `summary.md` | `saveSummary()`, on fold/completion | The fold output — what `amicus read <id>` returns by default. |
| `subagents/<subagentId>/` | Sub-agent sessions | Same shape as a top-level session (its own `metadata.json` + `conversation.jsonl`). |

**Fanout waves.** A wave (`amicus fanout`) gets its own session dir at `<waveId>` (same
`amicus_sessions/` root); each leg is a full sibling session dir named `<waveId>-1` through
`<waveId>-N` (`deriveLegIds()` in `src/sidecar/fanout.js`). The wave-heartbeat display reads each
leg's `progress.json`/`conversation.jsonl` directly — nothing wave-specific is stored beyond the
per-leg session dirs themselves plus the wave's own `metadata.json` (type `wave`, `legs: [...]`).

### Log location + LOG_LEVEL

**Logs go to stderr only — there is no log file, anywhere, ever.** `src/utils/logger.js` writes every
entry as one JSON line via `console.error(...)`; stdout is reserved for command output (summaries,
`--json` documents). Setting `LOG_LEVEL=debug` does **not** create a file or a new destination — it
only lowers the filter threshold so `debug`-level entries (which are dropped by default) start
printing to the same stderr stream. If you want debug output captured, redirect it yourself:

```bash
LOG_LEVEL=debug amicus start --model gemini --prompt "test" --no-ui 2> debug.log
```

Levels, in order of decreasing verbosity: `debug` > `info` > `warn` > `error` (the default). Each
level includes everything above it.

### Config file format

`config.json`, commented (comments added for illustration — real JSON has none):

```jsonc
{
  // Default alias, resolved via `aliases` below when --model is omitted.
  "default": "gemini",

  // Short name -> full model id. Bare `provider/model` (canonical) routes direct-first;
  // `amicus setup` seeds direct-capable vendors this way automatically.
  // `amicus setup --add-alias name=provider/model` adds more.
  "aliases": {
    "gemini": "google/gemini-3-pro-preview",
    "gpt": "openai/gpt-5",
    "opus": "anthropic/claude-opus-4",
    "deepseek": "deepseek/deepseek-v3"
  },

  // Named council member lists, e.g. seeded by the Free OpenRouter council
  // wizard step. Run with `amicus fanout --council <name>`.
  "councils": {
    "free": ["free-gemini", "free-deepseek", "free-llama"]
  },

  // Gateway routing policy (see Routing above). `prefer` defaults to "direct"
  // when this key is absent entirely. `migration_notified` is written
  // automatically the first time the one-time direct-migration notice fires
  // for a vendor — don't hand-edit it.
  "routing": {
    "prefer": "direct",
    "migration_notified": { "openai": true }
  },

  // User-defined local / OpenAI-compatible providers (v4.2) — written by
  // `amicus provider add`, or hand-edited. id -> normalized entry; `pricing`
  // defaults to {prompt: 0, completion: 0} (the $0 tier) when omitted.
  "providers": {
    "lmstudio": { "type": "openai-compatible", "baseURL": "http://127.0.0.1:1234/v1", "flavor": "lmstudio" },
    "ollama": { "type": "openai-compatible", "baseURL": "http://127.0.0.1:11434/v1", "flavor": "ollama" },
    "vllm-lab": {
      "type": "openai-compatible",
      "baseURL": "http://127.0.0.1:8000/v1",
      "flavor": "vllm",
      "apiKeyEnv": "VLLM_LAB_API_KEY",
      "pricing": { "prompt": 0.0000005, "completion": 0.0000015 }
    }
  }
}
```

A provider id may not shadow one of the five built-in vendors — `openrouter`, `google`, `openai`, `anthropic`, `deepseek` are rejected. `apiKeyEnv` names an env var — the token itself is never written to `config.json`, only to `.env` (`0600`), by `amicus provider add --bearer` or `amicus key <id> <token>`.

An alias whose value is missing, `null`, or not a string is stripped on the next `saveConfig()`
call, with a notice printed to stderr — `config.json` never accumulates dead aliases silently.

### Uninstall instructions

`npm uninstall -g amicus` removes the package and its bin shims. It does **not** clean up everything
`amicus` and its postinstall left behind — remove these by hand if you want a full uninstall:

| What | Where | Left behind because |
|---|---|---|
| MCP registration in Claude Code | `~/.claude.json` → `mcpServers.amicus` | Written by `scripts/postinstall.js`'s `registerClaudeCode()`; npm has no hook into another app's config file. Remove the `amicus` key under `mcpServers`, or run `claude mcp remove amicus`. |
| MCP registration in Claude Desktop / Cowork | `claude_desktop_config.json` → `mcpServers.amicus` (macOS: `~/Library/Application Support/Claude/`; Windows: `%APPDATA%\Claude\`; Linux: `~/.config/claude/`) | Written by `registerClaudeDesktop()`, same reasoning. Remove the `amicus` key under `mcpServers` by hand. |
| The chat skill | `~/.claude/skills/sidecar/` | Copied by `installSkill()`. Delete the directory. |
| The council skill | `~/.claude/skills/second-opinion/` | Copied by `installCouncilSkill()`. Delete the directory — note `MODEL-NOTES.md` inside it is **your** reviewer-reliability data (seeded once, never overwritten by updates), so back it up first if you want to keep it. |
| The entire config tree | `~/.config/amicus/` (keys, config, catalog cache, both ledgers, session index) | Never touched by npm at all — it's outside the package's install footprint by design (so an uninstall doesn't silently delete your API keys or history). Delete the directory yourself: `rm -rf ~/.config/amicus` (macOS/Linux) or `Remove-Item -Recurse -Force $HOME\.config\amicus` (PowerShell). |
| Per-project session data | `<project>/.claude/amicus_sessions/` in every project you ran Amicus from | Also outside npm's footprint — it lives inside *your* project directories, not the package. Delete per-project if you want it gone. |

If you plan to reinstall later, leaving `~/.config/amicus/` in place is the point — your keys,
aliases, and council presets carry over untouched.

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `electron` ^43.1.1 | Interactive Amicus window |
| `tiktoken` ^1.0.0 | Declared for future exact tokenization; **currently unused** — token sizing uses a length/4 heuristic (see `src/context.js`, `src/context-compression.js`). |
| `jest` ^29.0.0 | Testing framework |
| `eslint` ^8.0.0 | Code linting |
| `lint-staged` ^16.3.2 | Run linters on staged files |

`opencode-ai` (>=1.0.0) is the bundled LLM conversation engine — it is installed automatically as a postinstall step and does not need a separate `npm install`.

> **Legacy names.** Pre-rebrand `SIDECAR_*` environment variables were removed entirely in v2.0.0 — they are no longer read, with no warning. Rename to the `AMICUS_*` equivalents documented above. See [docs/SHIMS.md](./SHIMS.md) for the full removal record and rename table.

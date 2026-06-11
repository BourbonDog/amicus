# Configuration Reference

`amicus setup` is the recommended way to configure Amicus. It opens a graphical wizard that validates your API keys live, lets you pick a default model from the live catalog, and saves everything to `~/.config/amicus/.env` (permissions `0600`). The environment variables below are for overrides and advanced tuning — most users only need the API keys section.

---

## API Keys

Amicus reads API keys from `~/.config/amicus/.env` and from `process.env`. The `.env` file wins over `process.env` so that keys written by `amicus setup` are not silently overridden by a shell environment.

| Variable | Purpose |
|----------|---------|
| `OPENROUTER_API_KEY` | OpenRouter — routes to any provider from a single key. |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Direct Google Gemini access (bypasses OpenRouter). |
| `OPENAI_API_KEY` | Direct OpenAI access. |
| `ANTHROPIC_API_KEY` | Direct Anthropic access. |
| `DEEPSEEK_API_KEY` | Direct DeepSeek access. |

The model prefix decides which credentials are used:

| Model prefix | Credential consumed |
|-------------|-------------------|
| `openrouter/provider/model` | `OPENROUTER_API_KEY` |
| `google/model` | `GOOGLE_GENERATIVE_AI_API_KEY` |
| `openai/model` | `OPENAI_API_KEY` |
| `anthropic/model` | `ANTHROPIC_API_KEY` |

---

## Behavior

| Variable | Purpose | Default |
|----------|---------|---------|
| `LOG_LEVEL` | Log verbosity: `error` \| `warn` \| `info` \| `debug`. Keep `error` (the default) for clean LLM consumption; use `debug` to diagnose poll issues. | `error` |
| `AMICUS_CONFIG_DIR` | Override the entire config directory — keys, model catalog, session index. Useful for isolated test environments. | `~/.config/amicus` |
| `AMICUS_ENV_DIR` | Override just the `.env` file directory (keys only). Takes precedence over the legacy `SIDECAR_ENV_DIR` name (which still works with a deprecation warning). | `~/.config/amicus` (the config dir) |
| `AMICUS_FANOUT_MAX_LEGS` | Cap the number of concurrent legs in a single fanout wave. Protects against accidental runaway costs when `--models` is a long list. Non-positive or non-integer values fall back to the default. | `10` |

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

Legacy `SIDECAR_IDLE_TIMEOUT*` names are still honored (deprecated — one-time warning on use).

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

**Validation on launch.** `amicus start` and `amicus fanout` validate the model against the catalog before launching. For an explicit `--model` this is **blocking** (a typo'd model name fails fast with same-vendor suggestions); for a model inherited from a previous session via `continue`/`resume` it is **advisory** (a warning is printed but the session still starts). Skip catalog validation with `--no-validate-model`, or refresh the catalog with `amicus models --refresh`.

**`amicus models --check` in CI.** The command exits with the **number of stale aliases** (capped at 100) and prints replacement suggestions for each, so it integrates cleanly into a CI gate:

```bash
amicus models --check && echo "aliases ok"
```

---

## Model Aliases

Aliases are short names that resolve to full provider-prefixed model IDs. `amicus setup` seeds a curated default set (e.g. `gemini`, `gpt`, `opus`, `deepseek`). You add or override aliases with:

```bash
amicus setup --add-alias fast=openrouter/google/gemini-3.1-flash-lite-preview
```

Aliases are stored in `~/.config/amicus/config.json`. The source of truth for what resolves on your machine is `amicus models`, not this document.

**Full-id passthrough.** You can always bypass aliases and specify a model by its full provider-prefixed ID:

```bash
amicus start --model openrouter/google/gemini-3.1-flash-lite-preview --prompt "..."
amicus start --model google/gemini-3-pro-preview --prompt "..."
amicus start --model anthropic/claude-opus-4 --prompt "..."
```

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `electron` ^28.0.0 | Interactive Amicus window |
| `tiktoken` ^1.0.0 | Token estimation for context sizing |
| `jest` ^29.0.0 | Testing framework |
| `eslint` ^8.0.0 | Code linting |
| `lint-staged` ^16.3.2 | Run linters on staged files |

`opencode-ai` (>=1.0.0) is the bundled LLM conversation engine — it is installed automatically as a postinstall step and does not need a separate `npm install`.

> **Legacy names.** Pre-rebrand `SIDECAR_*` environment variables are still honored (with a one-time deprecation warning) and map to their `AMICUS_*` equivalents. See [docs/SHIMS.md](./SHIMS.md) for the full mapping.

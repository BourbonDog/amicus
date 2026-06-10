# Configuration

## Environment Variables (.env)

```bash
# Required
OPENROUTER_API_KEY=sk-or-...              # Multi-model API access

# Optional
OPENCODE_COMMAND=opencode                 # Override OpenCode command path
AMICUS_DEFAULT_MODEL=openrouter/google/gemini-2.5-flash
AMICUS_TIMEOUT=15                         # Headless timeout in minutes
LOG_LEVEL=error                           # debug | info | warn | error

# Model Routing
AMICUS_DISABLE_MODEL_ROUTING=true         # Disable auto-routing for subagent tasks
AMICUS_EXPLORE_MODEL=openrouter/...       # Override model for Explore subagents

# Advanced / Debug
AMICUS_CONFIG_DIR=/path/to/config         # Override config directory (~/.config/amicus)
AMICUS_ENV_DIR=/path/to/env               # Override .env file directory
AMICUS_DEBUG_PORT=9223                    # CDP debug port (default: 9222)
AMICUS_MOCK_UPDATE=available              # Mock update UI state for testing
```

---

## Process Lifecycle

These environment variables control how Amicus processes self-terminate and share resources.

```bash
# Idle timeout overrides (values in minutes, 0 = disabled)
AMICUS_IDLE_TIMEOUT=0                     # Blanket override for all modes (0 = disabled)
AMICUS_IDLE_TIMEOUT_HEADLESS=15           # Headless mode idle timeout (default: 15 min)
AMICUS_IDLE_TIMEOUT_INTERACTIVE=60        # Interactive mode idle timeout (default: 60 min)
AMICUS_IDLE_TIMEOUT_SERVER=30             # Shared server idle timeout (default: 30 min)

# Resource limits
AMICUS_MAX_SESSIONS=20                    # Max concurrent sessions on shared server (default: 20)
AMICUS_REQUEST_TIMEOUT=5                  # Per-request timeout in minutes (default: 5 min)

# Shared server
AMICUS_SHARED_SERVER=1                    # Use shared OpenCode server (default: 1, set 0 to disable)
```

Amicus processes self-terminate after the configured idle period. The shared server (`AMICUS_SHARED_SERVER=1`) allows multiple Amicus sessions to reuse a single OpenCode Go binary process rather than spawning one per invocation.

---

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `electron` | ^28.0.0 | Interactive Amicus window |
| `tiktoken` | ^1.0.0 | Token estimation |
| `jest` | ^29.0.0 | Testing framework |
| `eslint` | ^8.0.0 | Code linting |
| `husky` | ^9.1.7 | Unused (legacy) — hooks are configured by `scripts/setup-hooks.js` |
| `lint-staged` | ^16.3.2 | Run linters on staged files |

### Bundled Dependencies

- `opencode-ai` (>=1.0.0) - LLM conversation engine (installed automatically, no separate install needed)

---

## Model Names Reference

**IMPORTANT**: Always fetch current model names from the OpenRouter API before using them.

**API Endpoint**: `https://openrouter.ai/api/v1/models`

```bash
# Fetch available models
curl https://openrouter.ai/api/v1/models | jq '.data[].id' | grep -i gemini
```

**Common Model IDs** (as of 2026-03):
| Model | OpenRouter ID |
|-------|---------------|
| Gemini 3 Flash | `openrouter/google/gemini-3-flash-preview` |
| Gemini 3 Pro | `openrouter/google/gemini-3-pro-preview` |
| Gemini 3.1 Pro | `openrouter/google/gemini-3.1-pro-preview` |

**Note**: Model names change frequently. Always verify current names via the API or `opencode models openrouter`.

---

## Model Aliases

Amicus supports model aliases configured via `amicus setup`. Config is stored at `~/.config/amicus/config.json`.

```bash
amicus setup                              # Interactive wizard
amicus start --prompt "Review auth"       # Uses config default model
amicus start --model opus --prompt "..."  # Uses alias
amicus start --model openrouter/google/gemini-3-flash-preview --prompt "..."  # Full string
```

Run `amicus setup --add-alias name=model` to add custom aliases.

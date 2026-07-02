# CLI & MCP Usage Reference

## CLI Commands

The `am` alias is interchangeable with `amicus` everywhere.

```bash
# Core workflow
amicus start --model <model> --prompt "<task>"
amicus start --model <model> --prompt-file briefing.md --no-ui --json
amicus fanout --models "gemini,deepseek,gpt" --prompt "Review this" --json
amicus list [--status <filter>] [--all] [--json]
amicus resume <task_id>
amicus continue <task_id> --prompt "Next step..."
amicus read <task_id> [--conversation|--metadata|--json]
amicus abort <task_id>
amicus abort --all

# Setup & maintenance
amicus setup                              # Full wizard: keys, default model, aliases
amicus setup --api-keys                   # Open just the API-key step
amicus setup --add-alias fast=openrouter/google/gemini-3.1-flash-lite-preview
amicus models                             # List the live catalog
amicus models --search gemini             # Filter by substring
amicus models --refresh                   # Force-fetch from provider APIs
amicus models --check                     # Audit aliases against catalog
amicus mcp                                # Start MCP server (stdio transport)
amicus update                             # Update to latest version
amicus doctor [--json] [--fix]            # Diagnose setup; --fix self-heals (e.g. Electron)
amicus key <provider> <key>               # Validate + save one API key (also: --remove / bare list)
amicus council tally <input.json> --json  # Deterministic tiers + street-cred (+ ledger append)
amicus council stats [--json]             # Reviewer reliability from the ledger
amicus council report <verdict.json> [--md|--html]   # Render the council run report
```

---

## `amicus start` — Launch a Session

```bash
amicus start --model gemini --prompt "Fact-check the auth approach"
amicus start --model opus --prompt-file briefing.md --no-ui --json
amicus start --model deepseek --prompt "Generate tests" --no-ui --timeout 30
```

**Key options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--model <model>` | Alias or full `provider/model` ID. | config default |
| `--prompt <text>` | Task description (mutually exclusive with `--prompt-file`). | *(required)* |
| `--prompt-file <path>` | Read the prompt from a UTF-8 file. Preferred for long briefings; avoids the ~32 KB Windows argument cap. | |
| `--no-ui` | Run headless (autonomous, no window). | off |
| `--json` | Emit the run result as a stable JSON run document on stdout (requires `--no-ui`). | off |
| `--timeout <minutes>` | Headless timeout. | `15` |
| `--agent <agent>` | `Chat` (interactive), `Build` (full tool access), `Plan` (read-only). | `Chat` interactive / `Build` headless |
| `--no-validate-model` | Skip catalog validation before launch. | validation on |

See `amicus start --help` or the README for the full option list (context, MCP, thinking, summary length, window position, etc.).

**Catalog validation.** For an explicit `--model`, the model is checked against the live catalog before launch — a typo'd name fails fast with same-vendor suggestions. For a model inherited from a previous session (`continue`/`resume` without `--model`), validation is **advisory**: a warning is printed but the session starts anyway. Skip with `--no-validate-model`.

---

## `amicus fanout` — Same Prompt, Many Models

Fanout runs one headless wave: every leg receives the **same** prompt concurrently (this is the shared-prompt model that the council's review stages are built on). When all legs settle, Amicus emits a single JSON wave document on stdout.

```bash
amicus fanout --models "gemini,deepseek,gpt" --prompt "Review this design" --json
amicus fanout --models "gemini,opus" --prompt-file briefing.md --json --wave-id my-wave-1
```

**Key options:**

| Option | Description |
|--------|-------------|
| `--models <a,b,c>` | Comma-separated aliases or full provider IDs (required). |
| `--prompt <text>` | Shared briefing (mutually exclusive with `--prompt-file`). |
| `--prompt-file <path>` | Read the shared briefing from a file. Preferred for long briefs and required on Windows when content exceeds ~32 KB. |
| `--wave-id <id>` | Set the wave ID explicitly; leg IDs become `<wave-id>-1` … `<wave-id>-N`. |
| `--json` | Emit the wave document on stdout. |
| `--no-validate-model` | Skip catalog validation. |

**Exit codes:** `0` all legs complete · `2` partial wave (at least one leg failed) · `1` none complete / hard failure · `130` SIGINT · `143` SIGTERM.

**Wave document shape:**

```json
{
  "schemaVersion": 1,
  "waveId": "...",
  "status": "complete",
  "counts": { "total": 2, "complete": 2, "error": 0, "timeout": 0, "aborted": 0 },
  "legs": [
    {
      "taskId": "...", "model": "...", "modelInput": "...", "agent": "...",
      "status": "complete", "summary": "...", "error": null,
      "createdAt": "...", "completedAt": "...", "durationMs": 0
    }
  ]
}
```

`status` is `complete | partial | error | aborted`. Each leg's `summary` is that model's full response.

**Fanout vs. N parallel starts.** Use `fanout` when every leg should receive the **same prompt** — this is what the council's independent review waves use. Use N separate `start` calls when each leg needs a **different prompt**.

---

## Other Commands

```bash
amicus list                          # Current project
amicus list --status running         # Filter: running, complete, aborted, error
amicus list --all                    # All projects
amicus list --json                   # Machine-readable

amicus read <id>                     # Fold summary (default)
amicus read <id> --conversation      # Full conversation
amicus read <id> --metadata          # Session metadata
amicus read <id> --json              # Stable JSON run or wave document

amicus resume <id>                   # Reopen session with full history
amicus continue <id> --prompt "..."  # New session; previous one as read-only context

amicus abort <id>                    # Stop one running session
amicus abort --all                   # Stop all running sessions in this project
```

---

## MCP Server

```bash
# Auto-registered on npm install. Manual registration:
claude mcp add-json amicus '{"command":"npx","args":["-y","amicus@latest","mcp"]}' --scope user
```

MCP tools: `amicus_start`, `amicus_status`, `amicus_wait`, `amicus_read`, `amicus_list`, `amicus_resume`, `amicus_continue`, `amicus_abort`, `amicus_setup`, `amicus_guide`, `amicus_fanout`, `amicus_council_tally`, `amicus_council_stats`, `amicus_verdict`

The async pattern is **start → status → read**: `amicus_start` (or `amicus_fanout`) returns immediately, you poll `amicus_status`, then call `amicus_read` once the status is terminal.

Session statuses: `running`, `complete`, `aborted`, `crashed`, `error`, `idle-timeout`

> Legacy `sidecar_*` tool names are no longer registered by default (v1.8.0). To restore them, add `"env": {"AMICUS_LEGACY_ALIASES": "1"}` to the MCP server entry — the default surface is `amicus_*` only. They will be removed entirely in the next major (see docs/SHIMS.md).

---

## OpenCode Agent Types

The `--agent` option controls which OpenCode agent drives the session:

| Agent | Description | Tool Access |
|-------|-------------|-------------|
| **Chat** | Interactive conversation | Reads freely, asks before writes/bash |
| **Build** | Full-access primary agent (headless default) | Read, write, bash, task |
| **Plan** | Read-only analysis | Read-only |

`--agent Chat` is interactive-only and incompatible with `--no-ui`. Custom agents defined in `~/.config/opencode/agents/` or `.opencode/agents/` are also supported.

---

## Context Sharing

When you `start` or `fanout`, Amicus automatically includes your recent Claude Code conversation history as context. Tune it:

- `--context-turns <N>` — max conversation turns to include (default 50).
- `--context-since <duration>` — time window (e.g. `2h`); overrides turns.
- `--context-max-tokens <N>` — cap the context size (default 80000).
- `--no-context` — skip parent history entirely (useful for `fanout` with a self-contained briefing).

---

## Process Self-Termination

Amicus processes automatically shut down after a period of inactivity. Default idle timeouts:

- **Headless mode**: 15 minutes
- **Interactive mode**: 60 minutes
- **Shared server**: 30 minutes

Set `AMICUS_IDLE_TIMEOUT=0` to disable self-termination entirely. For per-mode control use `AMICUS_IDLE_TIMEOUT_HEADLESS`, `AMICUS_IDLE_TIMEOUT_INTERACTIVE`, or `AMICUS_IDLE_TIMEOUT_SERVER` (all in minutes). See [docs/configuration.md](configuration.md#process-lifecycle) for the full table.

Legacy `SIDECAR_IDLE_TIMEOUT*` names still honored (deprecated).

---

## JSON Output

With `--json`, Amicus emits stable, versioned documents on stdout.

**Run document** (single session):

```json
{
  "taskId": "...", "model": "...", "modelInput": "...", "agent": "...",
  "status": "complete", "summary": "...", "error": null,
  "createdAt": "...", "completedAt": "...", "durationMs": 0
}
```

`modelInput` is the alias you passed; `model` is the resolved id. `status` is one of `complete | error | timeout | aborted | crashed | idle-timeout`.

**Exit codes:** `0` success · `2` partial wave · `1` error / hard failure · `130` SIGINT · `143` SIGTERM.

---

## Agentic Evals

```bash
node evals/run_eval.js --eval-id 1          # Single eval
node evals/run_eval.js --all                # All evals
node evals/run_eval.js --all --dry-run      # Print commands only
node evals/run_eval.js --eval-id 1 --model opus  # Override model
```

See [evals/README.md](../evals/README.md) for the full eval system documentation.

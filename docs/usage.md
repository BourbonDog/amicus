# CLI & MCP Usage Reference

## CLI Commands

```bash
# Core workflow
amicus start --model <model> --prompt "<task>" [--agent <agent>] [--validate-model]
amicus list [--status <filter>] [--all]
amicus resume <task_id>
amicus continue <task_id> --briefing "..."
amicus read <task_id> [--summary|--conversation]

# Setup & maintenance
amicus setup                        # Configure default model and aliases
amicus setup --add-alias name=model # Add a custom alias
amicus mcp                          # Start MCP server (stdio transport)
amicus update                       # Update to latest version
```

## MCP Server (for Cowork / Claude Desktop)

```bash
# Auto-registered during npm install. Manual registration:
claude mcp add-json amicus '{"command":"npx","args":["-y","amicus@latest","mcp"]}' --scope user
```

MCP tools: `amicus_start`, `amicus_status`, `amicus_read`, `amicus_list`, `amicus_resume`, `amicus_continue`, `amicus_setup`, `amicus_guide`, `amicus_abort`

Session statuses: `running`, `complete`, `aborted`, `crashed`, `error`

## OpenCode Agent Types

The `--agent` option specifies which OpenCode native agent to use:

| Agent | Description | Tool Access |
|-------|-------------|-------------|
| **Build** | Default primary agent | Full (read, write, bash, task) |
| **Plan** | Read-only analysis | Read-only |
| **General** | Full-access subagent | Full |
| **Explore** | Read-only subagent | Read-only |

Custom agents defined in `~/.config/opencode/agents/` or `.opencode/agents/` are also supported.

## Process Self-Termination

Amicus processes automatically shut down after a period of inactivity, so you do not need to manually kill lingering processes. Default idle timeouts:

- **Headless mode**: 15 minutes (`AMICUS_IDLE_TIMEOUT_HEADLESS`)
- **Interactive mode**: 60 minutes (`AMICUS_IDLE_TIMEOUT_INTERACTIVE`)
- **Shared server**: 30 minutes (`AMICUS_IDLE_TIMEOUT_SERVER`)

Set `AMICUS_IDLE_TIMEOUT=0` to disable self-termination. See [docs/configuration.md](configuration.md#process-lifecycle) for all lifecycle env vars.

## Agentic Evals

```bash
node evals/run_eval.js --eval-id 1       # Single eval
node evals/run_eval.js --all             # All evals
node evals/run_eval.js --all --dry-run   # Print commands only
node evals/run_eval.js --eval-id 1 --model opus  # Override model
```

See [evals/README.md](../evals/README.md) for the full eval system documentation.

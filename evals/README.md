# Agentic Eval System

End-to-end evaluation system that tests whether an LLM can correctly use sidecar as an MCP tool or CLI: choosing the right model, selecting appropriate agent modes, writing good briefings, and acting on results.

## How It Works

Each eval spawns a real Claude Code process pointed at an isolated sandbox project (copied from `fixtures/`). Claude works on the task autonomously, then the system grades both tool usage and decision-making quality.

In **MCP mode**, amicus is connected via `--mcp-config` and Claude uses MCP tools (`amicus_start`, `amicus_read`, etc.). The server is spawned env-free, so it exposes the default canonical surface — legacy `sidecar_*` aliases are opt-in (`AMICUS_LEGACY_ALIASES=1`) since v1.8.0 and are NOT used here.

In **CLI mode**, the `sidecar` binary is added to PATH and Claude uses bash commands (`sidecar start`, `sidecar read`, etc.).

```
run_eval.js --eval-id 1 --mode mcp
  1. Copy fixture to /tmp sandbox
  2. Generate MCP config pointing to the amicus binary
  3. Prepend mode-specific prompt prefix
  4. Spawn: claude -p "<prompt>" --output-format stream-json --mcp-config <config>
  5. Capture stream-json output lines
  6. Parse transcript: tool calls, bash commands, params, results, tokens, errors
  7. Run programmatic checks (mode-aware) against transcript + sandbox filesystem
  8. If programmatic checks pass: run LLM-as-judge (Haiku) with rubric
  9. Write results to evals/workspace/
  10. Print summary with scores, tokens, duration
```

## Running Evals

```bash
# Single eval (both modes by default)
node evals/run_eval.js --eval-id 1

# All evals
node evals/run_eval.js --all

# Dry run (print commands without executing)
node evals/run_eval.js --all --dry-run

# Override model
node evals/run_eval.js --eval-id 1 --model opus
```

### Mode Selection

Evals can run against the MCP interface, CLI interface, or both:

```bash
# MCP only (sidecar as MCP tools)
node evals/run_eval.js --eval-id 1 --mode mcp

# CLI only (sidecar as bash commands)
node evals/run_eval.js --eval-id 1 --mode cli

# Both modes (default)
node evals/run_eval.js --eval-id 1
node evals/run_eval.js --eval-id 1 --mode both
```

**MCP mode:** Claude uses amicus MCP tools (`amicus_start`, `amicus_read`, etc.) connected via `--mcp-config`. Programmatic checks use `tool_called`, `tool_param`, etc.

**CLI mode:** Claude uses bash to run `sidecar start`, `sidecar read`, etc. The sidecar binary is added to PATH. Programmatic checks use `bash_command_matches`.

Each mode uses its own programmatic criteria (`programmatic` for MCP, `programmatic_cli` for CLI). The LLM-as-judge rubric is shared.

### Requirements

- Claude Code CLI installed and authenticated
- Anthropic API key (for Claude + LLM-as-judge)
- OpenRouter API key (for sidecar model calls)
- Node.js 18+

## Eval Scenarios

| ID | Name | Fixture | Tests |
|----|------|---------|-------|
| 1 | Debug Auth Bug | `buggy-auth-app` | File read/write, code analysis, model selection |
| 2 | Generate Tests | `todo-api` | Multi-file analysis, file creation, agent mode selection |
| 3 | Research and Document | `research-task` | Research capability, file creation, model routing |
| 4 | Context Passing | `buggy-auth-app` | Parent session context flows to sidecar |

Each scenario runs in both MCP and CLI modes by default.

## Scoring

Evals use a two-stage scoring system:

### 1. Programmatic Checks (gate)

Run first. All must pass before LLM-as-judge runs. Criteria are mode-aware.

**MCP mode criteria** (from `programmatic` field):

| Criterion Type | Description |
|----------------|-------------|
| `tool_called` | Was this MCP tool invoked? |
| `tool_param` | Did a tool call include this param with this value? |
| `tool_param_matches` | Regex match on a param value |
| `tool_result_matches` | Does a tool's result contain this regex pattern? |
| `file_changed` | Was this file modified in the sandbox? |
| `file_created` | Was a new file created matching a pattern? |
| `file_contains` | Does the file contain this regex pattern? |
| `no_errors` | No tool call errors in transcript |

**CLI mode criteria** (from `programmatic_cli` field):

| Criterion Type | Description |
|----------------|-------------|
| `bash_command_matches` | Did a bash tool call contain a command matching this regex? |
| `bash_result_matches` | Does the output of a matching bash command contain this regex? |
| `file_changed` | Was this file modified in the sandbox? |
| `file_created` | Was a new file created matching a pattern? |
| `file_contains` | Does the file contain this regex pattern? |
| `no_errors` | No tool call errors in transcript |

### 2. LLM-as-Judge (quality)

If programmatic checks pass, the transcript is sent to Haiku with a rubric. Each rubric item is scored 1-5. The average must meet the `pass_threshold` (default 3.5).

Rubric items evaluate decision-making quality: model choice, briefing quality, agent mode selection, and whether the LLM acted on sidecar findings. The same rubric is used for both MCP and CLI modes.

## Adding New Evals

### 1. Create a fixture

Add a project directory under `evals/fixtures/`:

```
evals/fixtures/my-scenario/
├── package.json
└── src/
    └── ...
```

### 2. Add eval task

Add an entry to `evals/eval_tasks.json` with both `programmatic` (MCP) and `programmatic_cli` (CLI) criteria:

```json
{
  "id": 4,
  "name": "My Scenario",
  "description": "What this tests",
  "fixture": "my-scenario",
  "prompt": "Instructions for Claude...",
  "max_budget_usd": 2.0,
  "model": "sonnet",
  "success_criteria": {
    "programmatic": [
      {"type": "tool_called", "tool": "amicus_start"},
      {"type": "file_changed", "path": "src/app.js"}
    ],
    "programmatic_cli": [
      {"type": "bash_command_matches", "pattern": "sidecar\\s+start\\s+--model"},
      {"type": "file_changed", "path": "src/app.js"}
    ],
    "llm_judge": {
      "rubric": [
        "Was the model choice appropriate? (1-5)",
        "Was the briefing detailed enough? (1-5)"
      ],
      "pass_threshold": 3.5
    }
  }
}
```

### 3. Run it

```bash
node evals/run_eval.js --eval-id 4
```

## Architecture

```
evals/
├── run_eval.js              # CLI orchestrator (--mode mcp|cli|both)
├── claude_runner.js          # Sandbox creation, MCP/CLI config, Claude process spawning
├── transcript_parser.js      # Parse stream-json: tool calls, bash commands, tokens
├── evaluator.js              # Programmatic checks (8 types) + LLM-as-judge
├── result_writer.js          # Write results, format summary with mode labels
├── eval_tasks.json           # Eval task definitions (MCP + CLI criteria)
├── fixtures/                 # Seed projects (one per scenario)
│   ├── buggy-auth-app/      # Express app with missing await bug
│   ├── todo-api/            # CRUD API with no tests
│   └── research-task/       # Empty project for research eval
├── tests/                    # Unit tests (33 tests, 4 suites)
│   ├── transcript_parser.test.js
│   ├── evaluator.test.js
│   ├── claude_runner.test.js
│   └── result_writer.test.js
└── workspace/                # Output (gitignored)
    └── eval-{id}-{mode}-{timestamp}/
        ├── result.json       # Scores, criteria results, sidecar calls, mode
        └── transcript.jsonl  # Raw stream-json from Claude
```

## Result Format

Each eval produces a `result.json`:

```json
{
  "eval_id": 1,
  "eval_name": "Debug Auth Bug",
  "mode": "mcp",
  "status": "PASS",
  "score": 0.85,
  "duration_seconds": 92,
  "token_usage": {
    "claude": {"input_tokens": 12500, "output_tokens": 3200}
  },
  "programmatic_results": [
    {"type": "tool_called", "tool": "amicus_start", "passed": true, "detail": "Called"}
  ],
  "judge_results": {
    "scores": [{"rubric": "Model choice", "score": 4}],
    "average": 4.0,
    "passed": true
  },
  "sidecar_calls": [
    {"tool": "amicus_start", "params": {"model": "gemini", "agent": "Build"}}
  ],
  "cli_commands": []
}
```

The summary output shows all results in a table with mode labels:

```
Sidecar Eval Results
====================
Eval 1 (MCP): Debug Auth Bug              PASS  0.85  (92s, 15.7k tok)
  Sidecar: gemini, agent=Build
Eval 1 (CLI): Debug Auth Bug              PASS  0.80  (105s, 18.2k tok)
  Sidecar: sidecar start --model gemini --briefing "debug auth"
Eval 2 (MCP): Generate Tests              PASS  0.90  (145s, 22.1k tok)
  Sidecar: gemini-pro, agent=Build
Eval 2 (CLI): Generate Tests              FAIL  0.40  (120s, 19.8k tok)
  Sidecar: (no sidecar command found)

Overall: 3/4 passed, avg score: 0.74, total: 75.3k tok
```

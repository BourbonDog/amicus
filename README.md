> ### ⚠️ This is **Amicus** — a work-in-progress rebrand
>
> **Amicus** is an independent fork of [Claude Sidecar](https://github.com/jrenaldi79/sidecar) (MIT, © John Renaldi) that bundles the Sidecar engine with a multi-model **LLM Council** (`skills/second-opinion/`) and an ad-hoc multi-model **chat** skill (`skill/`) — installable as one system, with Claude as the orchestrator. See [`NOTICE`](./NOTICE) for attribution.
>
> The documentation below reflects the Amicus rebrand.

---

<div align="center">

# Amicus

**A parallel AI window that shares your context. Talk to any model while your main session keeps working.**

![Amicus: Fork, Work, Fold](./docs/hero.png)

Amicus opens a real UI alongside Claude Code or Cowork, pre-loaded with your conversation context, connected to Gemini, GPT, DeepSeek, Qwen, Grok, or any other model. You interact with Amicus in parallel (fact-check Claude's work, get a second opinion, explore a tangent) then fold the results back when you're ready.

[![Watch the demo](https://img.youtube.com/vi/Cl_RA8HAZJE/maxresdefault.jpg)](https://youtu.be/Cl_RA8HAZJE)

> **Supported clients:** Claude Code CLI and Claude Cowork are fully tested and supported. Claude Code web and Claude Desktop are experimental.

[![npm version](https://img.shields.io/npm/v/amicus?color=D97757&labelColor=1A1C29)](https://www.npmjs.com/package/amicus)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?labelColor=1A1C29)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen?labelColor=1A1C29)](https://nodejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?labelColor=1A1C29)](./CONTRIBUTING.md)
[![GitHub last commit](https://img.shields.io/github/last-commit/jrenaldi79/sidecar?labelColor=1A1C29)](https://github.com/jrenaldi79/sidecar/commits)
[![GitHub stars](https://img.shields.io/github/stars/jrenaldi79/sidecar?style=social)](https://github.com/jrenaldi79/sidecar)

</div>

---

## Table of Contents

- [What Is Amicus?](#what-is-amicus)
- [Use Cases](#use-cases)
- [Getting Started](#getting-started)
- [Quick Start](#quick-start)
- [How It Works](#how-it-works)
- [Features](#features)
- [Commands](#commands)
- [Agent Modes](#agent-modes)
- [Models](#models)
- [MCP Integration](#mcp-integration)
- [Configuration](#configuration)
- [Understanding Amicus Output](#understanding-amicus-output)
- [Troubleshooting](#troubleshooting)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [Built On](#built-on)
- [License](#license)

---

## What Is Amicus?

Amicus is a **literal second window** that runs alongside your Claude Code or Cowork session. It:

1. **Shares your context.** Your current conversation history is automatically extracted and passed to the Amicus session. No copy-pasting, no re-explaining.
2. **Runs in parallel.** Your main Claude session keeps working while you interact with Amicus. It's not sequential, it's simultaneous.
3. **Connects to any model.** Gemini 3.1 Pro (1M context), GPT-5.4, DeepSeek v3.2, Qwen, Grok: whatever's best for the job.
4. **Folds back cleanly.** When you're done, click FOLD and a structured summary returns to your main context. No noise, just results.

![What Is Amicus: Fork and Fold](./docs/what-is-amicus.png)

---

## Use Cases

### Fact-Check Claude's Work
Claude just proposed an architecture or made a claim? Open Amicus to a different model and verify it, with full context already loaded.

### Get a Second Opinion on a Feature
Designing something complex? Fork the conversation to Gemini or GPT-5.4 for an independent take. Compare approaches before committing to one.

### Deep-Dive Without Polluting Context
Need to explore a rabbit hole (trace a bug, read a huge file, research an API)? Do it in Amicus. Your main session stays clean and focused.

### Parallel Investigation
While Claude implements a fix, spin up Amicus to review the test coverage, audit security implications, or draft documentation, all at the same time.

### Leverage Model Strengths
- **Gemini 3.1 Pro**: 1M token context for analyzing entire codebases
- **GPT-5.4**: Strong at code generation and refactoring
- **DeepSeek v3.2**: Cost-effective reasoning at scale
- **Qwen 3.5**: High-quality open-weight reasoning
- **Grok**: Fast iteration and broad knowledge

---

## Getting Started

### Prerequisites

- Node.js 18+

### 1. Install

```bash
npm install -g amicus
```

On install, Amicus automatically configures itself for all supported clients:
- **Claude Code CLI**: Registers an MCP server and installs a Skill, so Claude can launch and manage Amicus sessions on your behalf
- **Claude Desktop & Cowork**: Registers an MCP server, so Amicus tools appear natively in the UI

No manual registration needed. Just install and run setup.

### 2. Run Setup

```bash
amicus setup
```

This launches a **graphical setup wizard** that walks you through everything:

| Step | What It Does |
|------|-------------|
| **1. API Keys** | Enter keys for OpenRouter, Google, OpenAI, and/or Anthropic. Each key is validated live against the provider's API. Keys are stored locally at `~/.config/amicus/.env` with restricted permissions (0600). |
| **2. Default Model** | Choose your go-to model from 20+ aliases (Gemini, GPT, Opus, DeepSeek, Qwen, Grok, and more). This is what Amicus uses when you omit `--model`. |
| **3. Model Routing** | Configure which provider serves each model. If you have both an OpenRouter key and a direct Google key, you can route Gemini through Google directly and everything else through OpenRouter. |
| **4. Review** | Summary of your configuration before saving. |

> **Headless environments:** If Electron isn't available, the wizard falls back to a readline-based setup in the terminal.

You can also manage individual settings without re-running the full wizard:

```bash
amicus setup --add-alias fast=openrouter/google/gemini-3.1-flash-lite-preview
```

### 3. Verify

```bash
amicus start --model gemini --prompt "Hello, confirm Amicus is working"
```

A window should open alongside your editor with Gemini ready to chat, pre-loaded with your Claude Code context.

---

## Quick Start

```bash
# Fact-check: open Amicus to verify Claude's approach
amicus start --model gemini --prompt "Fact-check the auth approach Claude just proposed"

# Second opinion: get a different model's take
amicus start --model gpt --prompt "Review this feature design. Is there a simpler approach?"

# Deep dive: investigate without polluting your main context
amicus start --model gemini-pro --prompt "Analyze the entire codebase architecture"

# Headless: autonomous, no UI, summary returns automatically
amicus start --model gemini --prompt "Generate Jest tests for src/utils/" --no-ui

# Use your configured default model (just omit --model)
amicus start --prompt "Security review the payment module"
```

---

## How It Works

1. **Context sharing.** Amicus reads your Claude Code session from `~/.claude/projects/[project]/[session].jsonl` and passes it to the Amicus model automatically.
2. **Window launch.** An Electron window opens alongside your editor with the Amicus UI (OpenCode-powered).
3. **Parallel interaction.** You converse with the Amicus model while your main Claude session continues working independently.
4. **Fold.** Click FOLD (or press `Cmd+Shift+F`) to generate a structured summary.
5. **Context return.** The summary flows back into your Claude Code context for Claude to act on.

The Electron shell uses a **BrowserView** architecture: the OpenCode web UI loads in a dedicated viewport, while the Amicus toolbar (branding, timer, Fold button) renders in the bottom 40px. No CSS conflicts with the host app.

![Amicus Architecture](./docs/architecture.png)

---

## Features

### Interactive + Headless Modes

**Interactive (default):** Opens a window alongside Claude Code. You converse with Amicus, steer the investigation, then click **FOLD** to generate a structured summary. Switch models mid-conversation without restarting.

**Headless (`--no-ui`):** The agent works autonomously in the background. When done, outputs a `[SIDECAR_FOLD]` summary automatically. Ideal for bulk tasks: test generation, documentation, linting.

### Context Passing

Your conversation history is automatically shared with Amicus. No re-explaining needed. Filter by turns (`--context-turns`) or time window (`--context-since 2h`).

### Adaptive Personality

Amicus detects its launch context and adapts:
- **From Claude Code** (`--client code-local`): Engineering-focused (debug, implement, review)
- **From Cowork** (`--client cowork`): General-purpose (research, analyze, write, brainstorm)

### MCP Server Inheritance

Amicus automatically discovers MCP servers configured in your Claude Code session (`~/.claude.json`) and passes them through to the Amicus OpenCode instance. Your Amicus session has access to the same tools you do. Control this with:

- `--no-mcp` disables MCP inheritance entirely
- `--exclude-mcp <name>` excludes specific servers (repeatable)
- `--mcp name=url` adds additional servers

### Safety Features

- **Conflict detection**: Warns when files changed externally while Amicus was running
- **Drift awareness**: Indicates when the Amicus context may be stale relative to your current session
- **Pre-flight validation**: All CLI inputs are validated before anything launches

### Auto-Update

Amicus checks the npm registry for updates once every 24 hours (cached, zero-latency background check). When an update is available:

- **CLI:** A notification box appears in your terminal after any command
- **Electron UI:** A banner appears above the toolbar with a one-click **Update** button. No terminal commands needed.

Updating installs the latest code **and** re-runs the postinstall step, so your Claude Code Skill file and MCP registrations are always kept in sync with the latest version. No manual re-registration needed.

```bash
# Or update manually from the CLI
amicus update
```

### Session Persistence

Every Amicus session is persisted. List past sessions, read their summaries, reopen them, or chain them together.

```bash
amicus list                           # See all past Amicus sessions
amicus read abc123                    # Read the summary
amicus resume abc123                  # Reopen the exact session
amicus continue abc123 --prompt "..." # New session building on previous findings
```

### MCP Integration

Full MCP server for Claude Desktop and Cowork. Amicus tools appear natively inside Cowork's sandboxed environment. No CLI required.

---

## Commands

### `amicus start`: Launch an Amicus Session

```bash
amicus start --model <model> --prompt "<task>"
```

| Option | Description | Default |
|--------|-------------|---------|
| `--model` | Model to use (alias or full string) | Config default |
| `--prompt` | Task description | *(required)* |
| `--no-ui` | Headless autonomous mode | false |
| `--agent` | Agent mode: `chat`, `plan`, `build` | `chat` |
| `--timeout` | Headless timeout in minutes | 15 |
| `--context-turns N` | Max conversation turns to include | 50 |
| `--context-since` | Time filter: `30m`, `2h`, `1d` | |
| `--context-max-tokens N` | Context size cap | 80000 |
| `--no-context` | Skip parent conversation context | false |
| `--thinking` | Reasoning effort: `none` `minimal` `low` `medium` `high` `xhigh` | `medium` |
| `--summary-length` | Output verbosity: `brief` `normal` `verbose` | `normal` |
| `--session-id` | Explicit Claude Code session ID | Most recent |
| `--mcp` | Add MCP server: `name=url` or `name=command` | |
| `--mcp-config` | Path to `opencode.json` with MCP config | |
| `--no-mcp` | Don't inherit MCP servers from parent | false |
| `--exclude-mcp` | Exclude specific MCP server (repeatable) | |
| `--client` | Client context: `code-local` `cowork` (`code-web` experimental) | `code-local` |

### `amicus list`: Browse Past Sessions

```bash
amicus list                    # Current project
amicus list --status complete  # Completed only
amicus list --all              # All projects
amicus list --json             # JSON output
```

### `amicus resume`: Reopen a Session

```bash
amicus resume <task_id>
```

Reopens the exact OpenCode session with full conversation history preserved.

### `amicus continue`: Build on Previous Work

```bash
amicus continue <task_id> --prompt "Now implement the fix from the analysis"
```

Starts a **new** session with the previous session's conversation as read-only background context. Optionally switch models.

### `amicus read`: Read Session Output

```bash
amicus read <task_id>                  # Summary (default)
amicus read <task_id> --conversation   # Full conversation
amicus read <task_id> --metadata       # Session metadata
```

### `amicus abort`: Stop a Running Session

```bash
amicus abort <task_id>
```

Immediately stops a running Amicus session. The session status changes to `aborted`.

### `amicus setup`: Configure Amicus

```bash
amicus setup                                           # Full setup wizard (GUI)
amicus setup --add-alias fast=openrouter/google/gemini-3.1-flash-lite-preview
```

Opens the graphical setup wizard for API keys, default model, model routing, and aliases. See [Getting Started](#2-run-setup) for details.

### `amicus update`: Update to Latest Version

```bash
amicus update
```

Updates Amicus to the latest npm release. In the Electron UI, click the **Update** button in the banner instead. No terminal needed.

---

## Agent Modes

Three primary modes control what Amicus can do autonomously:

| Agent | Reads | Writes/Bash | Best For |
|-------|-------|-------------|----------|
| **Chat** *(default)* | Auto-approved | Asks permission | Questions, analysis, fact-checking, guided exploration |
| **Plan** | Auto-approved | Blocked entirely | Code review, architecture analysis, security audits |
| **Build** | Auto-approved | Auto-approved | Implementation tasks, test generation, headless batch work |

```bash
# Chat: good for fact-checking and analysis with human-in-the-loop (default)
amicus start --model gemini --prompt "Verify Claude's approach to the auth refactor"

# Plan: strict read-only, no changes possible
amicus start --model gemini --agent Plan --prompt "Security review of the payment module"

# Build: full autonomy, use when you explicitly want it to write code
amicus start --model gemini --agent Build --no-ui \
  --prompt "Generate comprehensive Jest tests for src/utils/"
```

> **Headless mode note:** `--no-ui` defaults to `Build`. The `Chat` agent requires interactive UI for write permissions and stalls in headless mode.

---

## Models

### Using Aliases (after `amicus setup`)

| Alias | Model | Notes |
|-------|-------|-------|
| `gemini` | Gemini 3.1 Flash Lite | Fast, cost-effective |
| `gemini-pro` | Gemini 3.1 Pro | Deep analysis, 1M context |
| `gpt` | GPT-5.4 | Code generation, refactoring |
| `gpt-pro` | GPT-5.4 Pro | Extended reasoning |
| `codex` | GPT-5.3 Codex | Code-specialized |
| `claude` / `sonnet` | Claude Sonnet 4.6 | Balanced capability |
| `opus` | Claude Opus 4.6 | Complex reasoning |
| `haiku` | Claude Haiku 4.5 | Fast, lightweight |
| `deepseek` | DeepSeek v3.2 | Cost-effective reasoning |
| `qwen` | Qwen 3.5 397B | High-quality open-weight |
| `qwen-coder` | Qwen 3 Coder | Code-specialized |
| `qwen-flash` | Qwen 3.5 Flash | Fast inference |
| `mistral` | Mistral Large | Strong European model |
| `devstral` | Devstral | Code-focused Mistral |
| `grok` | Grok 4.1 Fast | Fast iteration |
| `kimi` | Kimi K2.5 | Multilingual |
| `glm` | GLM-5 | Chinese-English bilingual |
| `minimax` | MiniMax M2.5 | Multimodal |
| `seed` | Seed 2.0 Mini | Lightweight |
| *(omit `--model`)* | | Your configured default |

### Using Full Model Strings

| Access | Format | Example |
|--------|--------|---------|
| OpenRouter | `openrouter/provider/model` | `openrouter/google/gemini-3.1-pro-preview` |
| Direct Google | `google/model` | `google/gemini-3.1-flash-lite-preview` |
| Direct OpenAI | `openai/model` | `openai/gpt-5.4` |
| Direct Anthropic | `anthropic/model` | `anthropic/claude-opus-4-6` |

The prefix determines which credentials are used. Model names evolve; verify current names:

```bash
curl https://openrouter.ai/api/v1/models | jq '.data[].id' | grep -i gemini
```

---

## MCP Integration

For Claude Desktop and Cowork, Amicus exposes a full MCP server auto-registered on install.

To register manually:
```bash
claude mcp add-json amicus '{"command":"npx","args":["-y","amicus@latest","mcp"]}' --scope user
```

| MCP Tool | Description |
|----------|-------------|
| `amicus_start` | Spawn an Amicus session (returns task ID immediately) |
| `amicus_status` | Poll for completion |
| `amicus_read` | Get results: summary, conversation, or metadata |
| `amicus_list` | List past sessions |
| `amicus_resume` | Reopen a session |
| `amicus_continue` | New session building on previous |
| `amicus_abort` | Stop a running session |
| `amicus_setup` | Open setup wizard |
| `amicus_guide` | Get usage instructions |

**Async pattern:** `amicus_start` returns a task ID immediately. Poll with `amicus_status`, then read results with `amicus_read`. This is non-blocking: the calling agent can do other work while Amicus runs.

---

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENROUTER_API_KEY` | API key for OpenRouter (multi-model access) | *(required)* |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Direct Google API key (bypasses OpenRouter) | |
| `OPENAI_API_KEY` | Direct OpenAI API key | |
| `ANTHROPIC_API_KEY` | Direct Anthropic API key | |
| `LOG_LEVEL` | Logging verbosity: `error` `warn` `info` `debug` | `error` |
| `AMICUS_CONFIG_DIR` | Override config directory | `~/.config/amicus` |
| `AMICUS_ENV_DIR` | Override `.env` file directory | |
| `AMICUS_TIMEOUT` | Default headless timeout in minutes | `15` |
| `OPENCODE_COMMAND` | Override OpenCode binary path | `opencode` |

API keys configured via `amicus setup` are stored in `~/.config/amicus/.env` with restricted permissions (0600). You can also set them as environment variables directly.

---

## Understanding Amicus Output

Every fold produces a structured summary:

```markdown
## Amicus Results: [Title]

**Context Age:** [How stale the context might be]
**FILE CONFLICT WARNING** [If files changed while Amicus ran]

**Task:** What was requested
**Findings:** Key discoveries
**Attempted Approaches:** What was tried but didn't work
**Recommendations:** Concrete next steps
**Code Changes:** Specific diffs with file paths
**Files Modified:** List of changed files
**Assumptions Made:** Things to verify
**Open Questions:** Remaining uncertainties
```

---

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|---------|
| `command not found: opencode` | OpenCode binary not found | Reinstall: `npm install -g amicus` (opencode-ai is bundled) |
| 401 Unauthorized / auth errors | API key missing or wrong provider prefix | Run `amicus setup` to configure keys, or verify `openrouter/...` prefix matches your credentials |
| Headless stalls silently | `Chat` agent in headless mode | Use `--agent build`, not `--agent chat` in headless mode |
| Session not found | No matching session ID | Run `amicus list`, or omit `--session-id` to use most recent |
| No conversation history found | Project path encoding | Check `ls ~/.claude/projects/`. `/` and `_` are encoded as `-` in path |
| Headless timeout | Task too complex for default timeout | Increase with `--timeout 30` |
| Summary corrupted | Debug output leaking to stdout | Use `LOG_LEVEL=debug` to diagnose |
| Multiple active sessions | Ambiguous session resolution | Pass `--session-id` explicitly |
| Setup wizard won't open | Electron not available | Falls back to terminal setup automatically; ensure `electron` is in dependencies |

**Debug logging:**
```bash
LOG_LEVEL=debug amicus start --model gemini --prompt "test" --no-ui
```

---

## Documentation

| Doc | Description |
|-----|-------------|
| [SKILL.md](./skill/SKILL.md) | Complete skill reference for Claude Code |
| [Electron Testing](./docs/electron-testing.md) | Chrome DevTools Protocol patterns for UI testing |
| [Agentic Evals](./evals/README.md) | End-to-end eval system for testing LLM interactions with Amicus |

---

## Contributing

Contributions are welcome!

```bash
git clone https://github.com/BourbonDog/amicus.git
cd amicus
npm install
npm test
```

`npm install` configures the git hooks (`core.hooksPath=.husky`) via the `prepare` script. If you install with `--ignore-scripts`, run `node scripts/setup-hooks.js` once instead. Hooks then fire in the clone and in every linked git worktree — no per-worktree setup.

### Autonomous UI Testing via Chrome DevTools Protocol

Amicus uses a novel approach for testing Electron UI features: instead of fragile DOM mock tests, we verify the real UI by connecting to the running Electron app via the **Chrome DevTools Protocol** (CDP).

**How it works:**

1. Launch Amicus with `AMICUS_DEBUG_PORT=9223` (avoids conflict with Chrome on 9222)
2. Use `AMICUS_MOCK_UPDATE=available` or other mock env vars to force specific UI states
3. Connect to `http://127.0.0.1:9223/json` to discover debug targets
4. Execute JavaScript in the Electron renderer via WebSocket to inspect DOM state
5. Take a screenshot with `screencapture` to visually verify

```bash
# Launch with mock update banner and debug port
AMICUS_MOCK_UPDATE=available AMICUS_DEBUG_PORT=9223 \
  amicus start --model gemini --prompt "test"

# Find the toolbar page
TOOLBAR_ID=$(curl -s http://127.0.0.1:9223/json | \
  node -e "const d=require('fs').readFileSync(0,'utf8'); \
  const p=JSON.parse(d).find(p=>p.url?.startsWith('data:')); \
  console.log(p?.id||'NOT_FOUND')")

# Inspect toolbar state (update banner, buttons, timer)
node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:9223/devtools/page/$TOOLBAR_ID');
ws.on('open', () => ws.send(JSON.stringify({
  id: 1, method: 'Runtime.evaluate',
  params: { expression: '({banner: document.getElementById(\"update-banner\")?.style?.display, text: document.getElementById(\"update-text\")?.textContent})', returnByValue: true }
})));
ws.on('message', d => { const m=JSON.parse(d.toString()); if(m.id===1){console.log(JSON.stringify(m.result?.result?.value,null,2));ws.close();process.exit(0);} });
setTimeout(() => { ws.close(); process.exit(0); }, 3000);
"
```

This approach tests real rendering in a real Electron window, not mocked DOM behavior. See [docs/electron-testing.md](docs/electron-testing.md) for the full reference.

---

## Built On

Amicus is a harness built on top of [**OpenCode**](https://opencode.ai), the open-source AI coding engine. OpenCode provides the conversation runtime, tool execution framework, agent system, and web UI. Amicus adds context sharing from Claude Code, the Electron shell, fold/summary workflow, session persistence, and multi-client support (CLI, MCP, Cowork). We don't reinvent the wheel. OpenCode handles the hard parts of LLM interaction so Amicus can focus on the parallel-window workflow.

---

## License

MIT. [John Renaldi](https://github.com/jrenaldi79)

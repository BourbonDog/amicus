---
name: sidecar
argument-hint: "[model] [prompt...]"
description: >
  Spawn a conversation with another LLM (Gemini, GPT, ChatGPT, Codex, o3, DeepSeek,
  Qwen, Grok, Mistral, or Claude as a target) and fold the results back into your
  context. TRIGGER when: the user asks to talk to, chat with, call, use, or spawn
  another LLM or model; names any non-current model; wants parallel exploration or
  a quick take from a different model; or says "sidecar", "fork", or "fold". This
  is NOT the skill for structured multi-model review of provided material — requests
  like "second opinion", "council review", or red-team/stress-test against criteria
  belong to the second-opinion skill. Before running any amicus command, read the
  Operating Rules section at the top of this document: background launches,
  --prompt-file briefings, interactive vs headless defaults, fanout for same-prompt
  multi-model runs, the o3/o3-pro cost warning, and the npx fallback when amicus is
  not on PATH.
---

# Amicus: Multi-Model Sidecar Tool

Spawn parallel conversations with different LLMs (Gemini, GPT, ChatGPT, Codex, o3, etc.) and fold results back into your context.

## Slash invocation (`/amicus:sidecar <model> <prompt…>`)

When invoked as a slash command with arguments:

- First argument (the model): $1
- Full argument string: $ARGUMENTS

Treat $1 as the target model alias and the remainder of $ARGUMENTS as the prompt.
If $1 is not a plausible model alias (gemini, gemini-pro, gpt, codex, deepseek,
qwen, grok, mistral, glm, …), treat the ENTIRE argument string as the prompt and
default to gemini. Then apply the critical rules below exactly as for any other
invocation (run_in_background: true, --prompt-file for long briefings, interactive
by default for a single model, never o3/o3-pro unprompted).

## Operating Rules

These rules are mandatory for every amicus invocation in this skill:

1. **ALWAYS launch amicus CLI commands with the Bash tool's `run_in_background: true`.** Never run `amicus start/resume/continue` in the foreground.
2. **The fold summary returns on stdout** when the user clicks Fold in the GUI or the headless agent finishes. Use TaskOutput to read it when the background task completes.
3. **For long or multi-line briefings, write them to a temp file and pass `--prompt-file <path>`** (mutually exclusive with `--prompt`; avoids shell-quoting hazards and argument-size caps).
4. **NEVER use o3 or o3-pro unless the user explicitly asks for it by name.** These models are extremely expensive (\$10-60+ per request). If the user asks for o3, warn them about the cost before proceeding. Default to gemini for most tasks. The CLI enforces this in code: a built-in budget gate refuses any model above a per-$/Mtok threshold (o3-pro class) before launch unless you pass `--no-cost-gate`; `--max-cost <$>` sets a soft estimated-total ceiling. When a run is refused with `BUDGET_EXCEEDED`, relay the gate's message — don't silently retry with the flag.
5. **When the user asks to query MULTIPLE LLMs simultaneously** (e.g., "ask Gemini AND ChatGPT", "compare Gemini vs GPT"), ALWAYS use `--no-ui` (headless) for all of them unless the user explicitly requests interactive. Opening multiple Electron windows at once is disruptive. Launch them all in parallel with `run_in_background: true`.
6. **When the SAME prompt should go to N models, use `amicus fanout --models "a,b,c" --prompt-file <path> --json`** (one headless wave, one JSON result) instead of N separate start calls. Different prompts per model → separate parallel `amicus start --no-ui` calls.
7. **For a SINGLE-model sidecar, DEFAULT to interactive** — omit `--no-ui` so the Electron UI opens and the user can watch, converse, and click Fold. Use `--no-ui` for a single model only when the user asks for headless/autonomous, or for unattended bulk automation. Interactive launches still use `run_in_background: true`.
8. **If `amicus` is not on PATH** (typical for plugin-only installs), run every command in this skill as `npx -y amicus@latest <args>` (e.g. `npx -y amicus@latest start --model gemini --prompt "..."`), or use the MCP tools (`amicus_start`, `amicus_wait`, `amicus_status`, `amicus_read`, …) instead. Do not conclude the tool is broken because `amicus` is not found.

## Installation

```bash
npm install -g amicus
```

Verify installation:
```bash
amicus --version
```

### Requirements
- Node.js 18+
- API credentials (see Setup below)
- Electron (installed automatically as optional dependency)

### MCP Server (Auto-Registered)

On install, an MCP server is auto-registered for Claude Cowork and Claude Desktop. If you're in an MCP-enabled environment, you can use `amicus_start`, `amicus_wait`, `amicus_status`, `amicus_read`, and other MCP tools directly instead of CLI commands. Call `amicus_guide` for detailed usage instructions.

---

## Setup: Configuring API Access

Amicus uses the OpenCode SDK to communicate with LLM providers. You need to configure API credentials for your chosen provider(s).

**Recommended:** run `amicus setup` — a guided wizard that stores keys in `~/.config/amicus/.env`, picks your default model from the live catalog, and seeds aliases. The options below are manual alternatives.

### Option A: OpenRouter (Recommended for Multi-Model Access)

OpenRouter provides unified access to many models (Gemini, GPT-4, Claude, o3, etc.) with a single API key. If you'd rather not hand-edit JSON, run `amicus setup` instead — it stores the key for you.

**Step 1: Get an OpenRouter API key**
- Sign up at https://openrouter.ai
- Go to Keys → Create Key
- Copy your key (starts with `sk-or-v1-...`)

**Step 2: Configure credentials**

Create the auth file:
```bash
mkdir -p ~/.local/share/opencode
cat > ~/.local/share/opencode/auth.json << 'EOF'
{
  "openrouter": {
    "apiKey": "sk-or-v1-YOUR_KEY_HERE"
  }
}
EOF
```

**Step 3: Verify setup**
```bash
amicus start --model gemini --prompt "Say hello" --no-ui
```

**Model names with OpenRouter:**
When using OpenRouter, prefix the model with `openrouter/`:
```bash
amicus start --model gemini --prompt "..."
amicus start --model gpt --prompt "..."
amicus start --model claude --prompt "..."
```

### Option B: Direct API Keys (Provider-Specific)

Use this if you have API keys directly from Google, OpenAI, or Anthropic.

**For Google Gemini:**
```bash
export GOOGLE_GENERATIVE_AI_API_KEY=your-google-api-key
```

**For OpenAI:**
```bash
export OPENAI_API_KEY=your-openai-api-key
```

**For Anthropic:**
```bash
export ANTHROPIC_API_KEY=your-anthropic-api-key
```

Add these to your shell profile (`~/.bashrc`, `~/.zshrc`) for persistence.

**zsh users:** `~/.zshrc` is only sourced by interactive shells. If you use amicus from Claude Code, CI, or scripts, either:
- Run `amicus setup` to store keys in amicus's config (recommended)
- Move your exports to `~/.zshenv` (sourced by all zsh shell types)

**Model names with direct API keys:**
When using direct API keys, use the provider/model format WITHOUT the `openrouter/` prefix:
```bash
amicus start --model google/<model-name> --prompt "..."
amicus start --model openai/<model-name> --prompt "..."
amicus start --model anthropic/<model-name> --prompt "..."
```

### Model Naming Summary

| Provider Access | Model Name Format | Example |
|-----------------|-------------------|---------|
| OpenRouter | `openrouter/provider/model` | `openrouter/google/<model-name>` |
| Direct Google API | `google/model` | `google/<model-name>` |
| Direct OpenAI API | `openai/model` | `openai/<model-name>` |
| Direct Anthropic API | `anthropic/model` | `anthropic/<model-name>` |

**Important:** The model name format tells the SDK which authentication to use:
- `openrouter/...` → Uses OpenRouter API key from auth.json
- `google/...` → Uses `GOOGLE_GENERATIVE_AI_API_KEY` environment variable
- `openai/...` → Uses `OPENAI_API_KEY` environment variable
- `anthropic/...` → Uses `ANTHROPIC_API_KEY` environment variable

---

## When to Use Sidecars

**DO spawn a sidecar when:**
- Task benefits from a different model's strengths (Gemini's large context, o3's reasoning)
- Deep exploration that would pollute your main context
- User explicitly requests a different model
- Parallel investigation while you continue other work
- Research/comparison tasks that generate verbose output

**DON'T spawn a sidecar when:**
- Simple task you can handle directly
- User wants to stay in the current conversation
- Task requires your specific context that's hard to transfer

### Agent Selection Guidelines

**Chat mode (interactive default)** — no `--agent` flag needed. Reads are auto-approved, writes and bash commands require user permission in the Electron UI:
```bash
# Default — good for questions, analysis, and guided work
amicus start --model gemini --prompt "Analyze the auth flow and suggest improvements"
```

**Plan mode** — fully read-only, no file modifications possible:
```bash
# Strict read-only for deep analysis
amicus start --model gemini --prompt "Review the codebase architecture" --agent Plan
```

**Build mode** — full tool access, all operations auto-approved:
```bash
# Only when offloading development tasks
amicus start --model gemini --prompt "Implement the login feature" --agent Build
```

**When to use each mode:**

| Mode | Use When |
|------|----------|
| **Chat** (interactive default) | Questions, analysis, guided exploration — you control what gets written |
| **Plan** | Comprehensive read-only analysis where no changes should happen |
| **Build** | Offloading implementation tasks where full autonomy is desired |

---

## Commands

### Start a Sidecar

```bash
amicus start \
  --model <provider/model> \
  --prompt "<task description>" \
  --session-id <your-session-id>
```

**Required:**
- `--prompt` (or `--prompt-file`): Detailed task description you generate

**Recommended:**
- `--model`: The model to use (see Models below). Omit it to use your configured default (`amicus setup`); the CLI errors only when neither an explicit model nor a configured default exists.
- `--session-id`: Your Claude Code session ID for accurate context passing

**Optional:**
- `--no-ui`: Run autonomously without GUI (for bulk tasks)
- `--no-context`: Skip parent conversation history. Use when the briefing is self-contained and includes all necessary file paths, code snippets, and criteria. Default: context is included.
- `--timeout <min>`: Headless timeout (default: 15)
- `--context-turns <N>`: Max conversation turns to include (default: 50)
- `--context-since <duration>`: Time filter for context (e.g., `2h`, `30m`, `1d`). Overrides `--context-turns`.
- `--context-max-tokens <N>`: Max context size (default: 80000)
- `--thinking <level>`: Model thinking/reasoning effort level:
  - `none` - No extended thinking
  - `minimal` - Minimal thinking (may be adjusted if unsupported by model)
  - `low` - Low thinking effort
  - `medium` - Medium thinking effort (default)
  - `high` - High thinking effort
  - `xhigh` - Extra high thinking effort
  Note: If the model doesn't support the specified level, it will be automatically adjusted.
- `--summary-length <length>`: Summary verbosity:
  - `brief` - Concise summary
  - `normal` - Standard summary (default)
  - `verbose` - Detailed summary
- `--mcp <spec>`: Add MCP server for enhanced tool access. Formats:
  - `name=url` - Remote MCP server (e.g., `--mcp "db=postgresql://localhost:5432/mydb"`)
  - `name=command` - Local MCP server (spawns process)
- `--mcp-config <path>`: Path to opencode.json file with MCP server configuration. Alternative to `--mcp` for complex setups.
- `--client <type>`: Client entry point (`code-local`, `code-web`, `cowork`). Affects system prompt personality. Default: `code-local`.
- `--prompt-file <path>`: Read the prompt/briefing from a UTF-8 file (mutually exclusive with
  `--prompt`). Use for long or multi-line briefings.
- `--json`: With `--no-ui`, emit the run result as one stable JSON document on stdout
  (`schemaVersion: 1`; the `summary` field is the model's output).
- `--no-validate-model`: Skip the model-catalog pre-flight check (validation is on by default).
- `--agent <agent>`: Agent mode (controls tool permissions). If omitted, defaults to
  **Chat** in interactive mode and **Build** in headless (`--no-ui`) mode — `chat`
  stalls without user interaction, so headless runs need an agent that doesn't wait
  on write/bash approval.

  **Primary Agents (for `amicus start`):**
  - `Chat` **(interactive default)**: Reads auto-approved, writes/bash require user permission
  - `Plan`: Read-only mode - no file modifications possible
  - `Build` **(headless default)**: Full tool access - all operations auto-approved

  **Custom Agents:**
  Custom agents defined in `~/.config/opencode/agents/` or `.opencode/agents/` are passed through directly.

### Input Validation

The CLI validates all inputs **before** launching the sidecar. Invalid inputs fail immediately with clear error messages - no Electron window will open.

**Required inputs (will error if invalid):**

| Input | Validation | Error Message |
|-------|------------|---------------|
| `--model` | Optional — falls back to the config default. An explicit value must resolve to a known alias or `provider/model` | `Error: Unknown model alias '<x>' …` or `No model specified and no default configured. Run 'amicus setup' to set a default model.` |
| `--prompt` | Must be present and non-empty | `Error: --prompt is required` or `Error: --prompt cannot be empty or whitespace-only` |
| `--cwd` | If provided, directory must exist | `Error: --cwd path does not exist: <path>` |
| `--session-id` | If explicit ID provided (not 'current'), must exist | `Error: --session-id '<id>' not found. Use 'amicus list' to see available sessions or omit --session-id for most recent.` |
| `--agent` | If provided, must be non-empty | `Error: --agent cannot be empty` |
| `--timeout` | Must be positive number | `Error: --timeout must be a positive number` |
| `--context-turns` | Must be positive number | `Error: --context-turns must be a positive number` |
| `--context-since` | Must match format: `30m`, `2h`, `1d` | `Error: --context-since must be in format: 30m, 2h, or 1d` |
| API Key | Must be set for model's provider | `Error: <KEY_NAME> environment variable is required for <Provider> models` |

**API Key Requirements by Provider:**

| Model Prefix | Required Env Var | Example |
|--------------|------------------|---------|
| `openrouter/...` | `OPENROUTER_API_KEY` | `export OPENROUTER_API_KEY=sk-or-...` |
| `google/...` | `GOOGLE_GENERATIVE_AI_API_KEY` | `export GOOGLE_GENERATIVE_AI_API_KEY=...` |
| `openai/...` | `OPENAI_API_KEY` | `export OPENAI_API_KEY=sk-...` |
| `anthropic/...` | `ANTHROPIC_API_KEY` | `export ANTHROPIC_API_KEY=sk-ant-...` |
| `deepseek/...` | `DEEPSEEK_API_KEY` | `export DEEPSEEK_API_KEY=...` |

**Handling validation errors:**

If you receive a validation error, fix the input and retry:

```bash
# Error: --session-id 'abc123' not found
# Fix: Use 'current' or omit --session-id
amicus start --model gemini --prompt "Task" --session-id current

# Error: --agent cannot be empty
# Fix: Use a valid OpenCode agent
amicus start --model gemini --prompt "Task" --agent Build

# Error: --prompt cannot be empty
# Fix: Provide a non-empty briefing
amicus start --model gemini --prompt "Detailed task description"

# Error: OPENROUTER_API_KEY environment variable is required
# Fix: Set the API key for your provider
export OPENROUTER_API_KEY=sk-or-your-key
amicus start --model gemini --prompt "Task"
```

### Fan Out One Prompt to N Models

```bash
amicus fanout --models "gemini,gpt,deepseek" --prompt-file ./briefing.md --json
```

Runs the same prompt on every listed model in parallel (one shared engine server, headless),
then prints ONE JSON wave document: `status` (`complete`|`partial`|`error`), `counts`, and
`legs[]` where each leg's `summary` is that model's answer. Exit codes: 0 complete, 2 partial,
1 error/aborted. Aliases and full `provider/model` IDs both work; duplicates are allowed
(distinct legs). `--wave-id <id>` pins leg IDs to `<id>-1..N`. Shared per-leg knobs: `--agent`,
`--thinking`, `--timeout`, `--summary-length`, `--no-context`, `--context-*`, `--mcp*`,
`--no-validate-model`, `--cwd`.

### Inspect the Model Catalog

```bash
amicus models                    # list the live catalog (context + pricing columns)
amicus models --search grok      # substring search over id + name
amicus models --refresh          # force-refresh from OpenRouter (TTL cache otherwise)
amicus models --check            # audit configured aliases against the catalog
```

The catalog is cached at `~/.config/amicus/model-catalog.json` and refreshes automatically;
`start`/`fanout` validate models against it before launching (skip with `--no-validate-model`).

### List Past Sidecars

```bash
amicus list
amicus list --status complete
amicus list --all  # All projects
amicus list --json # Output as JSON
```

**Optional:**
- `--status <filter>`: Filter by status (`running`, `complete`)
- `--all`: Show sessions from all projects
- `--json`: Output as JSON format (for programmatic use)
- `--cwd <path>`: Project directory (default: current directory)

### Resume a Sidecar

```bash
amicus resume <task_id>
```

Reopens a previous session with full conversation history. Amicus continues in the **same** OpenCode session — all previous messages and tool state are preserved.

**Use resume when:** You want to pick up exactly where you left off (e.g., re-examine findings, ask follow-up questions in the same conversation).

**Optional:**
- `--no-ui`: Continue session in autonomous mode
- `--timeout <minutes>`: Timeout for headless mode (default: 15)
- `--cwd <path>`: Project directory (default: current directory)

### Continue from a Sidecar

```bash
amicus continue <task_id> --prompt "<new task>"
```

Starts a **new** sidecar session that inherits the old session's conversation as context. The previous session's messages become read-only background context for the new task.

**Use continue when:** You want to build on previous findings with a new task or different model (e.g., "Now implement the fix from the previous analysis").

**Required:**
- `--prompt`: New task description for the continuation

**Optional:**
- `--model <model>`: Override model (defaults to original session's model)
- `--context-turns <N>`: Max turns from previous session to include (default: 50)
- `--context-max-tokens <N>`: Max tokens for context (default: 80000)
- `--no-ui`: Run in autonomous mode
- `--timeout <minutes>`: Timeout for headless mode (default: 15)
- `--cwd <path>`: Project directory (default: current directory)

### Read Sidecar Output

```bash
amicus read <task_id>                 # Show summary
amicus read <task_id> --conversation  # Show full conversation
amicus read <task_id> --metadata      # Show session metadata
```

**Optional:**
- `--summary`: Show summary (default if no option specified)
- `--conversation`: Show full conversation history
- `--metadata`: Show session metadata (model, agent, timestamps, etc.)
- `--cwd <path>`: Project directory (default: current directory)

### Abort a Running Session

```bash
amicus abort <task_id>     # stop one session
amicus abort --all         # stop every running session in this project
```

---

## Models Available

### Model Selection

Use short aliases (run `amicus models` to see the live catalog, and `amicus models --check` to audit your aliases):
- `--model gemini` -- Google Gemini (fast, large context)
- `--model opus` -- Claude Opus (deep analysis)
- `--model gpt` -- OpenAI GPT
- `--model deepseek` -- DeepSeek
- Omit `--model` entirely to use your configured default

Full model strings also work: `--model openrouter/provider/model-id`

### Verifying Model Names

Model names change frequently. Verify against the live catalog:

```bash
amicus models --search gemini
```

Aliases are seeded by `amicus setup` and audited by `amicus models --check`, which suggests
replacements for stale aliases. See also [Inspect the Model Catalog](#inspect-the-model-catalog) for `--refresh` and the cache location.

---

## Session ID (Important)

For reliable context passing, provide your session ID:

```bash
amicus start --session-id "a1b2c3d4-..." --model ... --prompt ...
```

**How to find your session ID:**

Your conversations are stored in:
```
~/.claude/projects/[encoded-project-path]/[session-id].jsonl
```

The encoded path replaces `/`, `\`, and `_` with `-`. For example:
- Project: `/Users/john/myproject`
- Encoded: `-Users-john-myproject`
- Full path: `~/.claude/projects/-Users-john-myproject/`

List session files to find yours:
```bash
ls -lt ~/.claude/projects/-Users-john-myproject/*.jsonl | head -5
```

The most recently modified file is likely your current session. Extract the UUID from the filename.

**Session ID behavior:**
- **Omit `--session-id`** or pass `--session-id current`: Uses the most recently modified session file (less reliable if multiple sessions are active)
- **Explicit session ID** (`--session-id abc123-def456`): Must exist or the command fails immediately with: `Error: --session-id 'abc123-def456' not found`

**If you get a session not found error:**
1. List available sessions: `amicus list`
2. Use one of the listed session IDs, OR
3. Omit `--session-id` to use the most recent session

---

## Generating the Briefing

You create the briefing—it should be a comprehensive handoff document:

```markdown
## Task Briefing

**Objective:** [One-line goal]

**Background:** [What led to this task, relevant context]

**What's been tried:** [Previous attempts, if any]

**Files of interest:**
- path/to/relevant/file.ts
- path/to/another/file.ts

**Success criteria:** [How to know when done]

**Constraints:** [Time limits, scope limits, things to avoid]
```

**Example:**

```bash
amicus start \
  --model gemini-pro \
  --session-id "abc123-def456" \
  --prompt "## Task Briefing

**Objective:** Debug the intermittent 401 errors on mobile

**Background:** Users report sporadic auth failures. Server logs show
token refresh race conditions. I suspect TokenManager.ts.

**Files of interest:**
- src/auth/TokenManager.ts (main suspect)
- src/api/client.ts (where tokens are used)
- logs/auth-errors-2025-01-25.txt

**Success criteria:** Identify root cause and propose fix

**Constraints:** Focus on auth flow only, don't refactor unrelated code"
```

---

## Context Control

By default, amicus includes your parent conversation history (up to 80k tokens). Skip this with `--no-context` when the task is self-contained.

### When You MUST Include Context
- Task references something from the current conversation ("that bug", "the approach you suggested")
- Fact checking, second opinions, or code review of recent work
- "Does this look right?" or validation requests
- Continuing a debugging thread

### When You Can Skip Context
- Greenfield tasks with explicit file paths and instructions
- General knowledge or research questions
- Tasks fully described in the briefing (files, criteria, constraints all specified)
- Independent analysis unrelated to current conversation

### Self-Contained Briefing Example

```bash
amicus start \
  --model gemini \
  --no-context \
  --prompt "## Task Briefing

**Objective:** Add retry logic with exponential backoff to the HTTP client

**Files to read:**
- src/api/client.ts (current implementation)
- src/utils/retry.ts (existing retry utility, if any)

**Success criteria:**
- Retries up to 3 times on 5xx errors
- Exponential backoff: 1s, 2s, 4s
- No retry on 4xx errors
- Add unit tests

**Constraints:** Don't modify the public API surface"
```

---

## Agent Modes

Amicus uses OpenCode's agent framework with three primary modes:

### Primary Agents (for Main Sessions)

| Agent | Reads | Writes/Edits | Bash | Default |
|-------|-------|-------------|------|---------|
| **Chat** | auto | asks permission | asks permission | Interactive |
| **Plan** | auto | denied | denied | No |
| **Build** | auto | auto | auto | Headless |

#### Chat Agent (Interactive Default)

Conversational mode — reads are auto-approved, writes and bash commands prompt for user permission in the UI. This is the default when no `--agent` flag is provided **in interactive mode**; headless (`--no-ui`) runs default to Build instead (see the Headless section below).

```bash
# These are equivalent — Chat is the interactive default
amicus start --model gemini --prompt "Analyze the auth flow"
amicus start --model gemini --prompt "Analyze the auth flow" --agent Chat
```

**Use Chat agent when:**
- Asking questions or requesting analysis
- You want to review and approve any file changes
- Interactive exploration where the model might suggest edits
- Any task where you want human-in-the-loop control over writes

#### Plan Agent

Strict read-only mode — file modifications are completely blocked:

```bash
amicus start --model gemini --prompt "Review the codebase architecture" --agent Plan
```

**Use Plan agent when:**
- Comprehensive analysis where no changes should happen
- Code review and security audits
- Architecture exploration

#### Build Agent

Full autonomous access — all operations auto-approved:

```bash
amicus start --model gemini --prompt "Implement the login feature" --agent Build
```

**Use Build agent when:**
- Offloading development tasks to the sidecar
- User explicitly requests implementation ("implement", "fix", "write", "create")
- Headless batch operations (test generation, linting, etc.)

---

## Interactive vs Headless

### Interactive (Default)

**The default for single-model sidecars — omit `--no-ui`.** Reach for headless only when the user asks for it, the run is part of a multi-model wave, or the task is unattended bulk automation.

- Opens a GUI window
- User can converse with the sidecar
- **Model Picker:** Click the model name in the input area to switch models mid-conversation
- Click **FOLD** when done to generate summary
- Summary returns to your context via stdout

**Use for:** Any single-model sidecar — debugging, exploration, second opinions, reviews, architectural discussions

**Mid-Conversation Model Switching:**
In interactive mode, you can change models without restarting:
1. Click the model dropdown (shows current model name)
2. Select a different model from the categorized list
3. A system message confirms the switch
4. Subsequent messages use the new model

This is useful when you want to:
- Start fast with Flash, then switch to Pro for complex analysis
- Try a different model's perspective on a problem
- Use reasoning models (o3-mini) for specific parts of the task

### Headless (--no-ui)

- Runs autonomously, no GUI
- Agent works until done or timeout
- Summary returns automatically
- **Default agent is `build`** — `chat` agent requires interactive UI and will stall in headless mode
- **Always use headless when spawning multiple sidecars at once** (see Multi-LLM rule below)
- **Not the default for single-model runs** — a single-model sidecar opens the UI unless the user asks for headless or the task is unattended bulk work

**Multi-LLM Rule:** When the SAME prompt goes to N models, use `amicus fanout` (see [Fan Out One Prompt to N Models](#fan-out-one-prompt-to-n-models)) — one headless wave, one JSON result. When prompts differ per model, use separate parallel `amicus start --no-ui` calls with `run_in_background: true`. Only switch to interactive if the user explicitly asks.

**Agent Headless Compatibility:**

| Agent | Headless Safe | Notes |
|-------|--------------|-------|
| `build` | Yes | Default for `--no-ui` — full autonomous access |
| `plan` | Yes | Read-only analysis |
| `explore` | Yes | Read-only codebase exploration |
| `general` | Yes | Full-access subagent |
| `chat` | **No** | Blocked — requires interactive mode for write permissions |

(`explore` and `general` are OpenCode-native agent types accepted by `--agent`; custom agents from `~/.config/opencode/agents/` are passed through as-is.)

```bash
# Error: chat + headless
amicus start --model gemini --prompt "..." --agent chat --no-ui
# → Error: --agent chat requires interactive mode (remove --no-ui or use --agent build)
```

**Use for:** Multi-model waves, bulk tasks, test generation, documentation, linting — or when the user explicitly asks for headless

```bash
amicus start \
  --model gemini \
  --prompt "Generate unit tests for src/utils/. Use Jest." \
  --no-ui \
  --timeout 20
```

---

## Background Execution (REQUIRED)

**ALWAYS run amicus commands in the background.** Use the Bash tool's `run_in_background: true` parameter for every `amicus start`, `amicus resume`, and `amicus continue` invocation. This ensures:

- No timeout ceiling — tasks can run for the full 15+ minutes
- You can continue working while the sidecar runs
- You'll be automatically notified when it completes

**Example invocation pattern:**
```
Bash tool:
  command: "amicus start --model gemini --prompt '...'"
  run_in_background: true
```

After launching an interactive sidecar, tell the user:
> "The Amicus window is open — chat with it there and click FOLD when you're done. I'll pick up the summary here."

After launching a headless sidecar, tell the user:
> "Amicus is running in the background. I'll share the results when it completes."

**When the background task completes**, you will be automatically notified. Use the `TaskOutput` tool with the task ID to read the sidecar's summary output, then present it to the user. Do NOT poll or sleep — the notification arrives automatically.

**Interactive mode note:** When running without `--no-ui`, the Electron GUI opens in a separate window. Backgrounding frees the terminal but does not prevent the user from interacting with the GUI window.

**Important:** Warn users about potential file conflicts:
> "I recommend committing your current changes before the sidecar completes, in case there are file conflicts."

---

## Understanding Sidecar Output

The summary includes:

```markdown
## Sidecar Results: [Title]

📍 **Context Age:** [How stale the context might be]

⚠️ **FILE CONFLICT WARNING** [If files were modified externally]

**Task:** [What was requested]
**Findings:** [Key discoveries]
**Attempted Approaches:** [What was tried but didn't work]
**Recommendations:** [Suggested actions]
**Code Changes:** [Specific code with paths]
**Files Modified:** [List of files]
**Assumptions Made:** [Things to verify]
**Open Questions:** [Remaining uncertainties]
```

**Act on the summary:**
- Implement recommended fixes
- Verify assumptions listed
- Don't repeat failed approaches
- Review files with conflict warnings carefully

### Handling Config Update Notices

When amicus emits `[AMICUS_CONFIG_UPDATE]` on stderr, the user's model aliases have changed (via `amicus setup`). The message contains a hash comment and a markdown alias table.

**Action required:**
1. Find the "Model Aliases" section in the project's CLAUDE.md
2. Replace that section's content with the block provided in the message
3. If no "Model Aliases" section exists, add one after the title line
4. Do **not** remove the `<!-- amicus-config-hash: ... -->` comment — it tracks config changes and prevents duplicate notifications

The update is purely informational (alias mappings) and safe to apply without user confirmation.

---

## Checking for Existing Sidecars

Before spawning a new sidecar, check if relevant work exists:

```bash
amicus list
```

If a relevant sidecar exists:
- Read its findings: `amicus read <id>`
- Reopen it: `amicus resume <id>`
- Build on it: `amicus continue <id> --prompt "..."`

**Ask the user** if you're unsure whether to resume or start fresh.

---

## Examples

### Example 1: Interactive Debugging (Chat Mode - Default)

```bash
# Default Chat mode — can read freely, asks before writing
amicus start \
  --model gpt \
  --session-id "$(ls -t ~/.claude/projects/-Users-john-myproject/*.jsonl | head -1 | xargs basename .jsonl)" \
  --prompt "## Debug Memory Leak

**Objective:** Find the source of memory growth in the worker process

**Background:** Memory usage grows 50MB/hour. Heap snapshots show retained
closures but I can't identify the source.

**Files of interest:**
- src/workers/processor.ts
- src/cache/lru.ts

**Success criteria:** Identify the leak and propose fix"
```

### Example 2: Headless Test Generation (Build Mode - Explicit Request)

```bash
# Build mode is appropriate here because user explicitly requested file creation
amicus start \
  --model gemini \
  --agent Build \
  --prompt "Generate comprehensive Jest tests for all exported functions
in src/utils/. Include edge cases. Write to tests/utils/." \
  --no-ui \
  --timeout 15
```

### Example 3: Code Review (Plan Mode - Read-Only)

```bash
# Plan mode for strict read-only review
amicus start \
  --model gemini \
  --agent Plan \
  --prompt "Review the authentication flow for security issues.
Focus on: token handling, session management, CSRF protection.
Analyze and report findings."
```

### Example 4: Continue Previous Work

```bash
# First, check what exists
amicus list

# Read what was found
amicus read abc123

# Continue with a follow-up task
amicus continue abc123 \
  --model gpt \
  --prompt "Implement the fix recommended in the previous session.
The mutex approach looks correct. Add tests."
```

---

## Troubleshooting

### "Missing Authentication header" in Claude Code or CI

API keys in `~/.zshrc` are not available in non-interactive shells. Resolution order: `process.env` > `~/.config/amicus/.env` (the legacy `~/.config/sidecar/.env` fallback was removed in v2.0.0 — see `docs/SHIMS.md`) > `~/.local/share/opencode/auth.json` (first wins). Fix:
1. Run `amicus setup` (stores keys in `~/.config/amicus/.env`)
2. Or move exports to `~/.zshenv`
3. Or add credentials to `~/.local/share/opencode/auth.json`

### "No Claude Code conversation history found"

Your project path encoding may not match. Check:
```bash
ls ~/.claude/projects/
```

Find the correct encoded path for your project. Remember that `/`, `\`, and `_` are all converted to `-`.

### "Multiple active sessions detected"

You have multiple Claude Code windows. Pass `--session-id` explicitly:
```bash
ls -lt ~/.claude/projects/[your-path]/*.jsonl | head -3
# Pick the correct session UUID
```

### Sidecar doesn't start / API errors

**Check API credentials are configured:**

For OpenRouter:
```bash
cat ~/.local/share/opencode/auth.json
# Should contain: {"openrouter": {"apiKey": "sk-or-v1-..."}}
```

For direct API keys:
```bash
echo $GOOGLE_GENERATIVE_AI_API_KEY    # For Google models
echo $OPENAI_API_KEY    # For OpenAI models
echo $ANTHROPIC_API_KEY # For Anthropic models
```

### "401 Unauthorized" or authentication errors

1. Verify you're using the correct model name format:
   - OpenRouter models: `openrouter/provider/model`
   - Direct API models: `provider/model`

2. Check your API key is valid and has credits

3. For OpenRouter, ensure auth.json exists:
   ```bash
   cat ~/.local/share/opencode/auth.json
   ```

### Headless mode times out with no output

1. Increase timeout: `--timeout 30`
2. Enable debug logging: `LOG_LEVEL=debug amicus start ...`

### Summary is corrupted

Debug output may be leaking to stdout. Check for console.log statements if you've modified the sidecar code. All logging should go to stderr via the structured logger.

### Validation Errors

**"Error: --prompt cannot be empty or whitespace-only"**

The briefing must contain actual content:
```bash
# Wrong
amicus start --model gemini --prompt ""
amicus start --model gemini --prompt "   "

# Right
amicus start --model gemini --prompt "Debug the auth issue in TokenManager.ts"
```

**"Error: --session-id '<id>' not found"**

The explicit session ID doesn't exist. Either:
1. Use `amicus list` to find valid session IDs
2. Omit `--session-id` to use the most recent session
3. Use `--session-id current` for automatic resolution

```bash
# Find valid sessions
amicus list

# Use most recent session
amicus start --model gemini --prompt "Task"
```

**"Error: --cwd path does not exist"**

The specified project directory doesn't exist:
```bash
# Wrong
amicus start --model ... --prompt "..." --cwd /nonexistent/path

# Right - use current directory
amicus start --model ... --prompt "..." --cwd .

# Right - use full path
amicus start --model ... --prompt "..." --cwd /Users/john/myproject
```

**"Error: --agent cannot be empty"**

The agent name cannot be empty. Use an OpenCode native agent or a custom agent:
```bash
# Wrong - empty agent
amicus start --model ... --prompt "..." --agent ""

# Right - use OpenCode native agent
amicus start --model ... --prompt "..." --agent Explore

# Right - use custom agent (defined in ~/.config/opencode/agents/)
amicus start --model ... --prompt "..." --agent MyCustomAgent
```

**"Error: <KEY_NAME> environment variable is required for <Provider> models"**

The API key for the model's provider is not set:
```bash
# For OpenRouter models (openrouter/...)
export OPENROUTER_API_KEY=sk-or-your-key

# For Google models (google/...)
export GOOGLE_GENERATIVE_AI_API_KEY=your-google-key

# For OpenAI models (openai/...)
export OPENAI_API_KEY=sk-your-openai-key

# For Anthropic models (anthropic/...)
export ANTHROPIC_API_KEY=sk-ant-your-key

# For DeepSeek models (deepseek/...)
export DEEPSEEK_API_KEY=your-deepseek-key

# Then retry
amicus start --model gemini --prompt "Task"
```

---

## Quick Start Checklist

1. [ ] Install amicus: `npm install -g amicus`
2. [ ] Configure API access (choose one):
   - [ ] Run `amicus setup` (recommended — wizard stores keys and seeds aliases)
   - [ ] OpenRouter manual: Create `~/.local/share/opencode/auth.json` with your key
   - [ ] Direct API: Set environment variable (`GOOGLE_GENERATIVE_AI_API_KEY`, etc.)
3. [ ] Test amicus: `amicus start --model <your-model> --prompt "Hello" --no-ui`

<!-- @header -->
<!-- @title value="Amicus" -->
<!-- @subtitle value="Multi-Model LLM Council for Claude Code & Cowork" -->
<!-- /@header -->

## 1. Spawn Subagents

Claude as orchestrator. Any model as a specialist.

From inside Claude Code or Cowork, ask Claude to spawn headless Amicus instances using the MCP tool. Each subagent gets your full session context, works autonomously on its assigned task, and returns a structured summary. No window switching, no prompting each model yourself.

Run multiple Amicus instances simultaneously to split work across specialized models. One reviews architecture. Another audits security. A third generates tests. Claude collects every summary and synthesizes the results back into your main context.

<!-- @cards type="feature" columns="3" -->
<!-- @card icon="network" title="Your Claude Context" -->
Every subagent gets your full conversation history, file changes, tool calls, and error output automatically. No export, no copy-paste, no starting from scratch.
<!-- /@card -->
<!-- @card icon="cpu" title="Claude Code & Cowork" -->
Native MCP tool works inside both Claude Code and Cowork. Amicus registers as an MCP server automatically — agents can spawn instances natively from their sandbox.
<!-- /@card -->
<!-- @card icon="zap" title="One Command" -->
Spawn a headless Amicus instance with a single tool call. Each subagent runs with a configurable timeout; structured summaries fold back into Claude's context when done.
<!-- /@card -->
<!-- /@cards -->

## 2. Built for How You Work

Every Amicus session shares your context automatically. Just pick a model and get to work.

<!-- @cards type="feature" columns="2" -->
<!-- @card icon="shield" title="Fact-Check" -->
Claude proposed an architecture? Send it to Gemini for a second opinion. Catch bad assumptions before they become bugs.
<!-- /@card -->
<!-- @card icon="search" title="Debug" -->
Stuck on a bug? Bring in a different model for a second look. A new perspective often catches what you've stopped seeing.
<!-- /@card -->
<!-- @card icon="brain" title="Brainstorm" -->
Get three different models thinking about the same problem in parallel. Claude collects and synthesizes the best ideas from each.
<!-- /@card -->
<!-- @card icon="lightbulb" title="Fresh Eyes" -->
Deep in a session and losing perspective? Bring in a fresh model. It sees everything you've built, without the tunnel vision.
<!-- /@card -->
<!-- /@cards -->

## 3. Your Tools Follow You

Every MCP server configured in Claude Code is automatically discovered and available inside Amicus. Repomix, GitHub, Slack — whatever tools you use — are ready in every session with zero extra setup.

<!-- @cards type="feature" columns="3" -->
<!-- @card icon="gitBranch" title="Auto-Discovery" -->
Amicus reads your `~/.claude.json` at startup and registers every configured MCP server. No manual wiring required.
<!-- /@card -->
<!-- @card icon="layers" title="Full Tool Access" -->
Subagents get the same MCP tools as your main Claude session — filesystem, GitHub, Slack, and any custom servers you've added.
<!-- /@card -->
<!-- @card icon="server" title="Zero Extra Setup" -->
Install once. Your existing MCP configuration travels with every Amicus session automatically.
<!-- /@card -->
<!-- /@cards -->

## 4. Any Model

Use your existing API keys directly, or connect everything through OpenRouter with a single key.

<!-- badge row injected by Task 4 fuse step -->

Compatible providers include Google Gemini, OpenAI, Anthropic, xAI, Meta, and DeepSeek — plus 200+ models via OpenRouter.

<!-- @cards type="feature" columns="2" -->
<!-- @card icon="zap" title="Direct API Keys" -->
Already have a Google AI, OpenAI, Anthropic, or DeepSeek key? Use it directly. No middleman, no extra accounts.
<!-- /@card -->
<!-- @card icon="network" title="OpenRouter (Recommended)" -->
One key, every model. Automatic fallback, unified billing. Run `amicus setup` to configure. Free model variants available to try at zero cost.
<!-- /@card -->
<!-- /@cards -->

## 5. Everything You Need

<!-- @stats -->
<!-- @stat value="5–8" label="Model calls per council" source="Internal" -->
<!-- @stat value="200+" label="Models via OpenRouter" source="OpenRouter" -->
<!-- @stat value="0" label="Extra config for MCP tools" source="Internal" -->
<!-- @stat value="2" label="Skills auto-installed" source="Internal" -->
<!-- /@stats -->

<!-- @cards type="feature" columns="2" -->
<!-- @card icon="users" title="Multi-Model Council" -->
Independent reviews → anonymous cross-review → non-Claude chair verdict. Blind spots surface when models from different families disagree.
<!-- /@card -->
<!-- @card icon="gitBranch" title="Fork / Work / Fold" -->
Spin up one other model in a real window with full context, work alongside it, and fold a structured summary back when you're done.
<!-- /@card -->
<!-- @card icon="layers" title="Fanout Parallel Waves" -->
Run N models on the same prompt headlessly in one wave. Every leg gets the same briefing; results arrive as a single JSON wave document.
<!-- /@card -->
<!-- @card icon="database" title="Live Model Catalog" -->
No frozen model table. Aliases and validation resolve against a live catalog fetched from provider APIs — model names stay current without a code change.
<!-- /@card -->
<!-- @card icon="code" title="Windows First-Class" -->
Developed and tested on Windows 11, no WSL required. Full unit suite runs green on Windows. macOS and Linux supported too.
<!-- /@card -->
<!-- @card icon="cpu" title="MCP Tools & Claude-Native" -->
Auto-registered MCP server and two installed skills (`second-opinion`, `sidecar`). Claude drives Amicus; you stay in your editor.
<!-- /@card -->
<!-- @card icon="shield" title="Context Sharing & Safety" -->
Conversation history passed automatically. Conflict detection warns when files changed externally — a fold never silently overwrites newer work.
<!-- /@card -->
<!-- @card icon="server" title="Session Persistence" -->
Every session is saved. List, resume, or chain new investigations on previous findings. Full JSON output for scripting and agent consumption.
<!-- /@card -->
<!-- /@cards -->

## 6. Prerequisites

A few things to have in place — and an honest look at what a run actually costs you.

<!-- @cards type="feature" columns="2" -->
<!-- @card icon="target" title="What You Need" -->
Node.js 18+ (run `node --version` to check), an active Claude Code or Cowork session, and at least one paid model API key — OpenRouter, or a direct Google / OpenAI / Anthropic / DeepSeek key.
<!-- /@card -->
<!-- @card icon="chart" title="What It Costs" -->
A sidecar is a single model call. A full council is typically 5–8 paid model calls (3 reviewers across 2 fan-out waves + 1 chair). Amicus estimates cost up front; a budget gate blocks runaway spend. Want to try for free? OpenRouter offers free model variants. Amicus itself is free and open-source — you only pay providers for tokens.
<!-- /@card -->
<!-- /@cards -->

## 7. Install in 30 Seconds

One npm install. Gets you the CLI, Claude Code skill, and MCP server. No manual registration required.

<!-- @terminal title="Install & First Run" command="bash" -->
- # Install
- npm install -g amicus
- # Configure API keys and default model
- amicus setup
- # Then in Claude Code or Cowork, just say:
- "council review this"
- > Amicus routes your doc through 3 models, cross-reviews, and presents a tiered verdict.
- > You make the accept / deny calls.
<!-- /@terminal -->

<!-- @cta label="View on GitHub" href="https://github.com/BourbonDog/amicus" variant="primary" headline="Ready to give Claude a council?" -->
Free and open-source. Install in 30 seconds. Works with Claude Code and Cowork.
<!-- /@cta -->

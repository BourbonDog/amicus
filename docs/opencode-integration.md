# OpenCode Integration

How Amicus integrates with OpenCode's native capabilities and avoids redundant implementations.

## SDK & API Notes

### OpenCode SDK Requirements

- SDK's `createOpencodeServer()` spawns `opencode` CLI internally
- `opencode-ai` is a regular dependency -- its binary is in `node_modules/.bin/`
- `src/utils/path-setup.js` adds `node_modules/.bin/` to PATH so the binary is always found
- SDK is ESM-only; use dynamic `import()` not `require()` in CommonJS projects
- Jest can't mock dynamic imports without `--experimental-vm-modules` - skip those tests

### OpenCode API Format

- Model must be object: `{ providerID: 'openrouter', modelID: 'google/gemini-2.5-flash' }`
- Sending model as string causes 400 Bad Request
- Use `formatModelForAPI()` from `electron/ui/model-picker.js` for conversion

---

## What OpenCode Provides (Use Native APIs)

| Feature | OpenCode API | How We Use It |
|---------|-------------|---------------|
| **Agent Types** | Native `Build`, `Plan`, `Explore`, `General` | Pass `agent` parameter to `sendPrompt()` |
| **Tool Permissions** | Enforced by agent framework | NO custom prompt-based restrictions |
| **Session Status** | `session.status()` | Used in `headless.js` for completion detection |
| **Session Messages** | `session.messages()` | Used for polling and conversation capture |
| **Child Sessions** | `session.create({ parentID })` | Used for subagent spawning |
| **Health Check** | `config.get()` | Used to verify server ready state |

## What We Built (Unique Value)

| Feature | Why We Need It | Implementation |
|---------|----------------|----------------|
| **Context Extraction** | Bridge Claude Code sessions to OpenCode | `context.js` reads `.jsonl` files |
| **File Conflict Detection** | Safety feature - OpenCode doesn't track this | `conflict.js` compares mtimes |
| **Context Drift Detection** | Safety feature - detect stale context | `drift.js` calculates staleness |
| **Session Persistence** | Custom metadata (briefing, agent, thinking) | `session-manager.js` |
| **MCP Config Merging** | CLI overrides + file config | `opencode-client.js` |
| **Client-aware prompt** | Cowork needs general-purpose, not SE-focused | `prompts/cowork-agent-prompt.js` sets `chat` agent `prompt` field |

## Removed Redundancies

The following custom implementations were **removed** because OpenCode handles them natively:

| Removed | Reason | Native Replacement |
|---------|--------|-------------------|
| ~~`buildCodeModeEnvironment()`~~ | Tool restrictions in prompts | OpenCode `Build` agent |
| ~~`buildPlanModeEnvironment()`~~ | Tool restrictions in prompts | OpenCode `Plan` agent |
| ~~`buildAskModeEnvironment()`~~ | Tool restrictions in prompts | OpenCode `Build` with `permissions` |
| ~~Custom heartbeat polling~~ | Basic sleep loop | `session.status()` API |

---

## Agent Type Mapping

```javascript
// src/utils/agent-mapping.js
mapAgentToOpenCode('build')    // -> { agent: 'Build' }
mapAgentToOpenCode('plan')     // -> { agent: 'Plan' }
mapAgentToOpenCode('explore')  // -> { agent: 'Explore' }
mapAgentToOpenCode('general')  // -> { agent: 'General' }
mapAgentToOpenCode('custom')   // -> { agent: 'custom' } // passed through
```

**Headless mode defaults:** When `--no-ui` is set, the default agent is `build` (not `chat`).
The `chat` agent requires user interaction for write/bash permissions and stalls in headless mode.
`isHeadlessSafe(agent)` returns `true` (safe), `false` (chat), or `null` (custom/unknown).

## Key Integration Files

| File | OpenCode Integration |
|------|---------------------|
| `src/opencode-client.js` | SDK wrapper - `createSession()`, `sendPrompt()`, `getSessionStatus()` |
| `src/headless.js` | Uses `session.status()` for completion detection |
| `src/utils/agent-mapping.js` | Maps Amicus modes to OpenCode agents |
| `electron/main.js` | Creates child sessions for subagents |

---

## SDK & HTTP API Reference

Refer to the [OpenCode documentation](https://opencode.ai/docs/) for SDK and server API details.

**Critical: Model Format** -- Models MUST be objects, not strings:

```javascript
// WRONG - causes 400 Bad Request
{ model: "google/gemini-2.5-flash" }

// CORRECT
{ model: { providerID: "openrouter", modelID: "google/gemini-2.5-flash" } }
```

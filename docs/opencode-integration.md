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

### Session Status Idle Signal

The OpenCode SDK exposes `client.session.status({ path: { id } })`, wrapped by `getSessionStatus()` in `src/opencode-client.js`. In headless runs this is the **authoritative completion signal**: when the response is `{ type: 'idle' }`, the poll loop in `src/headless.js` treats the session as done and exits immediately.

This signal is **gated on real output existing** (the `output.length > 0` check at `src/headless.js` line 500) so a pre-processing `idle` response from the SDK cannot end the run before the model has produced any text. If the status call fails or returns an unexpected shape, the code falls back transparently to the activity-heuristic idle detection (consecutive polls with no output growth, no new tool calls, no new messages). This gating was introduced as the F1 authoritative-idle-signal improvement.

---

## What OpenCode Provides (Use Native APIs)

| Feature | OpenCode API | How We Use It |
|---------|-------------|---------------|
| **Agent Types** | Native `build`, `plan`, `explore`, `general`, `chat` | Pass `agent` parameter to `sendPrompt()` |
| **Tool Permissions** | Enforced by agent framework | NO custom prompt-based restrictions |
| **Session Status** | `session.status()` | Used in `headless.js` as authoritative idle signal (F1) |
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
| ~~`buildCodeModeEnvironment()`~~ | Tool restrictions in prompts | OpenCode `build` agent |
| ~~`buildPlanModeEnvironment()`~~ | Tool restrictions in prompts | OpenCode `plan` agent |
| ~~`buildAskModeEnvironment()`~~ | Tool restrictions in prompts | OpenCode `build` with `permissions` |
| ~~Custom heartbeat polling~~ | Basic sleep loop | `session.status()` API |

---

## Agent Type Mapping

Agent name mapping is implemented in `src/utils/agent-mapping.js`. All known OpenCode native agents are normalised to lowercase before being sent to the API:

```javascript
// src/utils/agent-mapping.js
mapAgentToOpenCode('build')    // -> { agent: 'build' }
mapAgentToOpenCode('plan')     // -> { agent: 'plan' }
mapAgentToOpenCode('explore')  // -> { agent: 'explore' }
mapAgentToOpenCode('general')  // -> { agent: 'general' }
mapAgentToOpenCode('chat')     // -> { agent: 'chat' }
mapAgentToOpenCode('custom')   // -> { agent: 'custom' } // passed through as lowercase
```

**Default when agent is unset:** `mapAgentToOpenCode(undefined)` returns `{ agent: 'chat' }`.

**Headless mode default:** When `--no-ui` is set, Amicus hard-codes `agent || 'build'` before calling `mapAgentToOpenCode` (`src/headless.js` line 275), so the effective default in headless mode is `build`, not `chat`. The `chat` agent requires user interaction for write/bash permissions and stalls in headless mode.

`isHeadlessSafe(agent)` returns `true` (safe: build/plan/explore/general), `false` (unsafe: chat), or `null` (custom/unknown).

## Key Integration Files

| File | OpenCode Integration |
|------|---------------------|
| `src/opencode-client.js` | SDK wrapper - `createSession()`, `sendPrompt()`, `getSessionStatus()` |
| `src/headless.js` | Uses `session.status()` for authoritative idle detection (F1); falls back to activity heuristic |
| `src/utils/agent-mapping.js` | Maps Amicus agent names to OpenCode agents (all lowercase) |
| `electron/main.js` | Creates child sessions for subagents |
| `src/sidecar/fanout.js` | `amicus fanout` reuses the same `runHeadless` path per leg over one shared server — see [Fanout Wave Architecture](architecture.md#fanout-wave-architecture). |

---

## Backward Compatibility

**Legacy exported names** `startSidecar`, `listSidecars`, `resumeSidecar`, `continueSidecar`, `readSidecar` are real source identifiers that exist in `src/index.js` as deprecated shims pointing to the canonical `startAmicus` / `listAmicus` / etc. exports. They are kept for backward compatibility, tracked in `docs/SHIMS.md`.

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

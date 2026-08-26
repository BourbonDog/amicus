/**
 * OpenCode SDK Client Wrapper
 *
 * Provides a clean interface for interacting with the @opencode-ai/sdk.
 * Handles model string parsing and provides simplified API methods.
 * Now uses SDK server creation instead of spawning CLI.
 *
 * Spec Reference: SDK Migration Plan
 */

// Lazy-load SDK (ESM module) - all imports must be dynamic
let _sdk = null;
async function getSDK() {
  if (!_sdk) {
    _sdk = await import('@opencode-ai/sdk');
  }
  return _sdk;
}

async function getCreateOpencodeClient() {
  const sdk = await getSDK();
  return sdk.createOpencodeClient;
}

async function getCreateOpencodeServer() {
  const sdk = await getSDK();
  return sdk.createOpencodeServer;
}

/**
 * Shared reason string for an HTTP 402 from the provider.
 * Exported so #36 and a later pre-flight credit check can reuse the exact phrasing
 * instead of re-deriving it.
 */
const INSUFFICIENT_CREDITS_REASON = 'Insufficient credits';

/**
 * Map an SDK request result to a propagated provider-failure reason.
 *
 * Keys on the actual HTTP status (result.response.status, falling back to
 * result.error.status) so benign informational `error` payloads that ride on a
 * 2xx response stay "continue to poll" — only a real non-2xx status becomes a
 * session error.
 *
 *   402            -> 'Insufficient credits'
 *   other non-2xx  -> 'Provider error: <status>'
 *   2xx / unknown  -> null
 *
 * @param {{response?: {status?: number}, error?: {status?: number}}} [result]
 * @returns {string|null} Reason string, or null when there is no hard failure.
 */
function providerErrorReason(result) {
  if (!result) { return null; }
  const status = (result.response && result.response.status)
    || (result.error && result.error.status);
  // No usable status — cannot distinguish a benign warning from a failure, so
  // do not regress the "continue to poll" behavior.
  if (typeof status !== 'number') { return null; }
  if (status >= 200 && status < 300) { return null; }
  if (status === 402) { return INSUFFICIENT_CREDITS_REASON; }
  return `Provider error: ${status}`;
}

/**
 * Parse a model string into SDK format
 *
 * Converts from sidecar format (e.g., 'openrouter/google/gemini-2.5-flash')
 * to SDK format ({ providerID: 'openrouter', modelID: 'google/gemini-2.5-flash' })
 *
 * @param {string|object} modelString - Model identifier or already-parsed object
 * @returns {{providerID: string, modelID: string}} SDK model specification
 */
function parseModelString(modelString) {
  // If already an object, validate the expected SDK shape and return as-is.
  // A malformed object (e.g. `{}` or missing providerID/modelID) would reach
  // the SDK and come back as an opaque 400 — throw a clear error here instead.
  if (typeof modelString === 'object' && modelString !== null) {
    if (typeof modelString.providerID !== 'string' || typeof modelString.modelID !== 'string') {
      throw new Error(
        `Invalid model object: expected { providerID, modelID } strings, got ${JSON.stringify(modelString)}`
      );
    }
    return modelString;
  }

  // Handle empty string
  if (!modelString) {
    return { providerID: 'openrouter', modelID: '' };
  }

  const parts = modelString.split('/');

  // Single part (just model name) - default to openrouter
  if (parts.length === 1) {
    return { providerID: 'openrouter', modelID: modelString };
  }

  // Two or more parts - first is provider, rest is modelID
  return {
    providerID: parts[0],
    modelID: parts.slice(1).join('/')
  };
}

/**
 * Create an OpenCode SDK client
 *
 * @param {string} [baseUrl] - Base URL for the OpenCode server
 * @returns {Promise<import('@opencode-ai/sdk').OpencodeClient>} SDK client instance
 */
async function createClient(baseUrl) {
  const createOpencodeClient = await getCreateOpencodeClient();
  const config = baseUrl ? { baseUrl } : {};
  return createOpencodeClient(config);
}

/**
 * Build an optional `query: { directory }` fragment to spread into an SDK call.
 *
 * Returns an EMPTY object when no directory is supplied so spreading it is a
 * true no-op — the emitted request is byte-for-byte identical to a call that
 * never knew about `directory`. Only when a directory IS passed does a
 * `query: { directory }` key appear on the wire (the SDK accepts
 * `query?: { directory?: string }` on every session endpoint).
 *
 * @param {string} [directory] - Optional project directory to scope the call to.
 * @returns {{query?: {directory: string}}} Fragment to spread into SDK args.
 */
function directoryQuery(directory) {
  return directory === undefined ? {} : { query: { directory } };
}

/**
 * Create a new session
 *
 * @param {import('@opencode-ai/sdk').OpencodeClient} client - SDK client
 * @param {string} [directory] - Optional project directory to scope the session
 *   to (threaded to the SDK as query.directory). Omitting it keeps the call
 *   byte-for-byte identical to before.
 * @returns {Promise<string>} Session ID — deliberately still a plain string.
 *   The response's `version` (#133 piece 3, below) rides out through
 *   `utils/engine-skew` rather than widening this return type: measured, all
 *   three production callers (`headless.js`, `mcp-server.js`,
 *   `sidecar/interactive.js`) assign it straight to a `sessionId` string.
 * @throws {Error} If session creation fails
 */
async function createSession(client, directory) {
  const result = await client.session.create({ ...directoryQuery(directory) });

  if (result.error) {
    throw new Error(result.error.message || 'Failed to create session');
  }

  // Handle both direct ID and nested session.id
  const sessionId = result.data?.id || result.data?.session?.id;

  if (!sessionId) {
    throw new Error('No session ID returned');
  }

  // #133 piece 3: the server's own engine version arrives on every create and
  // used to be dropped on the floor. MEASURED 2026-08-25 against a real engine:
  // `data.version` is the opencode-ai version, so it can be compared with the
  // engine in this install's node_modules. The detector decides silence (older
  // servers omit the field); best-effort by construction — a diagnostic must
  // never be able to fail a session create.
  try {
    require('./utils/engine-skew')
      .noteSessionVersion(result.data?.version || result.data?.session?.version);
  } catch (_e) { /* diagnosis only — never load-bearing */ }

  return sessionId;
}

/**
 * Send a prompt to a session
 *
 * @param {import('@opencode-ai/sdk').OpencodeClient} client - SDK client
 * @param {string} sessionId - Session ID
 * @param {object} options - Prompt options
 * @param {string|object} options.model - Model identifier or SDK format object
 * @param {string} [options.system] - System prompt
 * @param {Array} options.parts - Message parts
 * @param {string} [options.agent] - Agent to use (e.g., 'build', 'explore')
 * @param {object} [options.tools] - Tool configuration
 * @param {object} [options.reasoning] - Reasoning/thinking configuration
 * @param {string} [options.reasoning.effort] - Effort level: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'none'
 * @param {object} [options.watchdog] - IdleWatchdog instance to signal busy/idle around the API call
 * @param {string} [options.directory] - Optional project directory to scope the
 *   call to (threaded to the SDK as query.directory). Omitting it keeps the
 *   call byte-for-byte identical to before.
 * @returns {Promise<object>} API response
 */
async function sendPrompt(client, sessionId, options) {
  const { model, system, parts, agent, tools, reasoning, watchdog, directory } = options;

  // Parse model string to SDK format
  const modelSpec = parseModelString(model);

  // Build request body
  const body = {
    model: modelSpec,
    parts
  };

  // Add optional fields
  if (system) {
    body.system = system;
  }

  if (agent) {
    // OpenCode API expects lowercase agent names
    body.agent = agent.toLowerCase();
  }

  if (tools) {
    body.tools = tools;
  }

  if (reasoning) {
    body.reasoning = reasoning;
  }

  if (watchdog) {
    watchdog.markBusy();
  }

  let result;
  try {
    result = await client.session.promptAsync({
      path: { id: sessionId },
      body,
      ...directoryQuery(directory)
    });
  } finally {
    if (watchdog) {
      watchdog.markIdle();
    }
  }

  // Detect a hard provider failure at the client boundary (#37). A non-2xx /
  // 402 here must surface as a session error EVEN WHEN the server emits no
  // assistant message carrying info.error — otherwise the run looks idle/empty.
  // Keyed on HTTP status so benign informational errors (model config warnings
  // on a 2xx) keep the fire-and-forget "continue to poll" behavior below.
  const reason = providerErrorReason(result);
  if (reason) {
    result.providerError = reason;
    const { logger } = require('./utils/logger');
    logger.error('promptAsync returned a hard provider error', {
      reason,
      status: (result.response && result.response.status) || (result.error && result.error.status),
      sessionId
    });
  } else if (result.error) {
    // Log but don't throw on benign promptAsync errors.
    // promptAsync is fire-and-forget: the server queues the prompt for async
    // processing. These errors are informational (e.g., model config warnings)
    // rather than fatal. The polling loop will detect real failures via timeout.
    const { logger } = require('./utils/logger');
    logger.error('promptAsync returned error (continuing to poll)', {
      error: result.error.message || JSON.stringify(result.error),
      sessionId
    });
  }

  return result;
}

/**
 * Get messages for a session
 *
 * @param {import('@opencode-ai/sdk').OpencodeClient} client - SDK client
 * @param {string} sessionId - Session ID
 * @param {string} [directory] - Optional project directory to scope the call to
 *   (threaded to the SDK as query.directory). Omitting it keeps the call
 *   byte-for-byte identical to before.
 * @returns {Promise<Array>} Array of messages
 */
async function getMessages(client, sessionId, directory) {
  const result = await client.session.messages({
    path: { id: sessionId },
    ...directoryQuery(directory)
  });

  // A well-formed response carries a data array (possibly empty). If it's
  // absent, the SDK returned an error shape (e.g. a 5xx with { error }) that
  // would otherwise be indistinguishable from "0 messages" — surface it so the
  // poll loop's diagnostics aren't blind. Return contract unchanged: an array.
  if (!Array.isArray(result.data)) {
    const { logger } = require('./utils/logger');
    logger.warn('getMessages: SDK response had no data array', {
      sessionId,
      status: (result.response && result.response.status) || (result.error && result.error.status),
      error: result.error && (result.error.message || JSON.stringify(result.error))
    });
    return [];
  }

  return result.data;
}

/**
 * Check if the OpenCode server is healthy
 *
 * @param {import('@opencode-ai/sdk').OpencodeClient} client - SDK client
 * @returns {Promise<boolean>} True if server is healthy
 */
async function checkHealth(client) {
  try {
    await client.config.get({});
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Create a child session with a parent ID
 *
 * @param {import('@opencode-ai/sdk').OpencodeClient} client - SDK client
 * @param {string} parentId - Parent session ID
 * @returns {Promise<string>} Child session ID
 * @throws {Error} If child session creation fails
 */
async function createChildSession(client, parentId) {
  const result = await client.session.create({
    body: { parentID: parentId }
  });

  if (result.error) {
    throw new Error(result.error.message || 'Failed to create child session');
  }

  // Handle both direct ID and nested session.id
  const sessionId = result.data?.id || result.data?.session?.id;

  if (!sessionId) {
    throw new Error('No session ID returned');
  }

  return sessionId;
}

/**
 * Get child (subagent) sessions for a parent session.
 *
 * ⚠️ v4.4.1 LC-7: this was the ONE per-session call that did not thread
 * `directoryQuery(directory)`, unlike getMessages / createSession /
 * abortSession. It went unnoticed because nothing called it — on a SHARED
 * server (one server, many projects) an un-scoped call is the exact
 * "session not found" failure mode issue #47 fixed everywhere else, and it
 * would have broken child-session cost attribution on precisely the
 * configuration that makes attribution matter. Fixed with CA-1, its first
 * consumer (src/sidecar/child-sessions.js).
 *
 * @param {import('@opencode-ai/sdk').OpencodeClient} client - SDK client
 * @param {string} parentId - Parent session ID
 * @param {string} [directory] - Optional project directory to scope the call to.
 *   Omitting it keeps the call byte-for-byte identical to before.
 * @returns {Promise<Array>} Array of child sessions
 */
async function getChildren(client, parentId, directory) {
  const result = await client.session.children({
    path: { id: parentId },
    ...directoryQuery(directory)
  });

  return result.data || [];
}

/**
 * List all sessions from the OpenCode server
 *
 * @param {import('@opencode-ai/sdk').OpencodeClient} client - SDK client
 * @returns {Promise<Array>} Array of sessions
 */
async function listSessions(client) {
  try {
    const result = await client.session.list();
    return result.data || [];
  } catch (_error) {
    return [];
  }
}

/**
 * Abort a running session
 *
 * @param {import('@opencode-ai/sdk').OpencodeClient} client - SDK client
 * @param {string} sessionId - Session ID to abort
 * @param {string} [directory] - Optional project directory to scope the call to
 *   (threaded to the SDK as query.directory). Omitting it keeps the call
 *   byte-for-byte identical to before.
 * @returns {Promise<void>}
 */
async function abortSession(client, sessionId, directory) {
  await client.session.abort({ path: { id: sessionId }, ...directoryQuery(directory) });
}

/**
 * Get session status
 *
 * @param {import('@opencode-ai/sdk').OpencodeClient} client - SDK client
 * @param {string} sessionId - Session ID
 * @param {string} [directory] - Optional project directory to scope the call to
 *   (threaded to the SDK as query.directory). Omitting it keeps the call
 *   byte-for-byte identical to before.
 * @returns {Promise<Object>} Session status
 */
async function getSessionStatus(client, sessionId, directory) {
  const result = await client.session.status({
    path: { id: sessionId },
    ...directoryQuery(directory)
  });

  return result.data || {};
}

/**
 * How long to wait for OpenCode to announce it is listening, per platform.
 *
 * ⚠️ ADDED v4.5.2 from a field report. `@opencode-ai/sdk` defaults this to
 * 5000ms (`dist/server.js:4-8`) and lets the caller override it; amicus never
 * passed one, so every start on every platform ran on the SDK's 5s — untunable
 * and invisible to `amicus doctor`. A reporter's Windows box (project on a
 * OneDrive-synced volume, Defender active) blew through it on a cold
 * OpenCode/SQLite open: the council's shared server failed to acquire, the run
 * degraded to the per-wave configuration `src/council/run-server.js` exists to
 * eliminate, and the whole Stage-1 bench died (`COUNCIL_QUORUM: Only 0 …`).
 *
 * The asymmetry decides the number: a slow start costs LATENCY, a failed start
 * costs a REVIEW SEAT. win32 gets the widest window because that is where
 * sync-backed volumes and always-on AV filter drivers are the norm.
 *
 * This is a ceiling, not a sleep — a healthy start still resolves in well under
 * a second and pays none of it.
 */
const SERVER_START_TIMEOUT_MS = Object.freeze({ win32: 30000, default: 15000 });

/**
 * Resolve the start timeout: explicit option → env override → platform default.
 *
 * `0` and negatives are REJECTED rather than honored. For most amicus knobs `0`
 * is a documented disable switch (see src/utils/env-num.js), but a 0ms start
 * timeout disables nothing — it fails every start instantly. That is an own-goal
 * an operator can only reach by accident, so it falls back to the default.
 *
 * @param {object} [options] - Server options ({timeout} respected if positive)
 * @param {object} [env] - Environment (test seam; defaults to process.env)
 * @param {string} [platform] - Platform (test seam; defaults to process.platform)
 * @returns {number} milliseconds
 */
function resolveServerStartTimeoutMs(options = {}, env, platform) {
  const plat = platform || process.platform;
  const dflt = SERVER_START_TIMEOUT_MS[plat] || SERVER_START_TIMEOUT_MS.default;
  const positive = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  if (options.timeout !== undefined) {
    const explicit = positive(options.timeout);
    if (explicit) { return explicit; }
  }
  const raw = (env || process.env).AMICUS_SERVER_START_TIMEOUT_MS;
  if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
    const fromEnv = positive(raw);
    if (fromEnv) { return fromEnv; }
  }
  return dflt;
}

/**
 * Build the server options object for createOpencodeServer.
 * Extracted for testability (no SDK dependency).
 *
 * @param {object} [options] - Server options
 * @param {number} [options.timeout] - Start timeout in ms. Omit to use
 *   AMICUS_SERVER_START_TIMEOUT_MS or the platform default; NEVER omitted from
 *   the object handed to the SDK, so the SDK's own 5000ms default is unreachable.
 * @param {number} [options.port] - Port to run on
 * @param {string} [options.hostname='127.0.0.1'] - Hostname to bind to
 * @param {AbortSignal} [options.signal] - Abort signal to stop server
 * @param {object} [options.mcp] - MCP server configurations
 * @param {string} [options.model] - Default model
 * @param {string[]} [options.models] - Resolved executable id(s) actually launched (#61 Task
 *   4.6/7.3 sole-input invariant) — a multi-model shared server (fanout) has no single
 *   default model, so ALL of them register in provider.models via this instead of `model`.
 *   Takes precedence over the `options.model` single-id fallback when non-empty.
 * @param {string} [options.client] - Client type ('cowork', 'code-local', etc.)
 * @param {string} [options.systemPrompt] - System prompt to set on agent config (hidden from UI)
 * @param {string} [options.agentName] - Agent to set systemPrompt on (default: 'chat')
 * @returns {object} Server options ready for createOpencodeServer
 */
function buildServerOptions(options = {}) {
  // Build config object for SDK
  const config = {};
  if (options.mcp) {
    // Normalize MCP configs for OpenCode's discriminated union format.
    //
    // OpenCode accepts exactly two type values (ConfigInvalidError otherwise):
    //   { type: "local",  enabled: true, command: ["cmd", ...args] }
    //   { type: "remote", enabled: true, url: "https://..." }
    //
    // Input formats we handle:
    //   Claude Code internal : { type: "stdio", command: "cmd", args: [...] }
    //   Claude Desktop       : { command: "cmd", args: [...] }   (no type field)
    //   Claude Code remote   : { type: "http",  url: "..." }
    //                          { type: "sse",   url: "..." }
    //   Already normalized   : { type: "local"|"remote", ... }  → pass through
    //
    // Note: OpenCode's "local" schema does NOT support an `env` field.
    // Environment variables from the source config are intentionally dropped;
    // MCP servers inherit the parent process environment which is sufficient.
    const normalized = {};
    for (const [name, serverConfig] of Object.entries(options.mcp)) {
      const t = serverConfig.type;
      if (t === 'stdio' || (!t && serverConfig.command)) {
        // stdio process (Claude Code or Claude Desktop format) → local
        if (!serverConfig.command) {
          const { logger } = require('./utils/logger');
          logger.warn(`MCP server "${name}": type "stdio" requires a command — skipping`);
          continue;
        }
        const cmd = typeof serverConfig.command === 'string' ? serverConfig.command : String(serverConfig.command);
        const args = Array.isArray(serverConfig.args) ? serverConfig.args : [];
        normalized[name] = {
          type: 'local',
          enabled: true,
          command: [cmd, ...args]
        };
      } else if (t === 'http' || t === 'sse') {
        // HTTP/SSE remote server → remote
        if (!serverConfig.url) {
          const { logger } = require('./utils/logger');
          logger.warn(`MCP server "${name}": type "${t}" requires a url — skipping`);
          continue;
        }
        // Preserve extra remote options (headers, oauth, timeout, etc.)
        // eslint-disable-next-line no-unused-vars
        const { type: _t, args: _a, command: _c, ...rest } = serverConfig;
        normalized[name] = {
          ...rest,
          type: 'remote',
          enabled: rest.enabled !== undefined ? rest.enabled : true
        };
      } else {
        // Already in OpenCode format (type: "local"|"remote") or unknown — pass through
        if (t && t !== 'local' && t !== 'remote') {
          const { logger } = require('./utils/logger');
          logger.warn(`MCP server "${name}": unrecognized type "${t}" — passing through unchanged`);
        }
        normalized[name] = serverConfig;
      }
    }
    config.mcp = normalized;
  }
  if (options.model) {
    config.model = options.model;
  }

  // Sync sidecar aliases into OpenCode's provider.models so the UI
  // model picker shows all configured models (single source of truth),
  // and register the actually-resolved launch route's provider so it
  // always matches config.model (the "sole input" invariant — see #61).
  // A multi-model shared server (fanout, #61 Task 7.3) has no single
  // config.model — options.models carries EVERY leg's resolved id instead,
  // and takes precedence over the single-id options.model fallback.
  const { buildProviderModels } = require('./utils/config');
  const resolvedForProvider = (Array.isArray(options.models) && options.models.length)
    ? options.models
    : (options.model ? [options.model] : []);
  config.provider = buildProviderModels(resolvedForProvider);

  // v4.6.2 PR1 (spec §4, D1/D2): a host-form ANTHROPIC_BASE_URL is correct
  // for Anthropic SDKs (they append /v1) and fatal for OpenCode's
  // direct-anthropic provider (it appends /messages -> 404). Carry the
  // normalized full-prefix form as a provider-config override — config-level,
  // no process env is written anywhere. AMICUS_BASE_URL_NORMALIZE=0 disables.
  // Merge order keeps any existing options.baseURL authoritative (M-5 lesson:
  // never clobber a user-authored value with a derived one).
  const { resolveBaseUrlOverride, announceBaseUrlNormalizationOnce } = require('./utils/base-url-classify');
  const baseUrlEnv = options._env || process.env;
  const anthropicBaseUrl = resolveBaseUrlOverride(baseUrlEnv);
  if (anthropicBaseUrl) {
    if (!Object.prototype.hasOwnProperty.call(config.provider, 'anthropic')) {
      config.provider.anthropic = { models: {} };
    }
    config.provider.anthropic.options = {
      baseURL: anthropicBaseUrl,
      ...(config.provider.anthropic.options || {}),
    };
    announceBaseUrlNormalizationOnce(baseUrlEnv.ANTHROPIC_BASE_URL, anthropicBaseUrl, options._noticeDeps);
  }

  // Register custom 'chat' agent: reads auto-approved, writes/bash require permission
  const chatAgent = {
    description: 'Conversational agent — reads are auto-approved, writes and commands require permission',
    mode: 'primary',
    permission: {
      edit: 'ask',
      bash: 'ask',
      webfetch: 'allow'
    }
  };

  // When launched from Cowork, replace the SE-focused base prompt with a general-purpose one
  if (options.client === 'cowork') {
    const { buildCoworkAgentPrompt } = require('./prompts/cowork-agent-prompt');
    chatAgent.prompt = buildCoworkAgentPrompt();
  }

  config.agent = {
    ...(config.agent || {}),
    chat: chatAgent
  };

  // Set system prompt on the target agent's config (hidden from UI).
  // The promptAsync `system` field is rendered as a visible chat message,
  // but agent.prompt is injected as the system instruction invisibly.
  if (options.systemPrompt) {
    const targetName = (options.agentName || 'chat').toLowerCase();
    if (targetName === 'chat') {
      // Chat is our custom agent — append to existing prompt (e.g., cowork)
      chatAgent.prompt = chatAgent.prompt
        ? `${chatAgent.prompt}\n\n${options.systemPrompt}`
        : options.systemPrompt;
    } else {
      // Built-in agents (build, plan, etc.) — register with system prompt
      config.agent[targetName] = {
        ...(config.agent[targetName] || {}),
        prompt: options.systemPrompt
      };
    }
  }

  const serverOptions = {
    hostname: options.hostname || '127.0.0.1',
    // ALWAYS set — unlike port/signal below, an omitted timeout is not a
    // harmless "let the SDK decide", it is the 5000ms that cost a bench.
    timeout: resolveServerStartTimeoutMs(options),
  };

  // Only include port/signal when explicitly set — passing undefined
  // overrides the SDK's defaults via Object.assign, causing --port=undefined
  if (options.port !== undefined) {
    serverOptions.port = options.port;
  }
  if (options.signal !== undefined) {
    serverOptions.signal = options.signal;
  }

  // Only add config if we have settings
  if (Object.keys(config).length > 0) {
    serverOptions.config = config;
  }

  return serverOptions;
}

const { findListenerPid } = require('./utils/port-pid');
const { waitThenKill: defaultWaitThenKill } = require('./utils/abort-coordinator');

// Teardown-appropriate grace window for the SIGTERM->SIGKILL escalation on
// close() (B06). Constant, not env-overridable — this is process teardown,
// not the marker-honoring abort grace in abort-coordinator.js.
const CLOSE_KILL_GRACE_MS = 2000;

/**
 * Build the { url, goPid, close } server handle around a raw SDK server.
 * Extracted + dependency-injected so the goPid capture and cross-platform
 * force-kill (F3 #15) can be unit-tested without the SDK's dynamic import.
 *
 * close() (B06 teardown-race fix): sdkServer.close() SIGTERMs the SDK's
 * wrapper script, not the Go binary — the SDK exposes no pid for it. So
 * close() ALSO SIGTERMs goPid directly (captured via the port scan / sdk
 * pid fields above) and runs it through the REF'd SIGTERM->SIGKILL
 * escalation primitive, bounded by CLOSE_KILL_GRACE_MS. The old unref'd
 * SIGKILL-only timer is gone: on POSIX it could die with the parent before
 * ever firing (orphaning the Go server), and it never sent a SIGTERM to the
 * Go pid at all. On win32 this is a no-op beyond firing the signal — the
 * job-object semantics that already reap the tree are untouched.
 * @param {{url:string, close:Function, pid?:number, process?:{pid:number}}} sdkServer
 * @param {{findListenerPid?:Function, kill?:Function, logger?:object, waitThenKill?:Function}} [deps]
 * @returns {{url:string, goPid:number|null, close:Function}}
 */
function buildServerHandle(sdkServer, deps = {}) {
  const findPid = deps.findListenerPid || findListenerPid;
  const kill = deps.kill || ((pid, sig) => process.kill(pid, sig));
  const log = deps.logger || require('./utils/logger').logger;
  const waitThenKill = deps.waitThenKill || defaultWaitThenKill;
  const serverPort = parseInt(new URL(sdkServer.url).port, 10);
  const goPid = sdkServer.pid || (sdkServer.process && sdkServer.process.pid) || findPid(serverPort);
  const server = {
    url: sdkServer.url,
    goPid,
    async close() {
      sdkServer.close();
      const pid = server.goPid;
      if (!pid || pid === process.pid) { return; }
      // graceMs: 0 => waitThenKill's own poll fires the direct SIGTERM to
      // goPid immediately (no wait beforehand — the SDK's close() above never
      // reaches the Go binary, so there is no reason to delay this one), then
      // the escalation tier SIGKILLs any survivor after CLOSE_KILL_GRACE_MS.
      const { escalated } = await waitThenKill(pid, {
        graceMs: 0,
        escalate: { killGraceMs: CLOSE_KILL_GRACE_MS },
        deps: { kill },
      });
      if (escalated.includes(pid)) {
        log.debug('Force-killed OpenCode server', { port: serverPort, pid });
      }
    }
  };
  return server;
}

/**
 * Start an OpenCode server and return client + server handle
 *
 * @param {object} [options] - Server options
 * @param {number} [options.port] - Port to run on
 * @param {string} [options.hostname='127.0.0.1'] - Hostname to bind to
 * @param {AbortSignal} [options.signal] - Abort signal to stop server
 * @param {object} [options.mcp] - MCP server configurations
 * @param {string} [options.model] - Default model
 * @param {string[]} [options.models] - Resolved executable id(s) actually launched (#61 Task
 *   4.6/7.3 sole-input invariant) — a multi-model shared server (fanout) has no single
 *   default model, so ALL of them register in provider.models via this instead of `model`.
 *   Takes precedence over the `options.model` single-id fallback when non-empty.
 * @param {string} [options.client] - Client type ('cowork', 'code-local', etc.)
 * @returns {Promise<{client: object, server: {url: string, close: Function}}>}
 */
async function startServer(options = {}) {
  // Fail fast when the opencode engine binary is absent (skipped
  // optionalDependency install or AV quarantine). Before giving up, attempt an
  // in-place self-heal: COPY the opencode-* packages from a healthy sibling
  // install (engine-ensure) — NOT re-running the opencode postinstall, which is
  // the same flaky optional-dependency trap. Only runs when truly missing; the
  // fast path skips it. `_hasOpencodeBinary` / `_ensureEngine` are test seams.
  const hasOpencodeBinary = options._hasOpencodeBinary
    || require('./utils/path-setup').hasOpencodeBinary;
  if (!hasOpencodeBinary()) {
    const ensureEngine = options._ensureEngine
      || require('./utils/engine-ensure').ensureEngine;
    const healed = await ensureEngine().catch(() => ({ ok: false }));
    if (!healed.ok) {
      const HINTS = require('./utils/remediation-hints');
      // Append the roots we probed so an npx-cache-vs-global divergence is visible
      // at the point of failure, not just in `amicus doctor` (report #4).
      const opencodeRoots = options._opencodeRoots
        || require('./utils/path-setup').opencodeRoots;
      const note = healed.reason ? ` (self-heal: ${healed.reason})` : '';
      throw new Error(`${HINTS.engineMissing} Searched: ${opencodeRoots().join(', ')}${note}`);
    }
  }

  // `_createOpencodeServer` is a test seam, matching `_hasOpencodeBinary` /
  // `_ensureEngine` / `_opencodeRoots` above: the SDK arrives through a dynamic
  // `import()`, which `jest.mock` cannot intercept under CommonJS, so the start
  // path is otherwise unreachable from a unit test.
  const createOpencodeServer = options._createOpencodeServer
    || await getCreateOpencodeServer();
  const serverOptions = buildServerOptions(options);

  // Measure the healthy path. The v4.5.2 timeout had to be sized from the
  // asymmetry of the failure (a slow start costs latency, a failed one costs a
  // review seat) because nothing recorded how long a GOOD start takes — so the
  // margin against the ceiling was unmeasurable on exactly the slow boxes that
  // needed it. Now it is one debug line, not an inference.
  const startedAt = Date.now();
  const sdkServer = await createOpencodeServer(serverOptions);
  const { logger } = require('./utils/logger');
  logger.debug('OpenCode server started', {
    startMs: Date.now() - startedAt,
    timeoutMs: serverOptions.timeout,
  });
  const client = await (options._createClient || createClient)(sdkServer.url);

  // Capture the Go server PID once so close() can force-kill it cross-platform
  // (F3 #15). Prefer a PID the SDK exposes; fall back to the port listener.
  // findListenerPid may return null if the port isn't bound yet (startup race);
  // in that case close() degrades to SIGTERM-only, which is acceptable best-effort.
  const server = buildServerHandle(sdkServer);

  return { client, server };
}

/**
 * Load MCP configuration from user's opencode.json
 *
 * @param {string} [configPath] - Optional path to config file
 * @param {string} [projectDir] - Project directory to resolve the project-scoped
 *   `opencode.json` against. Falls back to `process.cwd()` only when omitted.
 *   Callers launched by Claude Code/MCP/Cowork must pass the --cwd target here,
 *   since the process cwd is NOT the project directory in those environments.
 * @returns {object|null} MCP configuration or null if not found
 */
function loadMcpConfig(configPath, projectDir) {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');

  // Check paths in order of precedence
  const paths = [];

  if (configPath) {
    paths.push(configPath);
  }

  // Global config location
  paths.push(path.join(os.homedir(), '.config', 'opencode', 'opencode.json'));

  // Project-level config — resolved against the passed project dir when known,
  // falling back to cwd only if no project dir was threaded through.
  paths.push(path.join(projectDir || process.cwd(), 'opencode.json'));

  for (const configFile of paths) {
    try {
      if (fs.existsSync(configFile)) {
        const content = fs.readFileSync(configFile, 'utf-8');
        const config = JSON.parse(content);
        if (config.mcp && Object.keys(config.mcp).length > 0) {
          return config.mcp;
        }
      }
    } catch (e) {
      // Ignore parse errors, try next file
    }
  }

  return null;
}

/**
 * Tokenize a shorthand command string into [command, ...args].
 *
 * A minimal shell-like split: whitespace separates tokens, but single- or
 * double-quoted segments are kept intact so a command path containing spaces
 * (e.g. "C:\Program Files\node\node.exe" server.js) survives as ONE token.
 * Unquoted whitespace runs are collapsed. This is deliberately simple — it does
 * not handle escapes or nested quotes; the JSON form remains the escape hatch
 * for anything more elaborate.
 *
 * @param {string} value - Raw shorthand command string
 * @returns {string[]} Tokenized command + args
 */
function tokenizeCommand(value) {
  const tokens = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = re.exec(value)) !== null) {
    // Prefer whichever capture group matched (double-quoted, single-quoted, bare).
    tokens.push(match[1] !== undefined ? match[1] : (match[2] !== undefined ? match[2] : match[3]));
  }
  return tokens;
}

/**
 * Parse MCP server specification from CLI format
 *
 * Supports formats:
 *   - name=url (remote server)
 *   - name=command (local server with simple command)
 *   - JSON string (full config)
 *
 * The shorthand command form tokenizes on whitespace but respects single/double
 * quotes, so a command PATH containing spaces must be quoted
 * (e.g. name="C:\Program Files\node\node.exe" server.js). For anything more
 * elaborate, use the JSON form.
 *
 * @param {string} spec - MCP server specification
 * @returns {{name: string, config: object}|null} Parsed MCP config or null
 */
function parseMcpSpec(spec) {
  // Try JSON first
  if (spec.startsWith('{')) {
    try {
      const parsed = JSON.parse(spec);
      const name = Object.keys(parsed)[0];
      return { name, config: parsed[name] };
    } catch (e) {
      return null;
    }
  }

  // Try name=value format
  const eqIndex = spec.indexOf('=');
  if (eqIndex > 0) {
    const name = spec.slice(0, eqIndex);
    const value = spec.slice(eqIndex + 1);

    // If value looks like a URL, treat as remote
    if (value.startsWith('http://') || value.startsWith('https://')) {
      return {
        name,
        config: {
          type: 'remote',
          url: value,
          enabled: true
        }
      };
    }

    // Otherwise treat as local command. Tokenize with quote-awareness so a
    // command path containing spaces (when quoted) is not shredded into args.
    return {
      name,
      config: {
        type: 'local',
        command: tokenizeCommand(value),
        enabled: true
      }
    };
  }

  return null;
}

module.exports = {
  INSUFFICIENT_CREDITS_REASON,
  providerErrorReason,
  parseModelString,
  createClient,
  createSession,
  createChildSession,
  sendPrompt,
  sendPromptAsync: sendPrompt, // Alias: sendPrompt already uses promptAsync internally
  getMessages,
  getChildren,
  listSessions,
  getSessionStatus,
  abortSession,
  checkHealth,
  buildServerOptions,
  resolveServerStartTimeoutMs,
  SERVER_START_TIMEOUT_MS,
  buildServerHandle,
  startServer,
  loadMcpConfig,
  parseMcpSpec
};

'use strict';

/**
 * @module client-detect
 * Detects which caller (Claude Code vs. Cowork/Claude Desktop) spawned this
 * MCP server, so amicus_start/resume/continue/fanout can pass the RIGHT
 * `--client` value downstream instead of the historical hardcoded 'cowork'.
 *
 * Getting this right matters because the client tag is the single dispatch
 * key for three independent subsystems: context-builder.js (which session
 * store to read the parent conversation from), mcp-discovery.js (which app's
 * MCP config to inherit), and environment.js (which session-dir tree to use).
 *
 * Precedence:
 *   1. AMICUS_MCP_CLIENT env var, if it names a VALID_CLIENTS member — an
 *      explicit operator override, mirroring the AMICUS_LEGACY_ALIASES /
 *      AMICUS_PROJECT_DIR env-seam precedent elsewhere in this codebase.
 *      An invalid value is ignored (with a warning) rather than throwing,
 *      since this runs on the hot path of every tool call.
 *   2. clientInfo.name from the MCP `initialize` handshake (SDK's
 *      core.getClientVersion(), the sibling of getClientCapabilities() used
 *      by getClientRoot() in mcp-server.js), pattern-matched case-insensitively.
 *   3. Unknown or absent clientInfo.name → 'cowork'. This is the pre-existing
 *      hardcoded behavior, kept as the default so an unrecognized caller
 *      regresses nothing — but it's a deliberate status-quo choice, not a
 *      confident detection, so it logs a one-time warning naming the
 *      unrecognized clientInfo so misdetection is observable.
 */

const { VALID_CLIENTS } = require('../environment');

/** claude-code / Claude Code / claude_code / ClaudeCode → 'code-local'. */
const CODE_LOCAL_RE = /claude[-_ ]?code/i;

/** claude-ai / Claude Desktop / claude_desktop / cowork → 'cowork'. */
const COWORK_RE = /claude[-_ ]?(ai|desktop)|cowork/i;

// Per-mcpServer-instance memoization: clientInfo is fixed after initialize,
// so re-resolving on every tool call would be wasted work (and would re-fire
// the one-time warning). Keyed by the McpServer wrapper object identity.
const _resolvedCache = new WeakMap();

// Tracks which unrecognized clientInfo.name strings have already been warned
// about, so a long-lived server process doesn't spam stderr per tool call.
const _warnedNames = new Set();

/**
 * Map a raw clientInfo.name to an amicus client tag, or null if unrecognized.
 * @param {string} name
 * @returns {'code-local'|'cowork'|null}
 */
function matchClientName(name) {
  if (typeof name !== 'string' || !name.trim()) { return null; }
  if (CODE_LOCAL_RE.test(name)) { return 'code-local'; }
  if (COWORK_RE.test(name)) { return 'cowork'; }
  return null;
}

/**
 * Resolve the AMICUS_MCP_CLIENT env override, if set and valid.
 * @returns {string|undefined}
 */
function envOverride() {
  const raw = process.env.AMICUS_MCP_CLIENT;
  if (raw === undefined || raw === '') { return undefined; }
  if (VALID_CLIENTS.includes(raw)) { return raw; }
  // eslint-disable-next-line no-console
  console.error(
    `[amicus] Ignoring invalid AMICUS_MCP_CLIENT '${raw}'; ` +
    `expected one of: ${VALID_CLIENTS.join(', ')}`
  );
  return undefined;
}

/**
 * Detect the amicus `--client` value for the caller of this MCP server
 * instance. Resolved once per `mcpServer` and cached — safe to call from
 * every tool handler without repeating the initialize round-trip lookup.
 *
 * @param {object} [mcpServer] - the McpServer wrapper exposing `.server`
 *   (same shape as getClientRoot's parameter in mcp-server.js).
 * @returns {string} one of VALID_CLIENTS ('code-local' | 'code-web' | 'cowork').
 */
function detectClient(mcpServer) {
  const override = envOverride();
  if (override) { return override; }

  if (mcpServer && _resolvedCache.has(mcpServer)) {
    return _resolvedCache.get(mcpServer);
  }

  const core = mcpServer && mcpServer.server;
  const clientInfo = core && typeof core.getClientVersion === 'function'
    ? core.getClientVersion() : null;
  const name = clientInfo && clientInfo.name;

  const matched = matchClientName(name);
  let resolved;
  if (matched) {
    resolved = matched;
  } else {
    resolved = 'cowork'; // status-quo default (see module docblock)
    const warnKey = typeof name === 'string' && name ? name : '(absent)';
    if (!_warnedNames.has(warnKey)) {
      _warnedNames.add(warnKey);
      // eslint-disable-next-line no-console
      console.error(
        `[amicus] Unrecognized MCP client '${warnKey}'; defaulting --client to 'cowork'. ` +
        'Set AMICUS_MCP_CLIENT to override.'
      );
    }
  }

  if (mcpServer) { _resolvedCache.set(mcpServer, resolved); }
  return resolved;
}

module.exports = { detectClient, matchClientName };

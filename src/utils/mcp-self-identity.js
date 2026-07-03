'use strict';

/**
 * @module mcp-self-identity
 * Recursive-spawn guard. A child sidecar that inherits an MCP entry launching
 * amicus itself would spawn amicus inside amicus, forever. The shipped server
 * registers as 'amicus' (scripts/postinstall.js, .claude-plugin/plugin.json)
 * — and users can alias it under ANY name — so we exclude both reserved
 * names AND any entry whose command+args resolve to an amicus MCP invocation.
 *
 * 'sidecar'/'claude-sidecar' are recognized for BOTH lists even though
 * package.json's "bin" field no longer ships them as of v2.0.0 (#19): a
 * stale pre-rebrand global install can still have them linked on a user's
 * PATH, and a stale claude.json/MCP config can still reference the old
 * 'sidecar' server name. Recognizing them here only ever prevents a
 * recursive self-spawn — it never breaks a legitimately different server —
 * so there is no cost to keeping the wider net.
 */

/** Server names amicus registers itself under (current + legacy). */
const SELF_MCP_NAMES = Object.freeze(['amicus', 'sidecar']);

/** Bin names that resolve to ./bin/amicus.js (current package.json "bin" + legacy pre-v2.0.0 names). */
const SELF_BIN_NAMES = new Set(['amicus', 'am', 'sidecar', 'claude-sidecar']);

/**
 * Normalize one command/arg token for identity matching: lower-case, forward
 * slashes, basename, strip a trailing .exe/.cmd/.js, strip an @version spec.
 * 'C:\\x\\bin\\amicus.js' → 'amicus'; 'amicus@latest' → 'amicus'; 'npx' → 'npx'.
 * @param {unknown} token
 * @returns {string}
 */
function normalizeToken(token) {
  const t = String(token).toLowerCase().replace(/\\/g, '/');
  const base = t.includes('/') ? t.slice(t.lastIndexOf('/') + 1) : t;
  return base.replace(/\.(exe|cmd|js)$/, '').replace(/@[^@]*$/, '');
}

/**
 * True when this MCP server config would launch amicus's own MCP server:
 * some non-flag token resolves to an amicus binary/package and a LATER token
 * is 'mcp'. URL-only (command-less) configs are never self.
 * @param {{command?:string, args?:unknown[]}|null|undefined} config
 * @returns {boolean}
 */
function isAmicusMcpConfig(config) {
  if (!config || typeof config !== 'object' || !config.command) { return false; }
  const tokens = [config.command, ...(Array.isArray(config.args) ? config.args : [])].map(String);
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].startsWith('-')) { continue; } // flags (-y, --yes) are never the binary
    if (SELF_BIN_NAMES.has(normalizeToken(tokens[i]))) {
      return tokens.slice(i + 1).some((t) => String(t).toLowerCase() === 'mcp');
    }
  }
  return false;
}

/**
 * Delete every self entry (reserved name OR command identity) from an
 * mcpServers map. Mutates and returns the same object.
 * @param {object|null|undefined} mcpServers
 * @param {{debug?:Function}} [log]
 * @returns {object|null|undefined}
 */
function stripSelfMcpEntries(mcpServers, log) {
  if (!mcpServers || typeof mcpServers !== 'object') { return mcpServers; }
  for (const name of Object.keys(mcpServers)) {
    if (SELF_MCP_NAMES.includes(name) || isAmicusMcpConfig(mcpServers[name])) {
      delete mcpServers[name];
      if (log && log.debug) { log.debug('Auto-excluded amicus MCP entry (recursive spawn prevention)', { name }); }
    }
  }
  return mcpServers;
}

module.exports = { SELF_MCP_NAMES, isAmicusMcpConfig, stripSelfMcpEntries, normalizeToken };

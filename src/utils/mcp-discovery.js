/**
 * MCP Discovery - Discovers MCP servers from parent LLM configuration
 *
 * Supports discovering MCP servers from:
 * - Claude Code (reads plugin chain from ~/.claude/)
 * - Cowork / Claude Desktop (reads claude_desktop_config.json)
 *
 * @module utils/mcp-discovery
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { logger } = require('./logger');
const { stripSelfMcpEntries } = require('./mcp-self-identity');

/**
 * Normalize .mcp.json to a flat { name: config } map.
 * Handles both Format A (wrapped) and Format B (flat).
 *
 * @param {object|null|undefined} raw - Raw parsed JSON from .mcp.json
 * @returns {object} Normalized server configs
 */
function normalizeMcpJson(raw) {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  // Format A: { mcpServers: { name: config } }
  if (raw.mcpServers && typeof raw.mcpServers === 'object') {
    return raw.mcpServers;
  }
  // Format B: { name: config } (flat)
  return raw;
}

/**
 * Discover MCP servers from Claude Code's plugin chain AND ~/.claude.json.
 *
 * Discovery sources (merged, in priority order):
 * 1. ~/.claude.json → mcpServers  (servers added via `claude mcp add`)
 * 2. Enabled plugins → .mcp.json entries
 *
 * @param {string} [claudeDir] - Path to ~/.claude directory (for testing)
 * @param {string} [claudeJsonPath] - Path to ~/.claude.json (for testing)
 * @returns {object|null} Merged MCP server configs, or null if none found
 */
function discoverClaudeCodeMcps(claudeDir, claudeJsonPath) {
  const baseDir = claudeDir || path.join(os.homedir(), '.claude');
  const jsonPath = claudeJsonPath || path.join(os.homedir(), '.claude.json');

  // Source 1: ~/.claude.json → mcpServers (servers added via `claude mcp add`)
  let claudeJsonServers = {};
  try {
    if (fs.existsSync(jsonPath)) {
      const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      if (raw.mcpServers && typeof raw.mcpServers === 'object') {
        claudeJsonServers = raw.mcpServers;
        logger.debug('Read MCP servers from ~/.claude.json', {
          serverCount: Object.keys(claudeJsonServers).length
        });
      }
    }
  } catch (err) {
    logger.debug('Failed to read ~/.claude.json', { error: err.message });
  }

  // Source 2: Plugin chain (settings.json → installed_plugins.json → .mcp.json)
  const pluginServers = {};

  try {
    const settingsPath = path.join(baseDir, 'settings.json');
    if (!fs.existsSync(settingsPath)) {
      // No settings.json — skip plugin discovery, may still have claude.json servers
      const merged = stripSelfMcpEntries({ ...claudeJsonServers }, logger);
      return Object.keys(merged).length > 0 ? merged : null;
    }
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    const enabledPlugins = settings.enabledPlugins;
    if (!enabledPlugins || typeof enabledPlugins !== 'object') {
      const merged = stripSelfMcpEntries({ ...claudeJsonServers }, logger);
      return Object.keys(merged).length > 0 ? merged : null;
    }

    let installedPlugins = {};
    try {
      const pluginsDir = path.join(baseDir, 'plugins');
      const installedPath = path.join(pluginsDir, 'installed_plugins.json');
      if (fs.existsSync(installedPath)) {
        const installed = JSON.parse(fs.readFileSync(installedPath, 'utf-8'));
        installedPlugins = installed.plugins || {};
      }
    } catch (err) {
      logger.debug('Failed to read installed plugins', { error: err.message });
    }

    // Read blocklist
    let blocklist = [];
    try {
      const blocklistPath = path.join(baseDir, 'plugins', 'blocklist.json');
      if (fs.existsSync(blocklistPath)) {
        blocklist = JSON.parse(fs.readFileSync(blocklistPath, 'utf-8'));
        if (!Array.isArray(blocklist)) { blocklist = []; }
      }
    } catch {
      // Ignore blocklist read errors
    }

    for (const [pluginName, isEnabled] of Object.entries(enabledPlugins)) {
      if (!isEnabled) { continue; }
      if (blocklist.includes(pluginName)) {
        logger.debug('Skipping blocklisted plugin', { pluginName });
        continue;
      }

      const pluginInfo = installedPlugins[pluginName];
      if (!pluginInfo || !pluginInfo.installPath) { continue; }

      try {
        const mcpPath = path.join(pluginInfo.installPath, '.mcp.json');
        if (!fs.existsSync(mcpPath)) { continue; }
        const raw = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
        const servers = normalizeMcpJson(raw);

        for (const [name, config] of Object.entries(servers)) {
          pluginServers[name] = config;
        }
      } catch (err) {
        logger.debug('Failed to read plugin MCP config', { pluginName, error: err.message });
      }
    }
  } catch (err) {
    logger.debug('Failed to read Claude Code settings', { error: err.message });
  }

  // Merge: plugin servers first, then claude.json overwrites (higher priority).
  // Recursive-spawn guard: drop every entry that resolves to amicus itself.
  const merged = stripSelfMcpEntries({ ...pluginServers, ...claudeJsonServers }, logger);

  return Object.keys(merged).length > 0 ? merged : null;
}

/**
 * Discover MCP servers from Cowork / Claude Desktop config.
 *
 * @param {string} [configDir] - Path to config directory (for testing)
 * @returns {object|null} MCP server configs, or null if none found
 */
function discoverCoworkMcps(configDir) {
  const baseDir = configDir || (
    process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'Claude')
      : path.join(os.homedir(), '.config', 'Claude')
  );

  try {
    const configPath = path.join(baseDir, 'claude_desktop_config.json');
    if (!fs.existsSync(configPath)) { return null; }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (!config.mcpServers || Object.keys(config.mcpServers).length === 0) {
      return null;
    }
    return config.mcpServers;
  } catch (err) {
    logger.debug('Failed to read Cowork config', { error: err.message });
    return null;
  }
}

/**
 * Discover MCP servers from the parent LLM's configuration.
 *
 * @param {string} [clientType] - Client type: 'code-local', 'code-web', 'cowork'
 * @returns {object|null} Discovered MCP server configs, or null
 */
function discoverParentMcps(clientType) {
  if (clientType === 'cowork') {
    return discoverCoworkMcps();
  }
  if (!clientType || clientType === 'code-local' || clientType === 'code-web') {
    return discoverClaudeCodeMcps();
  }
  logger.debug('Unknown client type for MCP discovery', { clientType });
  return null;
}

module.exports = {
  discoverParentMcps,
  discoverClaudeCodeMcps,
  discoverCoworkMcps,
  normalizeMcpJson
};

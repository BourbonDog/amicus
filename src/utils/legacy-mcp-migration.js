// src/utils/legacy-mcp-migration.js
'use strict';

/**
 * Legacy 'sidecar' MCP registration cleanup (Phase 4 tool de-bloat).
 *
 * Through v1.7.x scripts/postinstall.js registered the SAME stdio MCP server
 * under two names — 'amicus' and legacy 'sidecar' — in Claude Code
 * (~/.claude.json) and Claude Desktop/Cowork (claude_desktop_config.json).
 * Combined with the in-server sidecar_* tool aliases this quadrupled the
 * client-visible tool surface (13 real tools -> 52).
 *
 * This module removes a legacy 'sidecar' server entry, but ONLY when it is
 * identical-in-effect to the amicus registration: its command must resolve to
 * an amicus MCP invocation per isAmicusMcpConfig() (./mcp-self-identity,
 * Phase 1). A 'sidecar' entry pointing anywhere else is user customization
 * and is NEVER touched.
 *
 * Consumers: scripts/postinstall.js (one-shot migration on install/upgrade)
 * and src/cli-handlers-doctor.js (duplicate check + `doctor --fix`).
 * All functions are synchronous, never throw, and report via return values.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeFileAtomic } = require('./atomic-write');

/** ~/.claude.json — where BOTH Claude Code registration paths (CLI + file fallback) land. */
function claudeCodeConfigPath() {
  return path.join(os.homedir(), '.claude.json');
}

/** claude_desktop_config.json — platform-aware; mirrors postinstall registerClaudeDesktop. */
function claudeDesktopConfigPath() {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json');
  }
  return path.join(os.homedir(), '.config', 'claude', 'claude_desktop_config.json');
}

function defaultTargets(deps = {}) {
  return [
    { target: 'Claude Code', configPath: deps.codePath || claudeCodeConfigPath() },
    { target: 'Claude Desktop', configPath: deps.desktopPath || claudeDesktopConfigPath() },
  ];
}

/**
 * Inspect one config file for a legacy 'sidecar' MCP entry.
 * @returns {{status:'absent'|'removable'|'customized'|'unreadable', config?:object}}
 */
function inspectLegacySidecarEntry(configPath, deps = {}) {
  const isAmicus = deps.isAmicusMcpConfig
    || require('./mcp-self-identity').isAmicusMcpConfig;
  let parsed;
  try {
    if (!fs.existsSync(configPath)) { return { status: 'absent' }; }
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    return { status: 'unreadable' };
  }
  const entry = parsed && parsed.mcpServers ? parsed.mcpServers.sidecar : undefined;
  if (!entry) { return { status: 'absent' }; }
  return isAmicus(entry)
    ? { status: 'removable', config: entry }
    : { status: 'customized', config: entry };
}

/**
 * Remove the legacy 'sidecar' entry from one config file — ONLY when it is an
 * amicus self-invocation. Preserves every other key in the file.
 * @returns {'absent'|'removed'|'customized'|'unreadable'|'write-failed'}
 */
function removeLegacySidecarEntry(configPath, deps = {}) {
  const inspected = inspectLegacySidecarEntry(configPath, deps);
  if (inspected.status !== 'removable') { return inspected.status; }
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    delete parsed.mcpServers.sidecar;
    // Atomic temp+rename write — a crash mid-write must never corrupt the
    // user's main Claude Code state file. 0o600 is a no-op on NTFS; kept for
    // parity with addMcpToConfigFile.
    writeFileAtomic(configPath, JSON.stringify(parsed, null, 2), { mode: 0o600 });
    return 'removed';
  } catch {
    return 'write-failed';
  }
}

/** Inspect every known registry (doctor check). */
function inspectAllLegacySidecarEntries(deps = {}) {
  return defaultTargets(deps).map((t) => ({ ...t, ...inspectLegacySidecarEntry(t.configPath, deps) }));
}

/** Remove identical-in-effect legacy entries everywhere. Idempotent. */
function migrateLegacySidecar(deps = {}) {
  return defaultTargets(deps).map((t) => ({ ...t, result: removeLegacySidecarEntry(t.configPath, deps) }));
}

module.exports = {
  claudeCodeConfigPath, claudeDesktopConfigPath,
  inspectLegacySidecarEntry, removeLegacySidecarEntry,
  inspectAllLegacySidecarEntries, migrateLegacySidecar,
};

#!/usr/bin/env node

/**
 * Post-install script for amicus
 *
 * 1. Copies SKILL.md to ~/.claude/skills/sidecar/
 * 2. Registers MCP server in Claude Code (~/.claude.json)
 * 3. Registers MCP server in Claude Desktop/Cowork config
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const SKILL_SOURCE = path.join(__dirname, '..', 'skill', 'SKILL.md');
const COUNCIL_SOURCE_DIR = path.join(__dirname, '..', 'skills', 'second-opinion');

/** Council files + per-file install semantics: SKILL/COUNCIL-DESIGN are product code
 * (overwrite on update); MODEL-NOTES is user data — its reviewer-reliability table evolves
 * per-run, so it is seeded once and never clobbered. */
const COUNCIL_FILES = [
  { file: 'SKILL.md', mode: 'overwrite' },
  { file: 'COUNCIL-DESIGN.md', mode: 'overwrite' },
  { file: 'MODEL-NOTES.md', mode: 'if-missing' },
];

function skillsRoot() {
  return path.join(os.homedir(), '.claude', 'skills');
}

const MCP_CONFIG = { command: 'npx', args: ['-y', 'amicus@latest', 'mcp'] };

/**
 * Add or update an MCP server in a JSON config file.
 * Always overwrites the entry to ensure upgrades apply the latest config.
 *
 * @param {string} configPath - Path to the JSON config file
 * @param {string} name - MCP server name
 * @param {object} config - MCP server config object
 * @returns {string} 'added', 'updated', or 'unchanged'
 */
function addMcpToConfigFile(configPath, name, config) {
  let existing = {};
  try {
    existing = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    // File doesn't exist or invalid JSON — start fresh
  }

  if (!existing.mcpServers) { existing.mcpServers = {}; }

  const prev = existing.mcpServers[name];
  const status = !prev ? 'added' : JSON.stringify(prev) !== JSON.stringify(config) ? 'updated' : 'unchanged';

  existing.mcpServers[name] = config;
  if (status !== 'unchanged') {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); }
    fs.writeFileSync(configPath, JSON.stringify(existing, null, 2), { mode: 0o600 });
  }
  return status;
}

/** Install the chat skill to ~/.claude/skills/sidecar/ */
function installSkill() {
  try {
    const destDir = path.join(skillsRoot(), 'sidecar');
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(SKILL_SOURCE, path.join(destDir, 'SKILL.md'));
    console.log('[amicus] Chat skill installed to ~/.claude/skills/sidecar/');
  } catch (err) {
    console.error(`[amicus] Warning: Could not install chat skill: ${err.message}`);
  }
}

/** Install the LLM Council skill to ~/.claude/skills/second-opinion/ */
function installCouncilSkill(sourceDir = COUNCIL_SOURCE_DIR) {
  const destDir = path.join(skillsRoot(), 'second-opinion');
  for (const { file, mode } of COUNCIL_FILES) {
    try {
      const dest = path.join(destDir, file);
      if (mode === 'if-missing' && fs.existsSync(dest)) { continue; }
      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(path.join(sourceDir, file), dest);
    } catch (err) {
      console.error(`[amicus] Warning: Could not install council file ${file}: ${err.message}`);
    }
  }
  console.log('[amicus] Council skill installed to ~/.claude/skills/second-opinion/');
}

/** Register MCP server in Claude Code config */
function registerClaudeCode() {
  // Try the CLI first
  try {
    const mcpJson = JSON.stringify(MCP_CONFIG);
    execFileSync('claude', ['mcp', 'add-json', 'amicus', mcpJson, '--scope', 'user'], {
      stdio: 'pipe',
      timeout: 10000,
    });
    console.log('[amicus] MCP registered in Claude Code (via CLI).');

    // DEPRECATED(amicus-shim): also register 'sidecar' so existing clients that
    // reference the old server name keep resolving. Remove in next major.
    try {
      execFileSync('claude', ['mcp', 'add-json', 'sidecar', mcpJson, '--scope', 'user'], {
        stdio: 'pipe',
        timeout: 10000,
      });
    } catch {
      // Best-effort; ignore failures for the shim registration
    }

    return;
  } catch {
    // CLI not available or failed — fall back to file edit
  }

  // Fallback: direct file edit
  const claudeConfigPath = path.join(os.homedir(), '.claude.json');
  const status = addMcpToConfigFile(claudeConfigPath, 'amicus', MCP_CONFIG);
  if (status === 'added') {
    console.log('[amicus] MCP registered in Claude Code (~/.claude.json).');
  } else if (status === 'updated') {
    console.log('[amicus] MCP config updated in Claude Code (~/.claude.json).');
  } else {
    console.log('[amicus] MCP already registered in Claude Code.');
  }

  // DEPRECATED(amicus-shim): also register 'sidecar' entry so existing clients
  // that reference the old server name keep resolving. Remove in next major.
  addMcpToConfigFile(claudeConfigPath, 'sidecar', MCP_CONFIG);
}

/** Register MCP server in Claude Desktop / Cowork config */
function registerClaudeDesktop() {
  let configDir;
  if (process.platform === 'darwin') {
    configDir = path.join(os.homedir(), 'Library', 'Application Support', 'Claude');
  } else if (process.platform === 'win32') {
    configDir = path.join(process.env.APPDATA || '', 'Claude');
  } else {
    configDir = path.join(os.homedir(), '.config', 'claude');
  }

  const configPath = path.join(configDir, 'claude_desktop_config.json');
  const status = addMcpToConfigFile(configPath, 'amicus', MCP_CONFIG);
  if (status === 'added') {
    console.log('[amicus] MCP registered in Claude Desktop.');
  } else if (status === 'updated') {
    console.log('[amicus] MCP config updated in Claude Desktop.');
  } else {
    console.log('[amicus] MCP already registered in Claude Desktop.');
  }

  // DEPRECATED(amicus-shim): also register 'sidecar' entry so existing clients
  // that reference the old server name keep resolving. Remove in next major.
  addMcpToConfigFile(configPath, 'sidecar', MCP_CONFIG);
}

function main() {
  console.log('[amicus] Installing...');
  installSkill();
  installCouncilSkill();
  registerClaudeCode();
  registerClaudeDesktop();

  console.log('');
  console.log('[amicus] Setup:');
  console.log('  - Configure API: Run `amicus setup` or set API keys directly');
  console.log('  - API keys: OPENROUTER_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, OPENAI_API_KEY, etc.');
}

// Only run main when executed directly (not when required for testing)
if (require.main === module) {
  main();
}

module.exports = { addMcpToConfigFile, installSkill, installCouncilSkill, COUNCIL_FILES };

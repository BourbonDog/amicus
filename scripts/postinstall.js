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

const SETUP_HOOKS_SCRIPT = path.join(__dirname, 'setup-hooks.js');

const SKILL_SOURCE = path.join(__dirname, '..', 'skills', 'sidecar', 'SKILL.md');
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
  try {
    fs.mkdirSync(destDir, { recursive: true });
  } catch (err) {
    console.error(`[amicus] Warning: Could not create council skill dir: ${err.message}`);
    return;
  }
  let failed = 0;
  for (const { file, mode } of COUNCIL_FILES) {
    try {
      const dest = path.join(destDir, file);
      if (mode === 'if-missing' && fs.existsSync(dest)) { continue; }
      fs.copyFileSync(path.join(sourceDir, file), dest);
    } catch (err) {
      failed++;
      console.error(`[amicus] Warning: Could not install council file ${file}: ${err.message}`);
    }
  }
  if (failed === COUNCIL_FILES.length) {
    console.error('[amicus] Warning: Council skill NOT installed (all files failed — see warnings above).');
  } else if (failed > 0) {
    console.log(`[amicus] Council skill partially installed (${failed}/${COUNCIL_FILES.length} files failed — see warnings above).`);
  } else {
    console.log('[amicus] Council skill installed to ~/.claude/skills/second-opinion/');
  }
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

/**
 * Resolve the Electron binary path the same way src/sidecar/interactive.js
 * getElectronPath() does: require('electron') returns the absolute path to the
 * binary (or throws if the optionalDependency never installed/extracted).
 * @returns {string|null} Path to the Electron binary, or null if unresolvable.
 */
function resolveElectron() {
  try {
    return require('electron');
  } catch {
    return null;
  }
}

/**
 * NON-FATAL verification that the OPTIONAL electron binary actually extracted.
 * Electron is an optionalDependency: npm exits 0 even if its download/extract
 * fails (or AV quarantines electron.exe), so without this the user only finds
 * out the GUI is broken much later. Warn clearly that headless runs + the
 * council still work, and point at `amicus doctor` / reinstall to get the GUI.
 *
 * This MUST never throw out of postinstall — the whole body is guarded so a
 * resolver failure or a missing fs can never turn into a non-zero exit.
 *
 * @param {object} deps - { resolveElectron } override for testing.
 */
function verifyElectron(deps = {}) {
  try {
    const _resolve = deps.resolveElectron || resolveElectron;
    const binPath = _resolve();
    if (binPath && fs.existsSync(binPath)) { return; }
    console.warn('[amicus] Warning: the Electron binary did not install — the interactive GUI / setup-wizard is unavailable.');
    console.warn('[amicus] Headless runs and the council still work. Run `amicus doctor` to check, or `npm install -g amicus` to reinstall and add the GUI.');
  } catch {
    // Never let the electron check throw out of postinstall.
  }
}

/**
 * Configure git hooks for DEVELOPERS, folded into postinstall (#35).
 *
 * Previously this ran via npm's "prepare" lifecycle. But "prepare" also fires
 * on the github: install path (`npm install -g github:BourbonDog/amicus`),
 * where npm clones the repo, runs prepare, does a NESTED devDependency install,
 * and re-packs — a fragile pipeline the registry install SKIPS entirely. That
 * divergence (plus a reusable corrupt cached artifact) is what made github:
 * installs roll back, especially on Windows. Removing the consumer-facing
 * prepare lifecycle makes the github: path behave identically to the registry
 * path.
 *
 * Hook setup still needs to happen for devs, so we run setup-hooks.js here.
 * It is a no-op for consumers: setup-hooks.js exits 0 outside a git checkout
 * (the published tarball / github: export has no .git), so this changes
 * nothing for end users while keeping `npm install` wiring hooks for devs.
 *
 * Best-effort and self-contained: never throws (a hook-setup failure must
 * never roll back the install), so it is safe to call before the optional
 * skill/MCP setup.
 *
 * @param {object} deps - { env } override for testing.
 */
function setupHooks(deps = {}) {
  try {
    execFileSync('node', [SETUP_HOOKS_SCRIPT], {
      stdio: 'inherit',
      env: deps.env || process.env,
    });
  } catch (err) {
    // Hook setup is for devs only and must never fail the install.
    console.warn(`[amicus] Warning: could not configure git hooks: ${err && err.message}`);
  }
}

function main(deps = {}) {
  if (process.env.AMICUS_SKIP_POSTINSTALL === '1') {
    console.log('[amicus] AMICUS_SKIP_POSTINSTALL set — skipping global setup (plugin channel handles registration).');
    return;
  }
  const _installSkill = deps.installSkill || installSkill;
  const _installCouncilSkill = deps.installCouncilSkill || installCouncilSkill;
  const _registerClaudeCode = deps.registerClaudeCode || registerClaudeCode;
  const _registerClaudeDesktop = deps.registerClaudeDesktop || registerClaudeDesktop;
  const _setupHooks = deps.setupHooks || setupHooks;

  console.log('[amicus] Installing...');
  // Dev-only: configure git hooks (no-op for consumers). Folded in from the
  // removed "prepare" lifecycle (#35) so github: installs run identically.
  _setupHooks();
  _installSkill();
  _installCouncilSkill();
  _registerClaudeCode();
  _registerClaudeDesktop();

  // Non-fatal: warn (only) if the optional Electron binary failed to extract.
  verifyElectron(deps);

  console.log('');
  console.log('[amicus] Setup:');
  console.log('  - Configure API: Run `amicus setup` or set API keys directly');
  console.log('  - API keys: OPENROUTER_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, OPENAI_API_KEY, etc.');
}

/**
 * Top-level entry point. Wraps main() so a failure is never fatal: npm treats
 * a non-zero postinstall as a reason to roll back / uninstall the ENTIRE global
 * package, but skill-copy + MCP registration are optional — amicus itself still
 * works without them. Warn clearly and exit 0 (mirrors scripts/setup-hooks.js).
 */
function runCli(deps = {}) {
  try {
    main(deps);
  } catch (err) {
    console.warn(`[amicus] Warning: optional post-install setup failed: ${err && err.message}`);
    console.warn('[amicus] Skill install + MCP registration are optional — amicus itself still works.');
    console.warn('[amicus] Run `amicus doctor` to check setup, or re-register manually later.');
  }
  // Always exit 0 so a failure here never rolls back the global install.
  process.exit(0);
}

// Only run when executed directly (not when required for testing)
if (require.main === module) {
  runCli();
}

module.exports = { main, runCli, addMcpToConfigFile, installSkill, installCouncilSkill, setupHooks, verifyElectron, resolveElectron, COUNCIL_FILES };

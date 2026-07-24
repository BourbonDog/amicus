/**
 * @module claude-register
 * Registration core for amicus: skill install (chat skill + LLM Council),
 * MCP server registration in Claude Code / Claude Desktop, and legacy MCP
 * migration. Extracted from scripts/postinstall.js (Task 15, v4.2 §4.8/C2) so
 * the SAME core can run at `npm install` time (via postinstall.js, now a
 * thin re-exporting consumer of this module) AND on demand via `amicus init`
 * (src/cli-handlers-init.js) — e.g. after a failed postinstall, a
 * plugin-channel / --ignore-scripts install, or to repair deleted ~/.claude
 * state.
 *
 * Behavior is byte-identical to the pre-extraction scripts/postinstall.js,
 * with one deliberate exception (M18): registerClaudeCode/registerClaudeDesktop
 * now RETURN their 'added'|'updated'|'unchanged' status instead of computing
 * it and discarding it, so callers (amicus init) get real per-step status.
 * scripts/postinstall.js's own callers ignore the return value, so this is
 * behavior-safe for postinstall's "byte-identical" claim.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

// B13: sibling of this file under src/utils/ — was '../src/utils/mcp-self-identity'
// when this code lived in scripts/postinstall.js.
const { isAmicusMcpConfig } = require('./mcp-self-identity');

// B13: this file now lives at src/utils/, two levels below the repo root
// (scripts/ was only one level below) — both source paths need an extra '..'.
const SKILL_SOURCE = path.join(__dirname, '..', '..', 'skills', 'sidecar', 'SKILL.md');
const COUNCIL_SOURCE_DIR = path.join(__dirname, '..', '..', 'skills', 'second-opinion');

/** Council files + per-file install semantics: SKILL/COUNCIL-DESIGN/SEAT-BRIEFS are
 * product code (overwrite on update, so upgrades keep them in sync with the package);
 * MODEL-NOTES is user data — its reviewer-reliability table evolves per-run, so it is
 * seeded once and never clobbered. */
const COUNCIL_FILES = [
  { file: 'SKILL.md', mode: 'overwrite' },
  { file: 'COUNCIL-DESIGN.md', mode: 'overwrite' },
  { file: 'SEAT-BRIEFS.md', mode: 'overwrite' },
  { file: 'MANUAL-ORCHESTRATION.md', mode: 'overwrite' },
  { file: 'MODEL-NOTES.md', mode: 'if-missing' },
];

function skillsRoot() {
  return path.join(os.homedir(), '.claude', 'skills');
}

const MCP_CONFIG = { command: 'npx', args: ['-y', 'amicus@latest', 'mcp'] };

/**
 * Add or update an MCP server in a JSON config file.
 *
 * Refreshes command/args on every install/upgrade. If the EXISTING entry at
 * this key is already amicus-shaped (per isAmicusMcpConfig — Phase 1's single
 * source of truth for "this is amicus"), we MERGE instead of overwrite: the
 * user's `env` (and any other extra keys, e.g. a future `cwd`) survive the
 * refresh. Without this, `npm i -g amicus` silently wiped
 * "env": {"AMICUS_LEGACY_ALIASES":"1"} — the exact opt-in escape hatch Phase 4
 * tells users to add — on every upgrade.
 *
 * A NON-amicus-shaped entry at this key is overwritten as before: 'amicus' is
 * a reserved registration name, so a foreign entry there is reclaimed rather
 * than merged with.
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
  const nextConfig = (prev && isAmicusMcpConfig(prev)) ? { ...prev, ...config } : config;
  const status = !prev ? 'added' : JSON.stringify(prev) !== JSON.stringify(nextConfig) ? 'updated' : 'unchanged';

  existing.mcpServers[name] = nextConfig;
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

/**
 * Read the previous 'amicus' entry from ~/.claude.json, if any — used by the
 * CLI add-json path to merge env the same way the file-fallback path does.
 * Never throws: a missing/unreadable file just means "no previous entry".
 * @returns {object|undefined}
 */
function readPrevClaudeCodeAmicusEntry() {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf-8'));
    return parsed && parsed.mcpServers ? parsed.mcpServers.amicus : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Register MCP server in Claude Code config.
 * @returns {'added'|'updated'|'unchanged'} the registration status (M18: both
 *   branches now report a real status instead of discarding it).
 */
function registerClaudeCode() {
  // Try the CLI first
  try {
    // Merge the PREVIOUS registration's env into the add-json payload — same
    // merge semantics as addMcpToConfigFile's file-fallback path (`{ ...prev,
    // ...config }`: prev env keys survive, canonical MCP_CONFIG keys win on
    // collision). Without this, a user's custom env (API key, AMICUS_* tuning
    // knobs) on the old registration was silently dropped whenever the
    // `claude` CLI was present, because the CLI path built its JSON payload
    // from the bare MCP_CONFIG and delegated overwrite semantics to the
    // claude binary — which has no idea about the user's previous entry.
    const prev = readPrevClaudeCodeAmicusEntry();
    const nextConfig = (prev && isAmicusMcpConfig(prev)) ? { ...prev, ...MCP_CONFIG } : MCP_CONFIG;
    // M18: the same status formula addMcpToConfigFile uses, computed from
    // data already in hand. The `claude` CLI itself reports no status, but we
    // know exactly what it is about to write (nextConfig) vs what was there
    // before (prev) — add-json writes to the SAME key the file-fallback path
    // below would, so this is the truth, not a guess.
    const status = !prev ? 'added' : JSON.stringify(prev) !== JSON.stringify(nextConfig) ? 'updated' : 'unchanged';
    const mcpJson = JSON.stringify(nextConfig);
    execFileSync('claude', ['mcp', 'add-json', 'amicus', mcpJson, '--scope', 'user'], {
      stdio: 'pipe',
      timeout: 10000,
    });
    console.log('[amicus] MCP registered in Claude Code (via CLI).');

    return status;
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
  return status;
}

/**
 * Register MCP server in Claude Desktop / Cowork config.
 * @returns {'added'|'updated'|'unchanged'} the registration status (M18: was
 *   computed and used for the console.log branch below, then discarded).
 */
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
  return status;
}

/**
 * One-shot migration: drop the duplicate legacy 'sidecar' MCP entry that
 * pre-1.8 postinstalls registered alongside 'amicus' (same server twice —
 * doubled the client-visible tool list). Only removes an entry whose command
 * is an amicus MCP invocation; a customized 'sidecar' entry is left alone.
 * Covers both files the three legacy registration paths wrote to:
 * ~/.claude.json (CLI + file fallback) and claude_desktop_config.json.
 * Never throws (postinstall must always exit 0).
 */
function migrateLegacyMcp(deps = {}) {
  try {
    // B13: sibling of this file under src/utils/ — was
    // '../src/utils/legacy-mcp-migration' when this lived in scripts/postinstall.js.
    const impl = deps.migrateLegacySidecar
      || require('./legacy-mcp-migration').migrateLegacySidecar;
    for (const r of impl()) {
      if (r.result === 'removed') {
        console.log(`[amicus] Removed duplicate legacy 'sidecar' MCP entry from ${r.target} (same server — kept as 'amicus').`);
      } else if (r.result === 'customized') {
        console.log(`[amicus] Kept custom 'sidecar' MCP entry in ${r.target} (does not point at amicus).`);
      } else if (r.result === 'write-failed') {
        console.warn(`[amicus] Warning: could not remove the legacy 'sidecar' MCP entry from ${r.target} — run: amicus doctor --fix`);
      }
    }
  } catch (err) {
    console.warn(`[amicus] Warning: legacy MCP cleanup skipped: ${err && err.message}`);
  }
}

module.exports = {
  MCP_CONFIG,
  addMcpToConfigFile,
  installSkill,
  installCouncilSkill,
  readPrevClaudeCodeAmicusEntry,
  registerClaudeCode,
  registerClaudeDesktop,
  migrateLegacyMcp,
  COUNCIL_FILES,
};

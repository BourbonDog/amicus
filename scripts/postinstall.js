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

const { repairElectron } = require('../src/sidecar/electron-install');
const HINTS = require('../src/utils/remediation-hints');
const { isAmicusMcpConfig } = require('../src/utils/mcp-self-identity');

const SETUP_HOOKS_SCRIPT = path.join(__dirname, 'setup-hooks.js');

/** Short cache-only provision budget: a slow disk must never hang the install. */
const PROVISION_TIMEOUT_MS = 15000;

const SKILL_SOURCE = path.join(__dirname, '..', 'skills', 'sidecar', 'SKILL.md');
const COUNCIL_SOURCE_DIR = path.join(__dirname, '..', 'skills', 'second-opinion');

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

/** Register MCP server in Claude Code config */
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
    const mcpJson = JSON.stringify(nextConfig);
    execFileSync('claude', ['mcp', 'add-json', 'amicus', mcpJson, '--scope', 'user'], {
      stdio: 'pipe',
      timeout: 10000,
    });
    console.log('[amicus] MCP registered in Claude Code (via CLI).');

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
    const impl = deps.migrateLegacySidecar
      || require('../src/utils/legacy-mcp-migration').migrateLegacySidecar;
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

/**
 * NON-FATAL, CACHE-ONLY provisioning of the OPTIONAL electron binary (#57,
 * supersedes #30's warn-only verifyElectron). Electron is an optionalDependency:
 * npm exits 0 even if its download/extract failed (or AV quarantined
 * electron.exe), so without this the user only finds out the GUI is broken much
 * later.
 *
 * We heal from the LOCAL cache via repairElectron({cacheOnly:true}) — NO network
 * during install. When a cached zip extracts cleanly the GUI just works. When
 * there is no cache (or the repair defers/contends), we emit a clear notice that
 * the GUI provisions on first use and that headless runs + the council already
 * work, then point at `amicus doctor --fix` (#56) — NOT a reinstall, which can
 * loop. A short timeout keeps a slow disk from ever hanging the install.
 *
 * This MUST never throw out of postinstall — the whole body (sync setup, the
 * awaited repair, and a synchronous-throw resolver) is guarded so nothing here
 * can turn into a non-zero exit (#29 always-exit-0 guard preserved).
 *
 * OPT-IN PREWARM (#60): when AMICUS_PREFETCH_ELECTRON=1 the user has asked to
 * aggressively prewarm the GUI at install time. We additionally drive a full
 * (possibly-networked) fetch via repairElectron({force:true}). This is the ONLY
 * path that may hit the network during install; it stays opt-in and non-fatal
 * (a throw here is swallowed and exit 0 is preserved). The DEFAULT remains
 * cache-only (#57).
 *
 * @param {object} deps - { repairElectron } override for testing.
 * @returns {Promise<void>}
 */
async function provisionElectron(deps = {}) {
  try {
    const _repair = deps.repairElectron || repairElectron;

    // Opt-in aggressive prewarm (#60): full fetch if needed. Non-fatal.
    if (process.env.AMICUS_PREFETCH_ELECTRON === '1') {
      console.log('[amicus] AMICUS_PREFETCH_ELECTRON=1 — prewarming the Electron GUI binary (may download)...');
      const forced = await _repair({ force: true });
      if (forced && forced.repaired) {
        console.log('[amicus] Electron GUI binary prewarmed.');
        return;
      }
      if (forced && forced.quarantined) {
        console.warn(`[amicus] Note: the Electron GUI binary could not be installed — ${forced.reason || 'antivirus quarantine.'}`);
        console.warn('[amicus] Headless runs and the council already work without the GUI.');
        return;
      }
      console.warn('[amicus] Note: Electron prewarm did not complete now — the GUI provisions on first use.');
      return;
    }

    const result = await _repair({ cacheOnly: true, timeoutMs: PROVISION_TIMEOUT_MS });
    if (result && result.repaired) { return; }
    // AV quarantine (electron.exe deleted right after extract) needs ACTION, not
    // a generic "provisions on first use" notice — re-extracting can never win,
    // so print the allow-list instruction verbatim instead. (No retry loop.)
    if (result && result.quarantined) {
      console.warn(`[amicus] Note: the Electron GUI binary could not be installed — ${result.reason || 'antivirus quarantine.'}`);
      console.warn('[amicus] Headless runs and the council already work without the GUI.');
      return;
    }
    // No cache hit (deferred), contended, or otherwise not provisioned now.
    console.warn('[amicus] Note: the Electron GUI binary is not provisioned yet — it will download on first use of the interactive GUI / setup-wizard.');
    console.warn(`[amicus] Headless runs and the council already work. To provision the GUI now: ${HINTS.doctorFix}`);
  } catch {
    // Never let provisioning throw out of postinstall.
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

async function main(deps = {}) {
  if (process.env.AMICUS_SKIP_POSTINSTALL === '1') {
    console.log('[amicus] AMICUS_SKIP_POSTINSTALL set — skipping global setup (plugin channel handles registration).');
    return;
  }
  const _installSkill = deps.installSkill || installSkill;
  const _installCouncilSkill = deps.installCouncilSkill || installCouncilSkill;
  const _registerClaudeCode = deps.registerClaudeCode || registerClaudeCode;
  const _registerClaudeDesktop = deps.registerClaudeDesktop || registerClaudeDesktop;
  const _migrateLegacyMcp = deps.migrateLegacyMcp || migrateLegacyMcp;
  const _setupHooks = deps.setupHooks || setupHooks;
  const _provisionElectron = deps.provisionElectron || provisionElectron;

  console.log('[amicus] Installing...');
  // Dev-only: configure git hooks (no-op for consumers). Folded in from the
  // removed "prepare" lifecycle (#35) so github: installs run identically.
  _setupHooks();
  _installSkill();
  _installCouncilSkill();
  _registerClaudeCode();
  _registerClaudeDesktop();
  _migrateLegacyMcp(deps);

  // Non-fatal, cache-only: heal the optional Electron binary from local cache
  // or emit a deferred notice (GUI provisions on first use). Never throws.
  await _provisionElectron(deps);

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
async function runCli(deps = {}) {
  try {
    await main(deps);
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

module.exports = { main, runCli, addMcpToConfigFile, installSkill, installCouncilSkill,
  setupHooks, provisionElectron, registerClaudeCode, registerClaudeDesktop, migrateLegacyMcp, COUNCIL_FILES };

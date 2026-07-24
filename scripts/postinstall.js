#!/usr/bin/env node

/**
 * Post-install script for amicus
 *
 * 1. Copies SKILL.md to ~/.claude/skills/sidecar/
 * 2. Registers MCP server in Claude Code (~/.claude.json)
 * 3. Registers MCP server in Claude Desktop/Cowork config
 *
 * The registration core (skill install, MCP registration, legacy migration)
 * lives in src/utils/claude-register.js (Task 15, v4.2 §4.8/C2) so `amicus
 * init` can re-run it on demand — this file is now a thin consumer that
 * wires that core into the npm postinstall lifecycle (dev hooks, electron
 * provisioning, and the top-level never-fail wrapper below).
 */

const path = require('path');
const { execFileSync } = require('child_process');

const { repairElectron } = require('../src/sidecar/electron-install');
const HINTS = require('../src/utils/remediation-hints');
const reg = require('../src/utils/claude-register');
const {
  installSkill, installCouncilSkill, registerClaudeCode, registerClaudeDesktop,
  migrateLegacyMcp, addMcpToConfigFile, COUNCIL_FILES,
} = reg;

const SETUP_HOOKS_SCRIPT = path.join(__dirname, 'setup-hooks.js');

/** Short cache-only provision budget: a slow disk must never hang the install. */
const PROVISION_TIMEOUT_MS = 15000;

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
    console.log('[amicus] AMICUS_SKIP_POSTINSTALL set — skipping global setup. Run `amicus init` to register skills + MCP on demand.');
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

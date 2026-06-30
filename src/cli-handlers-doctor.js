// src/cli-handlers-doctor.js
'use strict';

const HINTS = require('./utils/remediation-hints');

const MAX_CATALOG_AGE_MS = 24 * 60 * 60 * 1000; // 24h (mirrors model-catalog DEFAULT_MAX_AGE_MS)

/** #56: keep `doctor --fix`'s electron self-heal from ever hanging on a slow disk/network. */
const FIX_TIMEOUT_MS = 90 * 1000;

/** Default real helpers; tests override via deps. */
function realDeps() {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  return {
    nodeVersion: process.version,
    readApiKeys: () => require('./utils/api-key-store').readApiKeys(),
    readApiKeyValues: () => require('./utils/api-key-store').readApiKeyValues(),
    checkOpenRouterCredit: (key) => require('./utils/api-key-validation').checkOpenRouterCredit(key),
    getCwd: () => process.cwd(),
    readProjectMarkers: (dir) => {
      const exists = (name) => { try { return fs.existsSync(path.join(dir, name)); } catch (_e) { return false; } };
      return { hasGit: exists('.git'), hasPackageJson: exists('package.json'), hasClaude: exists('.claude') };
    },
    getConfigDir: () => require('./utils/config').getConfigDir(),
    resolveModel: () => require('./utils/config').resolveModel(),
    readCache: () => require('./utils/model-catalog').readCache(),
    collectAliasSources: () => require('./utils/alias-audit').collectAliasSources(),
    findStaleAliases: (s, c) => require('./utils/alias-audit').findStaleAliases(s, c),
    hasOpencodeBinary: () => {
      // Single source of truth shared with the runtime server-start guard.
      const { ensureNodeModulesBinInPath, hasOpencodeBinary } = require('./utils/path-setup');
      ensureNodeModulesBinInPath();
      return hasOpencodeBinary();
    },
    getElectronPath: () => require('./sidecar/interactive').getElectronPath(),
    // #56: self-heal primitive for `doctor --fix`. Pure probe (getElectronPath)
    // stays separate; repair only runs when fix is requested.
    repairElectron: (opts) => require('./sidecar/electron-install').repairElectron(opts),
    fix: false,
    discoverClaudeCodeMcps: () => require('./utils/mcp-discovery').discoverClaudeCodeMcps(),
    discoverCoworkMcps: () => require('./utils/mcp-discovery').discoverCoworkMcps(),
    skillInstalled: () => {
      const dir = path.join(os.homedir(), '.claude', 'skills');
      return fs.existsSync(path.join(dir, 'sidecar', 'SKILL.md'))
        && fs.existsSync(path.join(dir, 'second-opinion', 'SKILL.md'));
    },
  };
}

/** Run one guarded check; a thrown fn becomes an error line. */
function guard(id, name, fn) {
  try { return fn(); }
  catch (e) { return { id, name, status: 'error', message: e.message, hint: null }; }
}

/** Async variant of guard; a thrown/rejected fn becomes an error line. */
async function guardAsync(id, name, fn) {
  try { return await fn(); }
  catch (e) { return { id, name, status: 'error', message: e.message, hint: null }; }
}

/**
 * Compose the health checks. Never throws (async; awaits non-blocking
 * network checks such as the OpenRouter credit probe).
 * @param {object} [depsOverride]
 * @returns {Promise<Array<{id,name,status,message,hint}>>}
 */
async function runDoctorChecks(depsOverride = {}) {
  const d = { ...realDeps(), ...depsOverride };
  const checks = [];

  checks.push(guard('node', 'Node.js', () => {
    const major = parseInt(String(d.nodeVersion).replace(/^v/, '').split('.')[0], 10);
    return major >= 18
      ? { id: 'node', name: 'Node.js', status: 'ok', message: d.nodeVersion, hint: null }
      : { id: 'node', name: 'Node.js', status: 'error', message: `${d.nodeVersion} (need >=18)`, hint: 'Install Node 18 or newer from https://nodejs.org' };
  }));

  checks.push(guard('config-dir', 'Config directory', () => (
    { id: 'config-dir', name: 'Config directory', status: 'ok', message: d.getConfigDir(), hint: null }
  )));

  checks.push(guard('keys', 'API keys', () => {
    const keys = d.readApiKeys();
    const set = Object.keys(keys).filter(k => keys[k]);
    return set.length > 0
      ? { id: 'keys', name: 'API keys', status: 'ok', message: `configured: ${set.join(', ')}`, hint: null }
      : { id: 'keys', name: 'API keys', status: 'error', message: 'no provider keys configured', hint: 'amicus key <provider> <key>  (or run: amicus setup)' };
  }));

  checks.push((() => {
    try {
      const model = d.resolveModel();
      return { id: 'default-model', name: 'Default model', status: 'ok', message: model, hint: null };
    } catch (e) {
      return { id: 'default-model', name: 'Default model', status: 'error', message: e.message || 'no default model', hint: 'amicus setup' };
    }
  })());

  checks.push(guard('catalog', 'Model catalog', () => {
    const cache = d.readCache();
    if (!cache || !cache.fetchedAt) {
      return { id: 'catalog', name: 'Model catalog', status: 'warn', message: 'no cache yet', hint: 'amicus models --refresh' };
    }
    const ageMs = Date.now() - cache.fetchedAt;
    const fresh = ageMs <= MAX_CATALOG_AGE_MS;
    const hrs = Math.round(ageMs / 3600000);
    return fresh
      ? { id: 'catalog', name: 'Model catalog', status: 'ok', message: `${cache.models.length} models, ${hrs}h old`, hint: null }
      : { id: 'catalog', name: 'Model catalog', status: 'warn', message: `stale (${hrs}h old)`, hint: 'amicus models --refresh' };
  }));

  checks.push(guard('aliases', 'Model aliases', () => {
    const cache = d.readCache();
    const catalog = (cache && cache.models) || [];
    const stale = d.findStaleAliases(d.collectAliasSources(), catalog);
    return stale.length === 0
      ? { id: 'aliases', name: 'Model aliases', status: 'ok', message: catalog.length ? 'all resolve' : 'catalog empty — not checked', hint: null }
      : { id: 'aliases', name: 'Model aliases', status: 'warn', message: `${stale.length} stale: ${stale.map(s => s.alias).join(', ')}`, hint: 'amicus models --check' };
  }));

  checks.push(guard('opencode-bin', 'OpenCode binary', () => (
    d.hasOpencodeBinary()
      ? { id: 'opencode-bin', name: 'OpenCode binary', status: 'ok', message: 'found', hint: null }
      : { id: 'opencode-bin', name: 'OpenCode binary', status: 'error', message: 'not found', hint: HINTS.reinstallEngineAv }
  )));

  checks.push(await guardAsync('electron', 'Electron (interactive GUI)', async () => {
    if (d.getElectronPath()) {
      return { id: 'electron', name: 'Electron (interactive GUI)', status: 'ok', message: 'installed', hint: null };
    }
    // Broken (missing / quarantined). With --fix, self-heal in place (#56):
    // repairElectron provisions the binary; {deferred} (no cache, no network)
    // maps to WARN — a deferred download is not a failure. Without --fix, just
    // point the user at `amicus doctor --fix`.
    if (d.fix) {
      let res;
      try {
        res = await d.repairElectron({ timeoutMs: FIX_TIMEOUT_MS });
      } catch (e) {
        return { id: 'electron', name: 'Electron (interactive GUI)', status: 'warn', message: `repair failed: ${e.message} — headless still works`, hint: HINTS.doctorFix };
      }
      res = res || {};
      if (res.repaired || res.usable) {
        return { id: 'electron', name: 'Electron (interactive GUI)', status: 'ok', message: 'installed (self-healed)', hint: null };
      }
      const why = res.reason ? ` — ${res.reason}` : '';
      // Quarantine (AV deleted electron.exe post-extract) is NOT a deferral and
      // must NEVER be silently retried: surface the allow-list instruction as a
      // WARN and STOP. No re-run of repairElectron here (no loop).
      const detail = res.quarantined
        ? `antivirus quarantine${why}`
        : res.deferred
          ? `deferred${why}`
          : res.contended
            ? `repair already in progress${why}`
            : `not provisioned${why}`;
      return { id: 'electron', name: 'Electron (interactive GUI)', status: 'warn', message: `${detail} — headless still works`, hint: HINTS.doctorFix };
    }
    return { id: 'electron', name: 'Electron (interactive GUI)', status: 'warn', message: 'not installed — headless still works', hint: HINTS.doctorFix };
  }));

  checks.push(guard('skills', 'Skills installed', () => (
    d.skillInstalled()
      ? { id: 'skills', name: 'Skills installed', status: 'ok', message: '~/.claude/skills/{sidecar,second-opinion}', hint: null }
      : { id: 'skills', name: 'Skills installed', status: 'warn', message: 'one or both skills missing', hint: `${HINTS.reinstall}  (re-runs the skill install)` }
  )));

  checks.push(guard('mcp', 'MCP registration', () => {
    const code = d.discoverClaudeCodeMcps();
    const cowork = d.discoverCoworkMcps();
    const inCode = !!(code && code.amicus);
    const inCowork = !!(cowork && cowork.amicus);
    // Primary signal: Claude Code MCP registration. Cowork/Desktop is reported as bonus only.
    if (!inCode) {
      return { id: 'mcp', name: 'MCP registration', status: 'warn', message: 'not registered in Claude Code', hint: `${HINTS.reinstall}  (or install the amicus plugin)` };
    }
    const extra = inCowork ? ', Cowork/Desktop' : '';
    return { id: 'mcp', name: 'MCP registration', status: 'ok', message: `registered: Claude Code${extra}`, hint: null };
  }));

  // #43: OpenRouter credit/free-tier — warns (never errors); skipped when no key.
  checks.push(await guardAsync('openrouter-credit', 'OpenRouter credit', async () => {
    const values = d.readApiKeyValues() || {};
    const key = values.openrouter;
    if (!key) {
      return { id: 'openrouter-credit', name: 'OpenRouter credit', status: 'ok', message: 'no OpenRouter key — skipped', hint: null };
    }
    // Reuses the #38 non-blocking probe; resolves warning:null on any failure.
    const res = (await d.checkOpenRouterCredit(key)) || {};
    if (res.warning) {
      return { id: 'openrouter-credit', name: 'OpenRouter credit', status: 'warn', message: res.warning, hint: 'Add credit at openrouter.ai/credits, or build a free council (amicus setup → option 2).' };
    }
    const remaining = (typeof res.limitRemaining === 'number') ? ` ($${res.limitRemaining} remaining)` : '';
    return { id: 'openrouter-credit', name: 'OpenRouter credit', status: 'ok', message: `credit ok${remaining}`, hint: null };
  }));

  // #43: project-root sanity — warns when cwd looks like an app/install dir or lacks project markers.
  checks.push(guard('project-root', 'Project root', () => {
    const dir = d.getCwd();
    const markers = d.readProjectMarkers(dir);
    const { assessProjectRoot } = require('./utils/project-root-sanity');
    const r = assessProjectRoot(dir, markers);
    return { id: 'project-root', name: 'Project root', status: r.status, message: r.message, hint: r.hint };
  }));

  return checks;
}

const MARK = { ok: '✓', warn: '⚠', error: '✗' }; // ✓ ⚠ ✗

function renderHuman(checks) {
  let out = 'amicus doctor\n\n';
  for (const c of checks) {
    out += `${MARK[c.status] || '?'} ${c.name}: ${c.message}\n`;
    if (c.hint && c.status !== 'ok') { out += `    → ${c.hint}\n`; }
  }
  const errors = checks.filter(c => c.status === 'error').length;
  const warns = checks.filter(c => c.status === 'warn').length;
  out += `\n${errors} error(s), ${warns} warning(s).\n`;
  return out;
}

/**
 * `amicus doctor [--json] [--fix]`. Injectable `runChecks` for tests.
 * `--fix` (#56) self-heals fixable checks in place (electron via repairElectron).
 * @param {{_:string[], json?:boolean, fix?:boolean}} args
 * @param {(deps?:object)=>Array} [runChecks]
 * @returns {Promise<number>} exit code
 */
async function handleDoctor(args, runChecks = runDoctorChecks) {
  const useJson = !!args.json;
  // #56: --fix flows into runDoctorChecks as a dep so fixable checks (electron)
  // self-heal in place. Omitted (not false) when absent so the injected
  // test-double sees a clean "no fix" call.
  const checks = await runChecks(args.fix ? { fix: true } : undefined);
  if (useJson) {
    const { buildDoctorDoc } = require('./utils/result-schema');
    const VERSION = require('../package.json').version;
    const doc = buildDoctorDoc({ version: VERSION, timestamp: new Date().toISOString(), checks });
    process.stdout.write(JSON.stringify(doc, null, 2) + '\n');
    return doc.ok ? 0 : 1;
  }
  process.stdout.write(renderHuman(checks));
  return checks.some(c => c.status === 'error') ? 1 : 0;
}

module.exports = { runDoctorChecks, handleDoctor, MAX_CATALOG_AGE_MS };

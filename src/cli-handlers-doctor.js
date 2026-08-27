// src/cli-handlers-doctor.js
'use strict';

const HINTS = require('./utils/remediation-hints');
// B14/4.3: 'mcp' + 'mcp-legacy' check bodies (mirrors the B15 tmpSweep split — see file header).
const mcpChecks = require('./utils/doctor-mcp-checks');
// engine-mcp check body — verifies the engine in the npx-cache copies the MCP
// actually launches (bug report #1). Split out to keep this file under the gate.
const engineCheck = require('./utils/doctor-engine-check');
// electron-mcp check body (#76) — same blind spot, electron-flavored.
const electronMcpCheck = require('./utils/doctor-electron-mcp-check');
// local-providers check body (v4.2 §4.7 C8) — split out to keep this file
// under the gate (mirrors the engineCheck/mcpChecks split above).
const localProvidersCheck = require('./utils/doctor-local-providers-check');
// v4.6.2 PR1 (spec §4) — the 'anthropic-base-url' check body.
const baseUrlCheck = require('./utils/doctor-base-url-check');
// B3 (council review of PR 198, issue 195) — the 'aliases' check body,
// including its --fix repair of fabricated bare ids. Same split rationale.
const aliasCheck = require('./utils/doctor-alias-check');
const keyAuthCheck = require('./utils/doctor-key-auth-check'); // #210 — 'keys' tests presence only; this re-validates.

const { DEFAULT_MAX_AGE_MS: MAX_CATALOG_AGE_MS } = require('./utils/model-catalog'); // 24h — single source

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
    validateApiKey: (p, k) => require('./utils/api-key-validation').validateApiKey(p, k), // #210
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
    findDriftedStoredAliases: (s, c) => require('./utils/alias-audit').findDriftedStoredAliases(s, c),
    // B3: the narrow fabricated-bare-id repair class (pure detection) + the
    // impure rewrite primitive `doctor --fix` calls when repairing one.
    findFabricatedAliasRepairs: (s, c) => require('./utils/alias-audit').findFabricatedAliasRepairs(s, c),
    repairAlias: (alias, newId) => aliasCheck.repairAlias(alias, newId),
    hasOpencodeBinary: () => {
      // Single source of truth shared with the runtime server-start guard.
      const { ensureNodeModulesBinInPath, hasOpencodeBinary } = require('./utils/path-setup');
      ensureNodeModulesBinInPath();
      return hasOpencodeBinary();
    },
    // engine-mcp check: probe the engine in every install that could serve the
    // MCP (running/global/npx-cache), not just the one doctor runs from (#1).
    scanEngineInstalls: () => require('./utils/engine-install-scan').scanEngineInstalls(),
    // report #2: copy-from-sibling self-heal for `doctor --fix`.
    repairEngine: (o) => require('./utils/engine-repair').repairEngine(o),
    // electron-mcp check (#76): same enumeration, electron probed per copy.
    scanElectronInstalls: () => electronMcpCheck.scanElectronInstalls(),
    getElectronPath: () => require('./sidecar/interactive-process').getElectronPath(),
    // #56: self-heal primitive for `doctor --fix`. Pure probe (getElectronPath)
    // stays separate; repair only runs when fix is requested.
    repairElectron: (opts) => require('./sidecar/electron-install').repairElectron(opts),
    fix: false,
    discoverCoworkMcps: () => require('./utils/mcp-discovery').discoverCoworkMcps(),
    // B14: raw (unstripped) read — the PRIMARY 'mcp' check signal.
    // discoverClaudeCodeMcps() always strips 'amicus'/'sidecar'-shaped
    // entries (recursive-spawn guard, src/utils/mcp-self-identity.js) and so
    // can never be used to detect a healthy registration — see
    // utils/doctor-mcp-checks.js for the full rationale.
    hasAmicusRegistration: () => require('./utils/mcp-discovery').hasAmicusRegistration(),
    inspectLegacyMcpEntries: () => require('./utils/legacy-mcp-migration').inspectAllLegacySidecarEntries(),
    migrateLegacyMcpEntries: () => require('./utils/legacy-mcp-migration').migrateLegacySidecar(),
    // local-providers check (v4.2 §4.7 C8): both injectable so tests never
    // fire a real network probe when a depsOverride omits them (M14).
    getLocalProviders: () => require('./utils/local-providers').getLocalProviders(),
    probeLocalProvider: (e, o) => require('./utils/local-probe').probeLocalProvider(e, o),
    skillInstalled: () => {
      const dir = path.join(os.homedir(), '.claude', 'skills');
      return fs.existsSync(path.join(dir, 'sidecar', 'SKILL.md'))
        && fs.existsSync(path.join(dir, 'second-opinion', 'SKILL.md'));
    },
    now: () => Date.now(),
    listSessionIndexTmpFiles: () => tmpSweep.listSessionIndexTmpFiles(), // B15
    unlinkSessionIndexTmp: (n) => tmpSweep.unlinkSessionIndexTmp(n),
    listSessionMetadataTmpFiles: () => metaSweep.listSessionMetadataTmpFiles(), // D8
    unlinkSessionMetadataTmp: (n) => metaSweep.unlinkSessionMetadataTmp(n),
    listStaleSessionIndexEntries: () => indexPrune.listStaleSessionIndexEntries(), // R16
    pruneStaleSessionIndexEntries: (ids) => indexPrune.pruneStaleSessionIndexEntries(ids),
  };
}
// B15: sweep logic in utils/session-index-tmp-sweep.js (mirrors mcp-legacy's split).
const tmpSweep = require('./utils/session-index-tmp-sweep');
// D8: per-session metadata.json sibling sweep — utils/session-metadata-tmp-sweep.js.
const metaSweep = require('./utils/session-metadata-tmp-sweep');
// R16: stale sessions-index.json entry prune — utils/session-index-prune.js (mirrors B15 above).
const indexPrune = require('./utils/session-index-prune');

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
    const [maj, min] = String(d.nodeVersion).replace(/^v/, '').split('.').map(n => parseInt(n, 10));
    return (maj > 22 || (maj === 22 && min >= 12))
      ? { id: 'node', name: 'Node.js', status: 'ok', message: d.nodeVersion, hint: null }
      : { id: 'node', name: 'Node.js', status: 'error', message: `${d.nodeVersion} (need >=22.12)`, hint: 'Install Node 22.12 or newer from https://nodejs.org' };
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

  checks.push(await guardAsync('key-auth', 'API key auth', () => keyAuthCheck.evaluateKeyAuth(d))); // #210
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

  // B3: self-heals in place under --fix (fabricated bare ids only) — see
  // utils/doctor-alias-check.js for the check body and utils/alias-audit.js's
  // findFabricatedAliasRepairs for the detection rule.
  checks.push(guard('aliases', 'Model aliases', () => aliasCheck.evaluateAliasesCheck(d)));

  checks.push(guard('anthropic-base-url', 'ANTHROPIC_BASE_URL',
    () => baseUrlCheck.evaluateAnthropicBaseUrl(d)));

  checks.push(guard('opencode-bin', 'OpenCode binary', () => (
    d.hasOpencodeBinary()
      ? { id: 'opencode-bin', name: 'OpenCode binary', status: 'ok', message: 'found', hint: null }
      : { id: 'opencode-bin', name: 'OpenCode binary', status: 'error', message: 'not found', hint: HINTS.reinstallEngineAv }
  )));

  // Cross-install: verify the engine in the npx-cache copies the MCP actually
  // launches (`npx -y amicus@latest mcp`), so a green 'opencode-bin' (the running
  // install) can't hide a broken copy the MCP would spawn (bug report #1/#4).
  checks.push(await guardAsync('engine-mcp', 'OpenCode engine (MCP launch path)', () => engineCheck.evaluateEngineMcp(d)));

  // #76: same green-while-broken blind spot for Electron — probe the npx-cache
  // copies `ui: true` actually depends on. fixTimeoutMs forwards the #56
  // never-hang guard to the per-copy repairElectron calls.
  checks.push(await guardAsync('electron-mcp', 'Electron (MCP launch path)',
    () => electronMcpCheck.evaluateElectronMcp({ ...d, fixTimeoutMs: FIX_TIMEOUT_MS })));

  checks.push(await guardAsync('electron', 'Electron (interactive GUI)',
    () => electronMcpCheck.evaluateElectronInteractive(d, { fixTimeoutMs: FIX_TIMEOUT_MS })));

  checks.push(guard('skills', 'Skills installed', () => (
    d.skillInstalled()
      ? { id: 'skills', name: 'Skills installed', status: 'ok', message: '~/.claude/skills/{sidecar,second-opinion}', hint: null }
      : { id: 'skills', name: 'Skills installed', status: 'warn', message: 'one or both skills missing', hint: `${HINTS.reinstall}  (re-runs the skill install)` }
  )));

  checks.push(guard('mcp', 'MCP registration', () => mcpChecks.evaluateMcpRegistration(d)));

  // Duplicate legacy 'sidecar' MCP registration check — logic lives in
  // utils/doctor-mcp-checks.js (mirrors the B15 tmpSweep split) to keep this
  // file under the 300-line size gate.
  checks.push(guard('mcp-legacy', 'Legacy sidecar MCP entry', () => mcpChecks.evaluateLegacyMcpEntry(d)));

  checks.push(guard('sessions-index-tmp', 'Session index tmp files', () => tmpSweep.evaluateSessionIndexTmpSweep(d)));

  // R16: beside its sibling above — same file, a different growth gap.
  checks.push(guard('sessions-index-prune', 'Session index stale entries', () => indexPrune.evaluateSessionIndexPrune(d)));

  checks.push(guard('session-metadata-tmp', 'Session metadata tmp files', () => metaSweep.evaluateSessionMetadataTmpSweep(d)));

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

  // v4.2 §4.7 C8: configured local / OpenAI-compatible providers (Ollama, LM
  // Studio, vLLM, generic) — reachability only; warn, never error (a napping
  // `ollama serve` is not a doctor failure).
  checks.push(await guardAsync('local-providers', 'Local providers', () => localProvidersCheck.evaluateLocalProviders(d)));

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

function renderHuman(checks, degrades = []) {
  let out = 'amicus doctor\n\n';
  for (const c of checks) {
    out += `${MARK[c.status] || '?'} ${c.name}: ${c.message}\n`;
    if (c.hint && c.status !== 'ok') { out += `    → ${c.hint}\n`; }
  }
  const errors = checks.filter(c => c.status === 'error').length;
  const warns = checks.filter(c => c.status === 'warn').length;
  out += `\n${errors} error(s), ${warns} warning(s).\n`;
  // D7: every --fix repair announces what it did, in the one voice. Failures
  // are NOT repeated here — the ✗ rows above already carry them; degrade
  // records are the --json/artifact surface.
  const { formatDegrade } = require('./utils/degrade');
  for (const r of degrades.filter(x => x.kind === 'heal')) {
    out += formatDegrade(r);
  }
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
  // v4.6 Plan 3: collect once, both paths consume — the shared degrade/heal
  // vocabulary (spec §4/§6). Never affects the exit-code logic below.
  const { collectDoctorDegrades } = require('./utils/doctor-degrade');
  const degrades = collectDoctorDegrades(checks);
  if (useJson) {
    const { buildDoctorDoc } = require('./utils/result-schema');
    const VERSION = require('../package.json').version;
    const doc = buildDoctorDoc({ version: VERSION, timestamp: new Date().toISOString(), checks, degrades });
    process.stdout.write(JSON.stringify(doc, null, 2) + '\n');
    return doc.ok ? 0 : 1;
  }
  process.stdout.write(renderHuman(checks, degrades));
  return checks.some(c => c.status === 'error') ? 1 : 0;
}

module.exports = { runDoctorChecks, handleDoctor, MAX_CATALOG_AGE_MS };

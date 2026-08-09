/**
 * @module utils/engine-install-scan
 * Discover + probe every amicus install that could serve the MCP (running,
 * global, npx-cache), so `amicus doctor` verifies the copy the MCP actually
 * launches — not just the copy doctor happens to run from.
 *
 * The MCP is registered as `npx -y amicus@latest mcp` (scripts/postinstall.js),
 * so it runs from an npx-cache copy, while `amicus doctor` typically inspects the
 * global install on PATH. When those diverge, doctor can report the engine
 * "found" (global) while the npx copy the MCP launches is broken and every call
 * fails — the bug report's green-while-broken defect (#1). This enumerates
 * running + global + each npx-cache copy and probes the opencode engine in each
 * via the #69 dual-root resolver.
 */

'use strict';

const path = require('path');
const os = require('os');

/** Default npm cache dir: %LocalAppData%/npm-cache on win32, else ~/.npm. */
function defaultNpmCacheDir(platform) {
  if (platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(local, 'npm-cache');
  }
  return path.join(os.homedir(), '.npm');
}

/**
 * Best-effort `npm root -g`. Never throws; returns null on any failure.
 * ⚠️ Windows needs shell:true — npm is a .cmd shim, and Node 24's
 * CVE-2024-27980 hardening rejects .cmd via execFileSync without a shell
 * (bare `npm` → ENOENT, `npm.cmd` → EINVAL). Without this the global install
 * was invisible to the whole scan, which also blinded engine-repair's donor
 * search: `doctor --fix` reported "no healthy sibling install" while one sat
 * at %AppData%\npm\node_modules.
 */
function resolveNpmRootG({ execFileSync, platform } = {}) {
  const win = (platform || process.platform) === 'win32';
  try {
    const exec = execFileSync || require('child_process').execFileSync;
    const out = exec('npm', ['root', '-g'], {
      encoding: 'utf-8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'], shell: win,
    });
    return String(out).trim() || null;
  } catch (_e) {
    return null;
  }
}

/** Run fn, swallowing any throw and returning fallback. */
function safe(fn, fallback) {
  try { return fn(); } catch (_e) { return fallback; }
}

/**
 * Resolve the engine version from the roots already on the record. Reads
 * opencode-ai's own package.json, which is a faithful proxy for the executed
 * binary because opencode-ai exact-pins all 12 platform sub-packages.
 * ⚠️ Do NOT read next to the binary: hasOpencodeBinary probes
 * opencode-windows-<arch>/bin/opencode.exe on win32 but .bin/opencode on
 * POSIX, and .bin/ has no package.json — a binary-adjacent rule would work on
 * Windows only and silently return nothing on the two POSIX CI legs.
 * Uses the real `fs` module directly (not a seam) because this is the
 * PRODUCTION default — tests always inject `readEngineVersion` instead (the
 * suite's fakeFs implements no readFileSync).
 * @returns {string|undefined} undefined (never null) so toEqual fixtures survive
 */
function defaultReadEngineVersion({ roots }) {
  for (const root of roots || []) {
    try {
      const raw = require('fs').readFileSync(path.join(root, 'opencode-ai', 'package.json'), 'utf-8');
      const v = JSON.parse(raw).version;
      if (v) { return String(v); }
    } catch (_e) { /* try the next root */ }
  }
  return undefined;
}

/** Drop installs whose pkgDir resolves to the same real path; keep the first. */
function dedupByRealpath(installs, fs) {
  const seen = new Set();
  const out = [];
  for (const inst of installs) {
    const real = safe(() => fs.realpathSync(inst.pkgDir), inst.pkgDir);
    const key = path.normalize(real);
    if (seen.has(key)) { continue; }
    seen.add(key);
    out.push(inst);
  }
  return out;
}

/**
 * The amicus installs that could serve the MCP, highest-priority first
 * (running, global, then npx-cache copies). All I/O behind seams.
 *
 * @param {object} [deps]
 * @param {object} [deps.fs] - fs module (existsSync/readdirSync/realpathSync)
 * @param {string} [deps.platform] - process.platform override
 * @param {string} [deps.runningPkgDir] - this process's amicus package root
 * @param {string} [deps.npmCacheDir] - npm cache dir holding _npx/
 * @param {() => (string|null)} [deps.npmRootG] - resolver for `npm root -g`
 * @returns {Array<{kind:string, pkgDir:string}>}
 */
function listAmicusInstalls(deps = {}) {
  const fs = deps.fs || require('fs');
  const platform = deps.platform || process.platform;
  const runningPkgDir = deps.runningPkgDir || path.join(__dirname, '..', '..');
  const npmCacheDir = deps.npmCacheDir || defaultNpmCacheDir(platform);
  const npmRootG = deps.npmRootG || (() => resolveNpmRootG({ platform }));

  const raw = [{ kind: 'running', pkgDir: runningPkgDir }];

  // Global — best-effort; `npm root -g` → <root>/amicus. Never fails the scan.
  const gRoot = safe(() => npmRootG(), null);
  if (gRoot) {
    const gDir = path.join(gRoot, 'amicus');
    if (safe(() => fs.existsSync(gDir), false)) {
      raw.push({ kind: 'global', pkgDir: gDir });
    }
  }

  // npx caches — <cache>/_npx/<hash>/node_modules/amicus for each hash present.
  const npxRoot = path.join(npmCacheDir, '_npx');
  for (const hash of safe(() => fs.readdirSync(npxRoot), [])) {
    const pkgDir = path.join(npxRoot, hash, 'node_modules', 'amicus');
    if (safe(() => fs.existsSync(pkgDir), false)) {
      raw.push({ kind: 'npx', pkgDir });
    }
  }

  return dedupByRealpath(raw, fs);
}

/**
 * Classify the MCP launch method from the amicus registration config.
 * @param {{command?:string, args?:unknown[]}|null|undefined} config
 * @returns {'npx'|'path'|'none'|'unknown'}
 */
function classifyLaunch(config) {
  const { isAmicusMcpConfig, normalizeToken } = require('./mcp-self-identity');
  if (!config || typeof config !== 'object') { return 'none'; }
  if (config.command && normalizeToken(config.command) === 'npx') { return 'npx'; }
  if (isAmicusMcpConfig(config)) { return 'path'; }
  return 'unknown';
}

/**
 * Enumerate serving installs, probe the engine in each, and classify how the
 * MCP launches.
 *
 * @param {object} [deps] - listAmicusInstalls seams, plus:
 * @param {(d:{pkgDir:string}) => boolean} [deps.hasOpencodeBinary]
 * @param {(d:{pkgDir:string}) => string[]} [deps.opencodeRoots]
 * @param {(d:{pkgDir:string, roots:string[]}) => (string|undefined)} [deps.readEngineVersion]
 * @param {() => (object|null)} [deps.readAmicusMcpConfig]
 * @returns {{installs: Array<{kind,pkgDir,engineOk,roots,engineVersion}>, mcpLaunch: string}}
 */
function scanEngineInstalls(deps = {}) {
  const hasOpencodeBinary = deps.hasOpencodeBinary || require('./path-setup').hasOpencodeBinary;
  const opencodeRoots = deps.opencodeRoots || require('./path-setup').opencodeRoots;
  const readEngineVersion = deps.readEngineVersion || defaultReadEngineVersion;
  const readAmicusMcpConfig = deps.readAmicusMcpConfig
    || (() => require('./mcp-discovery').readAmicusMcpConfig());

  const installs = listAmicusInstalls(deps).map((i) => {
    const roots = opencodeRoots({ pkgDir: i.pkgDir });
    return {
      ...i,
      engineOk: !!hasOpencodeBinary({ pkgDir: i.pkgDir }),
      roots,
      engineVersion: safe(() => readEngineVersion({ pkgDir: i.pkgDir, roots }), undefined),
    };
  });
  const mcpLaunch = classifyLaunch(safe(() => readAmicusMcpConfig(), null));
  return { installs, mcpLaunch };
}

module.exports = {
  listAmicusInstalls, scanEngineInstalls, classifyLaunch, resolveNpmRootG,
};

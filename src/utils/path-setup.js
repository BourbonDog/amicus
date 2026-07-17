const path = require('path');
const os = require('os');

/**
 * The node_modules roots that may hold the opencode engine sub-packages.
 *
 * npm only NESTS a dependency under <pkg>/node_modules when it cannot hoist it.
 * `npm i -g amicus` nests opencode-windows-*; `npx -y amicus@latest` — which is
 * exactly how postinstall registers the MCP server — HOISTS it to a sibling of
 * amicus/, leaving <pkg>/node_modules nonexistent. Both are valid installs, so
 * probe both roots rather than assuming a layout. Assuming the nested one made a
 * present, runnable engine read as missing and threw engineMissing on every
 * fanout leg under npx (#69).
 *
 * Order is search priority: nested (amicus's own copy) before hoisted.
 *
 * @param {object} [deps] - test seams
 * @param {string} [deps.nodeModulesRoot] - exact root override (wins outright)
 * @param {string} [deps.pkgDir] - amicus package dir override
 * @returns {string[]} candidate node_modules roots
 */
function opencodeRoots(deps = {}) {
  if (deps.nodeModulesRoot) {
    return [deps.nodeModulesRoot];
  }
  const pkgDir = deps.pkgDir || path.join(__dirname, '..', '..');
  return [
    path.join(pkgDir, 'node_modules'), // nested  — npm i -g
    path.dirname(pkgDir), // hoisted — npx/pnpm: the node_modules holding amicus
  ];
}

/**
 * Ensures that the project's node_modules/.bin directory is included in the PATH,
 * and on Windows also adds the platform-specific native opencode binary directory
 * so that `spawn('opencode', ...)` without shell:true can resolve the .exe.
 * The OpenCode SDK spawns the 'opencode' command, and this ensures it can be found.
 * Walks every candidate root so hoisted installs resolve too (#69).
 *
 * PATH is a first-match search, so the array below IS the priority order — built
 * highest-priority-first, then prepended as ONE group. Two orderings matter and
 * both were once inverted by prepending one dir at a time (LIFO reverses intent):
 *   - default (AVX2) before -baseline: an AVX2 machine must run the fast build,
 *     with baseline only as the older-CPU fallback.
 *   - every native .exe dir before any .bin: on Windows .bin holds a .cmd shim
 *     that bare spawn() cannot execute, so a real .exe must always win — even a
 *     .exe in the other candidate root beats a shim in this one.
 * Hence the three tiers: all defaults, then all baselines, then all .bin — each
 * tier spanning every root in opencodeRoots() priority order.
 *
 * @param {object} [deps] - test seams, forwarded to opencodeRoots()
 * @param {string} [deps.nodeModulesRoot] - exact root override (wins outright)
 * @param {string} [deps.pkgDir] - amicus package dir override
 */
function ensureNodeModulesBinInPath(deps = {}) {
  const roots = opencodeRoots(deps);
  const dirs = [];

  if (os.platform() === 'win32') {
    const archMap = { x64: 'x64', arm64: 'arm64' };
    const arch = archMap[os.arch()] || os.arch();
    // Tier 1: default (AVX2) build in every root.
    for (const root of roots) {
      dirs.push(path.join(root, `opencode-windows-${arch}`, 'bin'));
    }
    // Tier 2: -baseline (pre-AVX2) fallback in every root — searched only after
    // every default build. Do not delete these entries as "dead code".
    for (const root of roots) {
      dirs.push(path.join(root, `opencode-windows-${arch}-baseline`, 'bin'));
    }
  }
  // Tier 3: node_modules/.bin in every root, last (its shims spawn() cannot run).
  for (const root of roots) {
    dirs.push(path.join(root, '.bin'));
  }

  // Prepend the not-yet-present dirs as one group, preserving the order above.
  const missing = dirs.filter((dir) => !process.env.PATH.includes(dir));
  if (missing.length > 0) {
    process.env.PATH = `${missing.join(path.delimiter)}${path.delimiter}${process.env.PATH}`;
  }
}

/**
 * Resolve whether the opencode engine binary actually exists on disk.
 *
 * opencode-ai ships the engine via per-platform binary sub-packages declared as
 * optionalDependencies, so a skipped install or an antivirus quarantine can
 * leave the .exe silently absent — and then `spawn('opencode')` fails with an
 * opaque ENOENT. This is the SINGLE source of truth shared by `amicus doctor`
 * (the opencode-bin check) and the runtime server-start guard, so both agree on
 * what "the binary is present" means.
 *
 * Mirrors the PATH resolution order: on Windows the platform sub-package (and
 * its -baseline variant) bin/opencode.exe; elsewhere node_modules/.bin/opencode.
 * Probes every candidate root (nested AND hoisted — see opencodeRoots), so a
 * layout npm chose for us can never masquerade as a missing engine (#69).
 * Never throws — a probe failure reads as not-found.
 *
 * @param {object} [deps] - test seams
 * @param {object} [deps.fs] - fs module (existsSync)
 * @param {string} [deps.platform] - process.platform override
 * @param {string} [deps.arch] - os.arch() override
 * @param {string} [deps.nodeModulesRoot] - node_modules root override
 * @param {string} [deps.pkgDir] - amicus package dir override
 * @returns {boolean} true only when a real opencode binary resolves on disk
 */
function hasOpencodeBinary(deps = {}) {
  const fs = deps.fs || require('fs');
  const platform = deps.platform || process.platform;
  const arch = deps.arch || os.arch();

  const a = arch === 'arm64' ? 'arm64' : 'x64';
  const candidates = [];
  for (const root of opencodeRoots(deps)) {
    if (platform === 'win32') {
      candidates.push(path.join(root, `opencode-windows-${a}`, 'bin', 'opencode.exe'));
      candidates.push(path.join(root, `opencode-windows-${a}-baseline`, 'bin', 'opencode.exe'));
    } else {
      candidates.push(path.join(root, '.bin', 'opencode'));
    }
  }

  return candidates.some((p) => { try { return fs.existsSync(p); } catch (_e) { return false; } });
}

module.exports = {
  ensureNodeModulesBinInPath,
  hasOpencodeBinary,
  opencodeRoots,
};

const path = require('path');
const os = require('os');

/**
 * Ensures that the project's node_modules/.bin directory is included in the PATH,
 * and on Windows also adds the platform-specific native opencode binary directory
 * so that `spawn('opencode', ...)` without shell:true can resolve the .exe.
 * The OpenCode SDK spawns the 'opencode' command, and this ensures it can be found.
 */
function ensureNodeModulesBinInPath() {
  const nodeModulesRoot = path.join(__dirname, '..', '..', 'node_modules');
  const nodeModulesBin = path.join(nodeModulesRoot, '.bin');

  if (!process.env.PATH.includes(nodeModulesBin)) {
    process.env.PATH = `${nodeModulesBin}${path.delimiter}${process.env.PATH}`;
  }

  // On Windows, Node's spawn() does not execute .cmd shims without shell:true.
  // Add the platform-specific native binary directory so `opencode` resolves
  // to opencode.exe directly (Windows searches PATHEXT-aware when .exe is present).
  if (os.platform() === 'win32') {
    const archMap = { x64: 'x64', arm64: 'arm64' };
    const arch = archMap[os.arch()] || os.arch();
    const nativeBin = path.join(nodeModulesRoot, `opencode-windows-${arch}`, 'bin');
    if (!process.env.PATH.includes(nativeBin)) {
      process.env.PATH = `${nativeBin}${path.delimiter}${process.env.PATH}`;
    }
    // Baseline variant: the default build needs AVX2; opencode ships a
    // -baseline (pre-AVX2) build for older CPUs. Windows resolves the first
    // PATH entry containing a real opencode.exe, so default-before-baseline
    // order matters — do not delete this block as "dead code".
    const nativeBinBaseline = path.join(nodeModulesRoot, `opencode-windows-${arch}-baseline`, 'bin');
    if (!process.env.PATH.includes(nativeBinBaseline)) {
      process.env.PATH = `${nativeBinBaseline}${path.delimiter}${process.env.PATH}`;
    }
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
 * Never throws — a probe failure reads as not-found.
 *
 * @param {object} [deps] - test seams
 * @param {object} [deps.fs] - fs module (existsSync)
 * @param {string} [deps.platform] - process.platform override
 * @param {string} [deps.arch] - os.arch() override
 * @param {string} [deps.nodeModulesRoot] - node_modules root override
 * @returns {boolean} true only when a real opencode binary resolves on disk
 */
function hasOpencodeBinary(deps = {}) {
  const fs = deps.fs || require('fs');
  const platform = deps.platform || process.platform;
  const arch = deps.arch || os.arch();
  const root = deps.nodeModulesRoot || path.join(__dirname, '..', '..', 'node_modules');

  const a = arch === 'arm64' ? 'arm64' : 'x64';
  const candidates = platform === 'win32'
    ? [path.join(root, `opencode-windows-${a}`, 'bin', 'opencode.exe'),
       path.join(root, `opencode-windows-${a}-baseline`, 'bin', 'opencode.exe')]
    : [path.join(root, '.bin', 'opencode')];

  return candidates.some((p) => { try { return fs.existsSync(p); } catch (_e) { return false; } });
}

module.exports = {
  ensureNodeModulesBinInPath,
  hasOpencodeBinary,
};

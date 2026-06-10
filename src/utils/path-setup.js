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

module.exports = {
  ensureNodeModulesBinInPath,
};

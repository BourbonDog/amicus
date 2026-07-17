/**
 * @module utils/engine-repair
 * Engine self-heal primitive (report #2): make the opencode engine present ON
 * DISK in a target amicus install by COPYING the opencode-* packages from a
 * healthy sibling install (running/global/npx). No network, and the donor is on
 * the same machine so its platform binaries match — unlike re-running the
 * opencode postinstall, the flaky optional-dependency trap the startServer guard
 * warns about.
 *
 * PURE copy — no PATH mutation — so it is targetable at ANY copy: the runtime
 * path (engine-ensure) repairs the RUNNING copy; `amicus doctor --fix` repairs a
 * foreign broken npx copy. Everything is injectable so tests never touch the real
 * fs. Mirrors the Electron self-heal primitive (src/sidecar/electron-install.js).
 */

'use strict';

const fsDefault = require('fs');
const path = require('path');

/** The running amicus package root (this file lives in <pkg>/src/utils). */
function runningPkgDir() {
  return path.join(__dirname, '..', '..');
}

/** First healthy install whose real path differs from the destination. */
function findDonor({ installs, destPkgDir, fs }) {
  const norm = (p) => { try { return path.normalize(fs.realpathSync(p)); } catch { return path.normalize(p); } };
  const destReal = norm(destPkgDir);
  return installs.find((i) => i.engineOk && norm(i.pkgDir) !== destReal) || null;
}

/** The donor root (nested or hoisted) that actually holds the engine binary. */
function engineSourceRoot({ donorPkgDir, hasOpencodeBinary, opencodeRoots, fs }) {
  for (const root of opencodeRoots({ pkgDir: donorPkgDir })) {
    if (hasOpencodeBinary({ nodeModulesRoot: root, fs })) { return root; }
  }
  return null;
}

/** Copy every opencode-* package dir + the .bin/opencode* shims source→dest. */
function copyEnginePackages({ sourceRoot, destRoot, fs }) {
  const copied = [];
  fs.mkdirSync(destRoot, { recursive: true });
  for (const name of fs.readdirSync(sourceRoot)) {
    if (!name.startsWith('opencode-')) { continue; }
    fs.cpSync(path.join(sourceRoot, name), path.join(destRoot, name), { recursive: true, force: true });
    copied.push(name);
  }
  // The engine resolver checks <root>/.bin/opencode on non-Windows, so carry the
  // shims across too (relative symlinks resolve against the copied opencode-ai).
  const srcBin = path.join(sourceRoot, '.bin');
  let shims = [];
  try { shims = fs.readdirSync(srcBin).filter((n) => n.startsWith('opencode')); } catch { shims = []; }
  if (shims.length) {
    const dstBin = path.join(destRoot, '.bin');
    fs.mkdirSync(dstBin, { recursive: true });
    for (const n of shims) {
      fs.cpSync(path.join(srcBin, n), path.join(dstBin, n), { recursive: true, force: true });
      copied.push(path.join('.bin', n));
    }
  }
  return copied;
}

/**
 * Copy the opencode engine into destPkgDir from a healthy sibling install.
 * Never throws — every failure mode is a {repaired:false, ...} document.
 *
 * @param {object} [opts]
 * @param {string} [opts.destPkgDir] install to repair (default: running copy)
 * @param {object} [opts.deps] injected { fs, scanEngineInstalls, hasOpencodeBinary, opencodeRoots, acquireLock }
 * @returns {Promise<{repaired:boolean, reason?:string, contended?:boolean, donor?:string, copied?:string[]}>}
 */
async function repairEngine({ destPkgDir = runningPkgDir(), deps = {} } = {}) {
  const fs = deps.fs || fsDefault;
  const scanEngineInstalls = deps.scanEngineInstalls
    || (() => require('./engine-install-scan').scanEngineInstalls());
  const hasOpencodeBinary = deps.hasOpencodeBinary || require('./path-setup').hasOpencodeBinary;
  const opencodeRoots = deps.opencodeRoots || require('./path-setup').opencodeRoots;
  const acquireLock = deps.acquireLock
    || ((o) => require('./engine-lock').acquireRepairLock({ ...o, fs }));

  // Already healthy — nothing to do (ensureEngine fast-paths, but doctor --fix
  // may call us directly on a copy a prior leg already healed).
  if (hasOpencodeBinary({ pkgDir: destPkgDir, fs })) {
    return { repaired: true };
  }

  const { installs } = scanEngineInstalls();
  const donor = findDonor({ installs, destPkgDir, fs });
  if (!donor) {
    return { repaired: false, reason: 'no healthy sibling install to copy the engine from' };
  }

  const sourceRoot = engineSourceRoot({ donorPkgDir: donor.pkgDir, hasOpencodeBinary, opencodeRoots, fs });
  if (!sourceRoot) {
    return { repaired: false, reason: `donor ${donor.pkgDir} has no resolvable engine root` };
  }

  let lock;
  try {
    lock = acquireLock({ pkgDir: destPkgDir });
  } catch (e) {
    if (e && e.code === 'EEXIST') {
      return { repaired: false, contended: true, reason: 'another engine repair is in progress' };
    }
    return { repaired: false, reason: `could not acquire repair lock: ${e && e.message}` };
  }

  try {
    const destRoot = path.join(destPkgDir, 'node_modules');
    const copied = copyEnginePackages({ sourceRoot, destRoot, fs });
    const repaired = !!hasOpencodeBinary({ pkgDir: destPkgDir, fs });
    return repaired
      ? { repaired: true, donor: donor.pkgDir, copied }
      : { repaired: false, reason: 'engine still missing after copy', donor: donor.pkgDir, copied };
  } catch (e) {
    return { repaired: false, reason: `engine copy failed: ${e && e.message}` };
  } finally {
    try { lock.release(); } catch { /* ignore */ }
  }
}

module.exports = { repairEngine, findDonor, engineSourceRoot, copyEnginePackages, runningPkgDir };

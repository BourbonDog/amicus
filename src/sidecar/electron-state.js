/**
 * Electron install-state probes (#76).
 *
 * Distinguishes the two states isElectronUsable() collapses into one boolean:
 *   'package-missing' — the electron optionalDependency was never installed
 *                       (possibly deliberate: headless-only install)
 *   'binary-missing'  — package present but dist/<exe> absent (interrupted
 *                       postinstall, AV quarantine) — repairElectron territory
 *   'ok'              — the resolved exe exists on disk
 *
 * Also owns electronDirFor(): the per-install dual-root layout probe. npm
 * NESTS electron under amicus/node_modules in a global install but HOISTS it
 * to a sibling in the npx cache — the same layout asymmetry that broke the
 * engine probe (#69). In-process require.resolve handles hoisting via walk-up,
 * which is why the running copy probes itself fine; only CROSS-install probing
 * (doctor) needs this explicit dual-root check.
 */

'use strict';

const path = require('path');
const fsDefault = require('fs');
const { isElectronUsable, defaultElectronDir } = require('./electron-install');

/**
 * Locate the electron package dir serving a given amicus install. Checks the
 * nested root first (require.resolve walk-up order), then the hoisted sibling.
 * @param {string} pkgDir amicus package root
 * @param {{fs?:object}} [deps]
 * @returns {string|null} electron package dir, or null when not installed
 */
function electronDirFor(pkgDir, { fs = fsDefault } = {}) {
  const candidates = [
    path.join(pkgDir, 'node_modules', 'electron'),
    path.join(path.dirname(pkgDir), 'electron'),
  ];
  for (const dir of candidates) {
    try { if (fs.existsSync(dir)) { return dir; } } catch { /* unreadable root */ }
  }
  return null;
}

/**
 * Probe one electron package dir into the 3-state verdict.
 * `electronDir: null` (electronDirFor found nothing) short-circuits to
 * package-missing; an explicit dir without package.json reports the same.
 * @param {{electronDir?:string|null, fs?:object, platform?:string, env?:object}} [opts]
 * @returns {{state:'ok'|'package-missing'|'binary-missing', electronDir:string|null}}
 */
function probeElectronState({
  electronDir = defaultElectronDir(), fs = fsDefault, platform = process.platform, env = process.env,
} = {}) {
  if (!electronDir) { return { state: 'package-missing', electronDir: null }; }
  let hasPkg = false;
  try { hasPkg = fs.existsSync(path.join(electronDir, 'package.json')); } catch { /* unreadable */ }
  if (!hasPkg) { return { state: 'package-missing', electronDir }; }
  const usable = isElectronUsable({ electronDir, fs, platform, env });
  return { state: usable ? 'ok' : 'binary-missing', electronDir };
}

module.exports = { electronDirFor, probeElectronState };

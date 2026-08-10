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

/**
 * Parse a semver-shaped string into a [major, minor, patch] triple.
 * Prerelease versions (`1.18.15-beta.1`) return null — treated the same as
 * unparseable, so they sort LAST rather than tying with (and, via a stable
 * sort, sometimes beating) the release they're a prerelease of. Only the
 * exact-release leading triple is a valid donor signal; amicus pins exact
 * release versions, never prereleases.
 * @returns {[number,number,number]|null} null for undefined/non-string/non-semver/prerelease
 */
function parseVersionTriple(v) {
  if (typeof v !== 'string') { return null; }
  const trimmed = v.trim();
  if (/^\d+\.\d+\.\d+-/.test(trimmed)) { return null; }
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(trimmed);
  if (!m) { return null; }
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * Descending version comparator: newest first, unparseable/absent sorts last
 * (never throws). Two unparseable values compare equal (0).
 */
function compareVersionsDesc(a, b) {
  const ta = parseVersionTriple(a);
  const tb = parseVersionTriple(b);
  if (!ta && !tb) { return 0; }
  if (!ta) { return 1; }
  if (!tb) { return -1; }
  for (let i = 0; i < 3; i += 1) {
    if (ta[i] !== tb[i]) { return tb[i] - ta[i]; }
  }
  return 0;
}

/**
 * TWO TIERS, not one sort. An explicitly-global healthy donor — `kind:'global'`,
 * or `isGlobal:true` when engine-install-scan.js's dedup collapsed the
 * `global` record into `running` (#133 R-A finding 1) — wins OUTRIGHT,
 * regardless of version. Only when no explicit-global donor exists does
 * engineVersion rank the remaining candidates (newest first; ties/absent
 * versions fall back to list order, running-first).
 *
 * Review round 2, finding 2: a single version-first sort (this function's
 * first cut) inverted R-A's own goal three ways, each confirmed by a test in
 * tests/utils/engine-repair.test.js:
 *   1. running (dev tree) newer than global → donated the dev tree. R-A's
 *      stated goal is "--fix stops donating the dev engine"; the dev tree
 *      running ahead of the pin is the NORMAL direction mid-pin-bump, not a
 *      reason to trust it over the global install.
 *   2. running-that-is-global older than a healthy npx sibling → donated the
 *      npx sibling — the exact outcome the ORIGINAL (pre-engineVersion)
 *      findDonor test says must never happen, reintroduced via the source
 *      class this file's own scanEngineInstalls docblock calls LEAST
 *      trustworthy (npx-cache copies: optional-dependency skips, AV
 *      quarantine on every re-resolve).
 *   3. global's version unresolved, npx sibling versioned → donated the npx
 *      copy despite a `global` record existing at all.
 * All three share one cause: ranking by version BEFORE asking "is there an
 * explicit global donor at all". Tiering fixes it without losing what the
 * version ranking was FOR — Task 3's kind-only rule left a residual hole
 * (dev checkout, no npm-global install, broken npx destination, healthy npx
 * sibling — no record has kind:'global' at all) where the old code fell
 * through to `healthy[0]`, the running dev tree, and could donate a
 * version-skewed dev engine over a newer healthy sibling. That hole is
 * exactly the case where tier 1 finds nothing and tier 2's version ranking
 * takes over.
 *
 * A `kind !== 'running'` proxy for tier 1 is wrong: listAmicusInstalls pushes
 * `running` first and `global` second, and dedupByRealpath keeps the FIRST of
 * any two entries that resolve to the same real path. So on an ordinary
 * end-user machine — where the running process IS the global install — the
 * `global` record never survives dedup; that copy is labeled `kind:
 * 'running'` (carrying `isGlobal:true` instead, once scanEngineInstalls has
 * run). A `kind !== 'running'` filter would then skip the good global engine
 * and donate some other (possibly stale) healthy copy, importing the exact
 * version skew this self-heal exists to prevent.
 *
 * Tier 1 (`kind==='global' || isGlobal`) is correct on both topologies: on a
 * dev machine the dev tree and the global install are distinct real paths, so
 * the `global` record survives dedup and wins over the dev tree. On an
 * end-user machine there is no separate `global` record — the running process
 * already IS it, flagged `isGlobal:true` — so tier 1 still finds it. Tier 2
 * (list-order fallback via a stable sort) only applies when tier 1 finds
 * nothing at all — a pure dev checkout or npx-only machine.
 */
function findDonor({ installs, destPkgDir, fs }) {
  const norm = (p) => { try { return path.normalize(fs.realpathSync(p)); } catch { return path.normalize(p); } };
  const destReal = norm(destPkgDir);
  const healthy = installs.filter((i) => i.engineOk && norm(i.pkgDir) !== destReal);
  if (healthy.length === 0) { return null; }

  const explicitGlobal = healthy.find((i) => i.kind === 'global' || i.isGlobal);
  if (explicitGlobal) { return explicitGlobal; }

  // No explicit-global donor on this machine at all — rank the remaining
  // healthy candidates by engineVersion (newest first; Array#sort is stable,
  // so ties/absent versions preserve list order, i.e. running-first).
  const sorted = [...healthy].sort((a, b) => compareVersionsDesc(a.engineVersion, b.engineVersion));
  return sorted[0];
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

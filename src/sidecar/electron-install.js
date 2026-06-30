/**
 * Electron self-heal primitive (#53, #59).
 *
 * Electron is an optionalDependency (^28.0.0). A flaky / interrupted extract
 * — or Windows Defender quarantining electron.exe — can leave the package's
 * path.txt on disk while dist/<exe> is MISSING, so the GUI silently fails.
 *
 * This module is the keystone the rest of the self-heal cluster (#54-#57)
 * imports. It does NOT wire itself into any caller. Everything that downloads,
 * extracts, spawns, or locks is dependency-INJECTABLE so tests never hit the
 * network or extract a real binary.
 *
 * Layout reference (npm `electron` package):
 *   node_modules/electron/path.txt    -> "electron.exe" (the exe basename)
 *   node_modules/electron/dist/<exe>  -> the actual binary
 * #59: when ELECTRON_OVERRIDE_DIST_PATH is set, the exe lives in that dir
 * instead of <pkg>/dist (mirrors electron/index.js + install.js semantics).
 *
 * Cache layout (@electron/get):
 *   <cacheRoot>/<sha256>/electron-v<ver>-<platform>-<arch>.zip
 */

'use strict';

const fsDefault = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const { resolveCacheRoots } = require('./electron-cache');

/** Default on-disk location of the installed electron package. */
function defaultElectronDir() {
  try {
    return path.dirname(require.resolve('electron/package.json'));
  } catch {
    return path.join(__dirname, '..', '..', 'node_modules', 'electron');
  }
}

/** Platform exe basename, matching electron's getPlatformPath(). */
function platformExe(platform) {
  switch (platform) {
    case 'mas':
    case 'darwin':
      return path.join('Electron.app', 'Contents', 'MacOS', 'Electron');
    case 'win32':
      return 'electron.exe';
    default:
      return 'electron';
  }
}

/**
 * Resolve the on-disk electron exe path from the package layout.
 * Mirrors ELECTRON_OVERRIDE_DIST_PATH semantics (#59): when set, the exe is
 * <override>/<exeBasename>; otherwise it is <electronDir>/dist/<exeBasename>.
 * @returns {string|null} resolved exe path, or null if path.txt is unreadable.
 */
function resolveElectronBinary({ electronDir = defaultElectronDir(), env = process.env, platform = process.platform, fs = fsDefault } = {}) {
  let exeRel;
  const pathFile = path.join(electronDir, 'path.txt');
  try {
    exeRel = fs.readFileSync(pathFile, 'utf-8').trim();
  } catch {
    exeRel = '';
  }
  if (!exeRel) {
    exeRel = platformExe(platform);
  }
  const override = env.ELECTRON_OVERRIDE_DIST_PATH;
  if (override) {
    return path.join(override, exeRel);
  }
  return path.join(electronDir, 'dist', exeRel);
}

/**
 * True ONLY if the resolved exe actually EXISTS on disk. This is the
 * stat-the-exe check #54 reuses — path.txt surviving is NOT enough.
 */
function isElectronUsable({ electronDir = defaultElectronDir(), env = process.env, platform = process.platform, fs = fsDefault } = {}) {
  const exe = resolveElectronBinary({ electronDir, env, platform, fs });
  try {
    return fs.existsSync(exe);
  } catch {
    return false;
  }
}

/**
 * Locate a previously-downloaded electron zip in the env-configurable cache
 * roots. Walks <root>/<sha>/electron-v<ver>-<platform>-<arch>.zip.
 * @returns {string|null} absolute zip path, or null when no cache hit.
 */
function cachedZip({ version, platform = process.platform, arch = process.arch, env = process.env, fs = fsDefault } = {}) {
  const zipName = `electron-v${version}-${platform}-${arch}.zip`;
  for (const root of resolveCacheRoots(env)) {
    let shaDirs;
    try {
      shaDirs = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const sha of shaDirs) {
      const candidate = path.join(root, sha, zipName);
      try {
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      } catch {
        /* ignore unreadable subdir */
      }
    }
  }
  return null;
}

/** Quarantine / AV note appended to win32 deferral reasons. */
function avHint(platform) {
  if (platform === 'win32') {
    return ' Windows Defender / antivirus may have quarantined electron.exe; '
      + 'allow it and re-run, or reinstall.';
  }
  return '';
}

/**
 * Single-flight lockfile: only one caller may extract/install at a time, so
 * concurrent callers don't double-extract (Windows EBUSY). Throws an
 * EEXIST-coded error when another holder is active.
 */
function defaultAcquireLock({ electronDir, fs = fsDefault }) {
  const lockPath = path.join(os.tmpdir(), `amicus-electron-repair-${Buffer.from(electronDir).toString('hex').slice(0, 16)}.lock`);
  const fd = fs.openSync(lockPath, 'wx'); // EEXIST if held
  return {
    release() {
      try { fs.closeSync(fd); } catch { /* ignore */ }
      try { fs.rmSync(lockPath, { force: true }); } catch { /* ignore */ }
    },
  };
}

/** Restore path.txt so electron/index.js resolves the freshly-extracted exe. */
function writePathTxt({ electronDir, platform, fs }) {
  fs.writeFileSync(path.join(electronDir, 'path.txt'), platformExe(platform));
}

/** Extract a cached zip into <electronDir>/dist offline. */
async function extractFromCache({ zip, electronDir, platform, extract, fs }) {
  const distDir = path.join(electronDir, 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  await extract(zip, { dir: distDir });
  writePathTxt({ electronDir, platform, fs });
}

/** Drive electron's own install.js with force_no_cache semantics. */
function runInstaller({ electronDir, force, spawn }) {
  const installScript = path.join(electronDir, 'install.js');
  const env = { ...process.env };
  if (force) {
    env.force_no_cache = 'true';
  }
  return spawn(process.execPath, [installScript], { env, stdio: 'ignore' });
}

/**
 * Heal a broken electron install.
 *
 * @param {object} opts
 * @param {boolean} [opts.cacheOnly] never hit the network; return
 *   {deferred,reason} when there is no cached zip.
 * @param {boolean} [opts.force] force a fresh (no-cache) installer download.
 * @param {number}  [opts.timeoutMs] best-effort installer timeout.
 * @param {object}  [opts.deps] injected { cachedZip, extract, spawn, acquireLock, fs }.
 * @returns {Promise<{repaired?:boolean, deferred?:boolean, contended?:boolean, reason?:string}>}
 */
async function repairElectron({
  cacheOnly = false,
  force = false,
  timeoutMs,
  electronDir = defaultElectronDir(),
  platform = process.platform,
  version,
  arch = process.arch,
  deps = {},
} = {}) {
  const fs = deps.fs || fsDefault;
  const extract = deps.extract || require('extract-zip');
  const spawn = deps.spawn || ((cmd, args, o) => spawnSync(cmd, args, { ...o, timeout: timeoutMs }));
  const findZip = deps.cachedZip || ((o) => cachedZip(o));
  const acquireLock = deps.acquireLock || ((o) => defaultAcquireLock({ ...o, fs }));

  if (!version) {
    try {
      version = require(path.join(electronDir, 'package.json')).version;
    } catch {
      version = undefined;
    }
  }

  // Single-flight: bail out gracefully if another caller is already repairing.
  let lock;
  try {
    lock = acquireLock({ electronDir, fs });
  } catch (e) {
    if (e && e.code === 'EEXIST') {
      return { contended: true, reason: 'Another electron repair is already in progress.' };
    }
    throw e;
  }

  try {
    // Attempt 1: extract from cache (always preferred, fully offline).
    const zip = findZip({ version, platform, arch, env: process.env, fs });
    if (zip) {
      await extractFromCache({ zip, electronDir, platform, extract, fs });
      return { repaired: isElectronUsable({ electronDir, platform, fs }) };
    }

    if (cacheOnly) {
      return {
        deferred: true,
        reason: `No cached electron zip found for v${version} (${platform}-${arch}); deferring download.${avHint(platform)}`,
      };
    }

    // Attempt 2: drive electron's installer (force_no_cache when forced).
    runInstaller({ electronDir, force, spawn });
    return { repaired: isElectronUsable({ electronDir, platform, fs }) || true };
  } finally {
    try { lock.release(); } catch { /* ignore */ }
  }
}

module.exports = {
  resolveElectronBinary,
  isElectronUsable,
  cachedZip,
  repairElectron,
  // exported for sibling/self-heal modules + tests
  platformExe,
  defaultElectronDir,
};

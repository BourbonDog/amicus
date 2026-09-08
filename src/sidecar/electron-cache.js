/**
 * Electron download-cache root resolution (#53 helper).
 *
 * Split out of electron-install.js to keep that module under the 300-line
 * size gate. Mirrors @electron/get's cache-root precedence:
 *   - electron_config_cache (npm config / .npmrc)
 *   - ELECTRON_CACHE (env override)
 *   - the platform default from env-paths('electron').cache
 */

'use strict';

const fsDefault = require('fs');
const path = require('path');
const os = require('os');

/** Platform default cache dir, mirroring env-paths('electron',{suffix:''}).cache. */
function defaultCacheRoot(env = process.env) {
  const home = env.HOME || os.homedir();
  if (process.platform === 'win32') {
    const localAppData = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return path.join(localAppData, 'electron', 'Cache');
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Caches', 'electron');
  }
  const xdg = env.XDG_CACHE_HOME || path.join(home, '.cache');
  return path.join(xdg, 'electron');
}

/**
 * Ordered, de-duplicated list of cache roots to probe for a cached zip.
 * @returns {string[]}
 */
function resolveCacheRoots(env = process.env) {
  const roots = [];
  if (env.electron_config_cache) { roots.push(env.electron_config_cache); }
  if (env.ELECTRON_CACHE) { roots.push(env.ELECTRON_CACHE); }
  roots.push(defaultCacheRoot(env));
  return [...new Set(roots.filter(Boolean))];
}

/**
 * Locate a previously-downloaded electron zip in the env-configurable cache
 * roots. Walks <root>/<sha>/electron-v<ver>-<platform>-<arch>.zip.
 *
 * MOVED here from electron-install.js (v4.9.6 F1): that file sits at the 300-line
 * gate with no headroom, and the F1 staging wiring had to go somewhere. Cache
 * LOOKUP belongs beside cache-root RESOLUTION anyway; electron-install.js
 * re-exports it so `ei.cachedZip` stays a valid import.
 *
 * The `<sha>` directory names come from `readdirSync` on a directory an attacker
 * may write, so the returned path is attacker-INFLUENCED. Callers must treat it
 * as such: read it ONCE into memory and hash and extract THOSE bytes, never
 * resolving the name a second time (sidecar/electron-custody.js), and never
 * print it unsanitized (utils/text-sanitize.js).
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

module.exports = { resolveCacheRoots, defaultCacheRoot, cachedZip };

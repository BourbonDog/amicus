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

module.exports = { resolveCacheRoots, defaultCacheRoot };

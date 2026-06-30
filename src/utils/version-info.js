/**
 * @module utils/version-info — running vs. on-disk amicus version (#33)
 *
 * After an `npm i -g amicus` upgrade, a long-lived MCP server process keeps
 * running the OLD code until the client restarts it. That staleness is
 * invisible from inside an agent session. These helpers surface the running
 * version in MCP responses and, via a CALL-TIME re-read of the on-disk
 * package.json, flag when the two have diverged.
 */
const fs = require('fs');
const path = require('path');

/** Absolute path to this install's package.json (repo root). */
const PKG_PATH = path.join(__dirname, '..', '..', 'package.json');

/**
 * The version baked into the running process at load time. Free: package.json
 * is already require()'d elsewhere, so this hits the module cache.
 */
const RUNNING_VERSION = require('../../package.json').version;

/**
 * Re-read the on-disk package.json version at call time. Wrapped in try/catch
 * — the file may be mid-rewrite, missing, or unreadable during/after an
 * upgrade — and returns null on any failure rather than throwing.
 * @returns {string|null}
 */
function readOnDiskVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8'));
    return (pkg && typeof pkg.version === 'string') ? pkg.version : null;
  } catch {
    return null;
  }
}

/**
 * One-line staleness warning, or null when there's nothing to warn about
 * (on-disk version unreadable or identical to the running version).
 * @returns {string|null}
 */
function versionWarning() {
  const onDisk = readOnDiskVersion();
  if (!onDisk || onDisk === RUNNING_VERSION) { return null; }
  return `Amicus was upgraded on disk (running v${RUNNING_VERSION}, on-disk v${onDisk}). `
    + `Restart your MCP client to load v${onDisk}.`;
}

module.exports = { RUNNING_VERSION, readOnDiskVersion, versionWarning, PKG_PATH };

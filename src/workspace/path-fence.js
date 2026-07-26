/**
 * Council Workspace — shared realpath-containment fence.
 *
 * Single source of truth for "is this resolved path inside that resolved
 * directory" — the primitive that defeats symlink escapes AND tampered/stale
 * pointer files (a `council-<id>.json` pointer's `runDir` is validated only
 * for truthiness by src/council/run-state.js's readPointer, so nothing
 * upstream of this check guarantees it stays inside the project).
 *
 * Extracted to its own leaf module (no other workspace/* requires) so every
 * consumer can share ONE implementation without creating a require cycle:
 * src/workspace/artifact-guard.js requires src/workspace/run-scan.js for
 * readPointer, so if run-scan.js also required artifact-guard.js for this
 * helper, the two would require each other and one side's destructured
 * import would silently resolve to undefined depending on load order. This
 * module has zero workspace/* dependencies, so artifact-guard.js, run-scan.js,
 * and run-detail.js can all require it directly with no cycle.
 */
'use strict';

const path = require('path');

/**
 * True when `targetRealPath` is exactly `dirRealPath` or a proper descendant
 * of it. Both arguments MUST already be resolved through realpathSync — this
 * is a pure string-prefix check.
 * @param {string} dirRealPath
 * @param {string} targetRealPath
 * @returns {boolean}
 */
function isRealpathContained(dirRealPath, targetRealPath) {
  const dir = String(dirRealPath);
  const target = String(targetRealPath);
  if (target === dir) { return true; }
  // ⚠️ COUNCIL REVIEW R2 (A6): when dirRealPath IS a filesystem root, it already
  // ends in a separator ('/' on POSIX, 'C:\\' on Windows) — blindly appending
  // another (the old `dirRealPath + path.sep`) doubles it ('//' / 'C:\\\\'), and
  // no real path ever starts with that, so containment silently returned false
  // for every path under a root dirRealPath. Only append the separator when it
  // isn't already there.
  const base = dir.endsWith(path.sep) ? dir : dir + path.sep;
  // The separator-qualified prefix (not a bare `startsWith(dir)`) is what defeats
  // the sibling-prefix trap: '/foobar' must not be considered inside '/foo'.
  return target.startsWith(base);
}

module.exports = { isRealpathContained };

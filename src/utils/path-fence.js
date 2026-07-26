/**
 * Shared realpath-containment fence.
 *
 * Single source of truth for "is this resolved path inside that resolved
 * directory" — the primitive that defeats symlink escapes AND tampered/stale
 * pointer files (a `council-<id>.json` pointer's `runDir` is validated only
 * for truthiness by src/council/run-state.js's readPointer, so nothing
 * upstream of this check guarantees it stays inside the project).
 *
 * It is a LEAF: `fs` + `path` and nothing else, no require cycle possible.
 * That was first needed inside the v4.4 workspace layer —
 * src/workspace/artifact-guard.js requires src/workspace/run-scan.js for
 * readPointer, so if run-scan.js also required artifact-guard.js for this
 * helper, the two would require each other and one side's destructured import
 * would silently resolve to undefined depending on load order.
 *
 * It lives in src/utils/ rather than src/workspace/ because its consumers are
 * no longer all workspace modules: the shipped v4.3 surfaces
 * (src/mcp-council-awareness.js behind amicus_status / amicus_abort /
 * amicus_list, src/cli-handlers-watch.js and src/observe/watch-render.js behind
 * `amicus watch`) fence the same pointer with the same check. Keeping it under
 * src/workspace/ would have made three stable shipped surfaces depend on a
 * feature directory added in v4.4 — the only inverted require in the tree, and
 * one that would turn any future reorganisation of that layer into a breaking
 * change for those tools. src/utils/ is the neutral layer src/workspace/
 * already depends on (formatCost, fold-marker), so the arrow now points one way.
 */
'use strict';

const fs = require('fs');
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

/**
 * Fail-closed, disk-resolving form of isRealpathContained: resolves BOTH
 * arguments through realpathSync and applies the same containment test.
 * Returns false when either side cannot be resolved — a missing directory, a
 * dangling symlink, a permission error, or a non-string `targetPath` straight
 * out of a hand-edited pointer file — so an unresolvable path is REFUSED
 * rather than trusted.
 *
 * The v4.4 workspace consumers keep calling isRealpathContained directly
 * because each has to tell "unreadable" apart from "escapes" in the error row
 * it renders. The v4.3 CLI/MCP consumers (src/mcp-council-awareness.js,
 * src/cli-handlers-watch.js, src/observe/watch-render.js) collapse every
 * failure into one outcome — no payload / skip the row / kind 'unknown' — so
 * they take this boolean form instead of repeating the two try/catch blocks at
 * four more call sites.
 * @param {string} dirPath
 * @param {string} targetPath
 * @returns {boolean}
 */
function containsOnDisk(dirPath, targetPath) {
  try {
    return isRealpathContained(fs.realpathSync(dirPath), fs.realpathSync(targetPath));
  } catch { return false; }
}

module.exports = { isRealpathContained, containsOnDisk };

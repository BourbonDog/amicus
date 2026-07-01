/**
 * @module project-root-allowlist — containment check for MCP project/cwd input.
 *
 * The MCP `project` / cwd input becomes the session-store parent AND the spawned
 * sidecar `--cwd`. Untrusted input (a poisoned tool call, a rogue client root)
 * could point it at a system directory (C:/Windows, /etc). This module decides
 * whether a resolved project root is one we are willing to treat as a project.
 *
 * Policy (allow legit repos anywhere the user works, reject egregious escapes):
 *   ALLOW a path under any of —
 *     - os.homedir()
 *     - process.cwd()
 *     - os.tmpdir() (scratch space — session dirs/sidecars here are harmless, and
 *       it keeps behaviour consistent across platforms where tmp is NOT under home
 *       e.g. /tmp on Linux vs %USERPROFILE%\AppData\...\Temp on Windows)
 *     - AMICUS_PROJECT_DIR (single path)
 *     - AMICUS_PROJECT_ROOTS (path-list, os.delimiter-separated)
 *     - any extra root the caller passes (e.g. the MCP client's advertised root)
 *   REJECT anything outside all of the above (e.g. C:/Windows, /etc).
 *
 * Pure(ish): only reads os/env/cwd for the default allow-list; never touches the
 * filesystem and never throws.
 */
const os = require('os');
const path = require('path');
const { canonicalProjectPath } = require('./utils/project-path');

/**
 * True when `child` is `parent` or lives beneath it. Both are canonicalized
 * first so slash/case/trailing-slash differences don't cause false negatives.
 * Comparison is case-insensitive to match Windows path semantics (and harmless
 * on case-sensitive POSIX for our purposes — a genuine escape still fails).
 * @param {string} child
 * @param {string} parent
 * @returns {boolean}
 */
function isPathInside(child, parent) {
  if (!child || !parent) { return false; }
  const c = canonicalProjectPath(child).toLowerCase();
  const p = canonicalProjectPath(parent).toLowerCase();
  if (c === p) { return true; }
  // Guard against prefix false-positives: '/foobar' is NOT inside '/foo'.
  const base = p.endsWith('/') ? p : `${p}/`;
  return c.startsWith(base);
}

/**
 * Collect the allowed root directories from env + os + caller extras.
 * @param {string[]} [extraRoots] additional roots (e.g. MCP client root).
 * @returns {string[]} canonical, de-duplicated, non-empty roots.
 */
function allowedRoots(extraRoots = []) {
  const roots = [os.homedir(), process.cwd(), os.tmpdir()];
  if (process.env.AMICUS_PROJECT_DIR) { roots.push(process.env.AMICUS_PROJECT_DIR); }
  if (process.env.AMICUS_PROJECT_ROOTS) {
    for (const r of process.env.AMICUS_PROJECT_ROOTS.split(path.delimiter)) {
      if (r.trim()) { roots.push(r.trim()); }
    }
  }
  for (const r of extraRoots) { if (r) { roots.push(r); } }
  return [...new Set(roots.filter(Boolean).map(canonicalProjectPath))];
}

/**
 * Decide whether `candidate` is an allowed project root.
 * @param {string} candidate the resolved project/cwd path.
 * @param {string[]} [extraRoots] additional allowed roots (e.g. client root).
 * @returns {boolean}
 */
function isAllowedProjectRoot(candidate, extraRoots = []) {
  if (!candidate) { return false; }
  return allowedRoots(extraRoots).some((root) => isPathInside(candidate, root));
}

module.exports = { isAllowedProjectRoot, isPathInside, allowedRoots };

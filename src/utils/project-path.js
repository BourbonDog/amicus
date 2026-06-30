/**
 * Canonical project-path helper.
 *
 * A project/cwd path can be written many incidental ways that all refer to the
 * SAME logical directory. If a path used to CREATE a session differs (by any of
 * these) from the path used to LOOK IT UP or build a route, the two won't match
 * and the session/route is lost. This module collapses those incidental
 * differences to ONE canonical string.
 *
 * Canonical form (documented contract):
 *   - forward slashes ('/'), never backslashes
 *   - duplicate/mixed separators collapsed to a single '/'
 *   - Windows drive letter upper-cased (c: -> C:)
 *   - no trailing slash, EXCEPT a bare root is preserved ('C:/' and '/')
 *
 * Pure function: no fs, no network, no process state. Safe to call anywhere.
 */

/**
 * Normalize a project/cwd path to its canonical string form.
 *
 * @param {string} p - A filesystem path (Windows or POSIX style).
 * @returns {string} The canonical path, or the input unchanged when falsy.
 */
function canonicalProjectPath(p) {
  // Preserve falsy input (''/undefined/null) so callers can pass through an
  // absent directory without special-casing.
  if (!p) {
    return p;
  }

  // 1. Backslashes -> forward slashes, then collapse duplicate separators.
  let out = p.replace(/\\/g, '/').replace(/\/+/g, '/');

  // 2. Upper-case a leading Windows drive letter (c: -> C:).
  out = out.replace(/^([a-z]):/, (_m, d) => `${d.toUpperCase()}:`);

  // 3. Strip a trailing slash, but keep a bare root ('C:/' or '/').
  if (out.length > 1 && out.endsWith('/')) {
    const withoutSlash = out.slice(0, -1);
    // 'C:/' -> withoutSlash is 'C:' (a bare drive); keep the root slash.
    if (!/^[A-Z]:$/.test(withoutSlash)) {
      out = withoutSlash;
    }
  }

  return out;
}

module.exports = { canonicalProjectPath };

// src/utils/project-root-sanity.js
'use strict';

/**
 * Project-root sanity heuristic (#43).
 *
 * `amicus doctor` resolves the project dir from process.cwd(); when a user
 * launches amicus from a packaged-app/install directory (e.g. the Claude
 * Desktop app dir) instead of their repo, sessions land in the wrong place.
 * This pure helper inspects a path string + its directory markers and decides
 * whether to WARN. It never touches the filesystem and never throws.
 */

/**
 * Path fragments that signal a packaged-app / install directory rather than a
 * user project. Matched case-insensitively against the normalized path.
 */
const INSTALL_PATTERNS = [
  /anthropicclaude/i,        // Claude Desktop app dir
  /[\\/]app-\d/i,            // versioned electron app dir, e.g. app-1.2.3
  /appdata[\\/]local/i,      // Windows per-user app data
  /program files/i,          // Windows install root
  /[\\/]\.asar/i,            // packaged electron resources
];

/** @returns {boolean} true if the path looks like an app/install dir */
function looksLikeInstallDir(dir) {
  if (!dir || typeof dir !== 'string') { return false; }
  return INSTALL_PATTERNS.some((re) => re.test(dir));
}

/**
 * Assess a resolved project dir.
 *
 * @param {string} dir Resolved project directory (e.g. process.cwd()).
 * @param {{hasGit?:boolean, hasPackageJson?:boolean, hasClaude?:boolean}} markers
 *   Presence of .git / package.json / .claude in `dir`.
 * @returns {{status:'ok'|'warn', message:string, hint:string|null}}
 */
function assessProjectRoot(dir, markers) {
  const m = markers || {};
  const safeDir = (dir && typeof dir === 'string') ? dir : '';
  const hint =
    'pass an explicit project (amicus … --project <path>) or cd into your repo before running amicus';

  if (looksLikeInstallDir(safeDir)) {
    return {
      status: 'warn',
      message: `${safeDir || '(empty)'} looks like an app/install dir, not a project`,
      hint,
    };
  }

  const hasMarker = !!(m.hasGit || m.hasPackageJson || m.hasClaude);
  if (!hasMarker) {
    return {
      status: 'warn',
      message: `${safeDir || '(empty)'} has no project markers (.git / package.json / .claude)`,
      hint,
    };
  }

  return { status: 'ok', message: safeDir, hint: null };
}

module.exports = { assessProjectRoot, looksLikeInstallDir, INSTALL_PATTERNS };

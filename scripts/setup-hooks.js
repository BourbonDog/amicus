#!/usr/bin/env node

/**
 * Configure git to run the version-controlled hooks in .husky/.
 *
 * Replaces husky's install step, which pointed core.hooksPath at the
 * generated, gitignored .husky/_ shim directory. That directory only
 * exists where husky's prepare actually ran, so hooks silently never
 * fired in linked git worktrees (relative core.hooksPath resolves against
 * each worktree's root, and .husky/_ is never checked out there). The
 * committed .husky/ directory exists in every checkout, so pointing
 * core.hooksPath at it makes hooks fire in the main clone and in every
 * worktree with no per-worktree setup.
 *
 * Runs automatically via the postinstall flow (scripts/postinstall.js) so a
 * fresh dev `npm install` still wires hooks. It is NOT a "prepare" script:
 * prepare also fires on the github: install path, where it triggers a nested
 * devDependency install + re-pack that the registry path skips (#35) — the
 * source of the Windows github: rollback. If you install with --ignore-scripts
 * (recommended for this repo), run it once by hand:
 *
 *   npm run setup-hooks      # or: node scripts/setup-hooks.js
 *
 * ONLY EVER CONFIGURES THE AMICUS CHECKOUT ITSELF.
 * ------------------------------------------------
 * "Are we in a git checkout?" is NOT a sufficient guard, because git resolves
 * a repository by walking UP the directory tree. When a consumer runs
 * `npm install amicus` inside their own repo, npm runs this postinstall with
 * cwd = <consumer>/node_modules/amicus — where `git rev-parse` finds the
 * CONSUMER'S .git and happily reports success. Writing core.hooksPath there
 * pointed their repository at a .husky directory that does not exist (it is
 * not in package.json "files", so it never ships), which silently disabled
 * every hook in their .git/hooks — no error, no warning, `git commit` just
 * stops running them. The damage also outlived a failed install: npm rolls
 * back node_modules, but not writes to someone else's .git/config.
 *
 * So the guard compares `git rev-parse --show-toplevel` against this package's
 * own root and does nothing unless they are the same directory. That is exact
 * rather than heuristic: a dependency install, a vendored copy, and a global
 * install all sit BELOW their enclosing repo's toplevel (or in no repo at
 * all), while the dev checkout — and every linked worktree of it, whose
 * toplevel is the worktree root — matches. Both sides are realpath'd so
 * macOS's /var -> /private/var symlink and Windows junctions compare equal.
 *
 * Every git call is anchored at the package root rather than process.cwd() for
 * the same reason: what gets configured must depend on where amicus lives, not
 * on where the script happened to be invoked from.
 *
 * Safe to run anywhere: exits 0 outside a git checkout (npm tarball
 * installs, exported archives) and never fails the install.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Resolve symlinks/junctions so two spellings of one directory compare equal.
 * Falls back to a plain resolve when the path cannot be stat'd.
 * @param {string} p
 * @returns {string}
 */
function realpath(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/**
 * Compare two absolute paths for pointing at the same directory.
 * win32 and darwin default filesystems are case-insensitive, and git may
 * report a different drive-letter case than Node does.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function samePath(a, b) {
  const left = path.resolve(a);
  const right = path.resolve(b);
  if (left === right) {
    return true;
  }
  if (process.platform === 'win32' || process.platform === 'darwin') {
    return left.toLowerCase() === right.toLowerCase();
  }
  return false;
}

/** This package's root — the parent of the scripts/ directory holding this file. */
const PKG_ROOT = realpath(path.resolve(__dirname, '..'));

function git(...args) {
  return execFileSync('git', args, { cwd: PKG_ROOT, encoding: 'utf-8' }).trim();
}

let toplevel;
try {
  toplevel = git('rev-parse', '--show-toplevel');
} catch {
  process.exit(0); // not a git checkout — nothing to configure
}

if (!samePath(realpath(toplevel), PKG_ROOT)) {
  // amicus is nested inside someone else's repository — a dependency install,
  // a vendored copy, a global install under a tracked directory. Their hooks
  // are none of our business. Silent: this is the normal consumer path.
  process.exit(0);
}

try {
  git('config', 'core.hooksPath', '.husky');
  console.log('setup-hooks: core.hooksPath -> .husky (applies to all worktrees of this clone)');
} catch (err) {
  console.warn(`setup-hooks: could not set core.hooksPath: ${err.message}`);
  process.exit(0); // never break npm install over hook setup
}

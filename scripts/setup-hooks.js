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
 * So the guard asks `git rev-parse --show-prefix` from the package root. That
 * prints the path of the current directory RELATIVE to the top of the work
 * tree, so it is empty exactly when the package root IS the repository root,
 * and non-empty ("node_modules/amicus/") when amicus merely sits inside
 * someone else's checkout. A dependency install, a vendored copy and a global
 * install all land below their enclosing repo's root; the dev checkout — and
 * every linked worktree of it, whose root is the worktree — comes back empty.
 *
 * DO NOT "simplify" this into comparing `--show-toplevel` against the package
 * root as strings. That was the first attempt and it broke on Windows CI: the
 * runners' %TEMP% is an 8.3 short path (C:\Users\RUNNER~1\...), Node's
 * fs.realpathSync PRESERVES short components while git always reports the long
 * form, so the two spellings of one directory never compared equal and the
 * guard refused to configure a legitimate checkout. Case, separators, symlinks
 * and 8.3 are four different ways for equal paths to spell differently; asking
 * git to compute the relationship sidesteps all of them at once.
 *
 * Every git call is anchored at the package root rather than process.cwd() for
 * the same reason: what gets configured must depend on where amicus lives, not
 * on where the script happened to be invoked from.
 *
 * Safe to run anywhere: exits 0 outside a git checkout (npm tarball
 * installs, exported archives) and never fails the install.
 */

const { execFileSync } = require('node:child_process');
const path = require('node:path');

/** This package's root — the parent of the scripts/ directory holding this file. */
const PKG_ROOT = path.resolve(__dirname, '..');

function git(...args) {
  return execFileSync('git', args, { cwd: PKG_ROOT, encoding: 'utf-8' }).trim();
}

let prefix;
try {
  prefix = git('rev-parse', '--show-prefix');
} catch {
  process.exit(0); // not a git checkout (or a bare repo) — nothing to configure
}

if (prefix !== '') {
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

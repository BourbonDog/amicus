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
 * Safe to run anywhere: exits 0 outside a git checkout (npm tarball
 * installs, exported archives) and never fails the install.
 */

const { execFileSync } = require('node:child_process');

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf-8' }).trim();
}

try {
  git('rev-parse', '--git-dir');
} catch {
  process.exit(0); // not a git checkout — nothing to configure
}

try {
  git('config', 'core.hooksPath', '.husky');
  console.log('setup-hooks: core.hooksPath -> .husky (applies to all worktrees of this clone)');
} catch (err) {
  console.warn(`setup-hooks: could not set core.hooksPath: ${err.message}`);
  process.exit(0); // never break npm install over hook setup
}

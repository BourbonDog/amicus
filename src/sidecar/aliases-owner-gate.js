/**
 * @module sidecar/aliases-owner-gate
 * The refusal gate for `amicus aliases --review --owner` (#238 D8), split out
 * of aliases-owner.js (council round 1 fix wave — the CAS/guard fixes pushed
 * that file past the 300-line cap) the same way aliases-review.js split its
 * own gate/render/prompt helpers out before it hit the same wall.
 *
 * Requires: a TTY, and the package root must BE a git work-tree root
 * (`git rev-parse --show-prefix` empty — an npm-installed copy inside a
 * consumer's repo fails this, mutant GATEPREFIX) with a clean tree
 * (`git status --porcelain --untracked-files=no` empty, so an untracked
 * scratch dir never blocks; R-P2-4, mutant DIRTYTREE). Refused = one reason
 * string, never thrown, so the caller prints it and exits 1 with nothing
 * read or written.
 */

'use strict';

const path = require('path');
const { execFileSync } = require('child_process');
const { collapseExcerpt } = require('../utils/text-sanitize');

const PKG_ROOT = path.resolve(__dirname, '..', '..');

/** @param {string[]} args @returns {string} git's trimmed stdout, run at the package root; stderr ignored (callers print their own reason) */
function defaultGit(args) {
  return execFileSync('git', args, { cwd: PKG_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

/**
 * The first half of `ownerGate`, on its own for `doctor`'s shipped-pins row:
 * true when the package root IS a git work-tree root — the dev checkout or a
 * linked worktree of it — false for an npm-installed copy (`--show-prefix`
 * prints `node_modules/amicus/`), a tarball with no repo, or no git at all.
 * Never throws.
 * @param {(args: string[]) => string} [git] injectable runner (tests)
 * @returns {boolean}
 */
function isSourceCheckout(git = defaultGit) {
  try { return git(['rev-parse', '--show-prefix']) === ''; } catch { return false; }
}

/**
 * @param {{isTTY: boolean, git: (args: string[]) => string}} d
 * @returns {string|null} the refusal reason, or null when owner mode may run
 */
function ownerGate(d) {
  if (!d.isTTY) { return 'aliases --review --owner is interactive: run it in a terminal'; }
  let prefix;
  try { prefix = d.git(['rev-parse', '--show-prefix']); }
  catch (err) {
    if (err && err.code === 'ENOENT') { return 'git is not installed or not on PATH — owner mode needs it'; }
    return `owner mode needs the amicus source checkout (${PKG_ROOT} is not inside a git work tree)`;
  }
  // Mutant GATEPREFIX: drop this check and an npm-installed copy inside a
  // consumer's repo passes (setup-hooks.js documents that exact trap).
  if (prefix !== '') { return `owner mode needs the amicus source checkout, not an installed copy (${PKG_ROOT} sits ${prefix} below its repository root)`; }
  let status;
  try { status = d.git(['status', '--porcelain', '--untracked-files=no']); }
  catch (err) { return `owner mode could not read the working tree (${collapseExcerpt(err.message)})`; }
  // Mutant DIRTYTREE: drop this check and `git diff` stops being a clean review surface.
  if (status !== '') { return `owner mode needs a clean working tree — commit or stash first (git status shows ${status.split('\n').length} changed file(s))`; }
  return null;
}

module.exports = { ownerGate, isSourceCheckout, defaultGit };

#!/usr/bin/env node

/**
 * Writes the current git HEAD SHA to .test-passed for the pre-push SHA cache
 * (the pre-push hook skips re-running the suite when .test-passed matches HEAD).
 *
 * Cross-platform replacement for the bash one-liner
 *   git rev-parse HEAD > .test-passed 2>/dev/null || true
 * which fails under npm's cmd.exe shell on Windows (`2>/dev/null` -> "system
 * cannot find the path specified", `true` -> "not recognized as a command"),
 * making `npm test` exit 1 even when every test passes.
 *
 * Runs as the `posttest` lifecycle script and the tail of `test:all`.
 *
 * Best-effort: every failure (not a git repo, git missing, unwritable cwd) is
 * swallowed so it can never fail a test run. The marker is a cache optimization,
 * not correctness -- a missing or stale .test-passed just means pre-push
 * re-runs the suite.
 *
 * Usage:
 *   node scripts/mark-test-passed.js                                  // CLI use
 *   const { markTestPassed } = require('./scripts/mark-test-passed'); // Library use
 */

const { execFileSync } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

/**
 * Resolve the current HEAD commit SHA.
 * @param {(cmd: string, args: string[]) => string} [runGit] - git runner (injectable for tests)
 * @returns {string|null} The trimmed SHA, or null if git is unavailable / not a repo.
 */
function getHeadSha(runGit) {
  const run = runGit || ((cmd, args) => execFileSync(cmd, args, { encoding: 'utf-8' }));
  try {
    const sha = String(run('git', ['rev-parse', 'HEAD'])).trim();
    return sha || null;
  } catch {
    return null;
  }
}

/**
 * Write the HEAD SHA to the marker file. Never throws.
 * @param {object} [options]
 * @param {string} [options.path] - Marker file path (default: .test-passed in cwd)
 * @param {(cmd: string, args: string[]) => string} [options.runGit] - git runner injection
 * @returns {boolean} True if the marker was written, false if skipped or failed.
 */
function markTestPassed(options = {}) {
  try {
    const sha = getHeadSha(options.runGit);
    if (!sha) {
      return false;
    }
    writeFileSync(options.path || resolve('.test-passed'), `${sha}\n`);
    return true;
  } catch {
    return false;
  }
}

// Run when invoked directly
if (process.argv[1] && process.argv[1].includes('mark-test-passed')) {
  markTestPassed();
}

module.exports = { getHeadSha, markTestPassed };

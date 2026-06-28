#!/usr/bin/env node

/**
 * File size enforcement for the pre-commit hook and the whole-tree CI gate (--all).
 * Blocks commits containing .js files in src/ that exceed the 300-line limit.
 *
 * Usage:
 *   node scripts/check-file-sizes.js          # Scans git staged files
 *   node scripts/check-file-sizes.js --all    # Scans all tracked files (CI mode)
 *   const { checkFileSize } = require('./scripts/check-file-sizes');  # Library use
 */

const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const CONFIG = {
  maxLines: 300,
  include: ['src/**/*.js'],
  exclude: [
    'src/utils/config.js',
    // Grandfathered: already over the limit when the '**' glob bug was fixed
    // (top-level src files had escaped the gate). Shrink one below maxLines,
    // then remove it from this list.
    'src/cli.js',
    'src/headless.js',
    'src/mcp-server.js',
    'src/mcp-tools.js',
    'src/opencode-client.js',
    'src/session-manager.js',
    // Grandfathered by whole-tree CI scan (was 355 lines on main before Task 4)
    'src/prompt-builder.js',
    // Grandfathered: was 348 lines before Task 8 (seedFreeCouncil + deriveFreeAlias landed
    // before the staged-file gate caught sidecar/setup.js). Shrink below 300, then remove.
    'src/sidecar/setup.js',
  ],
};

/**
 * Check if a single file exceeds the line limit.
 * @param {string} content - File content
 * @param {string} filePath - File path
 * @param {number} limit - Max lines allowed
 * @returns {null | {file: string, lines: number, limit: number}}
 */
function checkFileSize(content, filePath, limit) {
  const lineCount = content.split('\n').length;
  const adjustedCount = content.endsWith('\n') ? lineCount - 1 : lineCount;

  if (adjustedCount > limit) {
    return { file: filePath, lines: adjustedCount, limit };
  }
  return null;
}

/**
 * Check multiple files against the line limit.
 * @param {Array<{path: string, content: string}>} files
 * @param {number} limit
 * @returns {Array<{file: string, lines: number, limit: number}>}
 */
function checkFiles(files, limit) {
  const violations = [];
  for (const { path, content } of files) {
    const result = checkFileSize(content, path, limit);
    if (result) {
      violations.push(result);
    }
  }
  return violations;
}

/**
 * Simple glob match for include/exclude patterns.
 * '**\/' matches zero or more directories (so 'src/**\/*.js' covers
 * top-level src files too); '*' matches within a single path segment.
 * @param {string} filePath - Path to check
 * @param {string[]} patterns - Glob patterns to match against
 * @returns {boolean} True if path matches any pattern
 */
function matchesPattern(filePath, patterns) {
  for (const pattern of patterns) {
    const regexStr = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*\//g, '<<GLOBSTAR_DIR>>')
      .replace(/\*\*/g, '<<GLOBSTAR>>')
      .replace(/\*/g, '[^/]*')
      .replace(/<<GLOBSTAR_DIR>>/g, '(?:[^/]+/)*')
      .replace(/<<GLOBSTAR>>/g, '.*');
    if (new RegExp(`^${regexStr}$`).test(filePath)) {
      return true;
    }
  }
  return false;
}

/** List git-tracked files (whole-tree CI scan, no staging area). */
function listTrackedFiles() {
  const out = execFileSync('git', ['ls-files'], { encoding: 'utf-8' });
  return out.trim().split('\n').filter(Boolean);
}

/**
 * Check sizes across all tracked include-minus-exclude files.
 * @param {string[]} [files] - File list to check; defaults to all git-tracked files.
 * @returns {Array<{file: string, lines: number, limit: number}>}
 */
function checkAllTracked(files = listTrackedFiles()) {
  const target = files.filter(f =>
    matchesPattern(f, CONFIG.include) && !matchesPattern(f, CONFIG.exclude)
  );
  const loaded = target.map(f => ({ path: f, content: readFileSync(resolve(f), 'utf-8') }));
  return checkFiles(loaded, CONFIG.maxLines);
}

/**
 * Main: scan git staged files (pre-commit) or all tracked files (--all / CI).
 * Exit 1 if any file exceeds the limit.
 */
function main() {
  if (process.argv.includes('--all')) {
    const violations = checkAllTracked();
    if (violations.length > 0) {
      console.error(
        '\n  BLOCKED: File size limit exceeded (max %d lines):',
        CONFIG.maxLines
      );
      for (const v of violations) {
        console.error(`    ${v.file}: ${v.lines} lines (limit: ${v.limit})`);
      }
      console.error('\n  Refactor large files before committing.\n');
      process.exit(1);
    }
    process.exit(0);
  }

  // Existing staged-files (pre-commit) path — unchanged
  let stagedFiles;
  try {
    const output = execFileSync(
      'git',
      ['diff', '--cached', '--name-only', '--diff-filter=ACM'],
      { encoding: 'utf-8' }
    );
    stagedFiles = output.trim().split('\n').filter(Boolean);
  } catch {
    console.error('Failed to get staged files.');
    process.exit(1);
  }

  const targetFiles = stagedFiles.filter(f =>
    matchesPattern(f, CONFIG.include) && !matchesPattern(f, CONFIG.exclude)
  );

  if (targetFiles.length === 0) {
    process.exit(0);
  }

  const files = targetFiles.map(f => ({
    path: f,
    content: readFileSync(resolve(f), 'utf-8'),
  }));

  const violations = checkFiles(files, CONFIG.maxLines);

  if (violations.length > 0) {
    console.error(
      '\n  BLOCKED: File size limit exceeded (max %d lines):',
      CONFIG.maxLines
    );
    for (const v of violations) {
      console.error(`    ${v.file}: ${v.lines} lines (limit: ${v.limit})`);
    }
    console.error('\n  Refactor large files before committing.\n');
    process.exit(1);
  }
}

// Run main when invoked directly
if (process.argv[1] && process.argv[1].includes('check-file-sizes')) {
  main();
}

module.exports = { checkFileSize, checkFiles, matchesPattern, checkAllTracked, listTrackedFiles, CONFIG };

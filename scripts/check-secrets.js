#!/usr/bin/env node

/**
 * Secret detection for the pre-commit hook and the whole-tree CI gate (--all).
 * Scans files for API keys, tokens, and private key material.
 *
 * Usage:
 *   node scripts/check-secrets.js                                    # Scans git staged files
 *   node scripts/check-secrets.js --all                             # Scans all tracked files (CI mode)
 *   const { scanForSecrets } = require('./scripts/check-secrets');   # Library use
 */

const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { readIndexContent } = require('./git-index');

const CONFIG = {
  patterns: [
    { regex: /sk-or-[\w-]{3,}/g, name: 'sk-or-', description: 'OpenRouter API key' },
    { regex: /sk-ant-[\w-]{3,}/g, name: 'sk-ant-', description: 'Anthropic API key' },
    { regex: /AKIA[0-9A-Z]{16}/g, name: 'AKIA', description: 'AWS access key' },
    { regex: /ghp_[A-Za-z0-9_]{10,}/g, name: 'ghp_', description: 'GitHub personal access token' },
    { regex: /-----BEGIN\s[\w\s]*?PRIVATE\sKEY-----/g, name: 'BEGIN.*KEY', description: 'Private key block' },
    { regex: /AIza[0-9A-Za-z\-_]{35}/g, name: 'AIza', description: 'Google AI API key' },
    { regex: /sk-proj-[A-Za-z0-9_-]{20,}/g, name: 'sk-proj-', description: 'OpenAI project API key' },
    { regex: /sk-[A-Za-z0-9]{32,}/g, name: 'sk-', description: 'OpenAI/DeepSeek API key' },
  ],
  allowlistPaths: [
    'tests/**',
    '**/*.test.js',
    '**/*.spec.js',
    '**/*.md',
    'docs/**',
    'electron/setup-ui-keys.js',
  ],
};

/**
 * Check if a file path matches any allowlist glob pattern.
 * @param {string} filePath - Path to check
 * @param {string[]} allowlistPaths - Glob patterns to match against
 * @returns {boolean} True if path matches an allowlist pattern
 */
function matchesAllowlist(filePath, allowlistPaths) {
  for (const pattern of allowlistPaths) {
    const regexStr = pattern
      .replace(/\*\*/g, '<<GLOBSTAR>>')
      .replace(/\*/g, '[^/]*')
      .replace(/<<GLOBSTAR>>/g, '.*');
    if (new RegExp(`^${regexStr}$`).test(filePath)) {
      return true;
    }
  }
  return false;
}

/**
 * Scan content for secret patterns.
 * @param {string} content - File content to scan
 * @param {string} filePath - Path of the file (for allowlist matching)
 * @param {object} [options] - Override options
 * @param {string[]} [options.allowlistPaths] - Glob patterns to skip
 * @returns {Array<{pattern: string, description: string, line: number}>}
 */
function scanForSecrets(content, filePath, options = {}) {
  const allowlist = options.allowlistPaths || CONFIG.allowlistPaths;

  if (matchesAllowlist(filePath, allowlist)) {
    return [];
  }

  const results = [];
  const lines = content.split('\n');

  for (const { regex, name, description } of CONFIG.patterns) {
    const re = new RegExp(regex.source, regex.flags);
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        results.push({ pattern: name, description, line: i + 1 });
      }
      re.lastIndex = 0;
    }
  }

  return results;
}

/** List git-tracked files (whole-tree CI scan, no staging area). */
function listTrackedFiles() {
  const out = execFileSync('git', ['ls-files'], { encoding: 'utf-8' });
  return out.trim().split('\n').filter(Boolean);
}

/**
 * Scan every tracked file; returns [{file, secrets}].
 * @param {string[]} [files] - File list to scan; defaults to all git-tracked files.
 * @returns {Array<{file: string, secrets: Array<{pattern: string, description: string, line: number}>}>}
 */
function scanAll(files = listTrackedFiles()) {
  const findings = [];
  for (const file of files) {
    try {
      const content = readFileSync(resolve(file), 'utf-8');
      const secrets = scanForSecrets(content, file);
      if (secrets.length > 0) {
        findings.push({ file, secrets });
      }
    } catch {
      // binary or unreadable — skip
    }
  }
  return findings;
}

/**
 * Main: scan git staged files (pre-commit) or all tracked files (--all / CI).
 * Exit 1 if secrets found.
 */
function main() {
  if (process.argv.includes('--all')) {
    const findings = scanAll();
    if (findings.length > 0) {
      for (const { file, secrets } of findings) {
        console.error(`\n  BLOCKED: secret(s) in ${file}:`);
        for (const s of secrets) {
          console.error(`    Line ${s.line}: ${s.description} (${s.pattern})`);
        }
      }
      console.error('\n  Remove secrets before pushing. Use .env for local secrets.\n');
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
    console.error('Failed to get staged files. Are you in a git repo?');
    process.exit(1);
  }

  if (stagedFiles.length === 0) {
    process.exit(0);
  }

  let foundSecrets = false;

  // Read the INDEX, not the working tree: the index is what this commit will
  // contain. Reading the working copy meant a secret could be STAGED, scrubbed
  // from the working copy, and then committed with the gate never seeing it.
  const stagedContent = readIndexContent(stagedFiles);

  for (const file of stagedFiles) {
    try {
      // Absent from the index = absent from the commit; nothing to scan.
      if (!stagedContent.has(file)) { continue; }
      const content = stagedContent.get(file);
      const secrets = scanForSecrets(content, file);

      if (secrets.length > 0) {
        foundSecrets = true;
        console.error(`\n  BLOCKED: Potential secret(s) in ${file}:`);
        for (const s of secrets) {
          console.error(`    Line ${s.line}: ${s.description} (matched: ${s.pattern})`);
        }
      }
    } catch {
      // File might be binary or unreadable, skip
    }
  }

  if (foundSecrets) {
    console.error('\n  Remove secrets before committing. Use .env for local secrets.\n');
    process.exit(1);
  }
}

// Run main when invoked directly
if (process.argv[1] && process.argv[1].includes('check-secrets')) {
  main();
}

module.exports = { scanForSecrets, matchesAllowlist, scanAll, listTrackedFiles };

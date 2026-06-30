#!/usr/bin/env node

/**
 * CI assertion (Windows install-smoke job, #35): after a REAL global install
 * of the packed tarball — the consumer path equivalent to
 * `npm install -g github:BourbonDog/amicus` — verify the postinstall actually
 * registered the amicus MCP server and installed both skills, identically to a
 * registry install.
 *
 * This is the executable form of the README "runs identically" claim. It runs
 * only in CI (the runner has no `claude` CLI, so postinstall takes the
 * file-edit fallback into ~/.claude.json — which is exactly what we assert).
 *
 * Exits 0 on success, 1 (with a diagnostic) on any missing artifact.
 *
 * Cross-platform: pure Node, no shell, no bash-isms.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const home = os.homedir();
const problems = [];

// 1. MCP server registered in Claude Code config (~/.claude.json).
const claudeJson = path.join(home, '.claude.json');
try {
  const cfg = JSON.parse(fs.readFileSync(claudeJson, 'utf-8'));
  const servers = (cfg && cfg.mcpServers) || {};
  if (!servers.amicus) {
    problems.push(`~/.claude.json has no mcpServers.amicus entry (keys: ${Object.keys(servers).join(', ') || 'none'})`);
  }
} catch (err) {
  problems.push(`could not read/parse ~/.claude.json: ${err.message}`);
}

// 2. Both skills installed under ~/.claude/skills/.
const skillFiles = [
  path.join(home, '.claude', 'skills', 'sidecar', 'SKILL.md'),
  path.join(home, '.claude', 'skills', 'second-opinion', 'SKILL.md'),
];
for (const f of skillFiles) {
  if (!fs.existsSync(f)) {
    problems.push(`expected skill file missing: ${f}`);
  }
}

if (problems.length > 0) {
  console.error('check:global-install — FAILED: the github:/tarball global install did not register identically:');
  for (const p of problems) {
    console.error(`  - ${p}`);
  }
  process.exit(1);
}

console.log('check:global-install — OK: amicus MCP registered + both skills installed (github:/tarball path == registry path).');

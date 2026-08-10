'use strict';
const fs = require('fs');
const path = require('path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf-8');
const { mustSection, mustIndexOf } = require('./helpers/docs-extract');
const { getCommandNames } = require('../src/cli');

// F-2: derive the command list from bin/amicus.js's switch instead of
// hand-maintaining it — a hardcoded array silently stops covering a command
// added (or renamed) in the switch. `case 'foo':` labels only; matches all
// 21 current top-level commands.
const COMMANDS = [...read('bin/amicus.js').matchAll(/^\s*case '([^']+)':/gm)].map((m) => m[1]);

describe('docs command & MCP-tool coverage (B11)', () => {
  const readme = read('README.md');
  const usage = read('docs/usage.md');
  const trouble = read('docs/troubleshooting.md');
  const toolNames = [...read('src/mcp-tools.js').matchAll(/name: '(amicus_\w+)'/g)].map(m => m[1]);

  // Task 17.3 restructure: the per-command `### ` subsections that used to
  // follow `## Commands` (start options, fanout, other commands) moved to
  // docs/usage.md (the canonical CLI reference); the table is now bounded
  // by the next `## ` section instead of a `### ` subheading.
  const table = mustSection(readme, /## Commands[\s\S]*?(?=\n## )/, 'README.md Commands table');

  it('the switch labels and getCommandNames() agree', () => {
    // Free cross-check: src/cli.js:751 exports getCommandNames() as the
    // repo's stated anti-rot idiom for "every command amicus recognizes",
    // but nothing pinned it against the actual bin/amicus.js switch. If a
    // command is added to one and not the other, this goes red.
    expect(new Set(COMMANDS)).toEqual(new Set(getCommandNames()));
  });

  // Loose matcher deliberately: the README table is 22 rows for 21 commands
  // (both `amicus council` and `amicus council run` have rows) and carries
  // placeholders like `| \`amicus status <id>\` |`, so a
  // `| \`amicus <cmd>\` |` row-matcher would land red on `status`/`watch`.
  it.each(COMMANDS)('README Commands table documents amicus %s', (cmd) => {
    expect(table).toContain('amicus ' + cmd);
  });
  it.each(COMMANDS)('usage.md documents amicus %s', (cmd) => {
    expect(usage).toContain('amicus ' + cmd);
  });
  it('README MCP section lists every registered tool (no stale count)', () => {
    expect(readme).not.toMatch(/exposes ten tools/);
    for (const t of toolNames) { expect(readme).toContain(t); }
  });
  it('usage.md lists every registered MCP tool', () => {
    for (const t of toolNames) { expect(usage).toContain(t); }
  });
  it('troubleshooting leads with doctor and drops the false active-servers claim', () => {
    expect(trouble.indexOf('amicus doctor')).toBeGreaterThan(-1);
    expect(trouble.indexOf('amicus doctor')).toBeLessThan(trouble.indexOf('## Auth / 401'));
    expect(trouble).not.toContain('shows active servers');
  });
});

describe('there is no CLI `wait` command (4.1.1 T2 Fix A)', () => {
  // Repo-standard CRLF normalization for slice-boundary safety (see
  // tests/helpers/docs-extract.js) — a worktree checkout may materialize
  // CRLF even though these fixtures are authored as LF.
  const norm = s => s.replace(/\r\n/g, '\n');
  const cli = norm(read('bin/amicus.js'));
  const council = norm(read('docs/council.md'));
  const usageNorm = norm(read('docs/usage.md'));

  it('bin/amicus.js command dispatch has no `wait` case (only status/abort work on runs)', () => {
    expect(cli).not.toMatch(/case 'wait'/);
    expect(cli).toMatch(/case 'status'/);
    expect(cli).toMatch(/case 'abort'/);
  });

  it('usage.md no longer claims `wait` as a CLI verb alongside status/abort, and points to MCP amicus_wait', () => {
    const idx = mustIndexOf(usageNorm, 'amicus status|abort <councilRunId>', 'usage.md status|abort claim');
    const section = usageNorm.slice(idx, idx + 300);
    expect(usageNorm).not.toMatch(/status\|wait\|abort/);
    expect(section).toMatch(/no CLI `wait`/);
    expect(section).toMatch(/amicus_wait/);
  });

  it('council.md SIGINT/abort paragraph no longer lists `wait` as CLI-resolvable, and points to MCP amicus_wait', () => {
    const idx = mustIndexOf(council, 'SIGINT/SIGTERM abort the active wave/solo', 'council.md SIGINT paragraph');
    const section = council.slice(idx, idx + 400);
    expect(section).not.toMatch(/`status`\/`wait`\/`list`/);
    expect(section).toMatch(/no CLI `wait`/);
    expect(section).toMatch(/amicus_wait/);
  });
});

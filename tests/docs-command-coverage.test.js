'use strict';
const fs = require('fs');
const path = require('path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf-8');
const { mustSection } = require('./helpers/docs-extract');

describe('docs command & MCP-tool coverage (B11)', () => {
  const readme = read('README.md');
  const usage = read('docs/usage.md');
  const trouble = read('docs/troubleshooting.md');
  const toolNames = [...read('src/mcp-tools.js').matchAll(/name: '(amicus_\w+)'/g)].map(m => m[1]);

  it.each(['amicus doctor', 'amicus key', 'amicus council'])('README Commands table documents %s', c => {
    // Task 17.3 restructure: the per-command `### ` subsections that used to
    // follow `## Commands` (start options, fanout, other commands) moved to
    // docs/usage.md (the canonical CLI reference); the table is now bounded
    // by the next `## ` section instead of a `### ` subheading.
    const table = mustSection(readme, /## Commands[\s\S]*?(?=\n## )/, 'README.md Commands table');
    expect(table).toContain(c);
  });
  it('README MCP section lists every registered tool (no stale count)', () => {
    expect(readme).not.toMatch(/exposes ten tools/);
    for (const t of toolNames) { expect(readme).toContain(t); }
  });
  it('usage.md lists every registered MCP tool and the new commands', () => {
    for (const t of toolNames) { expect(usage).toContain(t); }
    expect(usage).toMatch(/amicus doctor/);
    expect(usage).toMatch(/amicus council report/);
  });
  it('troubleshooting leads with doctor and drops the false active-servers claim', () => {
    expect(trouble.indexOf('amicus doctor')).toBeGreaterThan(-1);
    expect(trouble.indexOf('amicus doctor')).toBeLessThan(trouble.indexOf('## Auth / 401'));
    expect(trouble).not.toContain('shows active servers');
  });
});

'use strict';
const fs = require('fs');
const path = require('path');
const { mustMatch } = require('./helpers/docs-extract');
const raw = fs.readFileSync(path.join(__dirname, '..', 'skills', 'second-opinion', 'SKILL.md'), 'utf-8').replace(/\r\n/g, '\n');

describe('second-opinion SKILL.md frontmatter (B27)', () => {
  const fm = mustMatch(raw, /^---\n([\s\S]*?)\n---/, 'skills/second-opinion/SKILL.md frontmatter block')[1];
  const desc = mustMatch(fm, /description: >\n([\s\S]*)$/, 'skills/second-opinion/SKILL.md frontmatter description field')[1]
    .split('\n').map(l => l.trim()).join(' ').trim();

  it('frontmatter description fits the 1024-char skill-list limit', () => {
    expect(desc.length).toBeLessThan(1024);
  });
  it('the NOT boundary is present and names the sidecar skill', () => {
    expect(desc).toMatch(/NOT/);
    expect(desc).toMatch(/sidecar skill/);
  });
  it('key trigger phrases are present', () => {
    expect(desc).toMatch(/second opinion/i);
    expect(desc).toMatch(/council review/i);
    expect(desc).toMatch(/multi-model/i);
  });
  it('name is unchanged', () => {
    expect(fm).toMatch(/^name: second-opinion\s*$/m);
  });
});

describe('second-opinion SKILL.md amicus_wait guidance (B16)', () => {
  it('transport-rule MCP tool list includes amicus_council_run and amicus_wait', () => {
    const transportRule = mustMatch(raw, /\*\*Transport rule[\s\S]*?equivalent\.\n/, 'skills/second-opinion/SKILL.md transport rule paragraph')[0];
    expect(transportRule).toContain('amicus_wait');
    // v4.1 §4.9: the fast path's MCP transport is amicus_council_run, so the
    // rule that tells a plugin-only install what to use must name it.
    expect(transportRule).toContain('amicus_council_run');
  });

  it('Cowork/no-Bash path recommends amicus_wait, with amicus_status as fallback', () => {
    const coworkSection = mustMatch(raw, /\*\*Cowork \/ no-Bash environments:\*\*[\s\S]*?equivalent\.\n/, 'skills/second-opinion/SKILL.md Cowork/no-Bash paragraph')[0];
    expect(coworkSection).toContain('amicus_council_run');
    expect(coworkSection).toContain('amicus_wait');
    expect(coworkSection).toContain('amicus_status');
    expect(coworkSection.indexOf('amicus_wait')).toBeLessThan(coworkSection.indexOf('amicus_status'));
  });
});

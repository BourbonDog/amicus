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

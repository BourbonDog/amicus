'use strict';
const fs = require('fs');
const path = require('path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf-8');

describe('shipped MODEL-NOTES carries runs 4-7 durable lessons (A10)', () => {
  const notes = read('skills/second-opinion/MODEL-NOTES.md');
  it.each(['### Grok', '### Kimi', '### Mistral', '### Claude'])('has section %s', h => {
    expect(notes).toContain(h);
  });
  it('carries the three new global rules', () => {
    expect(notes).toMatch(/PowerShell/);
    expect(notes).toMatch(/current date/i);
    expect(notes).toMatch(/80k\+|long agentic read/i);
  });
  it('stays WS-3: no hand-maintained reliability table, budget gate in code', () => {
    expect(notes).not.toMatch(/\| model \| runs \| avg street-cred/);
    expect(notes).toMatch(/amicus council stats/);
    expect(notes).toMatch(/--no-cost-gate/);
  });
  it('publishing.md gained the fold-back release checklist', () => {
    const pub = read('docs/publishing.md');
    expect(pub).toMatch(/## Release checklist/);
    expect(pub).toMatch(/MODEL-NOTES fold-back/);
    expect(pub).toMatch(/plugin\.json/);
  });
  it('SKILL.md names the machine-local/shipped split', () => {
    const s = read('skills/second-opinion/SKILL.md');
    expect(s).toMatch(/installed only if missing|never overwrite/i);
    expect(s).toMatch(/docs\/publishing\.md/);
  });
});

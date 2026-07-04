'use strict';
const fs = require('fs');
const path = require('path');
const { mustMatch, mustSection, mustIndexOf } = require('./helpers/docs-extract');
const raw = fs.readFileSync(path.join(__dirname, '..', 'skills', 'sidecar', 'SKILL.md'), 'utf-8').replace(/\r\n/g, '\n');

describe('sidecar SKILL.md overhaul (B10/B11)', () => {
  const fm = mustMatch(raw, /^---\n([\s\S]*?)\n---/, 'skills/sidecar/SKILL.md frontmatter block')[1];
  const desc = mustMatch(fm, /description: >\n([\s\S]*)$/, 'skills/sidecar/SKILL.md frontmatter description field')[1]
    .split('\n').map(l => l.trim()).join(' ').trim();
  const body = raw.slice(raw.indexOf('\n---', 4) + 4);

  it('frontmatter description fits the 1024-char skill-list limit', () => {
    expect(desc.length).toBeLessThan(1024);
  });
  it('description drops the second-opinion trigger and adds the NOT boundary', () => {
    expect(desc).not.toMatch(/second opinion from another model/i);
    expect(desc).toMatch(/NOT/);
    expect(desc).toMatch(/second-opinion skill/);
  });
  it('the 7 operating rules moved into a top-of-body section', () => {
    expect(body).toMatch(/^## Operating Rules/m);
    expect(body.indexOf('## Operating Rules')).toBeLessThan(body.indexOf('## Installation'));
    for (const marker of ['run_in_background: true', 'TaskOutput', '--prompt-file', 'o3-pro', '--no-ui', 'fanout', 'DEFAULT to interactive']) {
      const rules = body.slice(body.indexOf('## Operating Rules'), body.indexOf('## Installation'));
      expect(rules).toContain(marker);
    }
  });
  it('no phantom `amicus guide` command', () => {
    expect(raw).not.toContain('amicus guide');
  });
  it('no bare --session flag (only --session-id exists in the CLI)', () => {
    expect(raw).not.toMatch(/--session(?![-\w])/);
  });
  it('--model documented as optional-with-default, not required', () => {
    expect(raw).not.toContain('Error: --model is required');
    expect(raw).toMatch(/--model.*(Optional|falls back|configured default)/i);
  });
});

describe('sidecar SKILL.md amicus_wait guidance (B16)', () => {
  it('the npx-fallback MCP tool list (Operating Rules #8) includes amicus_wait', () => {
    const line = mustSection(raw, /^8\. .*$/m, 'skills/sidecar/SKILL.md Operating Rules item 8 (npx fallback)');
    expect(line).toContain('amicus_start');
    expect(line).toContain('amicus_wait');
  });

  it('the "MCP Server (Auto-Registered)" tool list includes amicus_wait', () => {
    const section = mustSection(raw, /### MCP Server \(Auto-Registered\)\n\n[^\n]*\n/, 'skills/sidecar/SKILL.md MCP Server (Auto-Registered) section');
    expect(section).toContain('amicus_start');
    expect(section).toContain('amicus_wait');
  });
});

describe('sidecar SKILL.md --agent default is split by interactive/headless (B30)', () => {
  it('the flags-reference --agent entry names both defaults, not an unqualified Chat default', () => {
    const section = mustSection(raw, /- `--agent <agent>`:[\s\S]*?\n\n/, 'skills/sidecar/SKILL.md flags-reference --agent entry');
    expect(section).toMatch(/interactive/i);
    expect(section).toMatch(/headless|Build/);
    expect(section).not.toMatch(/defaults to \*\*Chat\*\*\.\s*\n/);
  });

  it('no unqualified "defaults to Chat" claim remains anywhere in the file', () => {
    expect(raw).not.toMatch(/defaults to \*\*Chat\*\*(?!.*headless)/);
  });

  it('the Primary Agents flags-reference Chat bullet is qualified to interactive mode', () => {
    const section = mustSection(raw, /- `Chat` \*\*\([^)]*\)\*\*:[^\n]*\n/, 'skills/sidecar/SKILL.md flags-reference Chat bullet');
    expect(section).toMatch(/interactive/i);
  });

  it('the Chat Agent (Default) section scopes the default claim to interactive mode', () => {
    const idx = mustIndexOf(raw, '#### Chat Agent', 'skills/sidecar/SKILL.md Chat Agent section heading');
    const section = raw.slice(idx, idx + 600);
    expect(section).toMatch(/interactive/i);
  });
});

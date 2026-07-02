// tests/plugin-commands.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8');

describe('plugin slash commands (Phase 9a)', () => {
  test('commands/council.md exists, is user-invoked-only, and wraps second-opinion with $ARGUMENTS', () => {
    const md = read('commands/council.md');
    expect(md).toMatch(/^---\n/);
    expect(md).toContain('argument-hint:');
    expect(md).toContain('disable-model-invocation: true');
    expect(md).toContain('$ARGUMENTS');
    expect(md).toContain('second-opinion');
  });

  test('plugin.json does NOT declare a commands key (auto-discovery; a custom path REPLACES the default commands/ dir)', () => {
    const manifest = JSON.parse(read('.claude-plugin/plugin.json'));
    expect(manifest.commands).toBeUndefined();
  });

  test('no commands/sidecar.md — it would collide with the skills/sidecar command name', () => {
    expect(fs.existsSync(path.join(ROOT, 'commands', 'sidecar.md'))).toBe(false);
  });

  test('sidecar skill declares the slash-argument surface (argument-hint + $1/$ARGUMENTS binding)', () => {
    const md = read('skills/sidecar/SKILL.md');
    expect(md).toContain('argument-hint:');
    expect(md).toContain('$ARGUMENTS');
    expect(md).toContain('Slash invocation');
  });

  test('placeholder discipline: no stray $<digit> in the two skill bodies; command placeholders are exactly the intended set ($1, $ARGUMENTS)', () => {
    const stripFm = (md) => md.replace(/^---[\s\S]*?\n---\n/, ''); // strip frontmatter
    // second-opinion body: NO positional placeholders at all — every $<digit> literal must be \$-escaped (:62 fix).
    expect(stripFm(read('skills/second-opinion/SKILL.md'))).not.toMatch(/(^|[^\\$])\$\d/);
    // sidecar body: the ONLY unescaped $<digit> allowed is the deliberate $1 model placeholder in the
    // Slash-invocation section; literals must be \$-escaped (e.g. the Operating Rules' \$10-60+ from Phase 8 T1).
    const sidecarBody = stripFm(read('skills/sidecar/SKILL.md'));
    const hits = [...sidecarBody.matchAll(/(?:^|[^\\$])(\$\d+)/g)].map((m) => m[1]);
    expect([...new Set(hits)]).toEqual(['$1']);
    // commands/council.md takes no positional args: $ARGUMENTS only, no $<digit>.
    const council = read('commands/council.md');
    expect(council).toContain('$ARGUMENTS');
    expect(council).not.toMatch(/(^|[^\\$])\$\d/);
  });

  test('commands/ ships in the npm tarball alongside skills/ and .claude-plugin/', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.files).toContain('commands/');
  });
});

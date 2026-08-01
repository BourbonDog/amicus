// tests/plugin-commands.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8').replace(/\r\n/g, '\n');

// Parse the YAML frontmatter the way Claude Code's loader does. A file whose frontmatter
// fails to parse still LOOKS fine to a substring assertion, but loads at runtime with every
// metadata field silently dropped — which is exactly how commands/council.md shipped an
// unquoted `argument-hint: [...] [...]` (YAML flow-seq) past `toContain('argument-hint:')`.
const parseFrontmatter = (p) => {
  const md = read(p);
  const m = md.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) throw new Error(`${p}: no YAML frontmatter block`);
  return YAML.parse(m[1]);
};

describe('plugin slash commands (Phase 9a)', () => {
  test('commands/council.md exists, is user-invoked-only, and wraps second-opinion with $ARGUMENTS', () => {
    const md = read('commands/council.md');
    expect(md).toMatch(/^---\n/);
    expect(md).toContain('argument-hint:');
    expect(md).toContain('disable-model-invocation: true');
    expect(md).toContain('$ARGUMENTS');
    expect(md).toContain('second-opinion');
  });

  test('commands/council.md frontmatter actually PARSES as YAML and keeps its metadata', () => {
    const fm = parseFrontmatter('commands/council.md');
    expect(typeof fm.description).toBe('string');
    expect(fm.description.length).toBeGreaterThan(0);
    // Must survive as a STRING: an unquoted `[material, ...] [...]` parses as a flow sequence
    // (or throws) and the hint is lost.
    expect(typeof fm['argument-hint']).toBe('string');
    expect(fm['argument-hint']).toContain('material');
    // User-invoked only — dropped frontmatter would silently make the command model-invocable.
    expect(fm['disable-model-invocation']).toBe(true);
  });

  test('both plugin skills have frontmatter that parses as YAML with a usable description', () => {
    for (const skill of ['skills/sidecar/SKILL.md', 'skills/second-opinion/SKILL.md']) {
      const fm = parseFrontmatter(skill);
      expect(typeof fm.name).toBe('string');
      expect(typeof fm.description).toBe('string');
      expect(fm.description.length).toBeGreaterThan(0);
    }
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

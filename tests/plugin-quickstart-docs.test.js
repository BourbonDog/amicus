'use strict';
const fs = require('fs');
const path = require('path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf-8');

describe('plugin quick-start accuracy (A8)', () => {
  const readme = read('README.md');
  it('README no longer claims every install path delivers the same CLI', () => {
    expect(readme).not.toContain('all deliver the same CLI');
    expect(readme).toMatch(/npx -y amicus@latest/);
  });
  it('configure step offers the npx path for plugin installs', () => {
    const qs = readme.match(/## Quick start[\s\S]*?(?=\n## )/)[0];
    expect(qs).toMatch(/npx -y amicus@latest setup/);
  });
  it('skill-location hint covers plugin installs', () => {
    expect(readme).not.toMatch(/confirm it landed in `~\/.claude\/skills\/second-opinion\/`/);
    expect(readme).toMatch(/plugin installs keep it inside the plugin/i);
  });
  it.each(['skills/sidecar/SKILL.md', 'skills/second-opinion/SKILL.md'])(
    '%s carries the npx-fallback operating rule', (p) => {
      const s = read(p);
      expect(s).toMatch(/npx -y amicus@latest/);
      expect(s).toMatch(/not on PATH/i);
    });
});

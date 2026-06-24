// tests/ws4-quickwins.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

describe('WS-4 quick-wins', () => {
  test('package.json homepage points at the live landing page', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
    expect(pkg.homepage).toBe('https://bourbondog.github.io/amicus/');
  });

  test('README has a Prerequisites & cost block with the council-call estimate', () => {
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf-8');
    expect(readme).toMatch(/##\s*Prerequisites/i);
    expect(readme).toMatch(/Node.*18/);
    expect(readme).toMatch(/Claude Code/);
    expect(readme).toMatch(/5[–-]8 paid model calls/);
  });

  test('landing page has a parallel prerequisites/cost section', () => {
    const site = fs.readFileSync(path.join(ROOT, 'site', 'index.html'), 'utf-8');
    expect(site).toMatch(/id="prerequisites"/);
    expect(site).toMatch(/5[–-]8 paid model calls/);
  });
});

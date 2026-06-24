// tests/plugin-manifest.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));

describe('Claude Code plugin manifest', () => {
  const manifest = () => JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf-8'));

  test('plugin.json parses and has required fields', () => {
    const m = manifest();
    expect(m.name).toBe('amicus');
    expect(typeof m.description).toBe('string');
    expect(m.author && m.author.name).toBeTruthy();
  });

  test('version is kept in sync with package.json', () => {
    expect(manifest().version).toBe(pkg.version);
  });

  test('declares both skills under skills/', () => {
    expect(manifest().skills.sort()).toEqual(['./skills/second-opinion', './skills/sidecar']);
  });

  test('declares the amicus MCP with the skip-postinstall guard', () => {
    const mcp = manifest().mcpServers.amicus;
    expect(mcp.command).toBe('npx');
    expect(mcp.args).toEqual(['-y', 'amicus@latest', 'mcp']);
    expect(mcp.env.AMICUS_SKIP_POSTINSTALL).toBe('1');
  });

  test('.claude-plugin/marketplace.json lists the amicus plugin from this repo', () => {
    const mk = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf-8'));
    expect(Array.isArray(mk.plugins)).toBe(true);
    expect(mk.plugins.some(p => p.name === 'amicus')).toBe(true);
  });

  test('the .claude-plugin/ dir ships in the npm tarball (covers manifest + marketplace)', () => {
    expect(pkg.files).toContain('.claude-plugin/');
  });
});

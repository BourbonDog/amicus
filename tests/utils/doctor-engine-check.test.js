// tests/utils/doctor-engine-check.test.js
'use strict';
const path = require('path');
const { evaluateEngineInstalls } = require('../../src/utils/doctor-engine-check');

const npxDir = (hash) => path.join('C:', 'cache', '_npx', hash, 'node_modules', 'amicus');
const npxCopy = (hash, engineOk) => ({
  kind: 'npx', pkgDir: npxDir(hash), engineOk,
  roots: [path.join(npxDir(hash), 'node_modules'), path.dirname(npxDir(hash))],
});

// Doctor dep double: canned scan result.
const withScan = (scan) => ({ scanEngineInstalls: () => scan });

describe('evaluateEngineInstalls', () => {
  test('id and name identify the dedicated MCP-launch-path check', () => {
    const r = evaluateEngineInstalls(withScan({ installs: [], mcpLaunch: 'none' }));
    expect(r.id).toBe('engine-mcp');
    expect(r.name).toBe('OpenCode engine (MCP launch path)');
  });

  test('no amicus MCP registered → ok, not checked', () => {
    const r = evaluateEngineInstalls(withScan({ installs: [], mcpLaunch: 'none' }));
    expect(r.status).toBe('ok');
    expect(r.message).toMatch(/no amicus MCP registered/i);
  });

  test('fixed-path launch → ok, deferred to the OpenCode binary check', () => {
    const r = evaluateEngineInstalls(withScan({
      installs: [{ kind: 'running', pkgDir: path.join('C:', 'g', 'amicus'), engineOk: true, roots: [] }],
      mcpLaunch: 'path',
    }));
    expect(r.status).toBe('ok');
    expect(r.message).toMatch(/fixed path/i);
  });

  test('npx launch, no cached copy yet → warn (cannot inspect)', () => {
    const r = evaluateEngineInstalls(withScan({
      installs: [{ kind: 'running', pkgDir: path.join('C:', 'g', 'amicus'), engineOk: true, roots: [] }],
      mcpLaunch: 'npx',
    }));
    expect(r.status).toBe('warn');
    expect(r.message).toMatch(/no cached copy/i);
  });

  test('npx launch, all cached copies healthy → ok', () => {
    const r = evaluateEngineInstalls(withScan({
      installs: [npxCopy('a', true), npxCopy('b', true)],
      mcpLaunch: 'npx',
    }));
    expect(r.status).toBe('ok');
    expect(r.message).toMatch(/engine present/i);
  });

  test('npx launch, exactly one cached copy and it is broken → ERROR naming the path + searched roots', () => {
    const r = evaluateEngineInstalls(withScan({
      installs: [npxCopy('only', false)],
      mcpLaunch: 'npx',
    }));
    expect(r.status).toBe('error');
    expect(r.message).toContain(npxDir('only'));
    expect(r.message).toMatch(/searched:/i);
    expect(r.hint).toBeTruthy();
  });

  test('npx launch, multiple copies with one broken → WARN naming the broken path only', () => {
    const r = evaluateEngineInstalls(withScan({
      installs: [npxCopy('good', true), npxCopy('bad', false)],
      mcpLaunch: 'npx',
    }));
    expect(r.status).toBe('warn');
    expect(r.message).toContain(npxDir('bad'));
    expect(r.message).not.toContain(npxDir('good'));
  });

  test('unknown launch is treated like npx (single broken cached copy → error)', () => {
    const r = evaluateEngineInstalls(withScan({
      installs: [npxCopy('only', false)],
      mcpLaunch: 'unknown',
    }));
    expect(r.status).toBe('error');
  });
});

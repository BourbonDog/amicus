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

const { evaluateEngineMcp } = require('../../src/utils/doctor-engine-check');

describe('evaluateEngineMcp (--fix)', () => {
  test('without fix, returns the plain verdict (single broken → error)', async () => {
    const r = await evaluateEngineMcp(withScan({ installs: [npxCopy('only', false)], mcpLaunch: 'npx' }));
    expect(r.status).toBe('error');
  });

  test('--fix heals a broken npx copy and reports self-healed', async () => {
    const healed = { v: false };
    const scan = () => ({
      installs: [{ kind: 'npx', pkgDir: npxDir('h1'), engineOk: healed.v, roots: [] }],
      mcpLaunch: 'npx',
    });
    const repairEngine = jest.fn(async ({ destPkgDir }) => { healed.v = true; return { repaired: true, destPkgDir }; });
    const r = await evaluateEngineMcp({ scanEngineInstalls: scan, fix: true, repairEngine });
    expect(repairEngine).toHaveBeenCalledWith({ destPkgDir: npxDir('h1') });
    expect(r.status).toBe('ok');
    expect(r.message).toMatch(/self-healed/i);
  });

  test('--fix that cannot heal reports "self-heal incomplete" with the reason', async () => {
    const scan = () => ({ installs: [{ kind: 'npx', pkgDir: npxDir('h1'), engineOk: false, roots: [] }], mcpLaunch: 'npx' });
    const repairEngine = jest.fn(async () => ({ repaired: false, reason: 'no healthy sibling install to copy the engine from' }));
    const r = await evaluateEngineMcp({ scanEngineInstalls: scan, fix: true, repairEngine });
    expect(r.status).not.toBe('ok');
    expect(r.message).toMatch(/self-heal incomplete/i);
    expect(r.message).toMatch(/no healthy sibling/i);
  });

  test('--fix does not call repairEngine when already healthy', async () => {
    const repairEngine = jest.fn();
    const r = await evaluateEngineMcp({
      scanEngineInstalls: () => ({ installs: [npxCopy('h1', true)], mcpLaunch: 'npx' }),
      fix: true, repairEngine,
    });
    expect(repairEngine).not.toHaveBeenCalled();
    expect(r.status).toBe('ok');
  });

  test('--fix leaves the "no cached copy yet" warn untouched (nothing to copy)', async () => {
    const repairEngine = jest.fn();
    const r = await evaluateEngineMcp({
      scanEngineInstalls: () => ({
        installs: [{ kind: 'running', pkgDir: path.join('C:', 'g', 'amicus'), engineOk: true, roots: [] }],
        mcpLaunch: 'npx',
      }),
      fix: true, repairEngine,
    });
    expect(repairEngine).not.toHaveBeenCalled();
    expect(r.status).toBe('warn');
  });

  test('--fix with two broken copies, only one healable → self-heal incomplete listing the failure', async () => {
    const healed = { h1: false };
    const scan = () => ({
      installs: [
        { kind: 'npx', pkgDir: npxDir('h1'), engineOk: healed.h1, roots: [] },
        { kind: 'npx', pkgDir: npxDir('h2'), engineOk: false, roots: [] },
      ],
      mcpLaunch: 'npx',
    });
    const repairEngine = jest.fn(async ({ destPkgDir }) => {
      if (destPkgDir === npxDir('h1')) { healed.h1 = true; return { repaired: true }; }
      return { repaired: false, reason: 'no healthy sibling install to copy the engine from' };
    });
    const r = await evaluateEngineMcp({ scanEngineInstalls: scan, fix: true, repairEngine });
    expect(repairEngine).toHaveBeenCalledTimes(2);
    expect(r.status).not.toBe('ok');
    expect(r.message).toMatch(/self-heal incomplete/i);
    expect(r.message).toContain(npxDir('h2'));
    expect(r.message).not.toContain(npxDir('h1'));
  });

  test('--fix heals TWO broken copies → "self-healed 2 ... copies" (plural)', async () => {
    const healed = { h1: false, h2: false };
    const scan = () => ({
      installs: [
        { kind: 'npx', pkgDir: npxDir('h1'), engineOk: healed.h1, roots: [] },
        { kind: 'npx', pkgDir: npxDir('h2'), engineOk: healed.h2, roots: [] },
      ],
      mcpLaunch: 'npx',
    });
    const repairEngine = jest.fn(async ({ destPkgDir }) => {
      if (destPkgDir === npxDir('h1')) { healed.h1 = true; }
      if (destPkgDir === npxDir('h2')) { healed.h2 = true; }
      return { repaired: true };
    });
    const r = await evaluateEngineMcp({ scanEngineInstalls: scan, fix: true, repairEngine });
    expect(repairEngine).toHaveBeenCalledTimes(2);
    expect(r.status).toBe('ok');
    expect(r.message).toMatch(/self-healed 2 npx-cache copies/i);
  });

  // v4.6 Plan 3 Task 3: repair-success rows carry a structured fixed/fixDetail
  // fact so the doctor-degrade collector never has to parse prose. Prose stays
  // byte-identical — this only ADDS fields.
  test('a full self-heal marks the row fixed with a human-ready detail', async () => {
    const healed = { v: false };
    const scan = () => ({
      installs: [{ kind: 'npx', pkgDir: npxDir('h1'), engineOk: healed.v, roots: [] }],
      mcpLaunch: 'npx',
    });
    const repairEngine = jest.fn(async ({ destPkgDir }) => { healed.v = true; return { repaired: true, destPkgDir }; });
    const r = await evaluateEngineMcp({ scanEngineInstalls: scan, fix: true, repairEngine });
    expect(r.fixed).toBe(true);
    expect(r.fixDetail).toBe('copied the engine into 1 npx-cache copy');
    expect(r.message).toBe('engine present in 1 npx-cache copy (self-healed 1 npx-cache copy)'); // prose byte-identical, exact
  });

  test('a repair that heals nothing does NOT mark fixed', async () => {
    const scan = () => ({ installs: [{ kind: 'npx', pkgDir: npxDir('h1'), engineOk: false, roots: [] }], mcpLaunch: 'npx' });
    const repairEngine = jest.fn(async () => ({ repaired: false, reason: 'no healthy sibling install to copy the engine from' }));
    const r = await evaluateEngineMcp({ scanEngineInstalls: scan, fix: true, repairEngine });
    expect(r.fixed).toBeUndefined();
  });

  test('a partial self-heal (one healed, one still broken) marks fixed with the healed count, status stays warn', async () => {
    const healed = { h1: false };
    const scan = () => ({
      installs: [
        { kind: 'npx', pkgDir: npxDir('h1'), engineOk: healed.h1, roots: [] },
        { kind: 'npx', pkgDir: npxDir('h2'), engineOk: false, roots: [] },
      ],
      mcpLaunch: 'npx',
    });
    const repairEngine = jest.fn(async ({ destPkgDir }) => {
      if (destPkgDir === npxDir('h1')) { healed.h1 = true; return { repaired: true }; }
      return { repaired: false, reason: 'no healthy sibling install to copy the engine from' };
    });
    const r = await evaluateEngineMcp({ scanEngineInstalls: scan, fix: true, repairEngine });
    expect(r.fixed).toBe(true);
    expect(r.fixDetail).toBe('copied the engine into 1 npx-cache copy');
    expect(r.status).toBe('warn'); // the existing ambiguity rule is untouched
    expect(r.message).toBe(
      `engine missing from 1/2 npx-cache copies: ${npxDir('h2')} (searched: ); self-heal incomplete: ${npxDir('h2')} — no healthy sibling install to copy the engine from`,
    ); // prose byte-identical, exact
  });
});

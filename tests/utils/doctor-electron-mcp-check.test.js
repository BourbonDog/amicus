// tests/utils/doctor-electron-mcp-check.test.js
'use strict';
const path = require('path');
const {
  evaluateElectronInstalls, evaluateElectronMcp, scanElectronInstalls,
} = require('../../src/utils/doctor-electron-mcp-check');
const HINTS = require('../../src/utils/remediation-hints');

const npxPkg = (hash) => path.join('C:', 'cache', '_npx', hash, 'node_modules', 'amicus');
const npxEl = (hash) => path.join('C:', 'cache', '_npx', hash, 'node_modules', 'electron');
const npxCopy = (hash, state) => ({
  kind: 'npx', pkgDir: npxPkg(hash),
  electronDir: state === 'package-missing' ? null : npxEl(hash),
  state,
});

// Doctor dep double: canned scan result.
const withScan = (scan) => ({ scanElectronInstalls: () => scan });

describe('evaluateElectronInstalls', () => {
  test('id and name identify the dedicated MCP-launch-path check', () => {
    const r = evaluateElectronInstalls(withScan({ installs: [], mcpLaunch: 'none' }));
    expect(r.id).toBe('electron-mcp');
    expect(r.name).toBe('Electron (MCP launch path)');
  });

  test('no amicus MCP registered → ok, not checked', () => {
    const r = evaluateElectronInstalls(withScan({ installs: [], mcpLaunch: 'none' }));
    expect(r.status).toBe('ok');
    expect(r.message).toMatch(/no amicus MCP registered/i);
  });

  test('fixed-path launch → ok, deferred to the running-copy Electron check', () => {
    const r = evaluateElectronInstalls(withScan({
      installs: [{ kind: 'running', pkgDir: path.join('C:', 'g', 'amicus'), electronDir: null, state: 'package-missing' }],
      mcpLaunch: 'path',
    }));
    expect(r.status).toBe('ok');
    expect(r.message).toMatch(/fixed path/i);
  });

  test('npx launch, no cached copy yet → warn (cannot inspect)', () => {
    const r = evaluateElectronInstalls(withScan({
      installs: [{ kind: 'running', pkgDir: path.join('C:', 'g', 'amicus'), electronDir: '/x', state: 'ok' }],
      mcpLaunch: 'npx',
    }));
    expect(r.status).toBe('warn');
    expect(r.message).toMatch(/no cached copy/i);
  });

  test('npx launch, all cached copies ok → ok', () => {
    const r = evaluateElectronInstalls(withScan({
      installs: [npxCopy('a', 'ok'), npxCopy('b', 'ok')],
      mcpLaunch: 'npx',
    }));
    expect(r.status).toBe('ok');
    expect(r.message).toMatch(/electron present/i);
  });

  test('single copy, binary-missing → WARN distinguishing "binary missing" and naming both dirs', () => {
    const r = evaluateElectronInstalls(withScan({
      installs: [npxCopy('only', 'binary-missing')],
      mcpLaunch: 'npx',
    }));
    expect(r.status).toBe('warn');
    expect(r.message).toMatch(/binary missing/i);
    expect(r.message).not.toMatch(/not installed/i);
    expect(r.message).toContain(npxPkg('only'));
    expect(r.message).toContain(npxEl('only'));
    expect(r.hint).toBe(HINTS.doctorFix);
  });

  test('single copy, package-missing → WARN saying "not installed" (headless still works), no repair hint pressure', () => {
    const r = evaluateElectronInstalls(withScan({
      installs: [npxCopy('only', 'package-missing')],
      mcpLaunch: 'npx',
    }));
    expect(r.status).toBe('warn');
    expect(r.message).toMatch(/not installed/i);
    expect(r.message).not.toMatch(/binary missing/i);
    expect(r.message).toMatch(/headless still works/i);
  });

  test('multiple copies, one broken → warn naming the broken copy only', () => {
    const r = evaluateElectronInstalls(withScan({
      installs: [npxCopy('good', 'ok'), npxCopy('bad', 'binary-missing')],
      mcpLaunch: 'npx',
    }));
    expect(r.status).toBe('warn');
    expect(r.message).toContain(npxPkg('bad'));
    expect(r.message).not.toContain(npxPkg('good'));
  });

  test('unknown launch is treated like npx', () => {
    const r = evaluateElectronInstalls(withScan({
      installs: [npxCopy('only', 'binary-missing')],
      mcpLaunch: 'unknown',
    }));
    expect(r.status).toBe('warn');
  });
});

describe('evaluateElectronMcp (--fix)', () => {
  test('without fix, returns the plain verdict', async () => {
    const r = await evaluateElectronMcp(withScan({ installs: [npxCopy('only', 'binary-missing')], mcpLaunch: 'npx' }));
    expect(r.status).toBe('warn');
    expect(r.message).toMatch(/binary missing/i);
  });

  test('--fix heals a binary-missing npx copy via repairElectron({electronDir}) and reports self-healed', async () => {
    const healed = { v: false };
    const scan = () => ({
      installs: [{ kind: 'npx', pkgDir: npxPkg('h1'), electronDir: npxEl('h1'), state: healed.v ? 'ok' : 'binary-missing' }],
      mcpLaunch: 'npx',
    });
    const repairElectron = jest.fn(async ({ electronDir }) => { healed.v = true; return { repaired: true, electronDir }; });
    const r = await evaluateElectronMcp({ scanElectronInstalls: scan, fix: true, repairElectron });
    expect(repairElectron).toHaveBeenCalledTimes(1);
    expect(repairElectron.mock.calls[0][0].electronDir).toBe(npxEl('h1'));
    expect(r.status).toBe('ok');
    expect(r.message).toMatch(/self-healed/i);
  });

  test('--fix NEVER calls repairElectron for a package-missing copy (no package to repair into)', async () => {
    const repairElectron = jest.fn();
    const r = await evaluateElectronMcp({
      scanElectronInstalls: () => ({ installs: [npxCopy('h1', 'package-missing')], mcpLaunch: 'npx' }),
      fix: true, repairElectron,
    });
    expect(repairElectron).not.toHaveBeenCalled();
    expect(r.status).toBe('warn');
  });

  test('--fix that cannot heal reports "self-heal incomplete" with the reason', async () => {
    const scan = () => ({ installs: [npxCopy('h1', 'binary-missing')], mcpLaunch: 'npx' });
    const repairElectron = jest.fn(async () => ({ repaired: false, reason: 'antivirus quarantine' }));
    const r = await evaluateElectronMcp({ scanElectronInstalls: scan, fix: true, repairElectron });
    expect(r.status).toBe('warn');
    expect(r.message).toMatch(/self-heal incomplete/i);
    expect(r.message).toMatch(/antivirus quarantine/i);
  });

  test('--fix does not call repairElectron when already healthy', async () => {
    const repairElectron = jest.fn();
    const r = await evaluateElectronMcp({
      scanElectronInstalls: () => ({ installs: [npxCopy('h1', 'ok')], mcpLaunch: 'npx' }),
      fix: true, repairElectron,
    });
    expect(repairElectron).not.toHaveBeenCalled();
    expect(r.status).toBe('ok');
  });

  test('a throwing repairElectron is caught and reported, never propagated', async () => {
    const scan = () => ({ installs: [npxCopy('h1', 'binary-missing')], mcpLaunch: 'npx' });
    const repairElectron = jest.fn(async () => { throw new Error('disk full'); });
    const r = await evaluateElectronMcp({ scanElectronInstalls: scan, fix: true, repairElectron });
    expect(r.status).toBe('warn');
    expect(r.message).toMatch(/disk full/i);
  });
});

describe('scanElectronInstalls (default wiring — #69 lesson: exercise the real root computation)', () => {
  // Fake fs describing: one npx copy with HOISTED electron whose exe exists,
  // plus the running copy with no electron at all.
  const cache = path.join('C:', 'cache');
  const hash = 'aaaa';
  const pkg = path.join(cache, '_npx', hash, 'node_modules', 'amicus');
  const hoistedEl = path.join(cache, '_npx', hash, 'node_modules', 'electron');
  const running = path.join('C:', 'run', 'amicus');

  const fs = {
    existsSync: (p) => {
      const n = path.normalize(p);
      return [pkg, hoistedEl, path.join(hoistedEl, 'package.json'), path.join(hoistedEl, 'dist', 'electron.exe')]
        .map((x) => path.normalize(x)).includes(n);
    },
    readdirSync: (p) => {
      if (path.normalize(p) === path.normalize(path.join(cache, '_npx'))) { return [hash]; }
      throw new Error(`unexpected readdir: ${p}`);
    },
    realpathSync: (p) => p,
    readFileSync: () => { throw new Error('no path.txt in fixture'); },
  };

  test('probes hoisted electron in npx copies and classifies launch from the MCP config', () => {
    const { installs, mcpLaunch } = scanElectronInstalls({
      fs,
      platform: 'win32',
      runningPkgDir: running,
      npmCacheDir: cache,
      npmRootG: () => null,
      readAmicusMcpConfig: () => ({ command: 'npx', args: ['-y', 'amicus@latest', 'mcp'] }),
    });
    expect(mcpLaunch).toBe('npx');
    const npx = installs.find((i) => i.kind === 'npx');
    expect(npx).toBeTruthy();
    expect(npx.electronDir).toBe(hoistedEl);
    expect(npx.state).toBe('ok');
    const run = installs.find((i) => i.kind === 'running');
    expect(run.state).toBe('package-missing');
  });
});

// tests/sidecar/electron-state.test.js
'use strict';
const path = require('path');
const { electronDirFor, probeElectronState } = require('../../src/sidecar/electron-state');

// Fake fs: existsSync answers from a set of normalized paths; readFileSync
// always throws so isElectronUsable falls back to platformExe(platform).
const fakeFs = (existing) => {
  const set = new Set(existing.map((p) => path.normalize(p)));
  return {
    existsSync: (p) => set.has(path.normalize(p)),
    readFileSync: () => { throw new Error('no path.txt in fixture'); },
  };
};

const pkgDir = path.join('C:', 'cache', '_npx', 'h1', 'node_modules', 'amicus');
const nested = path.join(pkgDir, 'node_modules', 'electron');
const hoisted = path.join('C:', 'cache', '_npx', 'h1', 'node_modules', 'electron');

describe('electronDirFor (dual-root layout probe — the #69 lesson applied to electron)', () => {
  test('nested layout (global-install shape) → <pkgDir>/node_modules/electron', () => {
    const fs = fakeFs([nested]);
    expect(electronDirFor(pkgDir, { fs })).toBe(nested);
  });

  test('hoisted layout (npx-cache shape) → sibling <parent>/electron', () => {
    const fs = fakeFs([hoisted]);
    expect(electronDirFor(pkgDir, { fs })).toBe(hoisted);
  });

  test('both layouts present → nested wins (mirrors require.resolve walk-up order)', () => {
    const fs = fakeFs([nested, hoisted]);
    expect(electronDirFor(pkgDir, { fs })).toBe(nested);
  });

  test('neither layout present → null (electron package not installed for this copy)', () => {
    const fs = fakeFs([]);
    expect(electronDirFor(pkgDir, { fs })).toBeNull();
  });
});

describe('probeElectronState', () => {
  const exe = path.join(nested, 'dist', 'electron.exe');
  const pkgJson = path.join(nested, 'package.json');

  test('package dir null → package-missing (electronDir stays null)', () => {
    const r = probeElectronState({ electronDir: null, fs: fakeFs([]), platform: 'win32' });
    expect(r).toEqual({ state: 'package-missing', electronDir: null });
  });

  test('package.json absent at the given dir → package-missing', () => {
    const r = probeElectronState({ electronDir: nested, fs: fakeFs([nested]), platform: 'win32' });
    expect(r).toEqual({ state: 'package-missing', electronDir: nested });
  });

  test('package present + exe present → ok', () => {
    const r = probeElectronState({ electronDir: nested, fs: fakeFs([nested, pkgJson, exe]), platform: 'win32' });
    expect(r).toEqual({ state: 'ok', electronDir: nested });
  });

  test('package present + exe MISSING → binary-missing (the issue-#76 state doctor conflated)', () => {
    const r = probeElectronState({ electronDir: nested, fs: fakeFs([nested, pkgJson]), platform: 'win32' });
    expect(r).toEqual({ state: 'binary-missing', electronDir: nested });
  });

  // #69 lesson: exercise the DEFAULT electronDir computation (require.resolve
  // walk from the running copy) instead of always injecting the root. Only the
  // shape is asserted — the machine's actual provisioning state may vary.
  test('no electronDir given → probes the running copy via the default resolver', () => {
    const r = probeElectronState();
    expect(['ok', 'package-missing', 'binary-missing']).toContain(r.state);
    if (r.state !== 'package-missing') {
      expect(typeof r.electronDir).toBe('string');
      expect(r.electronDir.length).toBeGreaterThan(0);
    }
  });
});

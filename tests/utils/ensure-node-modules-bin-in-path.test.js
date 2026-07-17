// tests/utils/ensure-node-modules-bin-in-path.test.js
'use strict';
const path = require('path');
const os = require('os');
const { ensureNodeModulesBinInPath } = require('../../src/utils/path-setup');

// The two layouts opencodeRoots() probes (#69), pinned to fixtures so the
// assertions do not depend on where this checkout happens to live.
const PKG_DIR = path.join('C:', 'npx', 'cache', 'node_modules', 'amicus');
const NESTED = path.join(PKG_DIR, 'node_modules'); // npm i -g
const HOISTED = path.join('C:', 'npx', 'cache', 'node_modules'); // npx / pnpm

const nativeBin = (root, arch, variant = '') =>
  path.join(root, `opencode-windows-${arch}${variant}`, 'bin');
const binDir = (root) => path.join(root, '.bin');

const entries = () => process.env.PATH.split(path.delimiter);
const opencodeEntries = () => entries().filter((p) => p.includes('opencode-windows'));
const indexOfEntry = (dir) => entries().indexOf(dir);

describe('ensureNodeModulesBinInPath (PATH search order)', () => {
  let savedPath;

  // This function mutates the real process.env.PATH, and jest workers share one
  // process across test files — restore it or we leak into every later suite.
  beforeAll(() => { savedPath = process.env.PATH; });
  afterAll(() => { process.env.PATH = savedPath; });

  beforeEach(() => { process.env.PATH = 'SEED'; });
  afterEach(() => { jest.restoreAllMocks(); });

  const onWindows = (arch = 'x64') => {
    jest.spyOn(os, 'platform').mockReturnValue('win32');
    jest.spyOn(os, 'arch').mockReturnValue(arch);
  };

  test('windows x64: default (AVX2) beats -baseline, and nested beats hoisted', () => {
    onWindows('x64');

    ensureNodeModulesBinInPath({ pkgDir: PKG_DIR });

    expect(opencodeEntries()).toEqual([
      nativeBin(NESTED, 'x64'),
      nativeBin(HOISTED, 'x64'),
      nativeBin(NESTED, 'x64', '-baseline'),
      nativeBin(HOISTED, 'x64', '-baseline'),
    ]);
  });

  test('windows arm64: the same priority order holds', () => {
    onWindows('arm64');

    ensureNodeModulesBinInPath({ pkgDir: PKG_DIR });

    expect(opencodeEntries()).toEqual([
      nativeBin(NESTED, 'arm64'),
      nativeBin(HOISTED, 'arm64'),
      nativeBin(NESTED, 'arm64', '-baseline'),
      nativeBin(HOISTED, 'arm64', '-baseline'),
    ]);
  });

  test('windows: every native .exe dir precedes every .bin, whose shim spawn() cannot run', () => {
    onWindows('x64');

    ensureNodeModulesBinInPath({ pkgDir: PKG_DIR });

    const lastExe = Math.max(
      indexOfEntry(nativeBin(NESTED, 'x64', '-baseline')),
      indexOfEntry(nativeBin(HOISTED, 'x64', '-baseline')),
    );
    const firstBin = Math.min(indexOfEntry(binDir(NESTED)), indexOfEntry(binDir(HOISTED)));
    expect(lastExe).toBeLessThan(firstBin);
  });

  test('a single explicit root (nodeModulesRoot seam) is honoured on its own', () => {
    onWindows('x64');
    const ROOT = path.join('C:', 'app', 'node_modules');

    ensureNodeModulesBinInPath({ nodeModulesRoot: ROOT });

    expect(entries()).toEqual([
      nativeBin(ROOT, 'x64'),
      nativeBin(ROOT, 'x64', '-baseline'),
      binDir(ROOT),
      'SEED',
    ]);
  });

  test('the pre-existing PATH is preserved, after everything we prepend', () => {
    onWindows('x64');
    process.env.PATH = `FIRST${path.delimiter}SECOND`;

    ensureNodeModulesBinInPath({ pkgDir: PKG_DIR });

    expect(entries().slice(-2)).toEqual(['FIRST', 'SECOND']);
  });

  test('calling twice neither duplicates entries nor reorders them', () => {
    onWindows('x64');

    ensureNodeModulesBinInPath({ pkgDir: PKG_DIR });
    const afterFirst = process.env.PATH;
    ensureNodeModulesBinInPath({ pkgDir: PKG_DIR });

    expect(process.env.PATH).toBe(afterFirst);
  });

  test('non-windows: only the .bin dirs are added, nested first, no opencode-windows dirs', () => {
    jest.spyOn(os, 'platform').mockReturnValue('linux');
    jest.spyOn(os, 'arch').mockReturnValue('x64');

    ensureNodeModulesBinInPath({ pkgDir: PKG_DIR });

    expect(opencodeEntries()).toEqual([]);
    expect(entries()).toEqual([binDir(NESTED), binDir(HOISTED), 'SEED']);
  });
});

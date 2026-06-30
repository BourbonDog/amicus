// tests/utils/has-opencode-binary.test.js
'use strict';
const path = require('path');
const { hasOpencodeBinary } = require('../../src/utils/path-setup');

// Fake fs whose existsSync returns true only for the paths we seed.
function fakeFs(presentPaths) {
  const set = new Set(presentPaths.map((p) => path.normalize(p)));
  return { existsSync: (p) => set.has(path.normalize(p)) };
}

const ROOT = path.join('C:', 'app', 'node_modules');

describe('hasOpencodeBinary (shared resolver)', () => {
  test('windows x64: true when opencode.exe fixture exists in the platform subpackage', () => {
    const exe = path.join(ROOT, 'opencode-windows-x64', 'bin', 'opencode.exe');
    const ok = hasOpencodeBinary({
      fs: fakeFs([exe]),
      platform: 'win32',
      arch: 'x64',
      nodeModulesRoot: ROOT,
    });
    expect(ok).toBe(true);
  });

  test('windows x64: true when only the -baseline variant exists', () => {
    const exe = path.join(ROOT, 'opencode-windows-x64-baseline', 'bin', 'opencode.exe');
    const ok = hasOpencodeBinary({
      fs: fakeFs([exe]),
      platform: 'win32',
      arch: 'x64',
      nodeModulesRoot: ROOT,
    });
    expect(ok).toBe(true);
  });

  test('windows arm64: resolves the arm64 subpackage', () => {
    const exe = path.join(ROOT, 'opencode-windows-arm64', 'bin', 'opencode.exe');
    const ok = hasOpencodeBinary({
      fs: fakeFs([exe]),
      platform: 'win32',
      arch: 'arm64',
      nodeModulesRoot: ROOT,
    });
    expect(ok).toBe(true);
  });

  test('windows: false when no opencode.exe is present (skipped/quarantined)', () => {
    const ok = hasOpencodeBinary({
      fs: fakeFs([]),
      platform: 'win32',
      arch: 'x64',
      nodeModulesRoot: ROOT,
    });
    expect(ok).toBe(false);
  });

  test('non-windows: true when node_modules/.bin/opencode exists', () => {
    const bin = path.join(ROOT, '.bin', 'opencode');
    const ok = hasOpencodeBinary({
      fs: fakeFs([bin]),
      platform: 'linux',
      arch: 'x64',
      nodeModulesRoot: ROOT,
    });
    expect(ok).toBe(true);
  });

  test('non-windows: false when node_modules/.bin/opencode is missing', () => {
    const ok = hasOpencodeBinary({
      fs: fakeFs([]),
      platform: 'linux',
      arch: 'x64',
      nodeModulesRoot: ROOT,
    });
    expect(ok).toBe(false);
  });

  test('an existsSync that throws is treated as not-found (never throws)', () => {
    const throwingFs = { existsSync: () => { throw new Error('EACCES'); } };
    const ok = hasOpencodeBinary({
      fs: throwingFs,
      platform: 'win32',
      arch: 'x64',
      nodeModulesRoot: ROOT,
    });
    expect(ok).toBe(false);
  });
});

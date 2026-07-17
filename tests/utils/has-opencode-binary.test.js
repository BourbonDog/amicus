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

// Layout regression (#69): npm only NESTS deps under amicus/node_modules when it
// cannot hoist them. Under `npx -y amicus@latest mcp` — which is exactly how the
// postinstall registers the MCP server — opencode-windows-* is HOISTED to a
// sibling of amicus/. The engine is present and runnable, but a resolver that
// hard-codes <pkgDir>/node_modules reports "not found" and startServer throws
// engineMissing, killing every fanout leg instantly.
describe('hasOpencodeBinary (hoisted layout — npx / pnpm / workspaces)', () => {
  const PKG_DIR = path.join('C:', 'npx', 'cache', 'node_modules', 'amicus');
  const HOISTED = path.join('C:', 'npx', 'cache', 'node_modules');

  test('windows x64: true when opencode.exe is hoisted beside amicus/', () => {
    const exe = path.join(HOISTED, 'opencode-windows-x64', 'bin', 'opencode.exe');
    const ok = hasOpencodeBinary({
      fs: fakeFs([exe]),
      platform: 'win32',
      arch: 'x64',
      pkgDir: PKG_DIR,
    });
    expect(ok).toBe(true);
  });

  test('windows x64: true when only the hoisted -baseline variant exists', () => {
    const exe = path.join(HOISTED, 'opencode-windows-x64-baseline', 'bin', 'opencode.exe');
    const ok = hasOpencodeBinary({
      fs: fakeFs([exe]),
      platform: 'win32',
      arch: 'x64',
      pkgDir: PKG_DIR,
    });
    expect(ok).toBe(true);
  });

  test('windows x64: nested layout (npm -g) still resolves', () => {
    const exe = path.join(PKG_DIR, 'node_modules', 'opencode-windows-x64', 'bin', 'opencode.exe');
    const ok = hasOpencodeBinary({
      fs: fakeFs([exe]),
      platform: 'win32',
      arch: 'x64',
      pkgDir: PKG_DIR,
    });
    expect(ok).toBe(true);
  });

  test('windows: false when the binary exists in neither layout', () => {
    const ok = hasOpencodeBinary({
      fs: fakeFs([]),
      platform: 'win32',
      arch: 'x64',
      pkgDir: PKG_DIR,
    });
    expect(ok).toBe(false);
  });

  test('non-windows: true when .bin/opencode is hoisted beside amicus/', () => {
    const bin = path.join(HOISTED, '.bin', 'opencode');
    const ok = hasOpencodeBinary({
      fs: fakeFs([bin]),
      platform: 'linux',
      arch: 'x64',
      pkgDir: PKG_DIR,
    });
    expect(ok).toBe(true);
  });
});

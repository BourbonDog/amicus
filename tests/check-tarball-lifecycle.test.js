/**
 * Tests for scripts/check-tarball-lifecycle.js — the CI guard asserting that
 * every lifecycle-hook-referenced script actually ships in the published tarball.
 */

const path = require('node:path');
const {
  collectLifecycleScripts,
  extractPackedPaths,
  findMissing,
  checkTarball,
} = require('../scripts/check-tarball-lifecycle');

describe('collectLifecycleScripts', () => {
  test('extracts local script paths referenced by lifecycle hooks', () => {
    const pkg = {
      scripts: {
        test: 'jest',
        lint: 'eslint src/',
        postinstall: 'node scripts/postinstall.js',
        prepare: 'node scripts/setup-hooks.js',
      },
    };
    const scripts = collectLifecycleScripts(pkg);
    expect(scripts).toContain('scripts/postinstall.js');
    expect(scripts).toContain('scripts/setup-hooks.js');
  });

  test('ignores non-lifecycle scripts (test, lint, custom)', () => {
    const pkg = {
      scripts: {
        test: 'node scripts/run-tests.js',
        lint: 'node scripts/lint.js',
        'check:secrets': 'node scripts/check-secrets.js',
      },
    };
    expect(collectLifecycleScripts(pkg)).toEqual([]);
  });

  test('derives lifecycle hooks dynamically (preinstall, install, prepublishOnly)', () => {
    const pkg = {
      scripts: {
        preinstall: 'node scripts/pre.js',
        install: 'node scripts/inst.js',
        prepublishOnly: 'node scripts/pub.js',
      },
    };
    const scripts = collectLifecycleScripts(pkg);
    expect(scripts).toEqual(
      expect.arrayContaining(['scripts/pre.js', 'scripts/inst.js', 'scripts/pub.js'])
    );
  });

  test('returns empty array when there are no scripts', () => {
    expect(collectLifecycleScripts({})).toEqual([]);
    expect(collectLifecycleScripts({ scripts: {} })).toEqual([]);
  });
});

describe('extractPackedPaths', () => {
  test('parses the file list from npm pack --dry-run --json output', () => {
    const packOutput = [
      { files: [{ path: 'scripts/postinstall.js' }, { path: 'bin/amicus.js' }] },
    ];
    expect(extractPackedPaths(packOutput)).toEqual([
      'scripts/postinstall.js',
      'bin/amicus.js',
    ]);
  });

  test('accepts a raw JSON string', () => {
    const raw = JSON.stringify([{ files: [{ path: 'scripts/setup-hooks.js' }] }]);
    expect(extractPackedPaths(raw)).toEqual(['scripts/setup-hooks.js']);
  });

  test('normalizes backslash path separators to forward slashes', () => {
    const packOutput = [{ files: [{ path: 'scripts\\postinstall.js' }] }];
    expect(extractPackedPaths(packOutput)).toEqual(['scripts/postinstall.js']);
  });
});

describe('findMissing', () => {
  test('returns [] when every lifecycle script is present', () => {
    const scripts = ['scripts/postinstall.js', 'scripts/setup-hooks.js'];
    const packed = ['bin/amicus.js', 'scripts/postinstall.js', 'scripts/setup-hooks.js'];
    expect(findMissing(scripts, packed)).toEqual([]);
  });

  test('names any script absent from the tarball', () => {
    const scripts = ['scripts/postinstall.js', 'scripts/setup-hooks.js'];
    const packed = ['scripts/postinstall.js'];
    expect(findMissing(scripts, packed)).toEqual(['scripts/setup-hooks.js']);
  });

  test('matches regardless of path-separator style', () => {
    const scripts = ['scripts/postinstall.js'];
    const packed = ['scripts\\postinstall.js'];
    expect(findMissing(scripts, packed)).toEqual([]);
  });
});

describe('checkTarball (integration, mocked pack output)', () => {
  const realPkg = require(path.join(__dirname, '..', 'package.json'));

  test('passes against the real package with injected real pack file-list', () => {
    // Inject the real package's lifecycle scripts as "packed" so we exercise
    // the full pipeline without running a real install or pack.
    const lifecycle = collectLifecycleScripts(realPkg);
    const fakePackJson = [{ files: lifecycle.map((p) => ({ path: p })) }];
    const result = checkTarball({ pkg: realPkg, packOutput: fakePackJson });
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });

  test('fails when a referenced lifecycle script is missing from the tarball', () => {
    const pkg = {
      scripts: {
        postinstall: 'node scripts/postinstall.js',
        prepare: 'node scripts/setup-hooks.js',
      },
    };
    // Pack list is missing setup-hooks.js
    const fakePackJson = [{ files: [{ path: 'scripts/postinstall.js' }] }];
    const result = checkTarball({ pkg, packOutput: fakePackJson });
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['scripts/setup-hooks.js']);
  });
});

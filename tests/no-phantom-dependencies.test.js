// tests/no-phantom-dependencies.test.js
'use strict';

/**
 * No PHANTOM dependencies: every external module the shipped code requires must
 * be declared in `dependencies` or `optionalDependencies`.
 *
 * WHY THIS EXISTS. v4.5.2 fixed a field bug where `src/sidecar/unzip.js` did a
 * bare `require('extract-zip')` for a package that was never declared anywhere.
 * It resolved fine in the dev tree — `puppeteer`, a devDependency, pulls it
 * transitively — and every unit test injected `deps.extractZip`, so nothing ever
 * executed the real require. On a published `npm i -g amicus` there is no
 * puppeteer, so the module was simply absent and the entire Electron self-heal
 * threw MODULE_NOT_FOUND before doing anything. `doctor --fix` dead-ended at
 * "self-heal incomplete" for months and the failure was invisible in CI.
 *
 * A dev tree cannot detect this by resolving the module — it always succeeds.
 * The only sound check is DECLARATION, which is what this asserts.
 */

const fs = require('fs');
const path = require('path');
const { builtinModules } = require('module');
const { readIfPresent } = require('./helpers/read-if-present');

const ROOT = path.join(__dirname, '..');
const SHIPPED_DIRS = ['src', 'bin', 'electron'];

/** Top-level package name for a specifier ('a/b' → 'a', '@s/p/x' → '@s/p'). */
function topLevel(spec) {
  return spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
}

/** Every external top-level package required under `dir`, mapped to its files. */
function collectExternalRequires(dir, acc = new Map()) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') { collectExternalRequires(full, acc); }
      continue;
    }
    if (!entry.name.endsWith('.js')) { continue; }
    // Not fs.readFileSync: a parallel worker's temp file can be named by the
    // listing above and unlinked before this read — see helpers/read-if-present.
    const src = readIfPresent(full);
    if (src === null) { continue; }
    for (const m of src.matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
      const spec = m[1];
      if (spec.startsWith('.') || spec.startsWith('node:')) { continue; }
      const top = topLevel(spec);
      if (builtinModules.includes(top)) { continue; }
      if (!acc.has(top)) { acc.set(top, []); }
      acc.get(top).push(path.relative(ROOT, full));
    }
  }
  return acc;
}

describe('no phantom dependencies in shipped code', () => {
  const pkg = require('../package.json');
  const declared = new Set([
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.optionalDependencies || {}),
  ]);

  const required = SHIPPED_DIRS
    .filter(d => fs.existsSync(path.join(ROOT, d)))
    .reduce((acc, d) => collectExternalRequires(path.join(ROOT, d), acc), new Map());

  it('finds requires to check (the scan itself is not silently empty)', () => {
    expect(required.size).toBeGreaterThan(0);
  });

  it('declares every external package that src/, bin/ and electron/ require', () => {
    const phantom = [...required.entries()]
      .filter(([name]) => !declared.has(name))
      .map(([name, files]) => `${name} (required by ${files.slice(0, 3).join(', ')})`);
    expect(phantom).toEqual([]);
  });

  it('does not satisfy a runtime require from devDependencies', () => {
    const devOnly = [...required.keys()]
      .filter(n => !declared.has(n) && (pkg.devDependencies || {})[n]);
    expect(devOnly).toEqual([]);
  });

  // The specific regression: unzip.js's Strategy 1.
  it('declares extract-zip, the package that caused this test to exist', () => {
    expect(required.has('extract-zip')).toBe(true);
    expect(declared.has('extract-zip')).toBe(true);
  });
});

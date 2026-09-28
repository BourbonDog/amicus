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
 *
 * ── NAMED MUTANTS ─────────────────────────────────────────────────────────
 * Applied and reverted by byte copy, MEASURED 2026-09-28.
 *
 * NORECURSE  no-phantom-dependencies.test.js :: collectExternalRequires —
 *   never descend into a subdirectory, so only top-level src/, bin/ and
 *   electron/ files are scanned.
 *   RED: "no file under src/, bin/ or electron/ requires extract-zip", on its
 *   yauzl positive control (:119).
 * POSTINSTALLREQUIRE  scripts/postinstall.js — add `require('extract-zip')`
 *   to the shipped, production-executed postinstall. It survived every test
 *   here until the scripts/ pin existed.
 *   RED: "no file under scripts/ requires extract-zip either (the shipped
 *   postinstall runs in production)" (:129).
 * ──────────────────────────────────────────────────────────────────────────
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

  // N-06 / BL-10 (owner decision D-01, 2026-09-28): `extract-zip` and
  // `tiktoken` stay removed. `extract-zip` was declared solely for
  // the deleted `robustExtract` (formerly in src/sidecar/unzip.js; no production caller);
  // `tiktoken` was declared but never required anywhere (token sizing uses a
  // length/4 heuristic). ABSENCE-PINNED, the way tests/remediation-hints.test.js
  // pins a removed hint: a reintroduction of either must re-justify itself
  // here, not slip back in silently. Neither assertion touches node_modules or
  // resolves the package — both read package.json / scanned source text only
  // — so this holds regardless of what node_modules contains (a dev install
  // still has extract-zip via puppeteer -> @puppeteer/browsers; see
  // package-lock.json).
  it('extract-zip is not declared in package.json', () => {
    expect(declared.has('extract-zip')).toBe(false);
  });

  it('no file under src/, bin/ or electron/ requires extract-zip', () => {
    // Positive control: yauzl is required only inside guarded try blocks in src/sidecar/zip-from-buffer.js and zip-name-scan.js, the same shape extract-zip had.
    expect(required.has('yauzl')).toBe(true);
    expect(required.has('extract-zip')).toBe(false);
  });

  it('no file under scripts/ requires extract-zip either (the shipped postinstall runs in production)', () => {
    // package.json `files` ships scripts/postinstall.js and scripts/setup-hooks.js,
    // and every `npm i -g amicus` runs the postinstall: an undeclared require
    // there is the v4.5.2 failure class again, outside the three directories above.
    const inScripts = collectExternalRequires(path.join(ROOT, 'scripts'));
    expect(inScripts.size).toBeGreaterThan(0);
    expect(inScripts.has('extract-zip')).toBe(false);
  });

  it('tiktoken is not declared in package.json', () => {
    expect(declared.has('tiktoken')).toBe(false);
  });

  it('no file under src/, bin/, electron/ or scripts/ requires tiktoken', () => {
    // The phantom sweep above already fails on an undeclared require in the
    // first three; scripts/, which ships the postinstall, it never scans.
    expect(required.has('tiktoken')).toBe(false);
    expect(collectExternalRequires(path.join(ROOT, 'scripts')).has('tiktoken')).toBe(false);
  });
});

describe('engine version pinning (#133)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));

  // Exact pins, not ranges: package-lock.json does NOT ship in the tarball, so
  // for every consumer the range in package.json is the sole governor and a
  // caret resolves to "whatever was latest the day this copy was installed".
  // That is precisely how an npx-cache copy and a global install ended up on
  // different engines in #133. Exact makes the engine a pure function of the
  // amicus version. They release in lockstep, so both are pinned together.
  it.each(['opencode-ai', '@opencode-ai/sdk'])('%s is an exact version, not a range', (dep) => {
    expect(pkg.dependencies[dep]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('the engine and its SDK are pinned to the same version', () => {
    expect(pkg.dependencies['@opencode-ai/sdk']).toBe(pkg.dependencies['opencode-ai']);
  });
});

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
 * A SECOND SHAPE OF THE SAME BUG (council round 4, A3): a removed EXPORT. A
 * destructured import of a name a module no longer exports is `undefined`, not
 * an error, so nothing fails until the stale importer calls it. The
 * robustExtract / IDLE_MS guard below reads the same files through the same
 * walker.
 *
 * ── NAMED MUTANTS ─────────────────────────────────────────────────────────
 * Applied and reverted by byte copy, MEASURED 2026-09-28. Every one was re-run
 * in council round 3, when the sweep began reading the shipped scripts, and
 * again in round 4, when the walker was shared with the stale-import guard.
 *
 * NORECURSE  no-phantom-dependencies.test.js :: walkJs — never descend into a
 *   subdirectory, so only top-level files are read. REDEFINED in round 4:
 *   the recursion moved into walkJs out of collectExternalRequires.
 *   RED: "no file under src/, bin/ or electron/ requires extract-zip", on its
 *   yauzl positive control (:205), and the stale-import guard's control,
 *   "sees what the live importers take from unzip.js" (:286).
 * POSTINSTALLREQUIRE  scripts/postinstall.js — add `require('extract-zip')`
 *   to the shipped, production-executed postinstall. It survived every test
 *   here until the scripts/ pin existed.
 *   RED: "no file under scripts/ requires extract-zip either (the shipped
 *   postinstall runs in production)" (:215). Since round 3 also the phantom
 *   sweep (:179) and "no file under src/, bin/ or electron/ requires
 *   extract-zip" (:206), whose `required` now holds the shipped scripts.
 * TIKTOKENPOSTINSTALL scripts/postinstall.js — add `require('tiktoken')`.
 *   It survived every test here until the tiktoken scan covered scripts/.
 *   RED: "no file under src/, bin/, electron/ or scripts/ requires tiktoken"
 *   (:226), and since round 3 the phantom sweep (:179).
 * TIKTOKENREQUIRE src/sidecar/unzip.js — add `require('tiktoken')`.
 *   RED: the same test (:226), and the phantom sweep "declares every
 *   external package that src/, bin/, electron/ and the shipped scripts
 *   require" (:179).
 * POSTINSTALLPHANTOM scripts/postinstall.js — add `require('left-pad')`: an
 *   undeclared package under ANY name, in the shipped postinstall. It
 *   survived every test here until the sweep read the shipped scripts
 *   (council round 3, A1).
 *   RED: the phantom sweep (:179).
 * SETUPHOOKSPHANTOM scripts/setup-hooks.js — the same, in the OTHER shipped
 *   script, which the postinstall runs on every install.
 *   RED: the phantom sweep (:179).
 * SHIPPEDEMPTY no-phantom-dependencies.test.js :: shippedScripts — the
 *   filter stops taking plain `.js` (round 3: `.cjs` instead of `.js`;
 *   REDEFINED in round 4, when the filter moved into shippedScripts and
 *   began taking `.cjs`/`.mjs` too), so the sweep reads no shipped script.
 *   RED: "finds requires to check (the scan itself is not silently empty)"
 *   (:167).
 * SHIPPEDJSONLY no-phantom-dependencies.test.js :: shippedScripts — back to
 *   `.js` only, so a shipped `.cjs` or `.mjs` escapes the sweep again. It is
 *   the 2b11e9b2 filter (council round 4, A4/D4).
 *   RED: the same test, on its synthetic list (:172).
 * PUPPETEERPROD package.json — declare puppeteer in `dependencies`, which
 *   ships @puppeteer/browsers -> extract-zip to every install. It survived
 *   every test here once the robustExtract suite was deleted (round 3, A2).
 *   RED: "puppeteer stays out of what an install pulls in (it would bring
 *   extract-zip back)" (:235).
 * STALEROBUST src/sidecar/electron-native-rescue.js — add
 *   `const { robustExtract } = require('./unzip');`: `undefined`, silent
 *   until called. At 2b11e9b2 it passed every test here and in
 *   tests/electron-native-rescue.test.js and tests/electron-install.test.js
 *   (council round 4, A3).
 *   RED: "no file under src/, bin/, electron/ or scripts/ imports
 *   robustExtract, or IDLE_MS from unzip.js" (:297).
 * STALEIDLE src/sidecar/electron-native-rescue.js — the same, taking
 *   `IDLE_MS` from `./unzip`. It survived the same files at 2b11e9b2.
 *   RED: the same test (:297).
 * GUARDBLIND no-phantom-dependencies.test.js :: importedNames — resolve a
 *   relative specifier against the CWD, so nothing resolves to unzip.js and
 *   the IDLE_MS half of the guard is vacuous.
 *   RED: "sees what the live importers take from unzip.js (the scan is not
 *   blind)" (:286).
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

/** Record, in `acc`, every external top-level package that `file` requires. */
function recordExternalRequires(file, acc) {
  // Not fs.readFileSync: a parallel worker's temp file can be named by a
  // directory listing and unlinked before this read — see helpers/read-if-present.
  const src = readIfPresent(file);
  if (src === null) { return; }
  for (const m of src.matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
    const spec = m[1];
    if (spec.startsWith('.') || spec.startsWith('node:')) { continue; }
    const top = topLevel(spec);
    if (builtinModules.includes(top)) { continue; }
    if (!acc.has(top)) { acc.set(top, []); }
    acc.get(top).push(path.relative(ROOT, file));
  }
}

/** Hand every `.js` file under `dir` (node_modules excepted) to `onFile`. */
function walkJs(dir, onFile) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') { walkJs(full, onFile); }
      continue;
    }
    if (entry.name.endsWith('.js')) { onFile(full); }
  }
}

/** Every external top-level package required under `dir`, mapped to its files. */
function collectExternalRequires(dir, acc = new Map()) {
  walkJs(dir, (file) => recordExternalRequires(file, acc));
  return acc;
}

/** The scripts package.json `files` ships by name: `.js`, `.cjs` or `.mjs`, at
 *  any depth under scripts/ (council round 4, A4/D4). */
function shippedScripts(files) {
  return (files || []).filter((f) => /^scripts\/.+\.[cm]?js$/.test(f));
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
  // package.json `files` also ships two scripts, and a production install runs
  // both (`postinstall` is scripts/postinstall.js, which runs setup-hooks.js):
  // an undeclared require in either is the v4.5.2 failure class, so the sweep
  // reads them too. The rest of scripts/ is dev tooling that never ships.
  const SHIPPED_SCRIPTS = shippedScripts(pkg.files);
  for (const f of SHIPPED_SCRIPTS) { recordExternalRequires(path.join(ROOT, f), required); }

  it('finds requires to check (the scan itself is not silently empty)', () => {
    expect(required.size).toBeGreaterThan(0);
    // ...and the shipped scripts are really read: the list is not empty, and
    // every name in it is a file (readIfPresent skips a missing one silently).
    expect(SHIPPED_SCRIPTS).toContain('scripts/postinstall.js');
    expect(SHIPPED_SCRIPTS.filter((f) => !fs.existsSync(path.join(ROOT, f)))).toEqual([]);
    // The filter takes every script extension node runs, nested or not; none
    // but .js ships today, so a synthetic list is what proves it.
    expect(shippedScripts(['scripts/a.js', 'scripts/b.cjs', 'scripts/c.mjs', 'scripts/sub/d.js', 'scripts/', 'scripts/e.sh', 'src/x.js']))
      .toEqual(['scripts/a.js', 'scripts/b.cjs', 'scripts/c.mjs', 'scripts/sub/d.js']);
  });

  it('declares every external package that src/, bin/, electron/ and the shipped scripts require', () => {
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
    // first three and in the two shipped scripts; the rest of scripts/ it
    // never reads, so this scans all of it.
    expect(required.has('tiktoken')).toBe(false);
    expect(collectExternalRequires(path.join(ROOT, 'scripts')).has('tiktoken')).toBe(false);
  });

  it('puppeteer stays out of what an install pulls in (it would bring extract-zip back)', () => {
    // puppeteer is a devDependency, and its @puppeteer/browsers depends on
    // extract-zip (package-lock.json). Declared anywhere npm installs for a
    // consumer, it would put that package back into every install with no
    // require anywhere in amicus for the sweep above to see.
    expect(declared.has('puppeteer')).toBe(false);
    expect((pkg.peerDependencies || {}).puppeteer).toBeUndefined();
  });
});

/**
 * What `file` takes from each module it requires, with a relative specifier
 * resolved against the file: `const { a, b: c } = require(spec)`,
 * `require(spec).a`, and `x.a` after `const x = require(spec)`.
 * @returns {Array<{from: string, name: string}>}
 */
function importedNames(file, src) {
  const resolve = (spec) => (spec.startsWith('.') ? path.resolve(path.dirname(file), spec) : spec);
  const out = [];
  for (const m of src.matchAll(/\{([^{}]*)\}\s*=\s*require\((['"])([^'"]+)\2\)/g)) {
    for (const part of m[1].split(',')) {
      const name = part.split(':')[0].trim();
      if (name) { out.push({ from: resolve(m[3]), name }); }
    }
  }
  for (const m of src.matchAll(/require\((['"])([^'"]+)\1\)\s*\.\s*([A-Za-z_$][\w$]*)/g)) {
    out.push({ from: resolve(m[2]), name: m[3] });
  }
  for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\((['"])([^'"]+)\2\)/g)) {
    for (const use of src.matchAll(new RegExp(`\\b${m[1].replace(/\$/g, '\\$')}\\s*\\.\\s*([A-Za-z_$][\\w$]*)`, 'g'))) {
      out.push({ from: resolve(m[3]), name: use[1] });
    }
  }
  return out;
}

describe('no stale importer of what unzip.js no longer exports (council round 4, A3)', () => {
  // `robustExtract` and unzip.js's `IDLE_MS` went with the removal, and a
  // destructured import of a missing export is `undefined`, not an error: a
  // stale importer stays silent until the day it calls it. The legitimate
  // IDLE_MS is zip-stall-bound.js's own, which zip-from-buffer.js imports.
  const UNZIP = path.join(ROOT, 'src', 'sidecar', 'unzip');
  const taken = [];
  for (const d of [...SHIPPED_DIRS, 'scripts']) {
    walkJs(path.join(ROOT, d), (file) => {
      const src = readIfPresent(file);
      if (src === null) { return; }
      for (const t of importedNames(file, src)) {
        taken.push({ ...t, file: path.relative(ROOT, file).split(path.sep).join('/') });
      }
    });
  }
  const fromUnzip = (t) => t.from === UNZIP || t.from === `${UNZIP}.js`;
  const said = (t) => `${t.file} takes ${t.name}`;

  it('sees what the live importers take from unzip.js (the scan is not blind)', () => {
    expect(taken.filter(fromUnzip).map(said)).toEqual(expect.arrayContaining([
      'src/sidecar/electron-native-rescue.js takes MAX_MS',
      'src/sidecar/zip-from-buffer.js takes UNSAFE_PATTERNS',
    ]));
    // ...and the legitimate IDLE_MS, which comes from zip-stall-bound.js.
    const idle = taken.filter((t) => t.name === 'IDLE_MS').map((t) => `${said(t)} from ${path.relative(ROOT, t.from).split(path.sep).join('/')}`);
    expect(idle).toContain('src/sidecar/zip-from-buffer.js takes IDLE_MS from src/sidecar/zip-stall-bound');
  });

  it('no file under src/, bin/, electron/ or scripts/ imports robustExtract, or IDLE_MS from unzip.js', () => {
    const stale = taken.filter((t) => t.name === 'robustExtract' || (t.name === 'IDLE_MS' && fromUnzip(t)));
    expect(stale.map(said)).toEqual([]);
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

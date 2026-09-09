#!/usr/bin/env node
'use strict';

/**
 * THE DARWIN BUNDLE PROBE — the one place amicus's REAL extract path meets a
 * real `.app` bundle, a real POSIX `fs.symlinkSync`, a real `fs.realpathSync`
 * and a real dyld. Driven by `.github/workflows/darwin-bundle.yml`; runnable by
 * hand on any Mac. It runs SHIPPED code (`src/sidecar/electron-install.js` ::
 * repairElectron and `src/sidecar/zip-from-buffer.js` :: extractZipBuffer), not
 * a reimplementation.
 *
 * WHY IT EXISTS, STATED HONESTLY. The v4.9.7 filing was that the v4.9.6
 * target-escape check (`src/sidecar/zip-entry-write.js` :: writeSymlink) could
 * REJECT a real darwin layout. That is REFUTED by measurement, not by this job:
 * the real electron-v43.1.1-darwin-arm64.zip central directory holds 585
 * records and 14 symlinks, every target relative, none carrying a `..`
 * component, none absolute, and 0 of 585 entry names traverse a symlinked
 * component — so the lexical test in `writeSymlink` cannot fire. What is STILL
 * unverified, and is what this probe is for, is narrower:
 *   1. a real `fs.symlinkSync` actually creating those 14 links, and the tree
 *      that results being a bundle dyld can load;
 *   2. the SYMLINKCHAIN control against a REAL filesystem — in the jest suite it
 *      is pinned by a `realpathSync` the test itself injects
 *      (tests/electron-custody.test.js, describe 'symlinks — the darwin .app
 *      shape, which cannot be run here'), which proves the rule against a
 *      surface its own writer wrote;
 *   3. the ABSOLUTE-target branch on POSIX arithmetic — on win32 `/etc/passwd`
 *      resolves to `C:\etc\passwd` and a DIFFERENT limb of the three-limb test
 *      catches it, so the Windows suite proves the wrong platform's branch;
 *   4. a FUTURE electron whose bundle layout changes.
 *
 * EVERY ASSERTION BELOW NAMES ITS MUTANT. An assertion that cannot fail is
 * worse than no assertion.
 *
 * IT FAILS, IT NEVER SKIPS. A missing precondition is a red, because a skipped
 * assertion reads as a pass.
 *
 * Usage:
 *   node scripts/probe-darwin-extract.js --preflight   # preconditions only
 *   node scripts/probe-darwin-extract.js               # the full run
 */

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { repairElectron, resolveElectronBinary, isElectronUsable, cachedZip } = require('../src/sidecar/electron-install');
const { resolveAnchor } = require('../src/sidecar/electron-trust');
const { extractZipBuffer } = require('../src/sidecar/zip-from-buffer');
const { buildZip, MODE_SYMLINK } = require('../tests/helpers/zip-fixture');

const IFMT = 0o170000;
const IFLNK = 0o120000;

function die(msg) {
  console.error(`probe-darwin-extract: ${msg}`);
  process.exit(1);
}

// ── preconditions ───────────────────────────────────────────────────────────
if (process.platform !== 'darwin') {
  die(`darwin only; got ${process.platform}. This probe asserts POSIX symlink and dyld behaviour.`);
}

let pkgDir;
try {
  pkgDir = path.dirname(require.resolve('electron/package.json'));
} catch {
  die('the `electron` package is not installed. `npm ci` installs it (it is an optionalDependency).');
}
const version = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8')).version;
const arch = process.arch;
const zip = cachedZip({ version, platform: 'darwin', arch });
const referenceDist = path.join(pkgDir, 'dist');

// electron@43 ships NO postinstall script (measured: its package.json has no
// `scripts` field at all, and package-lock.json carries no `hasInstallScript`
// for it), so `npm ci` NEVER downloads the binary. The workflow provisions it
// explicitly with `node node_modules/electron/install.js`. If that step was
// skipped or failed, say so here rather than letting A1/A4 be vacuous.
if (!zip) {
  die(`no cached electron artifact for v${version} (darwin-${arch}). Run \`node node_modules/electron/install.js\` first — `
    + '`npm ci` alone does NOT provision it (electron 43 has no postinstall).');
}
if (!fs.existsSync(path.join(referenceDist, 'Electron.app'))) {
  die(`no reference tree at ${referenceDist} — the A4 parity diff would be vacuous. Run `
    + '`node node_modules/electron/install.js` first.');
}
console.log(`electron v${version} darwin-${arch}`);
console.log(`  cached artifact : ${zip} (${fs.statSync(zip).size} bytes)`);
console.log(`  reference tree  : ${referenceDist}`);
if (process.argv.includes('--preflight')) {
  console.log('preflight OK');
  process.exit(0);
}

// ── helpers ─────────────────────────────────────────────────────────────────
function mkScratch(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `amicus-darwin-${tag}-`));
}

/** A scratch electron package dir: package.json + checksums.json, deliberately no dist/. */
function stageElectronDir(tag, { withChecksums = true } = {}) {
  const dir = mkScratch(tag);
  fs.copyFileSync(path.join(pkgDir, 'package.json'), path.join(dir, 'package.json'));
  if (withChecksums) {
    fs.copyFileSync(path.join(pkgDir, 'checksums.json'), path.join(dir, 'checksums.json'));
  }
  return dir;
}

/**
 * Raw central-directory read of the cached artifact: names, unix mode bits and,
 * for symlink entries, the STORED target bytes. Deliberately hand-rolled rather
 * than routed through amicus so the expectation for A3(a) does not come from the
 * code under test.
 */
function centralDirectory(file) {
  const buf = fs.readFileSync(file);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65557; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  assert.ok(eocd >= 0, 'no end-of-central-directory record in the cached artifact');
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOff = buf.readUInt32LE(eocd + 16);
  const out = [];
  let p = cdOff;
  while (p < cdOff + cdSize) {
    assert.strictEqual(buf.readUInt32LE(p), 0x02014b50, `bad central-directory signature at ${p}`);
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const mode = (buf.readUInt32LE(p + 38) >>> 16) & 0xffff;
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    let target = null;
    if ((mode & IFMT) === IFLNK && method === 0) {
      const start = localOff + 30 + buf.readUInt16LE(localOff + 26) + buf.readUInt16LE(localOff + 28);
      target = buf.slice(start, start + size).toString('utf8');
    }
    out.push({ name, mode, target });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Every path under `root`, relative and sorted, with its lstat facts. */
function walk(root) {
  const seen = new Map();
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    const abs = path.join(root, rel);
    const st = fs.lstatSync(abs);
    if (rel !== '') {
      seen.set(rel, {
        link: st.isSymbolicLink(),
        target: st.isSymbolicLink() ? fs.readlinkSync(abs) : null,
        size: st.isSymbolicLink() || st.isDirectory() ? null : st.size,
        exec: (st.mode & 0o111) !== 0,
        dir: st.isDirectory(),
      });
    }
    if (!st.isSymbolicLink() && st.isDirectory()) {
      for (const name of fs.readdirSync(abs)) { stack.push(path.join(rel, name)); }
    }
  }
  return seen;
}

const failures = [];
function check(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures.push(name);
    console.error(`  FAIL ${name}\n       ${(e && e.message) || e}`);
  }
}

(async () => {
  // ── A1 — the shipped cache route, offline, with the digest anchor UNDER TEST ─
  // `deps.selfElectronDir: null` disables resolveAnchor's rung 1
  // (src/sidecar/electron-trust.js :: resolveAnchor, whose docblock says exactly
  // that). Without it the anchor arrives from amicus's OWN
  // node_modules/electron/checksums.json no matter what the scratch dir holds,
  // and the negative half below could never fail — a rule reading a pin from a
  // surface it did not put under test.
  const scratch = stageElectronDir('pin');
  const anchor = resolveAnchor({ electronDir: scratch, selfElectronDir: null });
  // MUTANT: drop `selfElectronDir` from the repairElectron call below (or from
  // resolveAnchor's signature). The anchor then comes from the repo's own
  // node_modules and this equality goes red, naming the wiring that broke.
  check('A1a resolveAnchor(selfElectronDir:null) reads the checksums.json under test', () => {
    assert.ok(anchor, 'no anchor resolved from the scratch electronDir');
    assert.strictEqual(anchor.source, path.join(scratch, 'checksums.json'));
  });

  const pinned = await repairElectron({
    cacheOnly: true, electronDir: scratch, platform: 'darwin', arch, version,
    deps: { selfElectronDir: null },
  });
  // MUTANT: any change that stops verifyArtifactBytes returning 'verified' for a
  // byte-exact artifact — e.g. hashing the file path instead of the held bytes,
  // or dropping the anchor into the gate. The extract still succeeds and the exe
  // still runs, so A2/A5 stay green; only `unverified` moves.
  check('A1b repairElectron(cacheOnly) repairs AND the digest gate says verified', () => {
    assert.strictEqual(pinned.repaired, true, JSON.stringify(pinned));
    assert.ok(!pinned.unverified, `the digest anchor did not pin the artifact: ${JSON.stringify(pinned)}`);
  });

  // The negative half. This is what makes A1b's mutant LIVE: with no anchor at
  // all the same bytes must still extract, and must be MARKED.
  // MUTANT: make a missing anchor report a clean repair (drop the `verdict !==
  // 'verified'` mark in src/sidecar/electron-repair-cache.js) — a silent
  // degrade of the trust route, which this repo's north star rates as badly as
  // a crash.
  const noPin = await repairElectron({
    cacheOnly: true, electronDir: stageElectronDir('nopin', { withChecksums: false }),
    platform: 'darwin', arch, version, deps: { selfElectronDir: null },
  });
  check('A1c with NO anchor the same bytes extract but are MARKED unverified', () => {
    assert.strictEqual(noPin.repaired, true, JSON.stringify(noPin));
    assert.strictEqual(noPin.unverified, true, JSON.stringify(noPin));
  });

  // ── A2 — the resolver over the tree amicus just wrote ────────────────────────
  const exe = resolveElectronBinary({ electronDir: scratch, platform: 'darwin' });
  // MUTANT: change platformExe's darwin arm (src/sidecar/electron-exe-rel.js),
  // or have promoteDist write a path.txt that names a different basename.
  check('A2 resolveElectronBinary points at the real launcher, and it is executable', () => {
    assert.strictEqual(exe, path.join(scratch, 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron'));
    assert.ok(isElectronUsable({ electronDir: scratch, platform: 'darwin' }), 'isElectronUsable is false');
    const st = fs.lstatSync(exe);
    assert.ok(st.isFile(), 'the launcher is not a regular file');
    assert.ok(st.mode & 0o111, 'the exec bit did not survive extraction');
  });

  // ── A3 — the symlinks, two ways ─────────────────────────────────────────────
  const cd = centralDirectory(zip);
  const cdLinks = cd.filter((e) => (e.mode & IFMT) === IFLNK);
  const dist = path.join(scratch, 'dist');
  // (a) DERIVED from the archive. Broad, and shares the zip PARSER with the code
  // under test only in the sense that both read the same bytes — the decision
  // being asserted (symlink vs regular file, and the exact target) is amicus's.
  // MUTANT: delete the `if (symlink)` branch in zip-entry-write.js :: placeEntry
  // so links become regular files holding their target string; every readlink
  // below throws EINVAL.
  check(`A3a all ${cdLinks.length} archive symlinks are symlinks on disk with byte-identical targets`, () => {
    assert.ok(cdLinks.length > 0, 'the artifact declared no symlink entries — the whole lane is vacuous');
    for (const e of cdLinks) {
      const p = path.join(dist, e.name);
      assert.ok(fs.lstatSync(p).isSymbolicLink(), `${e.name} is not a symlink`);
      assert.strictEqual(fs.readlinkSync(p), e.target, `${e.name} target`);
    }
  });
  // (b) HARD-CODED. Shares nothing with the archive, so it goes loud if a future
  // electron drops the framework links entirely — which (a) would happily accept.
  // MUTANT: `fs.symlinkSync(path.resolve(canonical, target), dest)` in
  // writeSymlink — an ABSOLUTE link that still runs on the runner (A5 stays
  // green) and breaks the moment the tree is moved. Only readlink catches it.
  const FW = path.join(dist, 'Electron.app', 'Contents', 'Frameworks');
  const STRUCTURAL = [
    ['Electron Framework.framework/Electron Framework', 'Versions/Current/Electron Framework'],
    ['Electron Framework.framework/Versions/Current', 'A'],
    ['Mantle.framework/Versions/Current', 'A'],
    ['Squirrel.framework/Versions/Current', 'A'],
    ['ReactiveObjC.framework/Versions/Current', 'A'],
  ];
  check('A3b the five structural framework links exist with exactly their measured targets', () => {
    for (const [rel, target] of STRUCTURAL) {
      const p = path.join(FW, rel);
      assert.ok(fs.lstatSync(p).isSymbolicLink(), `${rel} is not a symlink`);
      assert.strictEqual(fs.readlinkSync(p), target, rel);
    }
  });

  // ── A4 — parity against the tree a DIFFERENT extractor produced ─────────────
  // REPORT-ONLY on its first cut, deliberately. `node_modules/electron/dist` was
  // written by @electron-internal/extract-zip (a native napi extractor —
  // node_modules/electron/install.js:5), and amicus has never compared itself
  // against its policy. Nothing has measured that the two agree on directory
  // modes under the runner's umask, or on zero-length directory entries. Making
  // an UNMEASURED comparison a blocking gate on day one buys a red for reasons
  // unrelated to symlinks. Promote it to `check(...)` once one clean run exists.
  // WHAT IT WOULD CATCH once promoted: a flat mode in extractedMode
  // (zip-entry-write.js), or a `continue` that silently drops entries — neither
  // of which an entry COUNT can distinguish from a changed artifact.
  const mine = walk(dist);
  const theirs = walk(referenceDist);
  const diff = [];
  for (const [rel, a] of mine) {
    const b = theirs.get(rel);
    if (!b) { diff.push(`only in amicus  : ${rel}`); continue; }
    if (a.link !== b.link) { diff.push(`link?  ${rel}: amicus=${a.link} reference=${b.link}`); }
    else if (a.link && a.target !== b.target) { diff.push(`target ${rel}: amicus=${a.target} reference=${b.target}`); }
    if (!a.link && a.size !== b.size) { diff.push(`size   ${rel}: amicus=${a.size} reference=${b.size}`); }
    if (!a.link && a.exec !== b.exec) { diff.push(`exec   ${rel}: amicus=${a.exec} reference=${b.exec}`); }
  }
  for (const rel of theirs.keys()) {
    if (!mine.has(rel)) { diff.push(`only in reference: ${rel}`); }
  }
  console.log(`  info A4 parity vs @electron-internal/extract-zip: amicus ${mine.size} paths, reference ${theirs.size} paths, ${diff.length} differences (REPORT-ONLY)`);
  for (const line of diff) { console.log(`       ${line}`); }

  // ── A5 — the assertion that actually traverses the links, through dyld ──────
  // The 33,968-byte launcher stub's Mach-O carries LC_RPATH
  // `@executable_path/../Frameworks` and LC_LOAD_DYLIB `@rpath/Electron
  // Framework.framework/Electron Framework`, so dyld resolves the ~192 MB
  // framework THROUGH two of the fourteen links. A missing, dangling or
  // regular-file link is a `Library not loaded` failure, not a silent pass.
  // (There are ZERO `_CodeSignature` entries in the archive, so `codesign
  // --verify` would assert nothing and is deliberately not run.)
  // MUTANT: same as A3a — links written as regular files. This is the only
  // assertion here that no Windows probe can even approximate.
  check('A5 the extracted bundle RUNS: Electron --version loads the framework through the links', () => {
    const out = execFileSync(exe, ['--version'], { encoding: 'utf8', timeout: 60_000 }).trim();
    assert.strictEqual(out, `v${version}`, out);
  });

  // ── A6 — the adversarial half, on a REAL filesystem, no injected fs ─────────
  // `extra` runs inside the same check, with the refusal and the real root.
  async function refuses(name, entries, extra) {
    const root = fs.realpathSync(mkScratch('adv'));
    const err = await extractZipBuffer(buildZip(entries), { dir: root }).catch((e) => e);
    check(name, () => {
      assert.strictEqual(err && err.code, 'UNZIP_UNSAFE_ARCHIVE', `got ${err && (err.code || err.message)}`);
      assert.match(err.message, /^Out of bound path /);
      // Nothing was created before the refusal — the jest suite's
      // `expect(links).toEqual([])`, here against a real filesystem.
      const made = [...walk(root)].filter(([, v]) => v.link);
      assert.strictEqual(made.length, 0, `links created before the refusal: ${made.map(([k]) => k).join(', ')}`);
      if (extra) { extra(err, root); }
    });
  }

  // MUTANT: drop the `rel === '..'` / `rel.startsWith('..' + path.sep)` limbs
  // from the three-limb test in writeSymlink.
  await refuses('A6i an escaping relative target is REFUSED and nothing is planted', [
    { name: 'Electron.app/Contents/Frameworks/Evil.framework/Bad', body: '../../../../../../victim', mode: MODE_SYMLINK },
  ], (err) => {
    // The message quotes the RESOLVED absolute path — six levels above the
    // entry's directory, i.e. well outside `root`. Nothing may be there.
    const named = /^Out of bound path "([^"]+)"/.exec(err.message);
    assert.ok(named, 'the refusal did not name a resolved path');
    assert.ok(!fs.existsSync(named[1]), `the refused path was planted: ${named[1]}`);
  });

  // MUTANT: drop the `startsWith('..' + path.sep)` limb specifically. On win32
  // `/etc/passwd` becomes `C:\etc\passwd` and a different limb catches it, so
  // the Windows suite proves the wrong arithmetic. This is the POSIX branch.
  // (No "does it exist" check here: on darwin the refusal names /etc/passwd,
  // which of course exists — what matters is that no LINK was created to it.)
  await refuses('A6ii an ABSOLUTE POSIX target is REFUSED (the branch win32 cannot prove)', [
    { name: 'Electron.app/Contents/link', body: '/etc/passwd', mode: MODE_SYMLINK },
  ]);

  // The SYMLINKCHAIN control, with REAL links and a REAL realpath. In the jest
  // suite the chain is planted in an INJECTED realpathSync; here the three `.`
  // links exist on disk and the kernel answers.
  // MUTANT: revert `path.resolve(canonical, target)` to
  // `path.resolve(path.dirname(dest), target)` in writeSymlink — the
  // lexical-dirname bug its own docblock records as extracting with NO error and
  // planting a link outside the root.
  const chainDir = mkScratch('chain');
  const chainRoot = fs.realpathSync(chainDir);
  const chainErr = await extractZipBuffer(buildZip([
    { name: 'L0', body: '.', mode: MODE_SYMLINK },
    { name: 'L0/L1', body: '.', mode: MODE_SYMLINK },
    { name: 'L0/L1/L2', body: '.', mode: MODE_SYMLINK },
    { name: 'L0/L1/L2/x', body: '../../../victim.txt', mode: MODE_SYMLINK },
  ]), { dir: chainRoot }).catch((e) => e);
  check('A6iii SYMLINKCHAIN is refused by a REAL realpath: 3 links created, no victim', () => {
    assert.strictEqual(chainErr && chainErr.code, 'UNZIP_UNSAFE_ARCHIVE', `got ${chainErr && (chainErr.code || chainErr.message)}`);
    assert.match(chainErr.message, /L0\/L1\/L2\/x$/);
    // The three `.` links are legitimate (they resolve to the root itself);
    // only the escaping fourth is refused, and it was never created. Because
    // each `.` link makes realpath answer `root`, all three land in the root as
    // L0/L1/L2 — walk() does not follow links, so this cannot loop.
    const links = [...walk(chainRoot)].filter(([, v]) => v.link);
    assert.strictEqual(links.length, 3, `expected 3 links, got ${links.map(([k]) => k).join(', ')}`);
    assert.ok(links.every(([, v]) => v.target === '.'), 'a chain link carries the wrong target');
    // The victim resolves THREE levels above the root, not one — take the path
    // the refusal itself names rather than guessing at the depth.
    const named = /^Out of bound path "([^"]+)"/.exec(chainErr.message);
    assert.ok(named, 'the refusal did not name a resolved path');
    assert.ok(!fs.existsSync(named[1]), `victim.txt was planted: ${named[1]}`);
  });

  if (failures.length) {
    console.error(`\nprobe-darwin-extract: ${failures.length} FAILED — ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log(`\nprobe-darwin-extract: OK — electron v${version} darwin-${arch}, ${cdLinks.length} symlinks verified end to end`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `### Darwin bundle extract\n\n- electron **v${version}** \`darwin-${arch}\`\n`
      + `- ${cdLinks.length} symlinks created and read back byte-identically\n`
      + '- `Electron --version` loaded the framework through the links\n'
      + `- A4 parity vs \`@electron-internal/extract-zip\`: ${diff.length} differences (report-only)\n`);
  }
})().catch((e) => { console.error(e); process.exit(1); });

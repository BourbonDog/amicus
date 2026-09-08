// tests/electron-artifact-custody.test.js
'use strict';

/**
 * CUSTODY, WIRED — the bytes that were read are the bytes that were hashed are
 * the bytes that were written, on BOTH routes.
 *
 * tests/electron-custody.test.js pins the primitives (one read, one buffer, the
 * extractor, the promote). This suite pins the two places they are load-bearing,
 * because a control nobody calls is a control that does not exist.
 *
 * ── THE THREE REMEDIES THIS FILE HAS OUTLIVED ─────────────────────────────
 * v4.9.5 hashed the cache path and re-opened it for the extract; three council
 * seats found the swap window independently.
 *   1. RENAME into a private directory. Refuted: a rename moves a directory
 *      ENTRY, not an inode, so a hard link, a symlink or a retained descriptor
 *      all still name the file amicus staged. Measured end to end.
 *   2. COPY into a private 0700 directory. Refuted (council run 34165289952
 *      seat D1, confirmed 4 of 4): the attacker is the SAME USER, the prefix is
 *      fixed and the parent is world-listed, so the copy is found on the first
 *      readdir and opened `r+`. On Windows the 0700 was never even attempted.
 *   3. A RETAINED FILE DESCRIPTOR. Refuted by two independent probes before it
 *      was ever built: a descriptor names an inode, and a same-uid
 *      `writeFileSync` at the path rewrites that inode in place, visible through
 *      our own fd.
 * What is left is not a better hiding place. It is not having a file: the bytes
 * are read once into a Buffer and never re-derived from a name again.
 *
 * The property certified here, and the only one claimed:
 *   **Amicus never itself writes, or reports as verified, bytes it did not hash.**
 * NOT "the user launches genuine Electron" — a live same-uid attacker can
 * overwrite `<electronDir>/dist/electron.exe` directly, and no acquisition-time
 * design can promise otherwise.
 *
 * ── NAMED MUTANTS ─────────────────────────────────────────────────────────
 * Each is a ONE-LINE sabotage, applied and reverted by BYTE COPY (never
 * `git checkout --`), MEASURED against the named test.
 *
 * BUFFERREREAD     electron-repair-cache.js :: repairFromCache — extract from a
 *   re-read of the path (`fs.readFileSync(zip)`) instead of the held Buffer.
 *   RED: "the bytes EXTRACTED are the bytes that were READ".
 * HASHNOTBUFFER    electron-repair-cache.js :: repairFromCache — hash the PATH
 *   (`sha256(fs.readFileSync(zip))`) while still extracting the Buffer.
 *   RED: "the bytes HASHED are the bytes that were READ".
 * PROMOTEWITHOUTVERIFY  electron-repair-cache.js :: repairFromCache — drop the
 *   `if (!gate.allowed)` refusal, so a contradicted artifact is extracted.
 *   RED: "a MISMATCHING cached artifact never reaches dist/".
 * DOWNLOADUNHASHED electron-provision.js :: controlledProvision — drop its
 *   `if (!gate.allowed)` refusal.
 *   RED: "the DOWNLOAD route hashes what it is about to extract".
 * UNREADABLEEXTRACTED electron-provision.js :: controlledProvision — replace the
 *   `if (!held.bytes)` refusal with a re-read of the path.
 *   RED: "a download that cannot be READ is REFUSED, never extracted anyway".
 * NAMEUNCHECKED    electron-custody.js :: isSafeArtifactName — `return true`.
 *   RED: "an artifact NAME that is not a plain filename never becomes a path".
 * CORRUPTNOTEVICTED electron-repair-cache.js — delete the `fs.rmSync(zip, ...)`
 *   on the bad-archive branch.
 *   RED: "a corrupt cached artifact is EVICTED, and the reason says so".
 * DESTFAILUREEVICTS electron-repair-cache.js — invert the eviction rule back to
 *   an allow-list of codes that KEEP (`UNZIP_DEST_FAILED`,
 *   `UNZIP_BUFFER_UNAVAILABLE`), so anything unclassified evicts.
 *   RED: "a DESTINATION failure leaves the cached artifact alone (D2)", "an
 *   extractor that will not LOAD is a refusal, not an eviction", "a PROMOTE
 *   failure does not evict the cached artifact either", and "an extract failure
 *   amicus cannot CLASSIFY keeps the artifact (D2, fail-closed)".
 * PROMOTEEVICTS   electron-layout.js :: extractBytesToDist — drop the
 *   `destinationFailure` wrapper around `promoteDist`, so a raw EPERM reaches
 *   the caller untagged and is read as a corrupt archive.
 *   RED: "a PROMOTE failure does not evict the cached artifact either".
 * ──────────────────────────────────────────────────────────────────────────
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ei = require('../src/sidecar/electron-install');
const { isSafeArtifactName } = require('../src/sidecar/electron-custody');
const { fakeElectronDir, SELF_ANCHOR_OFF, ZIP_BODY } = require('./helpers/fake-electron-dir');

const VERSION = '43.1.1';
const PLATFORM = 'win32';
const ARCH = 'x64';
const ZIP_NAME = `electron-v${VERSION}-${PLATFORM}-${ARCH}.zip`;
const POISON = 'POISONED-BYTES';

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** A zip at <root>/<sha>/<ZIP_NAME>, the @electron/get cache layout. */
function writeZip({ body = ZIP_BODY, name = ZIP_NAME, root = mkTmp('amicus-zip-') } = {}) {
  const shaDir = path.join(root, 'a'.repeat(16));
  fs.mkdirSync(shaDir, { recursive: true });
  const zip = path.join(shaDir, name);
  fs.writeFileSync(zip, body);
  return zip;
}

/** A fake electron package with NO checksums.json — nothing anchors its artifact. */
function unanchoredElectronDir() {
  const made = fakeElectronDir({ withExe: false, platform: PLATFORM });
  fs.rmSync(path.join(made.dir, 'checksums.json'));
  return made;
}

/** repairElectron with every leaf injected. `extract` may be overridden. */
async function repair({ dir, zip, cacheOnly = true, deps = {}, extract, ...rest }) {
  return ei.repairElectron({
    cacheOnly,
    electronDir: dir,
    platform: PLATFORM,
    version: VERSION,
    arch: ARCH,
    ...rest,
    deps: {
      ...SELF_ANCHOR_OFF,
      cachedZip: () => zip,
      extract,
      spawn: jest.fn(),
      acquireLock: () => ({ release: () => {} }),
      ...deps,
    },
  });
}

/**
 * A same-uid attacker who writes `zip` the moment amicus lets go of it — the
 * exact window every previous remedy left open. The hook is on `closeSync`,
 * which fires after `readArtifactBytes` has the whole artifact in memory and
 * before the gate has hashed anything.
 */
function poisoningFs(zip, fired = { hit: false }) {
  return {
    ...fs,
    closeSync: (fd) => {
      const out = fs.closeSync(fd);
      if (!fired.hit) { fired.hit = true; fs.writeFileSync(zip, POISON); }
      return out;
    },
  };
}

let stderrSpy;
let savedCache;
beforeEach(() => {
  stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  savedCache = process.env.ELECTRON_CACHE;
});
afterEach(() => {
  stderrSpy.mockRestore();
  if (savedCache === undefined) { delete process.env.ELECTRON_CACHE; } else { process.env.ELECTRON_CACHE = savedCache; }
});

describe('the bytes read, hashed and written are one and the same', () => {
  test('the bytes EXTRACTED are the bytes that were READ (BUFFERREREAD)', async () => {
    const cacheRoot = mkTmp('amicus-cacheroot-');
    process.env.ELECTRON_CACHE = cacheRoot;
    const zip = writeZip({ root: cacheRoot });            // GOOD bytes, matching the anchor
    const { dir, exeName } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const fired = { hit: false };

    let sawBytes = null;
    const extract = jest.fn(async (bytes, o) => {
      sawBytes = bytes.toString('utf8');
      fs.writeFileSync(path.join(o.dir, exeName), 'MZextracted');
    });

    const res = await repair({ dir, zip, extract, deps: { fs: poisoningFs(zip, fired) } });

    expect(fired.hit).toBe(true);                          // the race really fired
    expect(Buffer.isBuffer(extract.mock.calls[0][0])).toBe(true);
    expect(sawBytes).toBe(ZIP_BODY);                       // ...and the swap lost
    expect(fs.readFileSync(zip, 'utf8')).toBe(POISON);     // the attacker DID write the file
    expect(res.repaired).toBe(true);
  });

  test('the bytes HASHED are the bytes that were READ (HASHNOTBUFFER)', async () => {
    // The other half of the same window. If the gate re-derived the bytes from
    // the name it would hash the attacker's poison and REFUSE a good artifact —
    // a denial of service handed to the attacker for free, and a verdict that
    // describes bytes nobody was going to extract.
    const cacheRoot = mkTmp('amicus-cacheroot-');
    process.env.ELECTRON_CACHE = cacheRoot;
    const zip = writeZip({ root: cacheRoot });
    const { dir, exeName } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const extract = jest.fn(async (_b, o) => { fs.writeFileSync(path.join(o.dir, exeName), 'MZextracted'); });

    const res = await repair({ dir, zip, extract, deps: { fs: poisoningFs(zip) } });

    expect(res.repaired).toBe(true);
    expect(res.integrity).toBeUndefined();                 // verified, not 'mismatch'
    expect(res.unverified).toBeUndefined();
  });

  test('a MISMATCHING cached artifact never reaches dist/ (PROMOTEWITHOUTVERIFY)', async () => {
    const cacheRoot = mkTmp('amicus-cacheroot-');
    process.env.ELECTRON_CACHE = cacheRoot;
    const zip = writeZip({ body: POISON, root: cacheRoot });
    const { dir, exeName, distDir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const extract = jest.fn(async (_b, o) => { fs.writeFileSync(path.join(o.dir, exeName), 'MZextracted'); });

    const res = await repair({ dir, zip, extract });

    expect(extract).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(distDir, exeName))).toBe(false);
    expect(res.repaired).toBe(false);
    expect(res.integrity).toBe('mismatch');
    // ...and no incoming directory is left behind for a later run to promote.
    expect(fs.readdirSync(dir).filter((n) => n.startsWith('.amicus-incoming-'))).toEqual([]);
  });

  test('a hard link the attacker KEEPS reaches nothing, because there is no second read', async () => {
    // The probe that killed remedy 1, as a test. The attacker plants the cache
    // entry as a hard link to a file of their own — with GENUINE bytes, so the
    // digest gate is happy — and writes through THEIR name afterwards. Under a
    // rename the staged path and `mine` were the same file; under a copy the copy
    // was still openable; under a Buffer there is nothing left to write to.
    const cacheRoot = mkTmp('amicus-cacheroot-');
    process.env.ELECTRON_CACHE = cacheRoot;
    const mine = path.join(mkTmp('amicus-attacker-'), 'mine.zip');
    fs.writeFileSync(mine, ZIP_BODY);
    const shaDir = path.join(cacheRoot, 'a'.repeat(16));
    fs.mkdirSync(shaDir, { recursive: true });
    const zip = path.join(shaDir, ZIP_NAME);
    fs.linkSync(mine, zip);
    expect(fs.statSync(zip).nlink).toBe(2);                // the second name really exists

    const { dir, exeName } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    let sawBytes = null;
    const extract = jest.fn(async (bytes, o) => {
      fs.writeFileSync(mine, POISON);                      // written through the RETAINED name
      sawBytes = bytes.toString('utf8');
      fs.writeFileSync(path.join(o.dir, exeName), 'MZextracted');
    });

    const res = await repair({ dir, zip, extract });

    expect(sawBytes).toBe(ZIP_BODY);
    expect(res.repaired).toBe(true);
  });
});

describe('F#3 — an artifact NAME is never trusted with a path', () => {
  test('an artifact NAME that is not a plain filename never becomes a path (NAMEUNCHECKED)', async () => {
    // `version` comes out of <electronDir>/package.json whenever the caller passes
    // none — and `doctor --fix`, the one production caller, passes none for a
    // directory it found by SCANNING npx caches. MEASURED before the check: a
    // planted "43.1.1/../../victim" wrote <tmp>/victim-win32-x64.zip, two levels
    // outside the intended directory, destroying whatever was there.
    const badVersion = '43.1.1/../../victim';
    const { dir } = fakeElectronDir({ withExe: false, platform: PLATFORM, version: badVersion });
    const victim = path.join(os.tmpdir(), `victim-${PLATFORM}-${ARCH}.zip`);
    fs.writeFileSync(victim, 'PRECIOUS');
    const zip = writeZip({ name: 'planted.zip' });
    const extract = jest.fn();

    const res = await ei.repairElectron({
      cacheOnly: true,
      electronDir: dir,
      platform: PLATFORM,
      arch: ARCH,                                   // no `version` — read from the dir
      deps: {
        ...SELF_ANCHOR_OFF, cachedZip: () => zip, extract, spawn: jest.fn(), acquireLock: () => ({ release: () => {} }),
      },
    });

    expect(extract).not.toHaveBeenCalled();
    expect(res.integrity).toBe('unsafe-name');
    expect(res.repaired).toBe(false);
    expect(fs.readFileSync(victim, 'utf8')).toBe('PRECIOUS');
    fs.rmSync(victim, { force: true });
  });

  test('isSafeArtifactName is an ALLOW-list, not a `..` deny-list', () => {
    expect(isSafeArtifactName(ZIP_NAME)).toBe(true);
    expect(isSafeArtifactName('electron-v43.1.1-beta.3-linux-arm64.zip')).toBe(true);
    for (const bad of [
      'electron-v43.1.1/../../victim-win32-x64.zip',
      'electron-v../x-win32-x64.zip',
      'electron-v43.1.1-win32-x64.zip/..',
      '../electron-v43.1.1-win32-x64.zip',
      'electron-v43.1.1-win32-x64.tar.gz',
      'electron-v43.1.1-win32-x64.zip .txt',
      '', null, undefined, 42,
    ]) {
      expect(isSafeArtifactName(bad)).toBe(false);
    }
    // win32 splits on backslash too; the pattern rejects it on every platform.
    expect(isSafeArtifactName('sub\\electron-v43.1.1-win32-x64.zip')).toBe(false);
  });
});

describe('F#2 — the DOWNLOAD route hashes what it extracts', () => {
  test('the DOWNLOAD route hashes what it is about to extract (DOWNLOADUNHASHED)', async () => {
    // @electron/get validated the bytes in its own temp dir and then moved them
    // into the cache root, so the path it returns is one the cache-dir writer
    // controls. Here the mirror simply served bytes the anchor contradicts.
    const { dir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const extract = jest.fn();
    const downloadArtifact = jest.fn(async () => writeZip({ body: POISON }));

    const res = await repair({ dir, zip: null, extract, cacheOnly: false, deps: { downloadArtifact } });

    expect(downloadArtifact).toHaveBeenCalledTimes(1);
    expect(extract).not.toHaveBeenCalled();
    expect(res.repaired).toBe(false);
    expect(res.integrity).toBe('mismatch');
    expect(res.reason).toMatch(/Downloaded electron artifact .* was REFUSED/);
  });

  test('a swap in the post-download window loses, because the bytes were already read', async () => {
    const cacheRoot = mkTmp('amicus-cacheroot-');
    process.env.ELECTRON_CACHE = cacheRoot;
    const { dir, exeName } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const dlZip = writeZip({ root: cacheRoot });

    let sawBytes = null;
    const extract = jest.fn(async (bytes, o) => {
      sawBytes = bytes.toString('utf8');
      fs.writeFileSync(path.join(o.dir, exeName), 'MZdownloaded');
    });

    const res = await repair({
      dir,
      zip: null,
      extract,
      cacheOnly: false,
      deps: { fs: poisoningFs(dlZip), downloadArtifact: jest.fn(async () => dlZip) },
    });

    expect(sawBytes).toBe(ZIP_BODY);
    expect(fs.readFileSync(dlZip, 'utf8')).toBe(POISON);   // the swap really happened
    expect(res.repaired).toBe(true);
  });

  test('the DOWNLOAD route leaves the fresh artifact in the cache', async () => {
    const { dir, exeName } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const dlZip = writeZip();
    const extract = jest.fn(async (_b, o) => { fs.writeFileSync(path.join(o.dir, exeName), 'MZdownloaded'); });

    const res = await repair({
      dir, zip: null, extract, cacheOnly: false, deps: { downloadArtifact: jest.fn(async () => dlZip) },
    });

    expect(res.repaired).toBe(true);
    expect(fs.readFileSync(dlZip, 'utf8')).toBe(ZIP_BODY);    // cache left whole
  });
});

describe('bytes that could not be READ are never extracted', () => {
  test('the CACHE route refuses, and says so with an integrity mark', async () => {
    const zip = writeZip();
    const { dir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const unreadableFs = { ...fs, openSync: () => { const e = new Error('EACCES'); e.code = 'EACCES'; throw e; } };
    const extract = jest.fn();

    const res = await repair({ dir, zip, extract, deps: { fs: unreadableFs } });

    expect(extract).not.toHaveBeenCalled();
    expect(res.repaired).toBe(false);
    expect(res.integrity).toBe('unreadable');
    expect(res.reason).toMatch(/could not be opened or read at all/);
    expect(fs.existsSync(zip)).toBe(true);          // the user still has the artifact
  });

  test('a download that cannot be READ is REFUSED, never extracted anyway (UNREADABLEEXTRACTED)', async () => {
    const { dir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const unreadableFs = { ...fs, openSync: () => { throw new Error('EACCES'); } };
    const dlZip = writeZip();
    const extract = jest.fn();

    const res = await repair({
      dir, zip: null, extract, cacheOnly: false, deps: { fs: unreadableFs, downloadArtifact: jest.fn(async () => dlZip) },
    });

    expect(extract).not.toHaveBeenCalled();
    expect(res.repaired).toBe(false);
    expect(res.integrity).toBe('unreadable');
  });

  test('BOTH refusals are carried, even when they share an integrity class (A4/D4)', async () => {
    // The council finding: deduplicating by `integrity` dropped the cache
    // refusal whenever the download failed the same way — so TWO mismatches, the
    // most alarming pair this code can observe, reported only the second and
    // never said the cached artifact had also been refused and deleted.
    const cacheRoot = mkTmp('amicus-cacheroot-');
    process.env.ELECTRON_CACHE = cacheRoot;
    const { dir } = fakeElectronDir({ withExe: false, platform: PLATFORM });

    const res = await repair({
      dir,
      zip: writeZip({ body: POISON, root: cacheRoot }),
      extract: jest.fn(),
      cacheOnly: false,
      deps: { downloadArtifact: jest.fn(async () => writeZip({ body: 'ALSO-WRONG' })) },
    });

    expect(res.integrity).toBe('mismatch');
    expect(res.reason).toMatch(/Cached electron artifact .* was REFUSED/);
    expect(res.reason).toMatch(/Downloaded electron artifact .* was REFUSED/);
  });
});

describe('nobody ends up with neither a cached artifact nor a dist', () => {
  test('the cache entry is STILL THERE while the extract runs — a kill cannot lose it', async () => {
    const zip = writeZip();
    const { dir, exeName, distDir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    let cachedDuringExtract = null;
    const extract = jest.fn(async (_b, o) => {
      cachedDuringExtract = fs.existsSync(zip) && fs.readFileSync(zip, 'utf8');
      fs.writeFileSync(path.join(o.dir, exeName), 'MZextracted');
    });

    const res = await repair({ dir, zip, extract });

    expect(cachedDuringExtract).toBe(ZIP_BODY);
    expect(res.repaired).toBe(true);
    expect(fs.existsSync(path.join(distDir, exeName))).toBe(true);   // a dist...
    expect(fs.readFileSync(zip, 'utf8')).toBe(ZIP_BODY);             // ...AND the cache entry
    // ...and nothing stranded anywhere: no temp copy is ever made now.
    expect(fs.readdirSync(dir).filter((n) => n.startsWith('.amicus-'))).toEqual([]);
  });

  test('an UNSAFE archive is left in place — a refused archive is the evidence', async () => {
    const zip = writeZip();
    const { dir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const extract = jest.fn(async () => {
      const e = new Error('refusing to extract cached.zip: invalid relative path: ../../evil');
      e.code = 'UNZIP_UNSAFE_ARCHIVE';
      throw e;
    });

    const res = await repair({ dir, zip, extract });

    expect(res.integrity).toBe('unsafe-archive');
    expect(fs.readFileSync(zip, 'utf8')).toBe(ZIP_BODY);
  });

  test('a DESTINATION failure leaves the cached artifact alone (D2) (DESTFAILUREEVICTS)', async () => {
    // The council finding, exactly: the old code evicted the cache entry on ANY
    // extract failure, so a full disk destroyed a pristine artifact — worst case
    // on an air-gapped run with nothing to re-download from. Only a BAD ARCHIVE
    // is evidence about the artifact.
    const { dir } = unanchoredElectronDir();
    const zip = writeZip();
    const extract = jest.fn(async () => {
      const e = new Error('could not write electron.exe: ENOSPC: no space left on device');
      e.code = 'UNZIP_DEST_FAILED';
      throw e;
    });

    const res = await repair({ dir, zip, extract });

    expect(fs.readFileSync(zip, 'utf8')).toBe(ZIP_BODY);      // still there, byte for byte
    expect(res.repaired).toBe(false);
    expect(res.integrity).toBe('extract-failed');
    expect(res.reason).toMatch(/LEFT IN PLACE/);
    expect(res.reason).not.toMatch(/corrupt/i);
  });

  test('a PROMOTE failure does not evict the cached artifact either (PROMOTEEVICTS)', async () => {
    // FOUND BY PROBING MY OWN CHANGE, not by the council. The extraction now
    // lands in `.amicus-incoming-<hex>` and is promoted into `dist/` by rename —
    // and a rename can fail (a Windows handle held on the live dist/). MEASURED
    // before this fix: the raw EPERM propagated out untagged, repairFromCache
    // read "an extract failure I cannot classify" as "the archive is bad", and
    // DELETED the cache entry while saying it "was corrupt and removed". Same
    // shape as D2, one function further along.
    const { dir } = unanchoredElectronDir();
    const zip = writeZip();
    const brokenRename = {
      ...fs,
      renameSync: () => { const e = new Error('EPERM: operation not permitted, rename'); e.code = 'EPERM'; throw e; },
    };
    const extract = jest.fn(async (_b, o) => { fs.writeFileSync(path.join(o.dir, 'electron.exe'), 'MZ'); });

    const res = await repair({ dir, zip, extract, deps: { fs: brokenRename } });

    expect(extract).toHaveBeenCalledTimes(1);              // the archive was FINE
    expect(fs.readFileSync(zip, 'utf8')).toBe(ZIP_BODY);   // ...so it is still there
    expect(res.integrity).toBe('extract-failed');
    expect(res.reason).toMatch(/could not promote the extracted tree into dist/);
    expect(res.reason).not.toMatch(/corrupt/i);
  });

  test('an extract failure amicus cannot CLASSIFY keeps the artifact (D2, fail-closed)', async () => {
    // MEASURED on the first answer to D2: its protection was a two-entry
    // allow-list of codes that KEEP, so every shape nobody enumerated fell open
    // toward deletion. An extractor throwing a plain `Error` with no `code` (an
    // internal bug) and one throwing a raw Node `ENOSPC` BOTH ended with the
    // artifact DELETED and the user told it "was corrupt and removed". The rule
    // is now inverted: only a positively-identified bad archive is removed.
    for (const thrown of [
      new Error('an internal bug with no code at all'),
      Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' }),
      Object.assign(new Error('no progress for 30000ms'), { code: 'UNZIP_BUFFER_STALLED' }),
    ]) {
      const { dir } = unanchoredElectronDir();
      const zip = writeZip();
      const extract = jest.fn(async () => { throw thrown; });

      const res = await repair({ dir, zip, extract });

      expect(fs.readFileSync(zip, 'utf8')).toBe(ZIP_BODY);   // still there, byte for byte
      expect(res.integrity).toBe('extract-failed');
      expect(res.reason).toMatch(/LEFT IN PLACE/);
      expect(res.reason).not.toMatch(/corrupt/i);
    }
  });

  test('an extractor that will not LOAD is a refusal, not an eviction (YAUZLUNDECLARED)', async () => {
    // `yauzl` is a declared dependency, so this should be unreachable — and
    // unzip.js:215-222 records the v4.5.2 outage that happened the last time a
    // zip library "should have been" resolvable. What must never happen is that
    // a hoisting surprise DELETES the user's only artifact on its way out.
    const { dir } = unanchoredElectronDir();
    const zip = writeZip();
    const extract = jest.fn(async () => {
      const e = new Error('the in-memory zip extractor is unavailable: Cannot find module');
      e.code = 'UNZIP_BUFFER_UNAVAILABLE';
      throw e;
    });

    const res = await repair({ dir, zip, extract });

    expect(fs.readFileSync(zip, 'utf8')).toBe(ZIP_BODY);
    expect(res.integrity).toBe('extract-failed');
  });

  test('a mismatch the FENCE refuses to delete is left in place, bytes intact', async () => {
    process.env.ELECTRON_CACHE = mkTmp('amicus-cacheroot-');
    const zip = writeZip({ body: POISON, root: mkTmp('amicus-elsewhere-') });   // outside every root
    const { dir } = fakeElectronDir({ withExe: false, platform: PLATFORM });

    const res = await repair({ dir, zip, extract: jest.fn() });

    expect(res.integrity).toBe('mismatch');
    expect(res.reason).toMatch(/left in place/i);
    expect(fs.readFileSync(zip, 'utf8')).toBe(POISON);
  });

  test('a mismatch the fence ALLOWS is gone from the cache and left nowhere else', async () => {
    const cacheRoot = mkTmp('amicus-cacheroot-');
    process.env.ELECTRON_CACHE = cacheRoot;
    const zip = writeZip({ body: POISON, root: cacheRoot });
    const { dir } = fakeElectronDir({ withExe: false, platform: PLATFORM });

    const res = await repair({ dir, zip, extract: jest.fn() });

    expect(res.reason).toMatch(/removed/i);
    expect(fs.existsSync(zip)).toBe(false);
    // ...and not sitting in a copy anywhere either, because nothing copies.
    expect(fs.readdirSync(dir).filter((n) => n.startsWith('.amicus-'))).toEqual([]);
  });
});

describe('F#4/F#5 — a corrupt cached artifact is actually evicted', () => {
  test('a corrupt cached artifact is EVICTED, and the reason says so (CORRUPTNOTEVICTED)', async () => {
    const { dir } = unanchoredElectronDir();
    const zip = writeZip({ body: 'CORRUPT' });
    const extract = jest.fn(async () => {
      const e = new Error('end of central directory record signature not found');
      e.code = 'UNZIP_BUFFER_FAILED';
      throw e;
    });

    const res = await repair({ dir, zip, extract });

    expect(res.repaired).toBe(false);
    expect(res.reason).toMatch(/was corrupt and removed/);
    expect(fs.existsSync(zip)).toBe(false);
  });

  test('when the eviction FAILS, the reason says "left in place" rather than lying', async () => {
    const { dir } = unanchoredElectronDir();
    const zip = writeZip({ body: 'CORRUPT' });
    const readOnlyFs = { ...fs, rmSync: (p, o) => { if (p === zip) { throw new Error('EPERM'); } return fs.rmSync(p, o); } };
    const extract = jest.fn(async () => {
      const e = new Error('end of central directory record signature not found');
      e.code = 'UNZIP_BUFFER_FAILED';
      throw e;
    });

    const res = await repair({ dir, zip, extract, deps: { fs: readOnlyFs } });

    expect(res.reason).toMatch(/was corrupt and left in place/);
    expect(fs.existsSync(zip)).toBe(true);
  });
});

describe('the REFUSAL text may only claim what this design still does (STAGINGCLAIMBACK)', () => {
  // The blocker: `rejectDownloadedZip` still told the user "amicus hashes what
  // it downloaded, in a directory only it can write, before extracting it" — a
  // containment control DELETED in this same PR, because the council MEASURED
  // its privacy claim false (mkdtempSync yields mode 666 on Windows and
  // electron-stage.js skipped its chmod(0o700) on win32; a spinner found the
  // fixed `amicus-electron-stage-` prefix on its FIRST readdir). The commit that
  // set out to "stop the docs describing a copy" fixed the .md files and missed
  // this string, which is what a user actually reads on the one screen amicus
  // prints when it is telling them something is wrong. Nothing pinned it, so
  // nothing caught it.
  //
  // This is the exact overclaim class the certified property exists to stop —
  //   **Amicus never itself writes, or reports as verified, bytes it did not hash.**
  // — printed by the refusal path itself.
  // eslint-disable-next-line global-require
  const { rejectDownloadedZip } = require('../src/sidecar/electron-refuse');

  test('the DOWNLOAD refusal describes the buffer, and claims no private directory', () => {
    const lines = [];
    const out = rejectDownloadedZip({
      gate: { verdict: 'mismatch', actual: 'a'.repeat(64), expected: 'b'.repeat(64) },
      fileName: ZIP_NAME,
      log: (m) => lines.push(String(m)),
    });
    const text = lines.join(' ');

    expect(text).toMatch(/DOWNLOADED electron artifact REFUSED/);
    expect(text).toMatch(/read these bytes ONCE, into its own memory/);
    expect(text).toMatch(/no copy on disk and no path in play/);
    expect(text).toMatch(/NOT extracted/);
    // The retracted claims, in the words that were on screen.
    expect(text).not.toMatch(/directory only it can write/);
    expect(text).not.toMatch(/private directory/i);
    expect(out.reason).toMatch(/was REFUSED/);
  });

  test('NOTHING amicus ships still claims the deleted private staging directory', () => {
    // The generic guard, because the specific string above is the SECOND place
    // this claim survived the deletion of the thing it described. Anything
    // shipped — code, scripts, docs — that still promises a directory only
    // amicus can write is describing a design that is gone.
    const roots = ['src', 'scripts', 'bin', 'docs', 'electron'];
    const RETRACTED = [/directory only it can write/i, /in a private directory/i];
    const offenders = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (!/[.](js|md|cjs|mjs)$/.test(e.name)) { continue; }
        if (RETRACTED.some((r) => r.test(fs.readFileSync(full, 'utf8')))) { offenders.push(full); }
      }
    };
    for (const r of roots) {
      const full = path.join(__dirname, '..', r);
      if (fs.existsSync(full)) { walk(full); }
    }

    expect(offenders).toEqual([]);
  });
});

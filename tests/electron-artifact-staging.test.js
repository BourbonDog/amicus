// tests/electron-artifact-staging.test.js
'use strict';

/**
 * F1 — the hash-then-reopen race, and the private staging that closes it.
 *
 * THE ORIGINAL FINDING (council run 34145415501, seats A1 + B1 + C2,
 * independently): "verifyArtifact hashes the zip path, then extractFromCache
 * re-opens the same path, so a cache-dir writer can swap the file between hash
 * and extraction and the unhashed replacement gets extracted and later launched
 * as Electron."
 *
 * THE SECOND ROUND, on the fix itself. The first cut RENAMED the artifact into a
 * private directory and asserted that "after it the attacker cannot reach the
 * bytes". A probe against that commit showed otherwise: a rename moves a
 * directory ENTRY, not an inode, so a HARD LINK the attacker kept (or a symlink,
 * or a descriptor opened beforehand) still names the file amicus staged. The
 * measured result was `verdict: verified`, then `BYTES EXTRACTED:
 * "POISONED-BYTES"` and `{"repaired":true}`. Staging now COPIES, unconditionally
 * — a new inode nobody else has a name for or a handle on — and the rename is
 * gone along with its EXDEV fallback.
 *
 * The same round found the fix was only half-applied: the DOWNLOAD route staged
 * but never hashed, both routes could fail OPEN when staging was impossible, and
 * an unvalidated artifact name could escape the staging directory entirely.
 *
 * This suite pins what makes it a control rather than a gesture: the bytes hashed
 * are the bytes extracted, ON BOTH ROUTES; the staging directory is outside every
 * resolved cache root; a name that is not a plain filename never becomes a path;
 * bytes that cannot be staged are never extracted; and the user's cached artifact
 * survives every exit path, because it never moved.
 *
 * ── NAMED MUTANTS ─────────────────────────────────────────────────────────
 * Each is a ONE-LINE sabotage, applied and reverted by byte copy, MEASURED
 * 2026-09-07 against the named test via `npx jest <this file> -t "<name>"`.
 *
 * STAGEDSKIPPED     electron-install.js :: repairElectron — hash the ORIGINAL
 *   path instead of the staged one: `verifyArtifact({ zip, anchor, ... })`.
 *   RED: "the bytes that were HASHED are the bytes that are EXTRACTED".
 * STAGEINCACHEROOT  electron-stage.js :: stageArtifact — stage inside the cache
 *   root: `parent = path.dirname(zip)` instead of `os.tmpdir()`.
 *   RED: "the staging directory is OUTSIDE every resolved cache root".
 * STAGERENAMED      electron-stage.js :: stageArtifact — `fs.renameSync` in
 *   place of `fs.copyFileSync`, i.e. the first cut's preferred path.
 *   RED: "a hard link the attacker KEPT cannot reach the staged bytes".
 * NAMEUNCHECKED     electron-stage.js :: isSafeArtifactName — `return true`.
 *   RED: "an artifact NAME that is not a plain filename never becomes a path".
 * DOWNLOADUNHASHED  electron-provision.js :: controlledProvision — drop the
 *   `if (!gate.allowed)` refusal, so the staged download is extracted unhashed.
 *   RED: "the DOWNLOAD route hashes what it is about to extract".
 * UNSTAGEDEXTRACTED electron-provision.js :: controlledProvision — replace the
 *   `if (!stage)` refusal with `stage ? stage.path : zip` at the extract call.
 *   RED: "a download that cannot be staged is REFUSED, never extracted anyway".
 * CORRUPTNOTEVICTED electron-install.js :: repairElectron — delete the
 *   `fs.rmSync(zip, { force: true })` on the corrupt-extract branch.
 *   RED: "a corrupt cached artifact is EVICTED, and the reason says so".
 * SWEEPUNREACHABLE  electron-install.js :: repairElectron — delete the
 *   `sweepStaleStages({ fs })` in the no-cache/offline branch.
 *   RED: "an OFFLINE run with an EMPTY cache sweeps too".
 * ──────────────────────────────────────────────────────────────────────────
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ei = require('../src/sidecar/electron-install');
const { resolveCacheRoots } = require('../src/sidecar/electron-cache');
const {
  isSafeArtifactName, releaseStage, stageArtifact, sweepStaleStages, STAGE_PREFIX, STALE_STAGE_MS,
} = require('../src/sidecar/electron-stage');
const { containsOnDisk } = require('../src/utils/path-fence');
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

describe('F1 — the bytes hashed are the bytes extracted', () => {
  test('the bytes that were HASHED are the bytes that are EXTRACTED (STAGEDSKIPPED)', async () => {
    // THE RACE, reproduced. `racingFs` stands in for a process that can write the
    // cache directory: it overwrites the artifact the moment the gate opens a file
    // to hash it — exactly the v4.9.5 window between verifyArtifact and the
    // extractor's re-open. With a private COPY already made, the write lands on a
    // file nothing will read again.
    const cacheRoot = mkTmp('amicus-cacheroot-');
    process.env.ELECTRON_CACHE = cacheRoot;
    const zip = writeZip({ root: cacheRoot });          // GOOD bytes, matching the anchor
    const { dir, exeName } = fakeElectronDir({ withExe: false, platform: PLATFORM });

    const hashed = [];
    const racingFs = { ...fs };
    racingFs.openSync = (...args) => {
      hashed.push(args[0]);
      fs.writeFileSync(zip, POISON);                    // the swap, at the hash
      return fs.openSync(...args);
    };

    let extracted = null;
    let sawBytes = null;
    const extract = jest.fn(async (z, o) => {
      extracted = z;
      sawBytes = fs.readFileSync(z, 'utf8');
      fs.writeFileSync(path.join(o.dir, exeName), 'MZextracted');
    });

    const res = await repair({ dir, zip, extract, deps: { fs: racingFs } });

    expect(hashed.length).toBeGreaterThan(0);            // the race really fired
    expect(hashed.every((p) => p !== zip)).toBe(true);   // ...at a path nothing hashed
    expect(hashed[0]).toBe(extracted);                   // hashed EXACTLY what it extracted
    expect(sawBytes).toBe(ZIP_BODY);                     // ...and the swap lost
    expect(res.repaired).toBe(true);
    expect(res.integrity).toBeUndefined();
  });

  test('a hard link the attacker KEPT cannot reach the staged bytes (STAGERENAMED)', async () => {
    // The council's probe against the first cut, as a test. A rename moves a
    // directory ENTRY; the inode keeps every other name it had. So the attacker
    // plants the cache entry as a hard link to a file of their own — with the
    // GENUINE bytes, so the digest gate is happy — and then writes through THEIR
    // name after the gate has passed. Under `renameSync` the staged path and
    // `mine` are the same file and the poison is what gets extracted; under a
    // copy they are different inodes and the write reaches nothing.
    const cacheRoot = mkTmp('amicus-cacheroot-');
    process.env.ELECTRON_CACHE = cacheRoot;
    const mine = path.join(mkTmp('amicus-attacker-'), 'mine.zip');
    fs.writeFileSync(mine, ZIP_BODY);
    const shaDir = path.join(cacheRoot, 'a'.repeat(16));
    fs.mkdirSync(shaDir, { recursive: true });
    const zip = path.join(shaDir, ZIP_NAME);
    fs.linkSync(mine, zip);
    expect(fs.statSync(zip).nlink).toBe(2);              // the second name really exists

    const { dir, exeName } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    let sawBytes = null;
    const extract = jest.fn(async (z, o) => {
      fs.writeFileSync(mine, POISON);                    // written through the RETAINED name
      sawBytes = fs.readFileSync(z, 'utf8');
      fs.writeFileSync(path.join(o.dir, exeName), 'MZextracted');
    });

    const res = await repair({ dir, zip, extract });

    expect(sawBytes).toBe(ZIP_BODY);
    expect(res.repaired).toBe(true);
  });

  test('the staging directory is OUTSIDE every resolved cache root (STAGEINCACHEROOT)', async () => {
    const cacheRoot = mkTmp('amicus-cacheroot-');
    process.env.ELECTRON_CACHE = cacheRoot;
    const zip = writeZip({ root: cacheRoot });
    const { dir, exeName } = fakeElectronDir({ withExe: false, platform: PLATFORM });

    // Judged INSIDE the extract callback: the staging dir is gone by the time the
    // call returns, and containsOnDisk fails closed on a path it cannot realpath.
    let inCacheRoot = null;
    let inElectronDir = null;
    let inTmp = null;
    let staged = null;
    const extract = jest.fn(async (z, o) => {
      staged = z;
      inCacheRoot = resolveCacheRoots(process.env).some((root) => containsOnDisk(root, z));
      inElectronDir = containsOnDisk(dir, z);
      inTmp = containsOnDisk(os.tmpdir(), z);
      fs.writeFileSync(path.join(o.dir, exeName), 'MZextracted');
    });

    const res = await repair({ dir, zip, extract });

    expect(staged).not.toBeNull();
    expect(inCacheRoot).toBe(false);
    expect(inElectronDir).toBe(false);
    expect(inTmp).toBe(true);
    expect(path.basename(staged)).toBe(ZIP_NAME);   // named from OUR resolution
    expect(path.basename(path.dirname(staged)).startsWith(STAGE_PREFIX)).toBe(true);
    expect(res.repaired).toBe(true);
  });
});

describe('F#3 — an artifact NAME is never trusted with a path', () => {
  test('an artifact NAME that is not a plain filename never becomes a path (NAMEUNCHECKED)', async () => {
    // `version` comes out of <electronDir>/package.json whenever the caller passes
    // none — and `doctor --fix`, the one production caller, passes none for a
    // directory it found by SCANNING npx caches. MEASURED before the check: a
    // planted "43.1.1/../../victim" staged to <tmp>/victim-win32-x64.zip, two
    // levels outside the staging directory, destroying whatever was there.
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
      'electron-v43.1.1-win32-x64.zip .txt',
      '', null, undefined, 42,
    ]) {
      expect(isSafeArtifactName(bad)).toBe(false);
    }
    // win32 splits on backslash too; the pattern rejects it on every platform.
    expect(isSafeArtifactName('sub\\electron-v43.1.1-win32-x64.zip')).toBe(false);
  });

  test('stageArtifact refuses the name itself, so no caller can be the only guard', () => {
    const lines = [];
    const stage = stageArtifact({
      zip: writeZip(), fileName: '../electron-v43.1.1-win32-x64.zip', fs, log: (m) => lines.push(m),
    });
    expect(stage).toBeNull();
    expect(lines.join('\n')).toMatch(/REFUSING an implausible Electron artifact name/);
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

  test('a swap in the post-download window loses, because the copy was already taken', async () => {
    // The council's probe: the swap fires from the FIRST syscall stageArtifact
    // makes (sweepStaleStages' readdir of os.tmpdir()), i.e. after the download
    // returned and before amicus has its own copy... which is still early enough,
    // because the gate hashes the copy and the copy is what extract() opens.
    const cacheRoot = mkTmp('amicus-cacheroot-');
    process.env.ELECTRON_CACHE = cacheRoot;
    const { dir, exeName } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const dlZip = writeZip({ root: cacheRoot });

    let fired = false;
    const racingFs = { ...fs };
    racingFs.readdirSync = (...a) => {
      if (!fired && String(a[0]) === os.tmpdir()) { fired = true; fs.writeFileSync(dlZip, POISON); }
      return fs.readdirSync(...a);
    };

    let sawBytes = null;
    const extract = jest.fn(async (z, o) => {
      sawBytes = fs.readFileSync(z, 'utf8');
      fs.writeFileSync(path.join(o.dir, exeName), 'MZdownloaded');
    });

    const res = await repair({
      dir, zip: null, extract, cacheOnly: false, deps: { fs: racingFs, downloadArtifact: jest.fn(async () => dlZip) },
    });

    expect(fired).toBe(true);
    // Either the copy beat the swap (GOOD bytes extracted) or it did not and the
    // gate refused — never "poison extracted and reported repaired".
    if (res.repaired) {
      expect(sawBytes).toBe(ZIP_BODY);
    } else {
      expect(extract).not.toHaveBeenCalled();
      expect(res.integrity).toBe('mismatch');
    }
  });

  test('the DOWNLOAD route stages too, and leaves the fresh artifact in the cache', async () => {
    const { dir, exeName } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const dlZip = writeZip();
    let seen = null;
    const extract = jest.fn(async (z, o) => {
      seen = z;
      fs.writeFileSync(path.join(o.dir, exeName), 'MZdownloaded');
    });

    const res = await repair({
      dir, zip: null, extract, cacheOnly: false, deps: { downloadArtifact: jest.fn(async () => dlZip) },
    });

    expect(res.repaired).toBe(true);
    expect(seen).not.toBe(dlZip);                             // extracted from the staged copy
    expect(path.basename(path.dirname(seen)).startsWith(STAGE_PREFIX)).toBe(true);
    expect(fs.readFileSync(dlZip, 'utf8')).toBe(ZIP_BODY);    // cache left whole
  });
});

describe('F#6/F#8 — bytes that could not be staged are never extracted', () => {
  test('the CACHE route refuses, and says so with an integrity mark', async () => {
    const zip = writeZip();
    const { dir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const noStageFs = { ...fs, mkdtempSync: () => { const e = new Error('EACCES'); e.code = 'EACCES'; throw e; } };
    const extract = jest.fn();

    const res = await repair({ dir, zip, extract, deps: { fs: noStageFs } });

    expect(extract).not.toHaveBeenCalled();
    expect(res.repaired).toBe(false);
    expect(res.integrity).toBe('unstaged');
    expect(res.reason).toMatch(/could not be staged privately/);
    expect(fs.existsSync(zip)).toBe(true);          // the user still has the artifact
  });

  test('a download that cannot be staged is REFUSED, never extracted anyway (UNSTAGEDEXTRACTED)', async () => {
    // The first cut extracted the unstaged path here while printing "the cached
    // bytes will not be extracted" — the finding seat F#8 filed, with the message
    // on screen saying the opposite of what the code did.
    const { dir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const noStageFs = { ...fs, mkdtempSync: () => { throw new Error('EACCES'); } };
    const dlZip = writeZip();
    const extract = jest.fn();

    const res = await repair({
      dir, zip: null, extract, cacheOnly: false, deps: { fs: noStageFs, downloadArtifact: jest.fn(async () => dlZip) },
    });

    expect(extract).not.toHaveBeenCalled();
    expect(res.repaired).toBe(false);
    expect(res.integrity).toBe('unstaged');
  });

  test('one broken temp directory refuses ONCE, not once per route', async () => {
    // Both routes stage, so an unwritable temp refuses on the cache route and again
    // on the download route. The user gets one sentence, not the same sentence twice
    // with two paths; a cache refusal of a DIFFERENT class is still carried.
    const { dir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const noStageFs = { ...fs, mkdtempSync: () => { throw new Error('EACCES'); } };

    const same = await repair({
      dir,
      zip: writeZip(),
      extract: jest.fn(),
      cacheOnly: false,
      deps: { fs: noStageFs, downloadArtifact: jest.fn(async () => writeZip()) },
    });
    expect(same.reason.match(/could not be staged privately/g)).toHaveLength(1);

    const cacheRoot = mkTmp('amicus-cacheroot-');
    process.env.ELECTRON_CACHE = cacheRoot;
    // The cache route stages fine and is refused for MISMATCH; the temp directory
    // then goes away, so the download route is refused for a different reason.
    let staged = 0;
    const secondStageFailsFs = {
      ...fs,
      mkdtempSync: (p) => { staged += 1; if (staged > 1) { throw new Error('EACCES'); } return fs.mkdtempSync(p); },
    };
    const mixed = await repair({
      dir,
      zip: writeZip({ body: POISON, root: cacheRoot }),
      extract: jest.fn(),
      cacheOnly: false,
      deps: { fs: secondStageFailsFs, downloadArtifact: jest.fn(async () => writeZip()) },
    });
    expect(mixed.integrity).toBe('unstaged');
    expect(mixed.reason).toMatch(/was REFUSED/);                 // the cache mismatch, carried
    expect(mixed.reason).toMatch(/could not be staged privately/);
  });

  test('a copy that runs out of room is refused OUT LOUD, not silently', async () => {
    // The other half of F#6: the copy-failure branch returned null with no log at
    // all, so a cache-dir writer who filled /tmp got a silent degrade.
    const zip = writeZip();
    const parent = mkTmp('amicus-stageparent-');
    const lines = [];
    const fullFs = { ...fs, copyFileSync: () => { const e = new Error('ENOSPC'); e.code = 'ENOSPC'; throw e; } };
    const stage = stageArtifact({ zip, fileName: ZIP_NAME, fs: fullFs, parent, log: (m) => lines.push(m) });

    expect(stage).toBeNull();
    expect(lines.join('\n')).toMatch(/could not copy the Electron artifact/);
    // The half-made staging directory is cleaned up, not left as litter.
    expect(fs.readdirSync(parent)).toEqual([]);
  });
});

describe('F1 — nobody ends up with neither a cached artifact nor a dist', () => {
  test('the cache entry is STILL THERE while the extract runs — a kill cannot lose it', async () => {
    // Staging copies, so there is no window in which the artifact exists only
    // under os.tmpdir(). This is what makes a Ctrl-C mid-extract survivable for
    // the air-gapped, hand-seeded-cache user, and why the stale-stage sweep is
    // reachable on the next run: the cache hit that triggers staging is intact.
    const zip = writeZip();
    const { dir, exeName, distDir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    let cachedDuringExtract = null;
    let stageDir = null;
    const extract = jest.fn(async (z, o) => {
      stageDir = path.dirname(z);
      cachedDuringExtract = fs.existsSync(zip) && fs.readFileSync(zip, 'utf8');
      fs.writeFileSync(path.join(o.dir, exeName), 'MZextracted');
    });

    const res = await repair({ dir, zip, extract });

    expect(cachedDuringExtract).toBe(ZIP_BODY);
    expect(res.repaired).toBe(true);
    expect(fs.existsSync(path.join(distDir, exeName))).toBe(true);   // a dist...
    expect(fs.readFileSync(zip, 'utf8')).toBe(ZIP_BODY);             // ...AND the cache entry
    expect(fs.existsSync(stageDir)).toBe(false);                     // nothing stranded
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
    // ...and not sitting in a staging directory either.
    expect(fs.readdirSync(os.tmpdir()).some((n) => n.startsWith(STAGE_PREFIX)
      && fs.existsSync(path.join(os.tmpdir(), n, ZIP_NAME))
      && fs.readFileSync(path.join(os.tmpdir(), n, ZIP_NAME), 'utf8') === POISON)).toBe(false);
  });
});

describe('F#4/F#5 — a corrupt cached artifact is actually evicted', () => {
  test('a corrupt cached artifact is EVICTED, and the reason says so (CORRUPTNOTEVICTED)', async () => {
    // The first cut set `stage.discard`, which only dropped the private copy —
    // so on the branch that copied (every branch, now) the corrupt original stayed
    // in the cache and was re-found forever, while the returned reason said it had
    // been removed. `scripts/postinstall.js` is the cacheOnly caller that hit it.
    const { dir } = unanchoredElectronDir();
    const zip = writeZip({ body: 'CORRUPT' });
    const extract = jest.fn(async () => { throw new Error('end of central directory record signature not found'); });

    const res = await repair({ dir, zip, extract });

    expect(res.repaired).toBe(false);
    expect(res.reason).toMatch(/was corrupt and removed/);
    expect(fs.existsSync(zip)).toBe(false);
  });

  test('when the eviction FAILS, the reason says "left in place" rather than lying', async () => {
    const { dir } = unanchoredElectronDir();
    const zip = writeZip({ body: 'CORRUPT' });
    const readOnlyFs = { ...fs, rmSync: (p, o) => { if (p === zip) { throw new Error('EPERM'); } return fs.rmSync(p, o); } };
    const extract = jest.fn(async () => { throw new Error('end of central directory record signature not found'); });

    const res = await repair({ dir, zip, extract, deps: { fs: readOnlyFs } });

    expect(res.reason).toMatch(/was corrupt and left in place/);
    expect(fs.existsSync(zip)).toBe(true);
  });
});

describe('stageArtifact / releaseStage — the primitives', () => {
  test('staging COPIES: the original is byte-for-byte where it was', () => {
    const zip = writeZip();
    const stage = stageArtifact({ zip, fileName: ZIP_NAME, fs });

    expect(stage.path).not.toBe(zip);
    expect(fs.readFileSync(stage.path, 'utf8')).toBe(ZIP_BODY);
    expect(fs.readFileSync(zip, 'utf8')).toBe(ZIP_BODY);      // never left
    // A NEW inode: no name the source had reaches the staged file.
    expect(fs.statSync(stage.path).ino).not.toBe(fs.statSync(zip).ino);
    releaseStage({ stage, fs });
    expect(fs.existsSync(stage.dir)).toBe(false);
    expect(fs.readFileSync(zip, 'utf8')).toBe(ZIP_BODY);      // and is still there after
  });

  test('releaseStage removes the private directory and nothing else, and never throws', () => {
    const zip = writeZip();
    const stage = stageArtifact({ zip, fileName: ZIP_NAME, fs });
    releaseStage({ stage, fs });
    expect(fs.existsSync(stage.dir)).toBe(false);
    expect(fs.existsSync(zip)).toBe(true);
    // Idempotent, and safe on a null stage — it is called from a `finally`.
    expect(() => releaseStage({ stage, fs })).not.toThrow();
    expect(() => releaseStage({ stage: null, fs })).not.toThrow();
  });

  test('staging fails (null), never throws, when the artifact cannot be read at all', () => {
    const gone = path.join(mkTmp('amicus-gone-'), 'nope', ZIP_NAME);
    const lines = [];
    expect(stageArtifact({ zip: gone, fileName: ZIP_NAME, fs, log: (m) => lines.push(m) })).toBeNull();
    expect(lines.join('\n')).toMatch(/could not be read at all/);
  });

  test('a cache entry that is not a regular FILE is refused, not copied', () => {
    // A symlink, a fifo, a directory. Asserted through lstat rather than by
    // planting a real symlink, which needs elevation on Windows.
    const zip = writeZip();
    const linkFs = { ...fs, lstatSync: () => ({ isFile: () => false }) };
    const lines = [];
    expect(stageArtifact({ zip, fileName: ZIP_NAME, fs: linkFs, log: (m) => lines.push(m) })).toBeNull();
    expect(lines.join('\n')).toMatch(/not a regular file/);
  });

  test('the staged file is named from OUR artifact name, not from the cache path', () => {
    const zip = writeZip({ name: 'attacker-chosen.zip' });
    const stage = stageArtifact({ zip, fileName: ZIP_NAME, fs });
    expect(path.basename(stage.path)).toBe(ZIP_NAME);
    releaseStage({ stage, fs });
  });
});

describe('sweepStaleStages — a killed run does not strand 170 MB forever', () => {
  test('removes a stale staging dir, keeps a fresh one, and never walks a non-directory', () => {
    const parent = mkTmp('amicus-sweep-');
    const stale = fs.mkdtempSync(path.join(parent, STAGE_PREFIX));
    fs.writeFileSync(path.join(stale, ZIP_NAME), ZIP_BODY);
    const old = (Date.now() - STALE_STAGE_MS - 60_000) / 1000;
    fs.utimesSync(stale, old, old);
    const fresh = fs.mkdtempSync(path.join(parent, STAGE_PREFIX));
    const notOurs = path.join(parent, 'somebody-elses-dir');
    fs.mkdirSync(notOurs);
    // A FILE wearing the prefix: lstat + isDirectory() is what stops the sweep
    // following anything it did not create (a symlink, on a world-writable /tmp).
    const decoy = path.join(parent, `${STAGE_PREFIX}decoy`);
    fs.writeFileSync(decoy, 'not a directory');
    fs.utimesSync(decoy, old, old);

    sweepStaleStages({ fs, parent });

    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.existsSync(notOurs)).toBe(true);
    expect(fs.existsSync(decoy)).toBe(true);
  });

  test('never throws on an unreadable parent', () => {
    expect(() => sweepStaleStages({ fs, parent: path.join(os.tmpdir(), 'amicus-no-such-parent-xyz') })).not.toThrow();
  });

  test('an OFFLINE run with an EMPTY cache sweeps too (SWEEPUNREACHABLE)', async () => {
    // Every other path reaches the sweep through stageArtifact. This one does not:
    // no cache hit, no download. It is exactly the state seat F#7 named, so the
    // sweep is called here explicitly rather than waiting for a cache hit that an
    // air-gapped machine may never get.
    const { dir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const parent = mkTmp('amicus-sweepparent-');
    const stale = fs.mkdtempSync(path.join(parent, STAGE_PREFIX));
    fs.writeFileSync(path.join(stale, ZIP_NAME), ZIP_BODY);
    const old = (Date.now() - STALE_STAGE_MS - 60_000) / 1000;
    fs.utimesSync(stale, old, old);

    let sweptParent = null;
    const watchFs = { ...fs, readdirSync: (p, o) => { sweptParent = sweptParent || String(p); return fs.readdirSync(p, o); } };
    const res = await repair({ dir, zip: null, extract: jest.fn(), deps: { fs: watchFs } });

    expect(res.deferred).toBe(true);
    expect(sweptParent).toBe(os.tmpdir());       // the sweep really ran
    sweepStaleStages({ fs, parent });            // ...and it is the same sweep
    expect(fs.existsSync(stale)).toBe(false);
  });
});

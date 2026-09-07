// tests/electron-artifact-staging.test.js
'use strict';

/**
 * F1 — the hash-then-reopen race, and the private staging that closes it (v4.9.6).
 *
 * THE FINDING (council run 34145415501, seats A1 + B1 + C2, independently):
 * "verifyArtifact hashes the zip path, then extractFromCache re-opens the same
 * path, so a cache-dir writer can swap the file between hash and extraction and
 * the unhashed replacement gets extracted and later launched as Electron."
 *
 * THE REMEDY, as ruled: move the artifact into a private staging directory —
 * `fs.mkdtempSync` under `os.tmpdir()`, never a subdirectory of the cache root,
 * which the attacker writes by definition — then hash and extract THERE.
 *
 * This suite pins the three things that make that a control rather than a
 * gesture: the bytes hashed are the bytes extracted; the staging directory is
 * outside every resolved cache root; and every exit path leaves the user with a
 * cached artifact, a working dist, or both — never neither.
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
 * ──────────────────────────────────────────────────────────────────────────
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ei = require('../src/sidecar/electron-install');
const { resolveCacheRoots } = require('../src/sidecar/electron-cache');
const {
  releaseStage, stageArtifact, sweepStaleStages, STAGE_PREFIX, STALE_STAGE_MS,
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
    // extractor's re-open. With the artifact already moved out of that directory,
    // the write lands on nothing the extractor will ever read.
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

describe('F1 — nobody ends up with neither a cached artifact nor a dist', () => {
  test('a verified artifact is put BACK in the cache, and the staging dir is gone', async () => {
    const zip = writeZip();
    const { dir, exeName, distDir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    let stageDir = null;
    const extract = jest.fn(async (z, o) => {
      stageDir = path.dirname(z);
      fs.writeFileSync(path.join(o.dir, exeName), 'MZextracted');
    });

    const res = await repair({ dir, zip, extract });

    expect(res.repaired).toBe(true);
    expect(fs.existsSync(path.join(distDir, exeName))).toBe(true);   // a dist...
    expect(fs.readFileSync(zip, 'utf8')).toBe(ZIP_BODY);             // ...AND the cache entry
    expect(fs.existsSync(stageDir)).toBe(false);                     // nothing stranded
  });

  test('an UNSAFE archive is put back too — a refused archive is the evidence', async () => {
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

  test('a mismatch the FENCE refuses to delete is put back, bytes intact', async () => {
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

  test('bytes that could not be staged are NEVER extracted', async () => {
    // A tmpdir amicus cannot write is the one case where the move is impossible.
    // Hashing in place would vouch for a file its writer still controls, so the
    // cache route stands down and the download route takes over instead.
    const zip = writeZip();
    const { dir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const noStageFs = { ...fs, mkdtempSync: () => { const e = new Error('EACCES'); e.code = 'EACCES'; throw e; } };
    const extract = jest.fn();

    const res = await repair({ dir, zip, extract, deps: { fs: noStageFs } });

    expect(extract).not.toHaveBeenCalled();
    expect(res.deferred).toBe(true);
    expect(res.reason).toMatch(/could not be staged privately/);
    expect(fs.existsSync(zip)).toBe(true);          // the user still has the artifact
  });

  test('online, unstageable cache bytes fall through to the controlled download', async () => {
    const zip = writeZip();
    const { dir, exeName } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const noStageFs = { ...fs, mkdtempSync: () => { throw new Error('EACCES'); } };
    const downloadArtifact = jest.fn(async () => writeZip());
    const extract = jest.fn(async (z, o) => { fs.writeFileSync(path.join(o.dir, exeName), 'MZ'); });

    const res = await repair({ dir, zip, extract, cacheOnly: false, deps: { fs: noStageFs, downloadArtifact } });

    expect(downloadArtifact).toHaveBeenCalledTimes(1);
    expect(res.repaired).toBe(true);
  });

  test('the DOWNLOAD route stages too, and leaves the fresh artifact in the cache', async () => {
    // Without this, an attacker who simply DELETES the cached zip forces the
    // download route and wins the identical swap there.
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

describe('stageArtifact / releaseStage — the primitives', () => {
  test('a cross-volume rename falls back to a COPY, leaving the original in place', () => {
    const zip = writeZip();
    const exdevFs = { ...fs, renameSync: () => { const e = new Error('EXDEV'); e.code = 'EXDEV'; throw e; } };
    const stage = stageArtifact({ zip, fileName: ZIP_NAME, fs: exdevFs });

    expect(stage.moved).toBe(false);
    expect(fs.readFileSync(stage.path, 'utf8')).toBe(ZIP_BODY);
    expect(fs.readFileSync(zip, 'utf8')).toBe(ZIP_BODY);      // never left
    releaseStage({ stage, fs });
    expect(fs.existsSync(stage.dir)).toBe(false);
    expect(fs.existsSync(zip)).toBe(true);                    // and is still there after
  });

  test('a failed restore KEEPS the bytes and says where they are', () => {
    const zip = writeZip();
    const stage = stageArtifact({ zip, fileName: ZIP_NAME, fs });
    expect(stage.moved).toBe(true);
    const stuckFs = {
      ...fs,
      renameSync: () => { throw new Error('EPERM'); },
      copyFileSync: () => { throw new Error('EPERM'); },
    };
    const lines = [];
    releaseStage({ stage, fs: stuckFs, log: (m) => lines.push(m) });

    // Deleting here would be the one outcome F1 forbids: neither cache nor dist.
    expect(fs.readFileSync(stage.path, 'utf8')).toBe(ZIP_BODY);
    expect(lines.join('\n')).toMatch(/LEFT at/);
    expect(lines.join('\n')).toContain(stage.path);
  });

  test('discard removes the staging dir and does NOT put the artifact back', () => {
    const zip = writeZip({ body: POISON });
    const stage = stageArtifact({ zip, fileName: ZIP_NAME, fs });
    stage.discard = true;
    releaseStage({ stage, fs });

    expect(fs.existsSync(stage.dir)).toBe(false);
    expect(fs.existsSync(zip)).toBe(false);
  });

  test('staging fails (null), never throws, when the artifact cannot be read at all', () => {
    const gone = path.join(mkTmp('amicus-gone-'), 'nope', ZIP_NAME);
    expect(stageArtifact({ zip: gone, fileName: ZIP_NAME, fs })).toBeNull();
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
});

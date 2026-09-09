// tests/electron-install.test.js
'use strict';

/**
 * Unit tests for the self-heal keystone src/sidecar/electron-install.js (#53, #59).
 *
 * Electron is an optionalDependency. A flaky/interrupted extract (or AV
 * quarantine) can leave path.txt on disk but the actual dist/electron.exe
 * MISSING -> a silently broken GUI. This module:
 *   - resolveElectronBinary(): resolve the on-disk exe path from electron's
 *     layout, mirroring ELECTRON_OVERRIDE_DIST_PATH semantics (#59).
 *   - isElectronUsable(): true ONLY if the resolved exe actually EXISTS.
 *   - cachedZip(): locate a previously-downloaded electron zip in cache roots.
 *   - repairElectron(): heal offline from cache, or trigger the installer.
 *
 * EVERYTHING that downloads/extracts/touches the network is MOCKED / injected;
 * no test fetches or extracts a real electron binary.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ei = require('../src/sidecar/electron-install');
// The fake package now carries a checksums.json anchor: repairElectron hashes a
// cached zip before extracting it. SELF_ANCHOR_OFF pins that anchor to the fixture
// (this repo really has electron 43.1.1 installed, whose real digests no 5-byte
// fixture can match). See tests/helpers/fake-electron-dir.js.
const { fakeElectronDir, SELF_ANCHOR_OFF, ZIP_BODY } = require('./helpers/fake-electron-dir');

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('electron-install module API (#53)', () => {
  test('exports the self-heal primitives', () => {
    expect(typeof ei.resolveElectronBinary).toBe('function');
    expect(typeof ei.isElectronUsable).toBe('function');
    expect(typeof ei.cachedZip).toBe('function');
    expect(typeof ei.repairElectron).toBe('function');
  });
});

describe('resolveElectronBinary + isElectronUsable (#53, #59)', () => {
  test('resolves dist/<exe> from path.txt for the default layout', () => {
    const { dir, exeName } = fakeElectronDir({ withExe: true, platform: 'win32' });
    const resolved = ei.resolveElectronBinary({ electronDir: dir, env: {}, platform: 'win32' });
    expect(resolved).toBe(path.join(dir, 'dist', exeName));
  });

  test('isElectronUsable is FALSE when path.txt exists but the exe is MISSING', () => {
    const { dir } = fakeElectronDir({ withExe: false, platform: 'win32' });
    expect(ei.isElectronUsable({ electronDir: dir, env: {}, platform: 'win32' })).toBe(false);
  });

  test('isElectronUsable is TRUE when the exe actually exists on disk', () => {
    const { dir } = fakeElectronDir({ withExe: true, platform: 'win32' });
    expect(ei.isElectronUsable({ electronDir: dir, env: {}, platform: 'win32' })).toBe(true);
  });

  test('honors ELECTRON_OVERRIDE_DIST_PATH (#59) instead of the fixed dist dir', () => {
    const { dir, exeName } = fakeElectronDir({ withExe: false, platform: 'win32' });
    // Put the exe in an override dir, NOT in the package dist dir.
    const overrideDir = mkTmp('amicus-electron-override-');
    fs.writeFileSync(path.join(overrideDir, exeName), 'MZbinary');

    const env = { ELECTRON_OVERRIDE_DIST_PATH: overrideDir };
    const resolved = ei.resolveElectronBinary({ electronDir: dir, env, platform: 'win32' });
    expect(resolved).toBe(path.join(overrideDir, exeName));
    expect(ei.isElectronUsable({ electronDir: dir, env, platform: 'win32' })).toBe(true);
  });
});

describe('resolveElectronBinary and the promote guard read path.txt by ONE rule (A1)', () => {
  // THE ANTI-DRIFT TEST, and the thing whose absence let the two copies of this
  // rule diverge until v4.9.7: `resolveElectronBinary` trimmed and fell back on
  // blank, `promoteDist`'s retirement guard did neither and asked only about
  // this host's default name -- so a failed promote deleted a cross-installed
  // tree that resolved perfectly well (A1).
  //
  // NAMED MUTANTS
  //   HELDEXENOTRIM     electron-exe-rel.js :: heldExeRel -- drop the `.trim()`.
  //     RED: the 'electron.exe' + LF and '  electron.exe  ' rows.
  //   HELDEXENOFALLBACK electron-exe-rel.js :: heldExeRel -- return the raw
  //     value instead of falling back to platformExe when it is blank, so a
  //     zero-byte path.txt resolves to dist/ ITSELF rather than to the exe.
  //     RED: the '' and whitespace-only rows. This is the mutant's REAL site --
  //     inside distHeldExe it is equivalent, because the containment bound
  //     already rejects a blank name, so no promote test can kill it.
  //   RESOLVERDRIFT     electron-install.js :: resolveElectronBinary -- restore
  //     the private inline read/trim/fallback instead of calling heldExeRel.
  //     Survives alone; goes RED the moment either copy is changed and the
  //     other is not, which is the drift this test exists to catch.
  const SHAPES = [
    { raw: null, expect: null },                    // absent -> platformExe
    { raw: '', expect: null },                      // zero-byte -> platformExe
    { raw: '   \n', expect: null },                 // whitespace-only -> platformExe
    { raw: 'electron.exe\n', expect: 'electron.exe' },
    { raw: '  electron.exe  ', expect: 'electron.exe' },
    { raw: 'electron', expect: 'electron' },        // an npm_config_platform cross-install
    { raw: 'Electron.app/Contents/MacOS/Electron', expect: 'Electron.app/Contents/MacOS/Electron' },
  ];

  for (const platform of ['win32', 'darwin', 'linux']) {
    for (const shape of SHAPES) {
      const label = shape.raw === null ? '<absent>' : JSON.stringify(shape.raw);
      test(`${platform}: path.txt ${label} resolves by the shared rule`, () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-resolve-'));
        // The expected value is derived from the fixture THIS TEST WROTE, never
        // from a value the code under test produced (an echoed read-back proves
        // nothing). `platformExe` is the constant; the rule is what is on trial.
        if (shape.raw !== null) { fs.writeFileSync(path.join(dir, 'path.txt'), shape.raw); }
        const exeRel = shape.expect === null ? ei.platformExe(platform) : shape.expect;

        expect(ei.resolveElectronBinary({ electronDir: dir, env: {}, platform }))
          .toBe(path.join(dir, 'dist', exeRel));
        expect(ei.resolveElectronBinary({
          electronDir: dir, env: { ELECTRON_OVERRIDE_DIST_PATH: path.join(dir, 'OVR') }, platform,
        })).toBe(path.join(dir, 'OVR', exeRel));

        fs.rmSync(dir, { recursive: true, force: true });
      });
    }
  }
});

describe('cachedZip (#53)', () => {
  test('locates a fixtured electron-v<ver>-<platform>-<arch>.zip under a cache root', () => {
    const cacheRoot = mkTmp('amicus-electron-cache-');
    const version = '43.1.1';
    const platform = 'win32';
    const arch = 'x64';
    const zipName = `electron-v${version}-${platform}-${arch}.zip`;
    // @electron/get nests the zip under a sha subdir.
    const shaDir = path.join(cacheRoot, 'deadbeefsha');
    fs.mkdirSync(shaDir, { recursive: true });
    const zipPath = path.join(shaDir, zipName);
    fs.writeFileSync(zipPath, ZIP_BODY);

    const found = ei.cachedZip({
      version,
      platform,
      arch,
      env: { electron_config_cache: cacheRoot },
    });
    expect(found).toBe(zipPath);
  });

  test('returns null when no cached zip is present', () => {
    const emptyRoot = mkTmp('amicus-electron-cache-empty-');
    // Fully isolate the env so the real default cache root cannot leak in.
    const found = ei.cachedZip({
      version: '43.1.1',
      platform: 'win32',
      arch: 'x64',
      env: {
        electron_config_cache: emptyRoot,
        ELECTRON_CACHE: emptyRoot,
        LOCALAPPDATA: emptyRoot,
        HOME: emptyRoot,
        XDG_CACHE_HOME: emptyRoot,
      },
    });
    expect(found).toBeNull();
  });
});

describe('repairElectron (#53)', () => {
  test('cacheOnly: extracts a cached zip + writes path.txt OFFLINE (never downloads)', async () => {
    const { dir, exeName, distDir } = fakeElectronDir({ withExe: false, platform: 'win32' });
    const zipPath = path.join(mkTmp('amicus-cz-'), 'electron-v43.1.1-win32-x64.zip');
    fs.writeFileSync(zipPath, ZIP_BODY);

    const extract = jest.fn(async (_zip, opts) => {
      // Simulate extraction by materializing the exe in the dist dir.
      fs.writeFileSync(path.join(opts.dir, exeName), 'MZextracted');
    });
    const spawn = jest.fn(() => { throw new Error('network must NOT be hit in cacheOnly'); });

    const res = await ei.repairElectron({
      cacheOnly: true,
      electronDir: dir,
      platform: 'win32',
      version: '43.1.1',
      arch: 'x64',
      deps: {
        ...SELF_ANCHOR_OFF,
        cachedZip: () => zipPath,
        extract,
        spawn,
        // single-flight lock no-op
        acquireLock: () => ({ release: () => {} }),
      },
    });

    expect(extract).toHaveBeenCalledTimes(1);
    // Extraction lands in a private incoming directory and is PROMOTED into
    // dist/ by rename, so a half-written tree is never what anything reads.
    expect(extract.mock.calls[0][1].dir).not.toBe(distDir);
    expect(path.dirname(extract.mock.calls[0][1].dir).startsWith(path.join(dir, '.amicus-incoming-'))).toBe(true);
    expect(spawn).not.toHaveBeenCalled();
    // path.txt restored + exe present => repaired.
    expect(fs.existsSync(path.join(distDir, exeName))).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'path.txt'), 'utf8')).toBe(exeName);
    expect(res.repaired).toBe(true);
  });

  test('cacheOnly: a silently-failed extract (no usable exe) reports repaired:false', async () => {
    const { dir, exeName, distDir } = fakeElectronDir({ withExe: false, platform: 'win32' });
    const zipPath = path.join(mkTmp('amicus-cz-'), 'electron-v43.1.1-win32-x64.zip');
    fs.writeFileSync(zipPath, ZIP_BODY);

    // Extract runs but does NOT materialize the exe (interrupted unzip / AV quarantine).
    const extract = jest.fn(async () => { /* no exe written */ });
    const spawn = jest.fn(() => { throw new Error('network must NOT be hit in cacheOnly'); });

    const res = await ei.repairElectron({
      cacheOnly: true,
      electronDir: dir,
      platform: 'win32',
      version: '43.1.1',
      arch: 'x64',
      deps: {
        ...SELF_ANCHOR_OFF,
        cachedZip: () => zipPath,
        extract,
        spawn,
        acquireLock: () => ({ release: () => {} }),
      },
    });

    expect(extract).toHaveBeenCalledTimes(1);
    expect(spawn).not.toHaveBeenCalled();
    // The exe never landed → repaired must be FALSE. Regression guard for the
    // `|| true` bug that reported every repair as successful even when the exe
    // was missing (which #57's postinstall message trusts).
    expect(fs.existsSync(path.join(distDir, exeName))).toBe(false);
    expect(res.repaired).toBe(false);
  });

  test('cacheOnly with NO cache returns {deferred:true, reason} and never downloads', async () => {
    const { dir } = fakeElectronDir({ withExe: false, platform: 'win32' });
    const extract = jest.fn();
    const spawn = jest.fn();

    const res = await ei.repairElectron({
      cacheOnly: true,
      electronDir: dir,
      platform: 'win32',
      version: '43.1.1',
      arch: 'x64',
      deps: {
        ...SELF_ANCHOR_OFF,
        cachedZip: () => null,
        extract,
        spawn,
        acquireLock: () => ({ release: () => {} }),
      },
    });

    expect(res.deferred).toBe(true);
    expect(typeof res.reason).toBe('string');
    expect(res.reason.length).toBeGreaterThan(0);
    expect(extract).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  test('win32 deferred reason mentions Windows Defender / AV quarantine', async () => {
    const { dir } = fakeElectronDir({ withExe: false, platform: 'win32' });
    const res = await ei.repairElectron({
      cacheOnly: true,
      electronDir: dir,
      platform: 'win32',
      version: '43.1.1',
      arch: 'x64',
      deps: {
        ...SELF_ANCHOR_OFF,
        cachedZip: () => null,
        extract: jest.fn(),
        spawn: jest.fn(),
        acquireLock: () => ({ release: () => {} }),
      },
    });
    expect(res.reason).toMatch(/defender|antivirus|av|quarantine/i);
  });

  test('single-flight lock blocks a concurrent double-extract', async () => {
    const { dir, exeName } = fakeElectronDir({ withExe: false, platform: 'win32' });
    const zipPath = path.join(mkTmp('amicus-cz2-'), 'electron-v43.1.1-win32-x64.zip');
    fs.writeFileSync(zipPath, ZIP_BODY);

    // A single shared lock: second acquire throws (EEXIST-style).
    let held = false;
    const acquireLock = jest.fn(() => {
      if (held) {
        const e = new Error('EEXIST: lock held');
        e.code = 'EEXIST';
        throw e;
      }
      held = true;
      return { release: () => { held = false; } };
    });

    let resolveExtract;
    const extractGate = new Promise((r) => { resolveExtract = r; });
    const extract = jest.fn(async (_zip, opts) => {
      await extractGate;
      fs.writeFileSync(path.join(opts.dir, exeName), 'MZextracted');
    });

    const common = {
      cacheOnly: true,
      electronDir: dir,
      platform: 'win32',
      version: '43.1.1',
      arch: 'x64',
      deps: { ...SELF_ANCHOR_OFF, cachedZip: () => zipPath, extract, spawn: jest.fn(), acquireLock },
    };

    const first = ei.repairElectron(common);
    const second = ei.repairElectron(common); // contends while first holds the lock

    const secondRes = await second;
    resolveExtract();
    await first;

    // Only ONE extraction ran; the contender backed off (single-flight).
    expect(extract).toHaveBeenCalledTimes(1);
    expect(secondRes.contended || secondRes.deferred).toBe(true);
  });

  test('controlled (no cache, !cacheOnly): CONTROLLED download via downloadArtifact + extract, never spawns install.js', async () => {
    const { dir, exeName, distDir } = fakeElectronDir({ withExe: false, platform: 'win32' });
    const dlZip = path.join(mkTmp('amicus-dl-'), 'electron-v43.1.1-win32-x64.zip');
    fs.writeFileSync(dlZip, ZIP_BODY);

    // downloadArtifact fetches the zip ourselves (the SAME api install.js uses).
    const downloadArtifact = jest.fn(async () => dlZip);
    // extract materializes the exe. It is handed the BUFFER amicus read and
    // hashed — there is no path here at all, which is the whole point.
    let sawBytes = null;
    const extract = jest.fn(async (bytes, opts) => {
      sawBytes = bytes.toString('utf8');
      fs.writeFileSync(path.join(opts.dir, exeName), 'MZdownloaded');
    });
    // spawn MUST NOT be used as the primary provision path anymore.
    const spawn = jest.fn(() => { throw new Error('install.js spawn must NOT be the controlled provision path'); });

    const res = await ei.repairElectron({
      force: true,
      cacheOnly: false,
      electronDir: dir,
      platform: 'win32',
      version: '43.1.1',
      arch: 'x64',
      deps: {
        ...SELF_ANCHOR_OFF,
        cachedZip: () => null,
        downloadArtifact,
        extract,
        spawn,
        acquireLock: () => ({ release: () => {} }),
      },
    });

    expect(downloadArtifact).toHaveBeenCalledTimes(1);
    const dlOpts = downloadArtifact.mock.calls[0][0];
    expect(dlOpts.version).toBe('43.1.1');
    expect(dlOpts.artifactName).toBe('electron');
    expect(dlOpts.force).toBe(true);
    expect(dlOpts.platform).toBe('win32');
    expect(dlOpts.arch).toBe('x64');
    expect(typeof dlOpts.cacheRoot).toBe('string');
    expect(extract).toHaveBeenCalledTimes(1);
    // The DOWNLOADED artifact is the one extracted — as BYTES amicus already
    // hashed, never as a path something else could still write to.
    expect(Buffer.isBuffer(extract.mock.calls[0][0])).toBe(true);
    expect(sawBytes).toBe(ZIP_BODY);
    // ...and the download cache is left holding the artifact it downloaded.
    expect(fs.readFileSync(dlZip, 'utf8')).toBe(ZIP_BODY);
    expect(spawn).not.toHaveBeenCalled();
    expect(res.repaired).toBe(true);
    expect(fs.existsSync(path.join(distDir, exeName))).toBe(true);
  });

  test('controlled download that yields NO usable exe reports repaired:false (no false success)', async () => {
    const { dir, exeName, distDir } = fakeElectronDir({ withExe: false, platform: 'win32' });
    const dlZip = path.join(mkTmp('amicus-dl-'), 'electron-v43.1.1-win32-x64.zip');
    fs.writeFileSync(dlZip, ZIP_BODY);

    const downloadArtifact = jest.fn(async () => dlZip);
    // Extract "runs" but never materializes the exe (interrupted unzip / AV).
    const extract = jest.fn(async () => { /* no exe written */ });

    const res = await ei.repairElectron({
      force: true,
      cacheOnly: false,
      electronDir: dir,
      platform: 'win32',
      version: '43.1.1',
      arch: 'x64',
      deps: {
        ...SELF_ANCHOR_OFF,
        cachedZip: () => null,
        downloadArtifact,
        extract,
        spawn: jest.fn(),
        acquireLock: () => ({ release: () => {} }),
      },
    });

    expect(downloadArtifact).toHaveBeenCalledTimes(1);
    // No exe materialized → repaired MUST be false (no false success).
    expect(res.repaired).toBe(false);
    expect(fs.existsSync(path.join(distDir, exeName))).toBe(false);
  });

  test('corrupt cached zip: extract throws → delete bad zip + forced re-download + extract', async () => {
    // The zip is ALLOWED and still fails to open — a truncated artifact, which is a
    // different failure class from a digest disagreement (that one is refused before
    // extract; see the C2 tests). NO anchor covers this artifact, which is the only
    // shape where "allowed, but corrupt" is physically coherent: with a published
    // digest in hand, bytes that fail to open would have failed the hash. v4.9.6's
    // second round hashes the DOWNLOAD too, so a fixture whose anchor vouches for
    // the corrupt body would now refuse the good re-download instead of extracting it.
    const badBody = 'CORRUPT';
    const { dir, exeName, distDir } = fakeElectronDir({ withExe: false, platform: 'win32', body: badBody });
    fs.rmSync(path.join(dir, 'checksums.json'));
    // INSIDE a cache root. Round 3's C2 put the corrupt-artifact eviction behind
    // the same `mayDeleteRejectedZip` fence the mismatch eviction always used, so
    // a "cached" zip sitting where no cache root resolves is now deliberately
    // left in place (tests/electron-artifact-custody.test.js pins that as
    // UNFENCEDEVICT). This test is about the corrupt-and-re-download flow, so it
    // puts the artifact where a real cache hit would have found it.
    const cacheRoot = mkTmp('amicus-cacheroot-');
    const savedRoot = process.env.ELECTRON_CACHE;
    process.env.ELECTRON_CACHE = cacheRoot;
    const badZip = path.join(cacheRoot, 'a'.repeat(16), 'electron-v43.1.1-win32-x64.zip');
    fs.mkdirSync(path.dirname(badZip), { recursive: true });
    fs.writeFileSync(badZip, badBody);
    // The re-downloaded zip is good.
    const goodZip = path.join(mkTmp('amicus-good-'), 'electron-v43.1.1-win32-x64.zip');
    fs.writeFileSync(goodZip, ZIP_BODY);

    let extractCalls = 0;
    // Keyed on the BYTES, because bytes are all the extractor is given now. The
    // thrown error carries UNZIP_BUFFER_FAILED: only an ARCHIVE failure evicts a
    // cache entry, and a destination failure must not (council finding D2).
    const extract = jest.fn(async (bytes, opts) => {
      extractCalls += 1;
      if (bytes.toString('utf8') === badBody) {
        const e = new Error('end of central directory record signature not found');
        e.code = 'UNZIP_BUFFER_FAILED';
        throw e;
      }
      fs.writeFileSync(path.join(opts.dir, exeName), 'MZredownloaded');
    });
    const downloadArtifact = jest.fn(async () => goodZip);

    const res = await ei.repairElectron({
      cacheOnly: false,
      electronDir: dir,
      platform: 'win32',
      version: '43.1.1',
      arch: 'x64',
      deps: {
        ...SELF_ANCHOR_OFF,
        cachedZip: () => badZip, // cache HIT, but corrupt
        downloadArtifact,
        extract,
        spawn: jest.fn(),
        acquireLock: () => ({ release: () => {} }),
      },
    });

    if (savedRoot === undefined) { delete process.env.ELECTRON_CACHE; } else { process.env.ELECTRON_CACHE = savedRoot; }

    // First extract attempt was on the corrupt cached zip and threw.
    expect(extractCalls).toBe(2);
    // The bad cached zip was KEPT (C2, round 4). With the hatch unset, a parse
    // failure prints the offer of the native-extractor rescue and telling a user
    // to set a variable and provision again cannot delete the copy that re-run
    // would act on. It is discarded once the rescue has run and every native
    // extractor has failed too — pinned in tests/electron-native-rescue.test.js
    // as OFFEREDANDEVICTED and its armed-and-failed sibling. Nothing here
    // depends on the eviction: the fall-through is what this test is about.
    expect(fs.existsSync(badZip)).toBe(true);
    // A forced fresh download was attempted.
    expect(downloadArtifact).toHaveBeenCalledTimes(1);
    expect(downloadArtifact.mock.calls[0][0].force).toBe(true);
    // Re-extract materialized the exe → repaired true, and marked `unverified`
    // because no published digest covered either artifact (F3).
    expect(res.repaired).toBe(true);
    expect(res.unverified).toBe(true);
    expect(fs.existsSync(path.join(distDir, exeName))).toBe(true);
  });
});

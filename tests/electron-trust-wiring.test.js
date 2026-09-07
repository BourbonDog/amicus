// tests/electron-trust-wiring.test.js
'use strict';

/**
 * The Electron trust boundary, WIRED (v4.9.5 C1-C3).
 *
 * tests/sidecar/electron-trust.test.js pins the primitives. This suite pins the
 * three places they are actually load-bearing, because a gate nobody calls is a
 * gate that does not exist:
 *
 *   C1  controlledProvision passes `checksums` to downloadArtifact, so
 *       @electron/get writes a LOCAL SHASUMS256.txt and never fetches one from a
 *       mirror an attacker may have chosen.
 *   C2  repairElectron HASHES a cached zip against the anchor BEFORE
 *       extractFromCache can run, deletes a mismatch only through the fence, and
 *       treats "no anchor" as a mark rather than a refusal.
 *   C3  runInstaller spawns electron's own install.js with a SCRUBBED env, so a
 *       blocked attacker cannot be funnelled into an unpinned downloader.
 *
 * Named mutants this suite is the tripwire for: DIGESTNOTCHECKED, POISONKEPT,
 * FENCEDROPPED, ANCHORFROMTARGET, INSTALLERENVLEAKED.
 *
 * No network, no real extraction: downloadArtifact, extract, spawn and the lock
 * are injected everywhere.
 */

// ── NAMED MUTANTS ──────────────────────────────────────────────────────────
// Each is a ONE-LINE sabotage, applied and reverted by byte copy, MEASURED
// 2026-09-07 against the named test via `npx jest <this file> -t "<name>"`
// (exit 1 in every case). The red set was not enumerated beyond the named test.
//
// DIGESTNOTCHECKED   electron-install.js :: repairElectron — replace the
//   `const gate = verifyArtifact(...)` line with `{ verdict: 'verified',
//   allowed: true }`, i.e. extract the cached zip without hashing it.
//   RED: "a MISMATCHING cached zip is NOT extracted" (extract called 1x, not 0).
// POISONKEPT         electron-provision.js :: rejectCachedZip — `if (false &&`
//   before the mismatch/fence condition, so nothing is ever deleted.
//   RED: "a mismatched zip INSIDE a resolved cache root is deleted"
//   (existsSync true, expected false).
// FENCEDROPPED       electron-provision.js :: mayDeleteRejectedZip — replace the
//   basename check with a bare `return true`, dropping the fence.
//   RED: "a mismatched zip OUTSIDE every cache root is left alone"
//   (the zip outside every root was deleted).
// ANCHORFROMTARGET   electron-trust.js :: resolveAnchor — replace the self-anchor
//   push with the electronDir push, so the SCANNED tree's own checksums.json is
//   read first and vouches for its own bytes.
//   RED: "the ANCHOR comes from the running amicus, not the scanned target dir"
//   (poison extracted). Also red: electron-trust.test.js "prefers the RUNNING…".
// INSTALLERENVLEAKED electron-install.js :: runInstaller — `const env = {
//   ...process.env };` instead of scrubbedChildEnv(...).
//   RED: "the last-resort install.js spawn gets no repo-plantable electron name"
//   (npm_config_electron_mirror arrived as "http://attacker.example/evil/").
// ───────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const os = require('os');
const path = require('path');

const ei = require('../src/sidecar/electron-install');
const { controlledProvision } = require('../src/sidecar/electron-provision');
const {
  fakeElectronDir, seedElectronAnchor, fakeChecksums, SELF_ANCHOR_OFF, ZIP_BODY, ZIP_SHA256,
} = require('./helpers/fake-electron-dir');

const VERSION = '43.1.1';
const PLATFORM = 'win32';
const ARCH = 'x64';
const ZIP_NAME = `electron-v${VERSION}-${PLATFORM}-${ARCH}.zip`;
const POISON = 'POISONED-BYTES';

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** A zip at <dir>/<sha>/<name>. `underCacheRoot:false` puts it in a bare temp dir. */
function writeZip({ body = ZIP_BODY, name = ZIP_NAME, root = mkTmp('amicus-zip-') } = {}) {
  const shaDir = path.join(root, 'a'.repeat(16));
  fs.mkdirSync(shaDir, { recursive: true });
  const zip = path.join(shaDir, name);
  fs.writeFileSync(zip, body);
  return zip;
}

/** repairElectron with every leaf injected; returns { res, extract, spawn, dir, distDir, exeName }. */
async function repair({ dir, exeName, distDir, zip, cacheOnly = false, deps = {}, extractWrites = true }) {
  const extract = jest.fn(async (_zip, opts) => {
    if (extractWrites) { fs.writeFileSync(path.join(opts.dir, exeName), 'MZextracted'); }
  });
  const spawn = jest.fn();
  const res = await ei.repairElectron({
    cacheOnly,
    electronDir: dir,
    platform: PLATFORM,
    version: VERSION,
    arch: ARCH,
    deps: {
      ...SELF_ANCHOR_OFF,
      cachedZip: () => zip,
      extract,
      spawn,
      acquireLock: () => ({ release: () => {} }),
      ...deps,
    },
  });
  return { res, extract, spawn, distDir };
}

// stderr is where the self-heal narrates; silence it and keep what was written.
let stderr;
let stderrSpy;
beforeEach(() => {
  stderr = [];
  stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation((chunk) => { stderr.push(String(chunk)); return true; });
});
afterEach(() => { stderrSpy.mockRestore(); });

describe('C1 — the digest is PINNED on the network path', () => {
  test('controlledProvision passes checksums for exactly the artifact it is fetching', async () => {
    const downloadArtifact = jest.fn(async () => '/tmp/out.zip');
    const extractFromCache = jest.fn(async () => {});
    await controlledProvision({
      electronDir: '/tmp/pkg',
      platform: PLATFORM,
      arch: ARCH,
      version: VERSION,
      anchor: { table: fakeChecksums({ version: VERSION, platform: PLATFORM, arch: ARCH }), source: '<test>' },
      downloadArtifact,
      extract: jest.fn(),
      extractFromCache,
      fs,
      env: {},
      downloadMs: 1000,
    });
    const opts = downloadArtifact.mock.calls[0][0];
    // THE control: with `checksums` supplied, @electron/get writes SHASUMS256.txt
    // locally and never fetches one from the mirror.
    expect(opts.checksums).toEqual({ [ZIP_NAME]: ZIP_SHA256 });
    expect(extractFromCache).toHaveBeenCalledTimes(1);
  });

  test('with NO anchor entry the `checksums` key is ABSENT, never an empty table', async () => {
    // An empty object is a hard throw upstream ("cannot generate a valid
    // SHASUMS256.txt"), and a table missing this artifact fails the download —
    // both would turn a legacy package into a permanent provision failure.
    const downloadArtifact = jest.fn(async () => '/tmp/out.zip');
    for (const anchor of [null, { table: { 'electron-v1.0.0-linux-x64.zip': ZIP_SHA256 }, source: '<test>' }]) {
      await controlledProvision({
        electronDir: '/tmp/pkg', platform: PLATFORM, arch: ARCH, version: VERSION, anchor,
        downloadArtifact, extract: jest.fn(), extractFromCache: jest.fn(async () => {}), fs, env: {},
      });
    }
    expect(downloadArtifact.mock.calls[0][0]).not.toHaveProperty('checksums');
    expect(downloadArtifact.mock.calls[1][0]).not.toHaveProperty('checksums');
  });

  test('repairElectron carries the anchor into the download it drives', async () => {
    const { dir, exeName, distDir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const downloadArtifact = jest.fn(async () => writeZip());
    const { res } = await repair({ dir, exeName, distDir, zip: null, deps: { downloadArtifact } });
    expect(res.repaired).toBe(true);
    expect(downloadArtifact.mock.calls[0][0].checksums).toEqual({ [ZIP_NAME]: ZIP_SHA256 });
  });
});

describe('C2 — the cached zip is hashed BEFORE it is extracted', () => {
  test('a MATCHING cached zip is extracted, as before (DIGESTNOTCHECKED)', async () => {
    const { dir, exeName, distDir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const { res, extract } = await repair({ dir, exeName, distDir, zip: writeZip(), cacheOnly: true });
    expect(extract).toHaveBeenCalledTimes(1);
    expect(res.repaired).toBe(true);
    expect(res.unverified).toBeUndefined();
  });

  test('a MISMATCHING cached zip is NOT extracted (DIGESTNOTCHECKED)', async () => {
    const { dir, exeName, distDir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const { res, extract } = await repair({
      dir, exeName, distDir, zip: writeZip({ body: POISON }), cacheOnly: true,
    });
    expect(extract).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(distDir, exeName))).toBe(false);
    expect(res.repaired).toBe(false);
    expect(res.integrity).toBe('mismatch');
    expect(res.reason).toMatch(/REFUSED/);
    expect(stderr.join('')).toMatch(/Electron artifact REFUSED/);
  });

  test('online, a refused cache entry falls through to the controlled download', async () => {
    const { dir, exeName, distDir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const downloadArtifact = jest.fn(async () => writeZip());
    const { res, extract } = await repair({
      dir, exeName, distDir, zip: writeZip({ body: POISON }), deps: { downloadArtifact },
    });
    expect(downloadArtifact).toHaveBeenCalledTimes(1);
    expect(extract).toHaveBeenCalledTimes(1);       // the DOWNLOADED zip, not the poison
    expect(res.repaired).toBe(true);
  });

  test('NO ANCHOR extracts as before and MARKS the result unverified', async () => {
    // A package predating checksums.json must not be pushed into a permanent
    // re-download loop — refusing here would break exactly that machine.
    const { dir, exeName, distDir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    fs.rmSync(path.join(dir, 'checksums.json'));
    const { res, extract } = await repair({ dir, exeName, distDir, zip: writeZip(), cacheOnly: true });
    expect(extract).toHaveBeenCalledTimes(1);
    expect(res.repaired).toBe(true);
    expect(res.unverified).toBe(true);
  });

  test('an anchor with no entry for THIS artifact is the same "no anchor" case', async () => {
    const { dir, exeName, distDir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    seedElectronAnchor(dir, { table: { 'electron-v43.1.1-darwin-arm64.zip': ZIP_SHA256 } });
    const { res, extract } = await repair({ dir, exeName, distDir, zip: writeZip({ body: POISON }), cacheOnly: true });
    expect(extract).toHaveBeenCalledTimes(1);
    expect(res.unverified).toBe(true);
  });

  test('AMICUS_ALLOW_UNVERIFIED_ELECTRON=1 downgrades the gate to a warning', async () => {
    const { dir, exeName, distDir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    process.env.AMICUS_ALLOW_UNVERIFIED_ELECTRON = '1';
    try {
      const { res, extract } = await repair({
        dir, exeName, distDir, zip: writeZip({ body: POISON }), cacheOnly: true,
      });
      expect(extract).toHaveBeenCalledTimes(1);
      expect(res.repaired).toBe(true);
      expect(stderr.join('')).toMatch(/AMICUS_ALLOW_UNVERIFIED_ELECTRON=1/);
    } finally {
      delete process.env.AMICUS_ALLOW_UNVERIFIED_ELECTRON;
    }
  });

  test('the ANCHOR comes from the running amicus, not the scanned target dir (ANCHORFROMTARGET)', async () => {
    // The `doctor --fix` shape: electronDir was found by a FILESYSTEM SCAN, so its
    // own checksums.json is as untrusted as the zip. Here it vouches for the poison
    // and the running amicus's anchor does not — the poison must still be refused.
    const { dir, exeName, distDir } = fakeElectronDir({ withExe: false, platform: PLATFORM, body: POISON });
    const self = seedElectronAnchor(mkTmp('amicus-self-'), { version: VERSION });
    const { res, extract } = await repair({
      dir, exeName, distDir, zip: writeZip({ body: POISON }), cacheOnly: true,
      deps: { selfElectronDir: self },
    });
    expect(extract).not.toHaveBeenCalled();
    expect(res.integrity).toBe('mismatch');
  });
});

describe('C2 — the poison delete is FENCED', () => {
  let saved;
  beforeEach(() => { saved = { ...process.env }; });
  afterEach(() => {
    for (const k of ['ELECTRON_CACHE', 'electron_config_cache']) {
      if (k in saved) { process.env[k] = saved[k]; } else { delete process.env[k]; }
    }
  });

  test('a mismatched zip INSIDE a resolved cache root is deleted (POISONKEPT)', async () => {
    const cacheRoot = mkTmp('amicus-cacheroot-');
    process.env.ELECTRON_CACHE = cacheRoot;
    const { dir, exeName, distDir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const zip = writeZip({ body: POISON, root: cacheRoot });
    const { res } = await repair({ dir, exeName, distDir, zip, cacheOnly: true });
    expect(fs.existsSync(zip)).toBe(false);
    expect(res.reason).toMatch(/removed/i);
  });

  test('a mismatched zip OUTSIDE every cache root is left alone (FENCEDROPPED)', async () => {
    const cacheRoot = mkTmp('amicus-cacheroot-');
    process.env.ELECTRON_CACHE = cacheRoot;
    const { dir, exeName, distDir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const zip = writeZip({ body: POISON, root: mkTmp('amicus-elsewhere-') });   // NOT under any root
    const { res, extract } = await repair({ dir, exeName, distDir, zip, cacheOnly: true });
    // Still refused — the fence governs the DELETE, never the gate.
    expect(extract).not.toHaveBeenCalled();
    expect(res.integrity).toBe('mismatch');
    expect(fs.existsSync(zip)).toBe(true);
    expect(res.reason).toMatch(/left in place/i);
  });

  test('a mismatched file whose BASENAME is not the artifact is left alone (FENCEDROPPED)', async () => {
    const cacheRoot = mkTmp('amicus-cacheroot-');
    process.env.ELECTRON_CACHE = cacheRoot;
    const { dir, exeName, distDir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const zip = writeZip({ body: POISON, name: 'something-else.zip', root: cacheRoot });
    const { res } = await repair({ dir, exeName, distDir, zip, cacheOnly: true });
    expect(fs.existsSync(zip)).toBe(true);
    expect(res.integrity).toBe('mismatch');
  });

  test('an UNREADABLE candidate is refused and never deleted', async () => {
    const cacheRoot = mkTmp('amicus-cacheroot-');
    process.env.ELECTRON_CACHE = cacheRoot;
    const { dir, exeName, distDir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const { res, extract } = await repair({
      dir, exeName, distDir, zip: path.join(cacheRoot, 'gone', ZIP_NAME), cacheOnly: true,
    });
    expect(extract).not.toHaveBeenCalled();
    expect(res.integrity).toBe('unreadable');
  });
});

describe('C3 — the installer spawn env is SCRUBBED (INSTALLERENVLEAKED)', () => {
  const HOSTILE = {
    npm_config_electron_mirror: 'http://attacker.example/evil/',
    npm_config_electron_use_remote_checksums: '1',
    npm_package_config_electron_mirror: 'http://attacker.example/evil/',
    npm_config_platform: 'linux',
    npm_config_arch: 'arm64',
    ELECTRON_MIRROR: 'https://mirror.corp/electron/',
  };
  let saved;
  beforeEach(() => {
    saved = {};
    for (const [k, v] of Object.entries(HOSTILE)) { saved[k] = process.env[k]; process.env[k] = v; }
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) { delete process.env[k]; } else { process.env[k] = v; }
    }
  });

  test('the last-resort install.js spawn gets no repo-plantable electron name', async () => {
    const { dir, exeName, distDir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const downloadArtifact = jest.fn(async () => { throw new Error('network blocked'); });
    const { spawn } = await repair({ dir, exeName, distDir, zip: null, deps: { downloadArtifact } });

    expect(spawn).toHaveBeenCalledTimes(1);
    const env = spawn.mock.calls[0][2].env;
    expect(env.npm_config_electron_mirror).toBeUndefined();
    expect(env.npm_config_electron_use_remote_checksums).toBeUndefined();
    expect(env.npm_package_config_electron_mirror).toBeUndefined();
    expect(env.npm_config_platform).toBeUndefined();
    expect(env.npm_config_arch).toBeUndefined();
    // amicus's own resolution is pinned under the names install.js ranks first...
    expect(env.ELECTRON_INSTALL_PLATFORM).toBe(PLATFORM);
    expect(env.ELECTRON_INSTALL_ARCH).toBe(ARCH);
    // ...and the machine owner's BARE mirror survives, because a repo cannot set it.
    expect(env.ELECTRON_MIRROR).toBe('https://mirror.corp/electron/');
    // process.env itself is never mutated.
    expect(process.env.npm_config_electron_mirror).toBe(HOSTILE.npm_config_electron_mirror);
  });
});

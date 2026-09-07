// tests/electron-trust-wiring.test.js
'use strict';

/**
 * The Electron trust boundary, WIRED (v4.9.5).
 *
 * tests/sidecar/electron-trust.test.js pins the primitives. This suite pins the
 * places they are actually load-bearing, because a gate nobody calls is a gate
 * that does not exist:
 *
 *   C1  controlledProvision passes `checksums` to downloadArtifact, so
 *       @electron/get writes a LOCAL SHASUMS256.txt and never fetches one from a
 *       mirror an attacker may have chosen.
 *
 * No network, no real extraction: downloadArtifact, extract, spawn and the lock
 * are injected everywhere.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ei = require('../src/sidecar/electron-install');
const { controlledProvision } = require('../src/sidecar/electron-provision');
const {
  fakeElectronDir, fakeChecksums, SELF_ANCHOR_OFF, ZIP_BODY, ZIP_SHA256,
} = require('./helpers/fake-electron-dir');

const VERSION = '43.1.1';
const PLATFORM = 'win32';
const ARCH = 'x64';
const ZIP_NAME = `electron-v${VERSION}-${PLATFORM}-${ARCH}.zip`;

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

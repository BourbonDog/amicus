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
 *   C2  repairElectron HASHES the cached artifact's bytes against the anchor
 *       BEFORE anything is extracted, deletes a mismatch only through the fence,
 *       and treats "no anchor" as a mark rather than a refusal.
 *   B1  a failed controlled provision spawns NOTHING. The last-resort
 *       install.js fallback is deleted, because it downloaded and extracted
 *       outside every control above.
 *
 * Named mutants this suite is the tripwire for: DIGESTNOTCHECKED, POISONKEPT,
 * FENCEDROPPED, ANCHORFROMTARGET, INSTALLERBACK, INPROCESSUNSCRUBBED.
 *
 * No network, no real extraction: downloadArtifact, extract and the lock are
 * injected everywhere.
 */

// ── NAMED MUTANTS ──────────────────────────────────────────────────────────
// Each is a ONE-LINE sabotage, applied and reverted by byte copy, MEASURED
// 2026-09-07 against the named test via `npx jest <this file> -t "<name>"`
// (exit 1 in every case). The red set was not enumerated beyond the named test.
//
// DIGESTNOTCHECKED   electron-repair-cache.js :: repairFromCache — replace the
//   `const gate = verifyArtifactBytes(...)` line with `{ verdict: 'verified',
//   allowed: true }`, i.e. extract the cached artifact without hashing it.
//   RED: "a MISMATCHING cached zip is NOT extracted" (extract called 1x, not 0).
// POISONKEPT         electron-refuse.js :: rejectCachedZip — `if (false &&`
//   before the mismatch/fence condition, so nothing is ever deleted.
//   RED: "a mismatched zip INSIDE a resolved cache root is deleted"
//   (existsSync true, expected false).
// FENCEDROPPED       electron-provision.js :: mayDeleteRejectedZip — replace the
//   basename check with a bare `return true`, dropping the fence.
//   RED: "a mismatched zip OUTSIDE every cache root is left alone"
//   (the zip outside every root was deleted).
// ANCHORFROMTARGET   electron-trust.js :: resolveAnchor — `for (const dir of
//   [electronDir])`, so the SCANNED tree's own checksums.json is read and
//   vouches for its own bytes.
//   RED: "the ANCHOR comes from the running amicus, not the scanned target dir"
//   (poison extracted). Also red: electron-trust.test.js "prefers the RUNNING…".
// INSTALLERBACK      electron-install.js :: repairElectron — restore the
//   `try { runInstaller(...) } catch {}` fallback in the provision catch (and
//   the helper it calls).
//   RED: "a failed controlled download spawns NOTHING".
//
// ── ADDED BY THE REVIEW REPAIR (measured 2026-09-07, same method) ───────────
// ANCHORVERSIONFROMTARGET  electron-trust.js :: resolveAnchor — condition the
//   self rung on the version read out of <electronDir>/package.json again.
//   RED: "a planted package.json version cannot make the scanned tree its own
//   anchor" (res.unverified undefined — the poison came back VERIFIED).
// SCRUBCASESENSITIVE       electron-trust.js :: isRepoPlantedName — drop the
//   `.toLowerCase()`.
//   RED: tests/sidecar/electron-trust.test.js "removes the UPPER-case spellings
//   too" (NPM_CONFIG_ELECTRON_MIRROR survived into the child env).
// UNSAFELAUNDERED          electron-install.js — `if (false)` in place of either
//   `isUnsafeArchive(...)` guard. Measured at BOTH catch sites.
//   RED: "from the CACHE: not retried, not deleted, not called corrupt" and
//   "from the DOWNLOAD: install.js is never spawned with the refused archive".
// HATCHNOTONDOWNLOAD       electron-provision.js :: controlledProvision —
//   `if (false && digest && policy.allowUnverified)`.
//   RED: "with the hatch set, the download is NOT pinned to the published digest".
// REFUSALDROPPED           electron-install.js — delete the line that folds
//   `refusal` into the returned object.
//   RED: "online, a REFUSED cache entry plus a failed download reports the
//   refusal, not 'not provisioned'".
// ADVICEAFTERDELETE        electron-refuse.js :: rejectCachedZip — move the
//   removal notice back above the hatch advice.
//   RED: "the refusal tells the user about the hatch BEFORE it tells them the
//   file is gone".
// POSTINSTALLREASONDROPPED scripts/postinstall.js — delete the one-line
//   `result.integrity` notice.
//   RED: tests/postinstall-provision-electron.test.js "a trust REFUSAL is
//   surfaced, not flattened into 'not provisioned yet'".
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
    // A REAL file: v4.9.6's second round stages the download and hashes the copy,
    // so a path that does not exist is refused before extraction is ever reached.
    const downloadArtifact = jest.fn(async () => writeZip());
    const extract = jest.fn(async () => {});
    await controlledProvision({
      electronDir: mkTmp('amicus-pkg-'),
      platform: PLATFORM,
      arch: ARCH,
      version: VERSION,
      anchor: { table: fakeChecksums({ version: VERSION, platform: PLATFORM, arch: ARCH }), source: '<test>' },
      downloadArtifact,
      extract,
      fs,
      env: {},
      downloadMs: 1000,
    });
    const opts = downloadArtifact.mock.calls[0][0];
    // THE control: with `checksums` supplied, @electron/get writes SHASUMS256.txt
    // locally and never fetches one from the mirror.
    expect(opts.checksums).toEqual({ [ZIP_NAME]: ZIP_SHA256 });
    expect(extract).toHaveBeenCalledTimes(1);
    // ...and what it was handed is the BUFFER amicus read and hashed, not a name.
    expect(Buffer.isBuffer(extract.mock.calls[0][0])).toBe(true);
    expect(extract.mock.calls[0][0].toString('utf8')).toBe(ZIP_BODY);
  });

  test('with NO anchor entry the `checksums` key is ABSENT, never an empty table', async () => {
    // An empty object is a hard throw upstream ("cannot generate a valid
    // SHASUMS256.txt"), and a table missing this artifact fails the download —
    // both would turn a legacy package into a permanent provision failure.
    const downloadArtifact = jest.fn(async () => writeZip());
    for (const anchor of [null, { table: { 'electron-v1.0.0-linux-x64.zip': ZIP_SHA256 }, source: '<test>' }]) {
      await controlledProvision({
        electronDir: '/tmp/pkg', platform: PLATFORM, arch: ARCH, version: VERSION, anchor,
        downloadArtifact, extract: jest.fn(), fs, env: {},
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
    // v4.9.6 (second round): an artifact amicus cannot READ is refused by
    // readArtifactBytes, one step earlier than the hash. `integrity` is set, so
    // postinstall still prints the reason; what matters is unchanged: nothing
    // extracted, nothing deleted. (The intermediate staged-copy cut called this
    // `unstaged` and blamed the temp directory — there is no temp copy now, and
    // council finding A3 was exactly that misdiagnosis.)
    const cacheRoot = mkTmp('amicus-cacheroot-');
    process.env.ELECTRON_CACHE = cacheRoot;
    const { dir, exeName, distDir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const { res, extract } = await repair({
      dir, exeName, distDir, zip: path.join(cacheRoot, 'gone', ZIP_NAME), cacheOnly: true,
    });
    expect(extract).not.toHaveBeenCalled();
    expect(res.integrity).toBe('unreadable');
    expect(res.repaired).toBe(false);
    expect(res.reason).toMatch(/could not be opened or read at all/);
  });
});

describe('C2 — the anchor cannot be demoted by DATA (ANCHORVERSIONFROMTARGET)', () => {
  // The review finding the four tests below exist for: ANCHORFROMTARGET was
  // reachable without touching any code. `version` is read out of
  // <electronDir>/package.json whenever the caller passes none — and the ONE
  // production caller, src/utils/doctor-electron-mcp-check.js:130-133, passes
  // {electronDir, timeoutMs} and never a version — so a planted
  // {"version":"99.0.0"} used to make the self anchor "not the same version",
  // demote rung 1, and let the scanned tree's own checksums.json vouch for its
  // own bytes. MEASURED on the tree before the fix: {"repaired":true} over
  // POISONED-BYTES, reported by doctor as "(self-healed 1 npx-cache copy)".
  const V99 = 'electron-v99.0.0-win32-x64.zip';

  test('a planted package.json version cannot make the scanned tree its own anchor', async () => {
    const { dir, exeName, distDir } = fakeElectronDir({
      withExe: false, platform: PLATFORM, version: '99.0.0', body: POISON,   // vouches for the POISON
    });
    const self = seedElectronAnchor(mkTmp('amicus-self-'), { version: VERSION });   // 43.1.1, honest
    const extract = jest.fn(async (_z, o) => { fs.writeFileSync(path.join(o.dir, exeName), 'MZ'); });
    const res = await ei.repairElectron({
      cacheOnly: true,
      electronDir: dir,
      platform: PLATFORM,
      arch: ARCH,                                    // NO version: the doctor --fix shape
      deps: {
        selfElectronDir: self,
        cachedZip: () => writeZip({ body: POISON, name: V99 }),
        extract,
        spawn: jest.fn(),
        acquireLock: () => ({ release: () => {} }),
      },
    });
    // The trusted anchor has no row for a version it never shipped, so the bytes
    // are UNVERIFIED and say so. What must never happen again is the poison being
    // reported as verified because the directory under audit said so.
    expect(res.unverified).toBe(true);
    expect(stderr.join('')).toMatch(/could not be verified/);
    expect(distDir).toBeDefined();
  });

  test('when the version is NOT lied about, the same poison is refused', async () => {
    const { dir, exeName, distDir } = fakeElectronDir({ withExe: false, platform: PLATFORM, body: POISON });
    const self = seedElectronAnchor(mkTmp('amicus-self-'), { version: VERSION });
    const { res, extract } = await repair({
      dir, exeName, distDir, zip: writeZip({ body: POISON }), cacheOnly: true, deps: { selfElectronDir: self },
    });
    expect(extract).not.toHaveBeenCalled();
    expect(res.integrity).toBe('mismatch');
  });
});

describe('C4 — a security refusal is terminal AT THE CALL SITE (UNSAFELAUNDERED)', () => {
  // unzip.js classifies extract-zip's path-traversal refusals as terminal. That
  // held only inside unzip.js: both catch blocks in repairElectron swallowed the
  // refusal without reading err.code and laundered it back into the retry the
  // control forbids. MEASURED before the fix — network path: runInstaller spawned
  // `node <electronDir>/install.js`; cache path: the zip was deleted through the
  // UNFENCED fs.rmSync and reported as "corrupt and removed".
  const unsafe = () => {
    const e = new Error('refusing to extract cached.zip: invalid relative path: ../../evil');
    e.code = 'UNZIP_UNSAFE_ARCHIVE';
    throw e;
  };

  test('from the CACHE: not retried, not deleted, not called corrupt', async () => {
    const { dir, exeName, distDir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const zip = writeZip();
    const { res, spawn } = await repair({
      dir, exeName, distDir, zip, cacheOnly: true, deps: { extract: jest.fn(unsafe) },
    });
    expect(spawn).not.toHaveBeenCalled();
    expect(fs.existsSync(zip)).toBe(true);                 // evidence, not swept up
    expect(res.integrity).toBe('unsafe-archive');
    expect(res.reason).not.toMatch(/corrupt/i);
    expect(res.reason).toMatch(/REFUSED/);
    expect(stderr.join('')).toMatch(/unsafe archive/i);
  });

  test('from the DOWNLOAD: install.js is never spawned with the refused archive', async () => {
    const { dir, exeName, distDir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const downloadArtifact = jest.fn(async () => writeZip());
    const { res, spawn } = await repair({
      dir, exeName, distDir, zip: null, deps: { downloadArtifact, extract: jest.fn(unsafe) },
    });
    expect(downloadArtifact).toHaveBeenCalledTimes(1);
    // Nothing is spawned on ANY path now (B1), so this asserts the narrower
    // thing that still matters: the refusal is returned as itself rather than
    // being reported as an ordinary provision failure.
    expect(spawn).not.toHaveBeenCalled();
    expect(res.integrity).toBe('unsafe-archive');
    expect(res.reason).toMatch(/was REFUSED/);
  });

  test('a CLASSIFIED bad archive still deletes and still falls through, with a reason', async () => {
    // A1 (council, confirmed 4 of 4): this branch used to delete the user's cache
    // entry and then, when the re-download also failed, return a bare
    // {repaired:false} with NO reason — the one message that would have explained
    // where their artifact went. The eviction is unchanged for an archive the
    // extractor positively identified as bad; the silence is not.
    const { dir, exeName, distDir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const zip = writeZip();
    const downloadArtifact = jest.fn(async () => { throw new Error('offline'); });
    const badArchive = jest.fn(async () => {
      const e = new Error('end of central directory record signature not found');
      e.code = 'UNZIP_BUFFER_FAILED';
      throw e;
    });
    const { res, spawn } = await repair({
      dir, exeName, distDir, zip, deps: { downloadArtifact, extract: badArchive },
    });
    expect(fs.existsSync(zip)).toBe(false);                // the corrupt-artifact delete still happens
    expect(spawn).not.toHaveBeenCalled();                  // ...and nothing is spawned to rescue it (B1)
    expect(res.integrity).toBe('corrupt-artifact');
    expect(res.reason).toMatch(/was corrupt and removed/);
    expect(res.reason).toMatch(/The controlled download failed: offline/);
  });

  test('an UNCLASSIFIED extract failure KEEPS the artifact, and still falls through with a reason', async () => {
    // THE SAME TEST AS ABOVE USED TO ASSERT THE OPPOSITE, with an uncoded
    // `new Error('unzip blew up')`, and that assertion was the defect: D2's
    // protection was an allow-list of codes that KEEP, so every failure shape
    // nobody enumerated — an internal bug in the extractor, a raw Node errno —
    // deleted the user's cached artifact and told them it "was corrupt". On an
    // air-gapped, hand-seeded cache that destroys the only copy on a guess.
    // The A1 property the old test existed for is preserved below: the reason
    // still survives the fall-through to a failed download.
    const { dir, exeName, distDir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const zip = writeZip();
    const downloadArtifact = jest.fn(async () => { throw new Error('offline'); });
    const { res, spawn } = await repair({
      dir, exeName, distDir, zip, deps: { downloadArtifact, extract: jest.fn(async () => { throw new Error('unzip blew up'); }) },
    });
    expect(fs.existsSync(zip)).toBe(true);                 // KEPT — nothing said the archive was bad
    expect(spawn).not.toHaveBeenCalled();
    expect(res.integrity).toBe('extract-failed');
    expect(res.reason).toMatch(/LEFT IN PLACE/);
    expect(res.reason).not.toMatch(/corrupt/i);
    expect(res.reason).toMatch(/The controlled download failed: offline/);
  });
});

describe('the escape hatch REACHES the download path', () => {
  let saved;
  beforeEach(() => { saved = process.env.AMICUS_ALLOW_UNVERIFIED_ELECTRON; });
  afterEach(() => {
    if (saved === undefined) { delete process.env.AMICUS_ALLOW_UNVERIFIED_ELECTRON; } else { process.env.AMICUS_ALLOW_UNVERIFIED_ELECTRON = saved; }
  });

  test('with the hatch set, the download is NOT pinned to the published digest', async () => {
    // Before: policy went only to verifyArtifact, so the one case the docs
    // describe — a legitimately rebuilt electron, on a machine with no matching
    // zip in any cache root — still downloaded under the official pin, failed
    // sumchecker, fell to install.js, failed its bundled pin too, and returned
    // {repaired:false} with NO reason. The variable did nothing.
    process.env.AMICUS_ALLOW_UNVERIFIED_ELECTRON = '1';
    const { dir, exeName, distDir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const downloadArtifact = jest.fn(async () => writeZip());
    const { res } = await repair({ dir, exeName, distDir, zip: null, deps: { downloadArtifact } });
    expect(downloadArtifact.mock.calls[0][0]).not.toHaveProperty('checksums');
    expect(res.repaired).toBe(true);
    expect(stderr.join('')).toMatch(/AMICUS_ALLOW_UNVERIFIED_ELECTRON=1 — downloading without/);
  });

  test('unset, the same download IS pinned', async () => {
    delete process.env.AMICUS_ALLOW_UNVERIFIED_ELECTRON;
    const { dir, exeName, distDir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const downloadArtifact = jest.fn(async () => writeZip());
    await repair({ dir, exeName, distDir, zip: null, deps: { downloadArtifact } });
    expect(downloadArtifact.mock.calls[0][0].checksums).toEqual({ [ZIP_NAME]: ZIP_SHA256 });
  });
});

describe('a refusal the retry could not rescue still reaches the caller', () => {
  test('online, a REFUSED cache entry plus a failed download reports the refusal, not "not provisioned"', async () => {
    // doctor calls repairElectron WITHOUT cacheOnly (doctor-electron-mcp-check.js
    // :130 and :182), and the refusal used to be dropped on the floor there: the
    // function returned a bare {repaired:false}, so `doctor` printed its generic
    // "not provisioned — headless still works" for a poisoned artifact.
    const { dir, exeName, distDir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const downloadArtifact = jest.fn(async () => { throw new Error('offline'); });
    const { res } = await repair({
      dir, exeName, distDir, zip: writeZip({ body: POISON, root: (() => { const r = mkTmp('amicus-cacheroot-'); process.env.ELECTRON_CACHE = r; return r; })() }),
      deps: { downloadArtifact },
    });
    delete process.env.ELECTRON_CACHE;
    expect(res.repaired).toBe(false);
    expect(res.integrity).toBe('mismatch');
    expect(res.reason).toMatch(/REFUSED/);
  });

  test('the refusal tells the user about the hatch BEFORE it tells them the file is gone', async () => {
    // On an air-gapped box the deleted artifact was the only copy, and advice
    // that arrives after "The file has been removed." arrives too late to use.
    const cacheRoot = mkTmp('amicus-cacheroot-');
    process.env.ELECTRON_CACHE = cacheRoot;
    const { dir, exeName, distDir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    await repair({ dir, exeName, distDir, zip: writeZip({ body: POISON, root: cacheRoot }), cacheOnly: true });
    delete process.env.ELECTRON_CACHE;
    const text = stderr.join('');
    expect(text).toMatch(/has been removed/);
    expect(text.indexOf('AMICUS_ALLOW_UNVERIFIED_ELECTRON=1')).toBeLessThan(text.indexOf('has been removed'));
    expect(text).toMatch(/re-copy it from the machine that downloaded it/);
  });
});

describe('B1 — there is no last-resort installer to bypass the gate with', () => {
  // The BLOCKER (council run 34165289952, seat gpt, confirmed 4 of 4): a failed
  // controlled provision fell through to `node <electronDir>/install.js`, which
  // did its own download and its own extraction outside every control this file
  // pins. Inducing one failure was enough to route around all of them. It was
  // worse than a bypass: install.js pins with `require('./checksums.json')` out
  // of the SCANNED directory, which is the ANCHORFROMTARGET hole rung 1 exists
  // to close, and it extracted unbounded with no traversal classification.
  //
  // Its one claimed justification — "amicus's tree cannot resolve @electron/get
  // but electron's can" — was MEASURED FALSE on this machine: both resolve the
  // same hoisted copy (require.resolve and
  // createRequire(electron/package.json).resolve return
  // node_modules/@electron/get/dist/index.js).
  const HOSTILE = {
    npm_config_electron_mirror: 'http://attacker.example/evil/',
    npm_config_electron_use_remote_checksums: '1',
    npm_package_config_electron_mirror: 'http://attacker.example/evil/',
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

  test('a failed controlled download spawns NOTHING (INSTALLERBACK)', async () => {
    const { dir, exeName, distDir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const downloadArtifact = jest.fn(async () => { throw new Error('network blocked'); });

    const { res, spawn } = await repair({ dir, exeName, distDir, zip: null, deps: { downloadArtifact } });

    expect(downloadArtifact).toHaveBeenCalledTimes(1);
    expect(spawn).not.toHaveBeenCalled();
    expect(res.repaired).toBe(false);
    // ...and the failure is REPORTED, not swallowed into a bare {repaired:false}.
    expect(res.reason).toMatch(/The controlled download failed: network blocked/);
    expect(stderr.join('')).toMatch(/the controlled Electron download did not complete/);
  });

  test("the IN-PROCESS download runs with a SCRUBBED process.env (D5) (INPROCESSUNSCRUBBED)", async () => {
    // Seat D5: the v4.9.6 scrub covered only the deleted install.js SPAWN, while
    // amicus's own controlled download runs @electron/get IN THIS PROCESS off
    // `process.env` and reads the very same names. Filed as a nit because the
    // digest pin refuses redirected bytes anyway — a wasted download, not a
    // compromise — but a stated threat model wider than the code is its own bug.
    // MEASURED against the real @electron/get 5.0.0 with an injected downloader:
    //   UNSCRUBBED -> https://hostile.example/attacker/v43.1.1/electron-...zip
    //   SCRUBBED   -> https://github.com/electron/electron/releases/download/...
    const { dir, exeName, distDir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    let envAtCallTime = null;
    const downloadArtifact = jest.fn(async () => {
      envAtCallTime = { ...process.env };
      return writeZip();
    });

    const { res } = await repair({ dir, exeName, distDir, zip: null, deps: { downloadArtifact } });

    expect(res.repaired).toBe(true);
    // Every repo-plantable name is gone WHILE @electron/get resolves its URL...
    expect(envAtCallTime.npm_config_electron_mirror).toBeUndefined();
    expect(envAtCallTime.npm_config_electron_use_remote_checksums).toBeUndefined();
    expect(envAtCallTime.npm_package_config_electron_mirror).toBeUndefined();
    // ...the machine owner's BARE mirror is untouched, because a repo cannot set it...
    expect(envAtCallTime.ELECTRON_MIRROR).toBe('https://mirror.corp/electron/');
    // ...and process.env is whole again afterwards.
    expect(process.env.npm_config_electron_mirror).toBe(HOSTILE.npm_config_electron_mirror);
    expect(process.env.npm_package_config_electron_mirror).toBe(HOSTILE.npm_package_config_electron_mirror);
  });

  test('the installer entry point is gone from the module surface', () => {
    // Not "unused" — GONE. An exported spawn-the-installer helper is one call
    // site away from being a bypass again.
    // eslint-disable-next-line global-require
    expect(require('../src/sidecar/electron-provision').runInstaller).toBeUndefined();
    // eslint-disable-next-line global-require
    expect(require('../src/sidecar/electron-trust').scrubbedChildEnv).toBeUndefined();
  });

  test('repairElectron takes no `deps.spawn` to drive a child with', async () => {
    // The parameter is gone from the signature, so a caller cannot reintroduce
    // the path by injection either.
    const { dir, exeName, distDir } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const spawn = jest.fn(() => { throw new Error('nothing may be spawned'); });
    const downloadArtifact = jest.fn(async () => { throw new Error('offline'); });

    const { res } = await repair({ dir, exeName, distDir, zip: null, deps: { downloadArtifact, spawn } });

    expect(spawn).not.toHaveBeenCalled();
    expect(res.repaired).toBe(false);
  });
});

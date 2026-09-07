// tests/electron-unverified-mark.test.js
'use strict';

/**
 * F3 — the `unverified` mark existed only on the cache route (v4.9.6).
 *
 * Council seats C1 (major) + B3 (minor): "on the download route a no-digest
 * provision silently omits the `checksums` pin, extracts the mirror-supplied
 * bytes, and returns plain `{ repaired: true }` with no `unverified` mark and no
 * log line" — while `CHANGELOG.md` and `docs/troubleshooting.md` both promise
 * that an artifact no published digest covers is "extracted and marked
 * `unverified` rather than refused".
 *
 * The docs were right about what should happen; the code was missing it. The
 * rule, stated once: an outcome is marked `unverified` exactly when the bytes
 * that became the dist were never checked against a digest AMICUS anchored —
 * a cached artifact with no anchor row (v4.9.5 already did this), or a download
 * that went out with no `checksums` key, whether because there was no anchor row
 * or because `AMICUS_ALLOW_UNVERIFIED_ELECTRON=1` dropped the pin.
 *
 * ── NAMED MUTANT ──────────────────────────────────────────────────────────
 * DOWNLOADUNMARKED  electron-install.js :: repairElectron — delete the line that
 *   folds `unverified: true` in when `provision.pinned` is false.
 *   RED: "a no-digest DOWNLOAD is MARKED unverified, not silently accepted".
 * ──────────────────────────────────────────────────────────────────────────
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ei = require('../src/sidecar/electron-install');
const { controlledProvision } = require('../src/sidecar/electron-provision');
const { fakeElectronDir, SELF_ANCHOR_OFF, ZIP_BODY } = require('./helpers/fake-electron-dir');

const VERSION = '43.1.1';
const PLATFORM = 'win32';
const ARCH = 'x64';
const ZIP_NAME = `electron-v${VERSION}-${PLATFORM}-${ARCH}.zip`;

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeZip({ body = ZIP_BODY, root = mkTmp('amicus-zip-') } = {}) {
  const shaDir = path.join(root, 'a'.repeat(16));
  fs.mkdirSync(shaDir, { recursive: true });
  const zip = path.join(shaDir, ZIP_NAME);
  fs.writeFileSync(zip, body);
  return zip;
}

/** A fake electron package with NO checksums.json — nothing anchors its artifact. */
function unanchoredElectronDir() {
  const made = fakeElectronDir({ withExe: false, platform: PLATFORM });
  fs.rmSync(path.join(made.dir, 'checksums.json'));
  return made;
}

async function repair({ dir, exeName, zip = null, deps = {}, cacheOnly = false }) {
  const extract = jest.fn(async (_zip, opts) => {
    fs.writeFileSync(path.join(opts.dir, exeName), 'MZextracted');
  });
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
      spawn: jest.fn(),
      acquireLock: () => ({ release: () => {} }),
      downloadArtifact: jest.fn(async () => writeZip()),
      ...deps,
    },
  });
  return { res, extract };
}

let stderr;
let stderrSpy;
let savedHatch;
beforeEach(() => {
  stderr = [];
  stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation((chunk) => { stderr.push(String(chunk)); return true; });
  savedHatch = process.env.AMICUS_ALLOW_UNVERIFIED_ELECTRON;
  delete process.env.AMICUS_ALLOW_UNVERIFIED_ELECTRON;
});
afterEach(() => {
  stderrSpy.mockRestore();
  if (savedHatch === undefined) { delete process.env.AMICUS_ALLOW_UNVERIFIED_ELECTRON; } else { process.env.AMICUS_ALLOW_UNVERIFIED_ELECTRON = savedHatch; }
});

describe('F3 — the download route marks what it could not pin (DOWNLOADUNMARKED)', () => {
  test('a no-digest DOWNLOAD is MARKED unverified, not silently accepted', async () => {
    const { dir, exeName } = unanchoredElectronDir();
    const downloadArtifact = jest.fn(async () => writeZip());

    const { res } = await repair({ dir, exeName, deps: { downloadArtifact } });

    // No anchor row -> no `checksums` key -> @electron/get falls back to the
    // SHASUMS256.txt the MIRROR serves. v4.9.5 returned a bare {repaired:true}.
    expect(downloadArtifact.mock.calls[0][0]).not.toHaveProperty('checksums');
    expect(res.repaired).toBe(true);
    expect(res.unverified).toBe(true);
    expect(stderr.join('')).toMatch(/could not be pinned/);
    expect(stderr.join('')).toContain(ZIP_NAME);
    expect(stderr.join('')).toMatch(/reported as unverified/);
  });

  test('a PINNED download is NOT marked — the mark means something', async () => {
    const { dir, exeName } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const downloadArtifact = jest.fn(async () => writeZip());

    const { res } = await repair({ dir, exeName, deps: { downloadArtifact } });

    expect(downloadArtifact.mock.calls[0][0]).toHaveProperty('checksums');
    expect(res.repaired).toBe(true);
    expect(res.unverified).toBeUndefined();
    expect(stderr.join('')).not.toMatch(/could not be pinned/);
  });

  test('the hatch drops the pin, so the hatch-driven download is marked too', async () => {
    // AMICUS_ALLOW_UNVERIFIED_ELECTRON=1 is exactly "these bytes are not the
    // published ones and I know it" — the result must say so, not read as clean.
    process.env.AMICUS_ALLOW_UNVERIFIED_ELECTRON = '1';
    const { dir, exeName } = fakeElectronDir({ withExe: false, platform: PLATFORM });
    const downloadArtifact = jest.fn(async () => writeZip());

    const { res } = await repair({ dir, exeName, deps: { downloadArtifact } });

    expect(downloadArtifact.mock.calls[0][0]).not.toHaveProperty('checksums');
    expect(res.repaired).toBe(true);
    expect(res.unverified).toBe(true);
    expect(stderr.join('')).toMatch(/AMICUS_ALLOW_UNVERIFIED_ELECTRON=1 — downloading without/);
  });

  test('a no-digest CACHE artifact that fails to extract carries the mark through the download', async () => {
    // The second half of the finding: the fall-through from a broken no-digest
    // cache entry lands on the same unpinned download, and used to lose the mark
    // that the cache route would have applied had the extract succeeded.
    const { dir, exeName } = unanchoredElectronDir();
    const cached = writeZip();
    let calls = 0;
    const extract = jest.fn(async (_zip, opts) => {
      calls += 1;
      if (calls === 1) { throw new Error('end of central directory record signature not found'); }
      fs.writeFileSync(path.join(opts.dir, exeName), 'MZredownloaded');
    });

    const { res } = await repair({ dir, exeName, zip: cached, deps: { extract } });

    expect(calls).toBe(2);
    expect(res.repaired).toBe(true);
    expect(res.unverified).toBe(true);
  });

  test('an unpinned download that produced no exe is a FAILURE, not an unverified success', async () => {
    const { dir, exeName } = unanchoredElectronDir();
    const extract = jest.fn(async () => { /* no exe written */ });

    const { res } = await repair({ dir, exeName, deps: { extract } });

    expect(res.repaired).toBe(false);
    expect(res.unverified).toBeUndefined();
  });

  test('the cache route still marks a no-digest artifact, exactly as v4.9.5 did', async () => {
    const { dir, exeName } = unanchoredElectronDir();
    const { res, extract } = await repair({ dir, exeName, zip: writeZip(), cacheOnly: true });
    expect(extract).toHaveBeenCalledTimes(1);
    expect(res.repaired).toBe(true);
    expect(res.unverified).toBe(true);
  });
});

describe('F3 — controlledProvision reports whether it pinned', () => {
  const base = {
    electronDir: '/tmp/pkg',
    platform: PLATFORM,
    arch: ARCH,
    version: VERSION,
    extract: jest.fn(),
    extractFromCache: jest.fn(async () => {}),
    fs,
    env: {},
  };

  test('pinned:true when the anchor names this artifact', async () => {
    const digest = require('crypto').createHash('sha256').update(ZIP_BODY).digest('hex');
    const out = await controlledProvision({
      ...base,
      anchor: { table: { [ZIP_NAME]: digest }, source: '<test>' },
      downloadArtifact: jest.fn(async () => writeZip()),
    });
    expect(out).toEqual({ pinned: true });
  });

  test('pinned:false, with a stderr NOTE, when it does not', async () => {
    const lines = [];
    const out = await controlledProvision({
      ...base,
      anchor: null,
      downloadArtifact: jest.fn(async () => writeZip()),
      log: (m) => lines.push(m),
    });
    expect(out).toEqual({ pinned: false });
    expect(lines.join('\n')).toMatch(/no published sha256 for electron-v43\.1\.1-win32-x64\.zip/);
    expect(lines.join('\n')).toMatch(/could not be pinned/);
  });
});

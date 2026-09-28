// tests/electron-unlisted-refusal.test.js
'use strict';

/**
 * D-02 (B-SEC-7): a checksums.json that EXISTS but lists no sha256 for the
 * requested Electron artifact is REFUSED as "unlisted". Only a package with NO
 * table at all keeps the legacy extract-and-mark
 * (tests/electron-unverified-mark.test.js pins that half).
 *
 * Until D-02, `expectedDigest` returned the same null for both cases and
 * `verifyArtifactBytes` allowed both. A present but silent table is what a copy
 * installed with a DIFFERENT Electron looks like (`doctor --fix` scans npx
 * caches, and npm resolves the newest `^43` release at each install). It is also
 * what a planted version looks like, and with natural skew nothing needs
 * planting: a file planted in the Electron download cache for the skewed version
 * was extracted into the copy the MCP launches.
 *
 * Every describe below carries its own NAMED MUTANTS. No test touches the
 * network: every repairElectron call injects downloadArtifact, runs cacheOnly, or
 * refuses first.
 */

const os = require('os');
const path = require('path');

const { refuseUnlistedArtifact } = require('../src/sidecar/electron-refuse');

const fs = require('fs');

const ei = require('../src/sidecar/electron-install');
const { controlledProvision } = require('../src/sidecar/electron-provision');
const { repairFromCache } = require('../src/sidecar/electron-repair-cache');
const { fakeElectronDir, seedElectronAnchor, ZIP_BODY, ZIP_SHA256 } = require('./helpers/fake-electron-dir');

const HEX = 'a'.repeat(64);
const POISON = 'POISONED-BYTES';
const SKEW = '43.6.0';
const SKEW_ZIP = `electron-v${SKEW}-win32-x64.zip`;
// F5: what an attacker-written string can smuggle into a terminal line, and how to catch it.
const ESC = '\u001b';
const FORGED_LINE = '[amicus] Electron artifact verified. Nothing further is required.';
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
const BIDI_CONTROLS = /[\u202a-\u202e\u2066-\u2069\u200e\u200f\u061c]/;

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** A zip at <root>/<sha>/<name>, the @electron/get cache layout. */
function writeZip({ body = ZIP_BODY, name = 'electron-v43.1.1-win32-x64.zip' } = {}) {
  const shaDir = path.join(mkTmp('amicus-zip-'), 'a'.repeat(16));
  fs.mkdirSync(shaDir, { recursive: true });
  const zip = path.join(shaDir, name);
  fs.writeFileSync(zip, body);
  return zip;
}

/** The doctor --fix shape: a SCANNED copy installed with Electron 43.6.0, whose own
 *  (untrusted) table vouches for its own bytes, and a running amicus on 43.1.1. */
function skewedCopy(body = ZIP_BODY) {
  const made = fakeElectronDir({ withExe: false, platform: 'win32', version: SKEW, body });
  const self = seedElectronAnchor(mkTmp('amicus-self-'), { version: '43.1.1' });
  return { ...made, self };
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

describe('D-02: the unlisted refusal names the version, the table and the fix', () => {
  // NAMED MUTANTS
  //   RAWTABLEPATH electron-refuse.js :: refuseUnlistedArtifact -- drop the
  //     collapseExcerpt() around `anchor.source`. RED: the third test below.
  //   RAWNAMEVERSION electron-refuse.js :: refuseUnlistedArtifact -- drop the
  //     collapseExcerpt() around `fileName` and `version`.
  //     KILLED (R-B3, 2026-09-28): tests/electron-unlisted-refusal.test.js:161, `expect(l).not.toMatch(CONTROL_CHARS)`.
  const NASTY = `${ESC}[31mEVIL${ESC}[0m\n${FORGED_LINE}\n\u202eTNEMHCATTA`;
  const SOURCE = path.join(os.tmpdir(), 'electron', 'checksums.json');

  /** Call the refusal with a collecting log. */
  function refuse({ table, source = SOURCE, fileName, version, platform = 'win32', arch = 'x64' }) {
    const lines = [];
    const out = refuseUnlistedArtifact({
      anchor: { table, source }, fileName, version, platform, arch, log: (m) => lines.push(String(m)),
    });
    return { out, lines };
  }

  test('a table for ANOTHER version names both versions and the repair-that-copy fix', () => {
    const { out, lines } = refuse({
      table: { 'electron-v43.1.1-win32-x64.zip': HEX, 'electron-v43.1.1-darwin-arm64.zip': HEX },
      fileName: 'electron-v43.6.0-win32-x64.zip',
      version: 'v43.6.0',
    });
    expect(out).toMatchObject({ repaired: false, integrity: 'unlisted' });
    expect(out.reason).toBe(
      'Electron artifact electron-v43.6.0-win32-x64.zip was REFUSED: the checksums.json amicus trusts covers'
      + ' Electron v43.1.1, not v43.6.0, so nothing was downloaded or extracted. Repair that copy with its own'
      + ' amicus (for the copy the MCP launches: npx -y amicus@latest doctor --fix); if it is this amicus\'s'
      + ' own Electron, reinstall amicus.',
    );
    expect(lines[0]).toBe('[amicus] Electron artifact REFUSED (no published sha256): electron-v43.6.0-win32-x64.zip');
    expect(lines[1]).toBe(`[amicus]   ${SOURCE}`);
    const text = lines.join('\n');
    expect(text).toMatch(/and so does a planted version/);
    expect(text).toMatch(/AMICUS_ALLOW_UNVERIFIED_ELECTRON=1 BEFORE provisioning again/);
    expect(lines[lines.length - 1]).toBe('[amicus] Headless runs and the council work without the GUI.');
  });

  test('a table that lists the version but not this platform says so, with no skew advice', () => {
    const { out, lines } = refuse({
      table: { 'electron-v43.1.1-darwin-arm64.zip': HEX },
      fileName: 'electron-v43.1.1-freebsd-x64.zip',
      version: 'v43.1.1',
      platform: 'freebsd',
    });
    expect(out.reason).toMatch(/lists Electron v43\.1\.1 but no freebsd-x64 build, so nothing was downloaded or extracted\./);
    expect(out.reason).toMatch(/Electron publishes no build for this platform in that table/);
    const text = lines.join('\n');
    expect(text).not.toMatch(/doctor --fix/);
    expect(text).not.toMatch(/AMICUS_ALLOW_UNVERIFIED_ELECTRON/);
  });

  test('the table path cannot forge an [amicus] line, colour the terminal, or reverse the sentence (RAWTABLEPATH)', () => {
    const { out, lines } = refuse({
      table: { 'electron-v43.1.1-win32-x64.zip': HEX },
      source: path.join(os.tmpdir(), NASTY, 'checksums.json'),
      fileName: 'electron-v43.6.0-win32-x64.zip',
      version: 'v43.6.0',
    });
    for (const l of lines) {
      expect(l).not.toMatch(CONTROL_CHARS);
      expect(l).not.toMatch(BIDI_CONTROLS);
    }
    expect(lines.some((l) => l.startsWith(FORGED_LINE))).toBe(false);
    expect(lines[1]).toContain('EVIL');           // ...and it still says where the table is
    expect(out.reason).not.toContain('\n');
  });

  test('the file name and the version cannot forge a line either, even for a caller that skips the name check (RAWNAMEVERSION)', () => {
    // repairElectron's `isSafeArtifactName` check runs first (the PRECHECKBEFORENAME test
    // below pins that order), so this is belt and braces: the words must not DEPEND on it.
    const { out, lines } = refuse({
      table: { 'electron-v43.1.1-win32-x64.zip': HEX },
      fileName: `electron-v${NASTY}-win32-x64.zip`,
      version: `v${NASTY}`,
    });
    const physical = lines.join('\n').split('\n');   // what a terminal shows, line by line
    for (const l of physical) {
      expect(l).not.toMatch(CONTROL_CHARS);
      expect(l).not.toMatch(BIDI_CONTROLS);
    }
    expect(physical.some((l) => l.startsWith(FORGED_LINE))).toBe(false);
    expect(out.reason).not.toMatch(CONTROL_CHARS);
    expect(out.reason).not.toMatch(BIDI_CONTROLS);
    expect(out.reason).toContain('EVIL');         // ...and it still names what was asked for
  });
});

describe('D-02: the refusal is WIRED before the lock, the cache and the network', () => {
  // The placement IS the property. A refusal inside the gate alone would come
  // AFTER the download, and ensureElectron clears its once-guard on every
  // failure, so every GUI launch would fetch ~100 MB and refuse it again: the
  // re-download loop the legacy allow exists to prevent.
  //
  // NAMED MUTANTS
  //   PRECHECKDROPPED electron-install.js :: repairElectron -- delete the
  //     `isUnlisted(...)` pre-check. RED: the first test below.
  //   HATCHIGNOREDPRECHECK electron-install.js :: repairElectron -- drop
  //     `&& !policy.allowUnverified` from the pre-check. RED: the second test below.
  test("a copy installed with a DIFFERENT Electron is refused against this amicus's table: nothing read, nothing downloaded (PRECHECKDROPPED)", async () => {
    const { dir, self } = skewedCopy(POISON);
    const acquireLock = jest.fn(() => ({ release: () => {} }));
    const cachedZip = jest.fn(() => null);
    const downloadArtifact = jest.fn(async () => writeZip({ body: POISON, name: SKEW_ZIP }));
    const extract = jest.fn();

    const res = await ei.repairElectron({
      electronDir: dir, platform: 'win32', arch: 'x64',   // NO version and NOT cacheOnly: the doctor --fix call
      deps: { selfElectronDir: self, acquireLock, cachedZip, downloadArtifact, extract, spawn: jest.fn() },
    });

    expect(acquireLock).not.toHaveBeenCalled();
    expect(cachedZip).not.toHaveBeenCalled();
    expect(downloadArtifact).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
    expect(res).toMatchObject({ repaired: false, integrity: 'unlisted' });
    expect(res.reason).toMatch(/covers Electron v43\.1\.1, not v43\.6\.0/);
    expect(res.reason).toContain('npx -y amicus@latest doctor --fix');
    expect(stderr.join('')).toContain(`Electron artifact REFUSED (no published sha256): ${SKEW_ZIP}`);
  });

  test('with AMICUS_ALLOW_UNVERIFIED_ELECTRON=1 the skewed copy is repaired and MARKED unverified (HATCHIGNOREDPRECHECK)', async () => {
    process.env.AMICUS_ALLOW_UNVERIFIED_ELECTRON = '1';
    const { dir, exeName, self } = skewedCopy();
    const extract = jest.fn(async (_bytes, opts) => { fs.writeFileSync(path.join(opts.dir, exeName), 'MZextracted'); });

    const res = await ei.repairElectron({
      cacheOnly: true, electronDir: dir, platform: 'win32', arch: 'x64',
      deps: {
        selfElectronDir: self, acquireLock: () => ({ release: () => {} }), extract, spawn: jest.fn(),
        cachedZip: () => writeZip({ name: SKEW_ZIP }),
      },
    });

    expect(extract).toHaveBeenCalledTimes(1);
    expect(res.repaired).toBe(true);
    expect(res.unverified).toBe(true);
  });
});

describe('D-02: the name check runs BEFORE the unlisted pre-check (F5 ordering)', () => {
  // repairElectron refuses an unsafe artifact name before it resolves the anchor or runs
  // the D-02 pre-check, so a planted package.json version never reaches the unlisted
  // refusal's words. The unsafe-name tests in tests/electron-artifact-custody.test.js
  // (NAMEUNCHECKED) and tests/electron-refusal-sanitize.test.js cannot see that order:
  // their fixture seeds a checksums.json row for the planted name and turns rung 1 off,
  // so `isUnlisted` is false and the pre-check never fires. Here the RUNNING amicus's
  // table (rung 1, the doctor --fix shape) has no row for it, so a moved pre-check WOULD.
  //
  // NAMED MUTANT
  //   PRECHECKBEFORENAME electron-install.js :: repairElectron -- move `policy`, `anchor`
  //     and the D-02 pre-check above the `isSafeArtifactName` check.
  //     KILLED (R-B3, 2026-09-28): tests/electron-unlisted-refusal.test.js:253, the 'unsafe-name' toMatchObject; both older unsafe-name suites stay GREEN under it.
  test('a planted version that climbs, colours and forges a line is refused as unsafe-name, never echoed as unlisted (PRECHECKBEFORENAME)', async () => {
    const planted = `43.6.0/../../${ESC}[31mEVIL${ESC}[0m\n${FORGED_LINE}`;
    const { dir } = fakeElectronDir({ withExe: false, platform: 'win32', version: planted });
    const self = seedElectronAnchor(mkTmp('amicus-self-'), { version: '43.1.1' });   // no row for the planted name
    const leaves = {
      acquireLock: jest.fn(() => ({ release: () => {} })),
      cachedZip: jest.fn(() => null),
      downloadArtifact: jest.fn(async () => { throw new Error('network is forbidden in this test'); }),
      extract: jest.fn(),
      spawn: jest.fn(),
    };

    const res = await ei.repairElectron({
      cacheOnly: true, electronDir: dir, platform: 'win32', arch: 'x64',   // NO version: read from the planted package.json
      deps: { selfElectronDir: self, ...leaves },
    });

    expect(res).toMatchObject({ repaired: false, integrity: 'unsafe-name' });
    const said = stderr.join('');
    expect(said).not.toContain('REFUSED (no published sha256)');
    for (const l of said.split('\n')) {
      expect(l).not.toMatch(CONTROL_CHARS);
      expect(l).not.toMatch(BIDI_CONTROLS);
    }
    expect(res.reason).not.toMatch(CONTROL_CHARS);
    for (const leaf of Object.values(leaves)) { expect(leaf).not.toHaveBeenCalled(); }
  });
});

describe('D-02: the GATE fails closed on its own, and the hatch accepts LOUDLY', () => {
  // repairElectron refuses an unlisted artifact before either route runs, so the
  // first two tests reach the gate directly: it is the invariant for any caller
  // that bypasses the pre-check. The third is the one place the hatch accepts
  // such bytes, and it must say so.
  //
  // NAMED MUTANTS
  //   UNLISTEDALLOWED electron-trust.js :: verifyArtifactBytes -- delete the
  //     `isUnlisted(...)` branch. RED: all three tests below.
  //   HATCHIGNOREDGATE electron-trust.js :: verifyArtifactBytes -- refuse even
  //     with the hatch set. RED: the third test below.
  const ZIP_NAME = 'electron-v43.1.1-win32-x64.zip';
  const UNLISTED = { table: { 'electron-v43.1.1-darwin-arm64.zip': ZIP_SHA256 }, source: '<test>' };

  test('a direct controlledProvision over an unlisted anchor never extracts what it downloaded (UNLISTEDALLOWED)', async () => {
    const extract = jest.fn();
    const out = await controlledProvision({
      electronDir: mkTmp('amicus-pkg-'), platform: 'win32', arch: 'x64', version: '43.1.1', anchor: UNLISTED,
      downloadArtifact: jest.fn(async () => writeZip()), extract, fs, env: {},
    });
    expect(extract).not.toHaveBeenCalled();
    expect(out.pinned).toBe(false);
    expect(out.refused).toMatchObject({ repaired: false, integrity: 'unlisted' });
  });

  test('a direct repairFromCache over an unlisted anchor refuses before extracting (UNLISTEDALLOWED)', async () => {
    const extract = jest.fn();
    const out = await repairFromCache({
      zip: writeZip(), fileName: ZIP_NAME, anchor: UNLISTED, policy: {},
      electronDir: mkTmp('amicus-pkg-'), platform: 'win32', arch: 'x64', version: '43.1.1', cacheOnly: true,
      extract, verifyOutcome: () => ({ repaired: true }), fs, env: {},
    });
    expect(extract).not.toHaveBeenCalled();
    expect(out).toMatchObject({ done: true, result: { repaired: false, integrity: 'unlisted' } });
  });

  test('with the hatch set, the skewed copy is accepted with a WARNING, not the legacy NOTE (HATCHIGNOREDGATE)', async () => {
    process.env.AMICUS_ALLOW_UNVERIFIED_ELECTRON = '1';
    const { dir, exeName, self } = skewedCopy();
    const extract = jest.fn(async (_bytes, opts) => { fs.writeFileSync(path.join(opts.dir, exeName), 'MZextracted'); });

    const res = await ei.repairElectron({
      cacheOnly: true, electronDir: dir, platform: 'win32', arch: 'x64',
      deps: {
        selfElectronDir: self, acquireLock: () => ({ release: () => {} }), extract, spawn: jest.fn(),
        cachedZip: () => writeZip({ name: SKEW_ZIP }),
      },
    });

    expect(res).toMatchObject({ repaired: true, unverified: true });
    const text = stderr.join('');
    expect(text).toContain(`AMICUS_ALLOW_UNVERIFIED_ELECTRON=1 — accepting ${SKEW_ZIP} although`);
    expect(text).not.toMatch(/so its bytes could not be verified/);
  });
});

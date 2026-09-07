// tests/sidecar/electron-trust.test.js
'use strict';

/**
 * Unit tests for src/sidecar/electron-trust.js — the trust core of the v4.9.5
 * Electron trust boundary (brief .superpowers/sdd/electron-trust-core-brief.md;
 * evidence docs/superpowers/plans/2026-09-07-electron-trust-boundary.md).
 *
 * The property under test, stated once: a hostile REPOSITORY can plant exactly
 * two env-name shapes in a `npm run` / `npm exec` child — `npm_config_<k>` and
 * `npm_package_config_<k>` (MEASURED, plan §0.1). Bare `ELECTRON_*` / `AMICUS_*`
 * names are out of its reach, which is why the escape hatch is a plain env var
 * and why a bare ELECTRON_MIRROR survives the installer-spawn scrub.
 *
 * Nothing here touches the network; every filesystem fixture is a temp dir.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const trust = require('../../src/sidecar/electron-trust');
const { fakeChecksums, ZIP_BODY, ZIP_SHA256 } = require('../helpers/fake-electron-dir');

const ZIP_NAME = 'electron-v43.1.1-win32-x64.zip';

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** A fake electron package dir carrying package.json + (optionally) checksums.json. */
function fakePkg({ version = '43.1.1', table } = {}) {
  const dir = mkTmp('amicus-trust-');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'electron', version }));
  if (table !== undefined) {
    fs.writeFileSync(path.join(dir, 'checksums.json'), typeof table === 'string' ? table : JSON.stringify(table));
  }
  return dir;
}

function writeZip(body = ZIP_BODY) {
  const dir = mkTmp('amicus-trust-zip-');
  const zip = path.join(dir, ZIP_NAME);
  fs.writeFileSync(zip, body);
  return zip;
}

const NO_ENV = Object.freeze({});

describe('artifactFileName (plan §2.1)', () => {
  test('normalises a leading v exactly once', () => {
    const args = { platform: 'win32', arch: 'x64' };
    expect(trust.artifactFileName({ version: '43.1.1', ...args })).toBe(ZIP_NAME);
    expect(trust.artifactFileName({ version: 'v43.1.1', ...args })).toBe(ZIP_NAME);
    expect(trust.artifactFileName({ version: '43.1.1', platform: 'darwin', arch: 'arm64' }))
      .toBe('electron-v43.1.1-darwin-arm64.zip');
  });

  test('the shared fixture helper keys checksums by that exact name', () => {
    expect(fakeChecksums({ version: '43.1.1', platform: 'win32', arch: 'x64' })).toEqual({ [ZIP_NAME]: ZIP_SHA256 });
    expect(ZIP_SHA256).toBe(crypto.createHash('sha256').update(ZIP_BODY).digest('hex'));
  });
});

describe('resolveAnchor + expectedDigest', () => {
  test('reads <electronDir>/checksums.json for the exact artifact filename', () => {
    const dir = fakePkg({ table: { [ZIP_NAME]: ZIP_SHA256 } });
    const anchor = trust.resolveAnchor({ electronDir: dir, version: '43.1.1', fs, selfElectronDir: null });
    expect(anchor).not.toBeNull();
    expect(anchor.source).toBe(path.join(dir, 'checksums.json'));
    expect(trust.expectedDigest(anchor, ZIP_NAME)).toBe(ZIP_SHA256);
  });

  test('returns null for absent / unparseable / non-map / non-64-hex, and never throws', () => {
    const call = (electronDir) => trust.resolveAnchor({ electronDir, version: '43.1.1', fs, selfElectronDir: null });

    expect(call(fakePkg({}))).toBeNull();                                  // absent file
    expect(call(fakePkg({ table: '{not json' }))).toBeNull();              // unparseable
    expect(call(fakePkg({ table: [ZIP_NAME] }))).toBeNull();               // not an object map
    expect(call(fakePkg({ table: { [ZIP_NAME]: 'nothex' } }))).toBeNull(); // non-64-hex
    expect(call(fakePkg({ table: { [ZIP_NAME]: ZIP_SHA256.toUpperCase() } }))).toBeNull(); // not LOWER-case
    expect(call(path.join(os.tmpdir(), 'amicus-does-not-exist-xyz'))).toBeNull();
    expect(call(undefined)).toBeNull();

    // key-absent: a valid anchor still yields no digest for an artifact it does not name
    const anchor = trust.resolveAnchor({
      electronDir: fakePkg({ table: { [ZIP_NAME]: ZIP_SHA256 } }), version: '43.1.1', fs, selfElectronDir: null,
    });
    expect(trust.expectedDigest(anchor, 'electron-v43.1.1-darwin-arm64.zip')).toBeNull();
    expect(trust.expectedDigest(null, ZIP_NAME)).toBeNull();
  });

  test('prefers the RUNNING amicus\'s electron checksums.json when the versions match (ANCHORFROMTARGET)', () => {
    // `doctor --fix` hands repairElectron an electronDir found by a filesystem
    // scan. Reading the anchor out of THAT tree would let it vouch for itself.
    const scanned = fakePkg({ table: { [ZIP_NAME]: 'b'.repeat(64) } });     // untrusted npx-cache copy
    const self = fakePkg({ version: '43.1.1', table: { [ZIP_NAME]: ZIP_SHA256 } });

    const matched = trust.resolveAnchor({ electronDir: scanned, version: '43.1.1', fs, selfElectronDir: self });
    expect(matched.source).toBe(path.join(self, 'checksums.json'));
    expect(trust.expectedDigest(matched, ZIP_NAME)).toBe(ZIP_SHA256);

    // versions DISAGREE -> rung 1 does not apply; fall back to the scanned tree's own file
    const mismatched = trust.resolveAnchor({ electronDir: scanned, version: '42.0.0', fs, selfElectronDir: self });
    expect(mismatched.source).toBe(path.join(scanned, 'checksums.json'));

    // self present but carrying NO usable table -> fall through rather than refuse
    const emptySelf = fakePkg({ version: '43.1.1', table: {} });
    const fell = trust.resolveAnchor({ electronDir: scanned, version: '43.1.1', fs, selfElectronDir: emptySelf });
    expect(fell.source).toBe(path.join(scanned, 'checksums.json'));
  });
});

describe('sha256File', () => {
  test('matches crypto over a >1 MiB file', () => {
    const dir = mkTmp('amicus-trust-big-');
    const big = path.join(dir, 'big.bin');
    const chunk = Buffer.alloc(256 * 1024, 0xab);
    // 2.5 MiB + a partial tail, so the 1 MiB read buffer wraps AND ends short.
    const body = Buffer.concat([...Array(10).fill(chunk), Buffer.from('tail')]);
    fs.writeFileSync(big, body);
    expect(body.length).toBeGreaterThan(1024 * 1024);
    expect(trust.sha256File(big, fs)).toBe(crypto.createHash('sha256').update(body).digest('hex'));
  });
});

describe('verifyArtifact — THE GATE', () => {
  const anchorFor = (digest) => ({ table: { [ZIP_NAME]: digest }, source: '<test>' });

  test('verified for matching bytes', () => {
    const r = trust.verifyArtifact({
      zip: writeZip(), anchor: anchorFor(ZIP_SHA256), fileName: ZIP_NAME,
      policy: trust.electronTrustPolicy(NO_ENV), fs,
    });
    expect(r).toEqual({ verdict: 'verified', allowed: true, actual: ZIP_SHA256 });
  });

  test('mismatch (allowed:false) for one flipped byte', () => {
    const r = trust.verifyArtifact({
      zip: writeZip('PKziq'), anchor: anchorFor(ZIP_SHA256), fileName: ZIP_NAME,
      policy: trust.electronTrustPolicy(NO_ENV), fs,
    });
    expect(r.verdict).toBe('mismatch');
    expect(r.allowed).toBe(false);
    expect(r.expected).toBe(ZIP_SHA256);
    expect(r.actual).not.toBe(ZIP_SHA256);
  });

  test('unreadable (never throws, never allowed) for a missing file', () => {
    const r = trust.verifyArtifact({
      zip: path.join(os.tmpdir(), 'amicus-nope-xyz.zip'), anchor: anchorFor(ZIP_SHA256), fileName: ZIP_NAME,
      policy: trust.electronTrustPolicy({ AMICUS_ALLOW_UNVERIFIED_ELECTRON: '1' }), fs,
    });
    expect(r.verdict).toBe('unreadable');
    expect(r.allowed).toBe(false);
    expect(typeof r.reason).toBe('string');
  });

  test('no-digest is ALLOWED and marked — a package with no anchor is not pushed into a re-download loop', () => {
    const lines = [];
    const r = trust.verifyArtifact({
      zip: writeZip(), anchor: null, fileName: ZIP_NAME,
      policy: trust.electronTrustPolicy(NO_ENV), fs, log: (m) => lines.push(m),
    });
    expect(r).toEqual({ verdict: 'no-digest', allowed: true });
    expect(lines.join('\n')).toContain(ZIP_NAME);
    expect(lines.join('\n')).toMatch(/could not be verified/);
  });

  test('AMICUS_ALLOW_UNVERIFIED_ELECTRON=1 downgrades a mismatch to a LOUD warning', () => {
    const lines = [];
    const r = trust.verifyArtifact({
      zip: writeZip('PKziq'), anchor: anchorFor(ZIP_SHA256), fileName: ZIP_NAME,
      policy: trust.electronTrustPolicy({ AMICUS_ALLOW_UNVERIFIED_ELECTRON: '1' }),
      fs, log: (m) => lines.push(m),
    });
    expect(r.verdict).toBe('mismatch');
    expect(r.allowed).toBe(true);
    const text = lines.join('\n');
    expect(text).toContain('AMICUS_ALLOW_UNVERIFIED_ELECTRON');
    expect(text).toContain(ZIP_NAME);
    expect(text).toContain(ZIP_SHA256);      // what was expected
    expect(text).toMatch(/fail closed/);
  });
});

describe('electronTrustPolicy — the ONLY reader of the escape hatch', () => {
  test('the hatch is exact-valued', () => {
    for (const v of ['true', 'TRUE', '0', '', 'yes', ' 1', '1 ']) {
      expect(trust.electronTrustPolicy({ AMICUS_ALLOW_UNVERIFIED_ELECTRON: v }).allowUnverified).toBe(false);
    }
    expect(trust.electronTrustPolicy({ AMICUS_ALLOW_UNVERIFIED_ELECTRON: '1' }).allowUnverified).toBe(true);
    expect(trust.electronTrustPolicy(NO_ENV).allowUnverified).toBe(false);
  });

  test('the hatch is NOT settable from a hostile repository', () => {
    // MEASURED (plan §0.1): a repo .npmrc line `AMICUS_ALLOW_UNVERIFIED_ELECTRON=1`
    // reaches the child ONLY as npm_config_amicus_allow_unverified_electron.
    // Reading any npm_config_ spelling would let the same .npmrc that plants the
    // mirror also switch off the check that catches it.
    expect(trust.electronTrustPolicy({
      npm_config_amicus_allow_unverified_electron: '1',
      NPM_CONFIG_AMICUS_ALLOW_UNVERIFIED_ELECTRON: '1',
      npm_package_config_amicus_allow_unverified_electron: '1',
    }).allowUnverified).toBe(false);
  });
});

describe('scrubbedChildEnv — the installer-spawn env (C3)', () => {
  const hostile = () => ({
    PATH: '/usr/bin',
    ELECTRON_MIRROR: 'https://mirror.corp/electron/',        // BARE: the owner's, kept
    ELECTRON_CACHE: 'D:\\cache',                             // BARE: kept
    electron_config_cache: 'D:\\cache2',                     // BARE: kept
    electron_use_remote_checksums: '1',                      // BARE: kept (owner's)
    npm_config_electron_mirror: 'http://attacker.example/evil/',
    npm_config_electron_nightly_mirror: 'http://attacker.example/evil/',
    npm_config_electron_custom_dir: 'pwned',
    npm_config_electron_use_remote_checksums: '1',           // would turn electron's pin OFF
    npm_package_config_electron_mirror: 'http://attacker.example/evil/',
    npm_package_config_electron_customFilename: 'evil.zip',
    npm_config_platform: 'linux',                            // chooses WHICH artifact
    npm_config_arch: 'arm64',
  });

  test('removes every repo-plantable electron name and both artifact selectors', () => {
    const out = trust.scrubbedChildEnv({ env: hostile(), platform: 'win32', arch: 'x64' });
    for (const name of Object.keys(hostile())) {
      if (name.startsWith('npm_config_electron_') || name.startsWith('npm_package_config_electron_')) {
        expect(out[name]).toBeUndefined();
      }
    }
    expect(out.npm_config_platform).toBeUndefined();
    expect(out.npm_config_arch).toBeUndefined();
    expect(Object.keys(out).some((k) => /^npm_(config|package_config)_electron_/.test(k))).toBe(false);
  });

  test('pins amicus\'s own platform/arch through the names install.js ranks FIRST', () => {
    // electron's install.js, lines 20-21 and 99: ELECTRON_INSTALL_PLATFORM/_ARCH outrank npm_config_*.
    const out = trust.scrubbedChildEnv({ env: hostile(), platform: 'win32', arch: 'x64' });
    expect(out.ELECTRON_INSTALL_PLATFORM).toBe('win32');
    expect(out.ELECTRON_INSTALL_ARCH).toBe('x64');
  });

  test('keeps every BARE owner-controlled name, and never mutates the argument', () => {
    const env = hostile();
    const out = trust.scrubbedChildEnv({ env, platform: 'win32', arch: 'x64' });
    expect(out.ELECTRON_MIRROR).toBe('https://mirror.corp/electron/');
    expect(out.ELECTRON_CACHE).toBe('D:\\cache');
    expect(out.electron_config_cache).toBe('D:\\cache2');
    expect(out.electron_use_remote_checksums).toBe('1');
    expect(out.PATH).toBe('/usr/bin');
    // the source env is untouched
    expect(env.npm_config_electron_mirror).toBe('http://attacker.example/evil/');
    expect(env.ELECTRON_INSTALL_PLATFORM).toBeUndefined();
  });

  test('omits the pins when platform/arch are not supplied', () => {
    const out = trust.scrubbedChildEnv({ env: { npm_config_electron_mirror: 'x' } });
    expect(out.ELECTRON_INSTALL_PLATFORM).toBeUndefined();
    expect(out.ELECTRON_INSTALL_ARCH).toBeUndefined();
    expect(out.npm_config_electron_mirror).toBeUndefined();
  });
});

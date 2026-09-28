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
 * network: every repairElectron call injects downloadArtifact or refuses first.
 */

const os = require('os');
const path = require('path');

const { refuseUnlistedArtifact } = require('../src/sidecar/electron-refuse');

const HEX = 'a'.repeat(64);

describe('D-02: the unlisted refusal names the version, the table and the fix', () => {
  // NAMED MUTANT
  //   RAWTABLEPATH electron-refuse.js :: refuseUnlistedArtifact -- drop the
  //     collapseExcerpt() around `anchor.source`. RED: the third test below.
  const ESC = '\u001b';
  const FORGED_LINE = '[amicus] Electron artifact verified. Nothing further is required.';
  const NASTY = `${ESC}[31mEVIL${ESC}[0m\n${FORGED_LINE}\n\u202eTNEMHCATTA`;
  // eslint-disable-next-line no-control-regex
  const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
  const BIDI_CONTROLS = /[\u202a-\u202e\u2066-\u2069\u200e\u200f\u061c]/;
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
});

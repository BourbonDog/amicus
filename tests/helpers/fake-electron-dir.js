// tests/helpers/fake-electron-dir.js
'use strict';

/**
 * Shared trust fixture for the electron self-heal suites (v4.9.5, C2).
 *
 * `repairElectron` now hashes a cached zip against electron's own
 * `checksums.json` BEFORE extracting it, so every fake electron package dir in
 * tests/electron-install.test.js, tests/electron-self-heal-smoke.test.js and
 * tests/electron-quarantine.test.js needs an anchor that vouches for the
 * `'PKzip'` body those suites write. This is that anchor, in ONE place, rather
 * than a hand-copied checksums.json in each fixture.
 *
 * WHY `SELF_ANCHOR_OFF` EXISTS. `resolveAnchor`'s highest rung prefers the
 * RUNNING amicus's own `node_modules/electron/checksums.json` whenever that
 * package's version equals the requested one — the rung that stops `doctor --fix`
 * from reading an anchor out of the same scanned, untrusted directory the bytes
 * came from. This repo really does have electron 43.1.1 installed, and the
 * suites really do ask for '43.1.1', so in-process that rung resolves to the
 * REAL published digests, which no 5-byte fixture can ever match. Spreading
 * `SELF_ANCHOR_OFF` into a test's `deps` pins the anchor to the fixture dir.
 * Production callers pass nothing and keep the real rung.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

/** The zip body every electron self-heal suite writes for a "cached" artifact. */
const ZIP_BODY = 'PKzip';
/** sha256(ZIP_BODY) — computed, never a copied literal. */
const ZIP_SHA256 = crypto.createHash('sha256').update(ZIP_BODY).digest('hex');

/** `electron-v<ver>-<plat>-<arch>.zip`, the key shape electron's checksums.json uses. */
function artifactName({ version = '43.1.1', platform = 'win32', arch = 'x64' } = {}) {
  return `electron-v${version}-${platform}-${arch}.zip`;
}

/**
 * A checksums.json table vouching for `body` under the artifact filename.
 * @returns {Record<string,string>}
 */
function fakeChecksums({ version, platform, arch, body = ZIP_BODY } = {}) {
  return { [artifactName({ version, platform, arch })]: crypto.createHash('sha256').update(body).digest('hex') };
}

/**
 * Write `package.json` + `checksums.json` into an existing fake electron package
 * dir, so the digest gate can verify a `ZIP_BODY` cached zip against it.
 * @param {string} dir the fake electron package dir
 * @param {object} [opts] { version, platform, arch, body, table } — `table`
 *   overrides the generated one (e.g. to plant a POISONED anchor).
 * @returns {string} dir
 */
function seedElectronAnchor(dir, opts = {}) {
  const { version = '43.1.1', table } = opts;
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'electron', version }));
  fs.writeFileSync(
    path.join(dir, 'checksums.json'),
    JSON.stringify(table || fakeChecksums({ ...opts, version })),
  );
  return dir;
}

/**
 * A REAL on-disk fake electron package: path.txt, dist/, and the trust anchor.
 * `withExe:false` reproduces the latent bug — path.txt survives but dist/<exe>
 * is missing.
 * @returns {{dir:string, exeName:string, distDir:string}}
 */
function fakeElectronDir({ withExe = false, platform = 'win32', prefix = 'amicus-electron-', ...anchor } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const exeName = platform === 'win32' ? 'electron.exe' : 'electron';
  fs.writeFileSync(path.join(dir, 'path.txt'), exeName);
  const distDir = path.join(dir, 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  if (withExe) { fs.writeFileSync(path.join(distDir, exeName), 'MZbinary'); }
  seedElectronAnchor(dir, { platform, ...anchor });
  return { dir, exeName, distDir };
}

/**
 * `deps` fragment that disables the self-anchor rung — see the header. Spread it
 * into any repairElectron call whose CACHE branch must verify against the
 * fixture's own checksums.json.
 */
const SELF_ANCHOR_OFF = Object.freeze({ selfElectronDir: null });

module.exports = {
  ZIP_BODY, ZIP_SHA256, artifactName, fakeChecksums, seedElectronAnchor, fakeElectronDir, SELF_ANCHOR_OFF,
};

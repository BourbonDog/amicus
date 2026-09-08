/**
 * Electron artifact TRUST core — the digest anchor and the gate. (The third
 * member of the cluster, the installer-spawn env scrub, lives in
 * ./electron-env-scrub and is re-exported here; see below.)
 *
 * A hostile REPOSITORY (a clone the user opens, an unpacked sample) controls the
 * `.npmrc` and `package.json` of the directory amicus's own docs tell people to
 * run `npx -y amicus@latest` in. MEASURED (npm 11.16.0): that reaches the child
 * as exactly two name shapes — `npm_config_<key lowercased>` and
 * `npm_package_config_<key case-preserved>` — and NOTHING else. Bare `ELECTRON_*`
 * and `AMICUS_*` names are out of its reach. THAT is the trust boundary this
 * module encodes: the escape hatch can be a plain environment variable, and a
 * machine-level `ELECTRON_MIRROR` can still be honoured, precisely because a
 * repository cannot write either one.
 *
 * The control is the DIGEST, not the URL. Supplying `checksums` to
 * `downloadArtifact` makes `@electron/get` write a LOCAL `SHASUMS256.txt` and
 * never fetch one from the mirror (@electron/get 5.0.0, dist/index.js, lines
 * 28-40), so an attacker who redirects the download still has to produce bytes that match
 * electron's own published sha256. Blocking the URL itself is defence in depth on
 * top of a control that already works, and is deliberately NOT built here.
 *
 * NEAR-LEAF MODULE: `crypto` + `path` + `fs`, plus `./electron-env-scrub`, which
 * is itself a true leaf (no requires at all). The arrow is electron-install ->
 * electron-provision -> electron-trust -> electron-env-scrub and must never point
 * back; src/utils/path-fence.js:11-17 records what a cycle does to a destructured
 * import in exactly this cluster.
 *
 * THE ENV SCRUB LIVES NEXT DOOR (v4.9.6 F2). `isRepoPlantedName` and
 * `REPO_ENV_PREFIXES` moved to `./electron-env-scrub` when this file hit the
 * 300-line gate with the F2 repair still to land, and are RE-EXPORTED here so
 * existing import paths stay valid — the same shape as engine-log-parse.js
 * re-exporting utils/text-sanitize.js. There is ONE implementation; these are
 * the same function objects, not a second copy. (`scrubbedChildEnv` and
 * `ELECTRON_INSTALL_TARGET_ENV` were deleted with the install.js spawn they
 * served; see electron-provision.js for why that spawn is gone.)
 *
 * @module sidecar/electron-trust
 */

'use strict';

const crypto = require('crypto');
const fsDefault = require('fs');
const path = require('path');

const { isRepoPlantedName, REPO_ENV_PREFIXES } = require('./electron-env-scrub');

/** A published sha256 is 64 LOWER-case hex characters. Anything else is not an anchor. */
const HEX64 = /^[0-9a-f]{64}$/;

/** Leading 'v' applied exactly once — matches @electron/get's normalizeVersion. */
function normalizeV(version) {
  const v = String(version || '');
  return v.startsWith('v') ? v : `v${v}`;
}

/**
 * The amicus-namespaced trust policy. THE ONLY place the escape hatch is read.
 * Never reads npm_config_* / npm_package_config_* / NPM_CONFIG_* — those are the
 * attacker's channel, and a rule that read its own writer's surface would be no
 * rule at all.
 *
 * `allowUnverified` is true for the string '1' and NOTHING else — 'true', 'yes',
 * ' 1' are all false. A hatch that fails open on a typo is not a hatch.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ allowUnverified: boolean }}
 */
function electronTrustPolicy(env = process.env) {
  return { allowUnverified: env.AMICUS_ALLOW_UNVERIFIED_ELECTRON === '1' };
}

/** `electron-v43.1.1-win32-x64.zip`. Matches BOTH electron's checksums.json keys
 *  and @electron/get's getArtifactFileName + normalizeVersion. */
function artifactFileName({ version, platform, arch }) {
  return `electron-${normalizeV(version)}-${platform}-${arch}.zip`;
}

/**
 * The electron package THIS amicus resolves — resolveAnchor rung 1. Duplicated
 * (not imported from electron-install.defaultElectronDir) so this module stays a
 * leaf and the require arrow keeps pointing one way.
 * @returns {string|null}
 */
function selfElectronPackageDir() {
  try {
    return path.dirname(require.resolve('electron/package.json'));
  } catch {
    return null;
  }
}

/** Parse one checksums.json into a table of ONLY well-formed rows. Never throws. */
function readChecksumTable(file, fs) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { return null; }
    const table = {};
    for (const [name, digest] of Object.entries(parsed)) {
      if (typeof digest === 'string' && HEX64.test(digest)) { table[name] = digest; }
    }
    return Object.keys(table).length > 0 ? table : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the digest ANCHOR, offline. Precedence, highest first:
 *   1. <selfElectronDir>/checksums.json — the RUNNING amicus's own table.
 *   2. <electronDir>/checksums.json — ONLY when rung 1 offers no usable table.
 *
 * RUNG 1 IS LOAD-BEARING, not a convenience. `doctor --fix`
 * (src/utils/doctor-electron-mcp-check.js:122-137) hands `repairElectron` an
 * electronDir found by a FILESYSTEM SCAN of npx caches, so rung 2 on its own
 * would read the anchor out of the same untrusted directory the bytes came from
 * — the pin would vouch for the attacker's own zip. Rung 1 is the same published
 * data out of a tree npm installed for amicus itself, before any hostile
 * directory was visited.
 *
 * WHY RUNG 1 NO LONGER TESTS THE VERSION. It used to apply only when the self
 * package's version equalled the requested one — but the requested `version` is
 * itself read out of `<electronDir>/package.json` whenever the caller supplies
 * none (electron-install.js `if (!version)`), and the ONE production caller,
 * doctor --fix, supplies none. MEASURED on this tree: a planted
 * `{"version":"99.0.0"}` demoted rung 1 by DATA alone, the scanned tree's own
 * checksums.json then vouched for its own bytes, and repairElectron returned
 * `{repaired:true}` after extracting POISONED-BYTES. A rule that reads its own
 * selector off the surface it exists to distrust is not a rule. No version check
 * is needed to keep a genuine version disagreement honest, because the table is
 * keyed by the FULL artifact filename: a self table for 43.1.1 simply holds no
 * `electron-v99.0.0-…zip` row, `expectedDigest` returns null, and the gate's
 * `no-digest` verdict extracts-and-MARKS exactly as the brief requires — never a
 * refusal, never a re-download loop.
 *
 * Rung 2 therefore survives for exactly one case: amicus's own electron package
 * ships no readable checksums.json (an old electron, or the optionalDependency
 * never installed). There the target's table is all there is, and it is still
 * better than nothing against a truncated download.
 *
 * Pass `selfElectronDir: null` to disable rung 1.
 * NEVER THROWS. Rejects a table whose values are not 64 lower-case hex.
 * @returns {{ table: Record<string,string>, source: string } | null}
 */
function resolveAnchor({ electronDir, fs = fsDefault, selfElectronDir } = {}) {
  const self = selfElectronDir === undefined ? selfElectronPackageDir() : selfElectronDir;
  for (const dir of [self, electronDir]) {
    if (!dir) { continue; }
    const source = path.join(dir, 'checksums.json');
    const table = readChecksumTable(source, fs);
    if (table) { return { table, source }; }
  }
  return null;
}

/** @returns {string|null} the 64-hex digest for one artifact, or null. */
function expectedDigest(anchor, fileName) {
  if (!anchor || !anchor.table) { return null; }
  const digest = anchor.table[fileName];
  return typeof digest === 'string' && HEX64.test(digest) ? digest : null;
}

/** sha256 of an artifact amicus already holds in its own heap. */
function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/**
 * THE GATE, OVER BYTES. NEVER THROWS. `allowed` is the single decision bit.
 *
 * @returns {{verdict:'verified',   allowed:true,  actual:string}
 *         | {verdict:'mismatch',   allowed:boolean, expected:string, actual:string}
 *         | {verdict:'no-digest',  allowed:true}}
 *
 * IT TAKES A BUFFER, AND THE PATH FORM IS GONE. `verifyArtifact({zip, ...})` and
 * `sha256File` were DELETED in the v4.9.6 second council round, not deprecated.
 * Hashing a path and then handing that path to an extractor is the race three
 * seats filed against v4.9.5, and hashing a private COPY of it is the race a
 * fourth seat filed against the remedy — a same-uid attacker opens the copy too
 * (MEASURED). Leaving a path-hashing gate exported and callable is an invitation
 * to reintroduce it, and no caller is left that could legitimately want one. The
 * bytes now arrive from `electron-custody.readArtifactBytes`, which reads them
 * once through one descriptor, and the SAME Buffer is what `zip-from-buffer`
 * extracts.
 *
 * `unreadable` disappeared with the path form. Unreadability is decided BEFORE
 * any hashing now, by `readArtifactBytes`, and the caller refuses there — bytes
 * that could not be read never reach this function, so there is no verdict for
 * them to carry.
 *
 * `no-digest` is ALLOWED and merely marked. An electron package that predates
 * `checksums.json` has no anchor through no fault of its own, and refusing it
 * would push that machine into a permanent re-download loop for a file no
 * download can improve. THE NOTE BELOW IS THE CACHE ROUTE'S stderr line, the one
 * `docs/troubleshooting.md` promises; the download route prints its own.
 */
function verifyArtifactBytes({ bytes, anchor, fileName, policy = {}, log = () => {} }) {
  const expected = expectedDigest(anchor, fileName);
  if (!expected) {
    log(`[amicus] NOTE: no published sha256 for ${fileName} (this electron package ships no`);
    log('[amicus]   checksums.json entry for it), so its bytes could not be verified.');
    return { verdict: 'no-digest', allowed: true };
  }
  const actual = sha256Bytes(bytes);
  if (actual === expected) { return { verdict: 'verified', allowed: true, actual }; }
  if (policy.allowUnverified) {
    log(`[amicus] WARNING: AMICUS_ALLOW_UNVERIFIED_ELECTRON=1 — accepting ${fileName} even though`);
    log(`[amicus]   its sha256 ${actual} does not match the published ${expected}.`);
    log('[amicus]   Unset that variable to fail closed.');
    return { verdict: 'mismatch', allowed: true, expected, actual };
  }
  return { verdict: 'mismatch', allowed: false, expected, actual };
}

module.exports = {
  electronTrustPolicy,
  resolveAnchor,
  expectedDigest,
  verifyArtifactBytes,
  sha256Bytes,
  artifactFileName,
  normalizeV,
  // RE-EXPORTED from ./electron-env-scrub — the same function objects, not copies.
  isRepoPlantedName,
  REPO_ENV_PREFIXES,
};

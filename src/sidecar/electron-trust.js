/**
 * Electron artifact TRUST core — the digest anchor, the gate, and the env scrub.
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
 * LEAF MODULE: `crypto` + `path` + `fs` and nothing from this repo. The arrow is
 * electron-install -> electron-provision -> electron-trust and must never point
 * back; src/utils/path-fence.js:11-17 records what a cycle does to a destructured
 * import in exactly this cluster.
 *
 * @module sidecar/electron-trust
 */

'use strict';

const crypto = require('crypto');
const fsDefault = require('fs');
const path = require('path');

/**
 * Env-name PREFIXES an untrusted REPOSITORY can plant. MEASURED, npm 11: a repo
 * .npmrc key `k` reaches an `npm run` / `npm exec` child as
 * `npm_config_<k lowercased>`; a repo package.json "config" key `k` reaches it as
 * `npm_package_config_<k>` with case preserved. Nothing else.
 *
 * PREFIXES, not a hand-maintained name list. Two prefixes cover every
 * `@electron/get` mirror knob in each repo-reachable spelling, plus electron's
 * own `npm_config_electron_use_remote_checksums` (electron's install.js, lines
 * 47-50 — that name turns electron's bundled pin OFF), plus any knob a future
 * @electron/get adds in the same namespace. Contrast ENGINE_CREDENTIAL_ENV
 * (scripts/run-integration-keyless.js:101), whose own docblock warns that nothing
 * makes a name list follow an upstream bump.
 *
 * The BARE `electron_use_remote_checksums` is deliberately NOT removed: a bare
 * lower-case name is not repo-injectable, so it carries the machine owner's
 * intent, exactly like a bare `ELECTRON_MIRROR`.
 *
 * MATCHED CASE-INSENSITIVELY. This used to fold no case, on the claim that
 * because the Windows environment block is case-insensitive, deleting the
 * lower-case name also removed the `NPM_CONFIG_ELECTRON_*` view @electron/get
 * reads second. That is true of `process.env` and FALSE of the `{...env}` PLAIN
 * OBJECT this module actually deletes from — a plain object is case-sensitive on
 * every platform, so the upper-case key survived and was handed to the child.
 * RE-MEASURED (npm 11.16.0, Windows 11) — two ways a repository reaches an
 * upper-case slot:
 *   1. `.npmrc` `electron_mirror=…` while `NPM_CONFIG_ELECTRON_MIRROR` already
 *      exists in the environment: npm overwrites that slot's VALUE and never
 *      renames it, so the child sees the ATTACKER's URL under the upper-case name.
 *   2. `package.json` `"config": {"ELECTRON_MIRROR": …}`: npm PRESERVES the key's
 *      case, planting `npm_package_config_ELECTRON_MIRROR` with nothing
 *      pre-existing at all — and @electron/get's own lookup for
 *      `npm_package_config_electron_mirror` (dist/artifact-utils.js, line 28) finds it,
 *      because the Windows lookup is case-insensitive too.
 * The old docblock's POSIX half (`NPM_CONFIG_ELECTRON_*` is a distinct variable
 * npm never writes there, so it is the machine owner's) is NOT measurable from
 * this machine, and it is load-bearing in the fail-OPEN direction: wrong, it
 * hands the child an attacker's mirror. Wrong the other way it costs one
 * alternate spelling inside a last-resort spawn, while bare `ELECTRON_MIRROR`
 * — which @electron/get ranks FIRST — still carries owner intent. So the fold is
 * unconditional rather than resting on an unverified platform claim.
 */
const REPO_ENV_PREFIXES = ['npm_config_electron_', 'npm_package_config_electron_'];

/** electron's install.js, lines 20-21 and 99 — these choose WHICH artifact it
 *  fetches, and `.npmrc` `platform=`/`arch=` plants both. Same case fold. */
const ELECTRON_INSTALL_TARGET_ENV = ['npm_config_platform', 'npm_config_arch'];

/** A published sha256 is 64 LOWER-case hex characters. Anything else is not an anchor. */
const HEX64 = /^[0-9a-f]{64}$/;

/** Leading 'v' applied exactly once — matches @electron/get's normalizeVersion. */
function normalizeV(version) {
  const v = String(version || '');
  return v.startsWith('v') ? v : `v${v}`;
}

/** True for a name a hostile repository could have planted, in ANY case (see above). */
function isRepoPlantedName(name) {
  const lower = String(name).toLowerCase();
  return REPO_ENV_PREFIXES.some((prefix) => lower.startsWith(prefix))
    || ELECTRON_INSTALL_TARGET_ENV.includes(lower);
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

/** Chunked sha256 (1 MiB buffer, openSync/readSync). SYNC so it composes with
 *  repairElectron's injected `fs`; chunked so a ~170 MB zip is never buffered whole. */
function sha256File(file, fs = fsDefault) {
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.alloc(1024 * 1024);
  const fd = fs.openSync(file, 'r');
  try {
    let read = fs.readSync(fd, buffer, 0, buffer.length, null);
    while (read > 0) {
      hash.update(buffer.subarray(0, read));
      read = fs.readSync(fd, buffer, 0, buffer.length, null);
    }
  } finally {
    try { fs.closeSync(fd); } catch { /* already closed */ }
  }
  return hash.digest('hex');
}

/**
 * THE GATE. NEVER THROWS. `allowed` is the single decision bit callers act on.
 *
 * @returns {{verdict:'verified',   allowed:true,  actual:string}
 *         | {verdict:'mismatch',   allowed:boolean, expected:string, actual:string}
 *         | {verdict:'no-digest',  allowed:true}
 *         | {verdict:'unreadable', allowed:false, reason:string}}
 *
 * `no-digest` is ALLOWED and merely marked. An electron package that predates
 * `checksums.json` has no anchor through no fault of its own, and refusing it
 * would push that machine into a permanent re-download loop for a file no
 * download can improve.
 *
 * `unreadable` is refused whatever the policy says: bytes that cannot be hashed
 * cannot be extracted either, so there is nothing to fail open to.
 */
function verifyArtifact({ zip, anchor, fileName, policy = {}, fs = fsDefault, log = () => {} }) {
  const expected = expectedDigest(anchor, fileName);
  if (!expected) {
    log(`[amicus] NOTE: no published sha256 for ${fileName} (this electron package ships no`);
    log('[amicus]   checksums.json entry for it), so its bytes could not be verified.');
    return { verdict: 'no-digest', allowed: true };
  }
  let actual;
  try {
    actual = sha256File(zip, fs);
  } catch (e) {
    return { verdict: 'unreadable', allowed: false, reason: `could not hash ${fileName}: ${(e && e.message) || e}` };
  }
  if (actual === expected) { return { verdict: 'verified', allowed: true, actual }; }
  if (policy.allowUnverified) {
    log(`[amicus] WARNING: AMICUS_ALLOW_UNVERIFIED_ELECTRON=1 — accepting ${fileName} even though`);
    log(`[amicus]   its sha256 ${actual} does not match the published ${expected}.`);
    log('[amicus]   Unset that variable to fail closed.');
    return { verdict: 'mismatch', allowed: true, expected, actual };
  }
  return { verdict: 'mismatch', allowed: false, expected, actual };
}

/**
 * A COPY of env for the runInstaller SPAWN. Never mutates the argument.
 *
 * electron's own install.js honours `npm_config_electron_mirror` (through
 * @electron/get) AND `npm_config_electron_use_remote_checksums` (its lines 47-50,
 * which turns its bundled pin off), so spawning it with an unfiltered
 * `{...process.env}` would funnel a blocked attacker straight into an unpinned
 * downloader. `npm_config_platform` / `npm_config_arch` (its lines 20-21 and 99)
 * choose WHICH artifact it fetches, so they are removed too and amicus's own
 * resolution is pinned through `ELECTRON_INSTALL_PLATFORM`/`_ARCH`, which
 * install.js ranks above them.
 *
 * LEAVES ALONE, deliberately — every one of these is a BARE name a repository
 * cannot plant, so it is the machine owner's: `ELECTRON_MIRROR`,
 * `ELECTRON_CUSTOM_*`, `electron_config_cache`, `ELECTRON_CACHE`,
 * `electron_use_remote_checksums`, `HTTP_PROXY`/`HTTPS_PROXY`/`ELECTRON_GET_USE_PROXY`.
 */
function scrubbedChildEnv({ env = process.env, platform, arch } = {}) {
  const out = { ...env };
  for (const name of Object.keys(out)) {
    if (isRepoPlantedName(name)) { delete out[name]; }
  }
  if (platform) { out.ELECTRON_INSTALL_PLATFORM = platform; }
  if (arch) { out.ELECTRON_INSTALL_ARCH = arch; }
  return out;
}

module.exports = {
  electronTrustPolicy,
  resolveAnchor,
  expectedDigest,
  verifyArtifact,
  sha256File,
  artifactFileName,
  scrubbedChildEnv,
  normalizeV,
  REPO_ENV_PREFIXES,
  ELECTRON_INSTALL_TARGET_ENV,
};

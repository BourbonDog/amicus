/**
 * Electron self-heal primitive (#53, #59).
 *
 * Electron is an optionalDependency (^28.0.0). A flaky / interrupted extract —
 * or Windows Defender quarantining electron.exe — can leave the package's
 * path.txt on disk while dist/<exe> is MISSING, so the GUI silently fails. This
 * module is the keystone the rest of the self-heal cluster (#54-#57) imports; it
 * wires itself into no caller, and everything that downloads, extracts, spawns or
 * locks is dependency-INJECTABLE so tests never hit the network or extract a real
 * binary.
 *
 * Layout (npm `electron`): path.txt -> the exe basename, dist/<exe> -> the binary.
 * #59: ELECTRON_OVERRIDE_DIST_PATH moves the exe to <override>/<exe> (mirrors
 * electron/index.js + install.js semantics). Cache layout (@electron/get):
 * <cacheRoot>/<sha256>/electron-v<ver>-<platform>-<arch>.zip
 *
 * AT THE SIZE GATE, so pieces live next door: `./electron-custody` reads the
 * artifact into memory once, `./zip-from-buffer` extracts what was read,
 * `./electron-layout` holds `platformExe`/`writePathTxt`/`extractBytesToDist`
 * (`platformExe` re-exported here for `ei.platformExe`), `./electron-refuse`
 * holds the refusal messages, `./electron-repair-cache` the whole cached-artifact
 * route, `./electron-provision` the pinned download. The arrow points one way out
 * of this file and never back.
 */

'use strict';

const fsDefault = require('fs');
const path = require('path');

const { cachedZip } = require('./electron-cache');
const { isSafeArtifactName } = require('./electron-custody');
const { avHint, verifyExtractOutcome: verifyQuarantine } = require('./electron-quarantine');
const { acquireRepairLock } = require('./electron-lock');
const { platformExe } = require('./electron-layout');
const { controlledProvision } = require('./electron-provision');
const { repairFromCache } = require('./electron-repair-cache');
const { isUnsafeArchive, refuseUnsafeArchive } = require('./electron-refuse');
const { artifactFileName, electronTrustPolicy, resolveAnchor } = require('./electron-trust');
const { extractZipBuffer } = require('./zip-from-buffer');
const { collapseExcerpt } = require('../utils/text-sanitize');

/** Self-heal progress line to stderr (visible during first-GUI provision). */
function stderrLog(msg) {
  try { process.stderr.write(`${msg}\n`); } catch { /* stderr closed */ }
}

/** Default on-disk location of the installed electron package. */
function defaultElectronDir() {
  try {
    return path.dirname(require.resolve('electron/package.json'));
  } catch {
    return path.join(__dirname, '..', '..', 'node_modules', 'electron');
  }
}

/**
 * Resolve the on-disk electron exe path from the package layout.
 * Mirrors ELECTRON_OVERRIDE_DIST_PATH semantics (#59): when set, the exe is
 * <override>/<exeBasename>; otherwise it is <electronDir>/dist/<exeBasename>.
 * @returns {string|null} resolved exe path, or null if path.txt is unreadable.
 */
function resolveElectronBinary({ electronDir = defaultElectronDir(), env = process.env, platform = process.platform, fs = fsDefault } = {}) {
  let exeRel;
  const pathFile = path.join(electronDir, 'path.txt');
  try {
    exeRel = fs.readFileSync(pathFile, 'utf-8').trim();
  } catch {
    exeRel = '';
  }
  if (!exeRel) {
    exeRel = platformExe(platform);
  }
  const override = env.ELECTRON_OVERRIDE_DIST_PATH;
  if (override) {
    return path.join(override, exeRel);
  }
  return path.join(electronDir, 'dist', exeRel);
}

/**
 * True ONLY if the resolved exe actually EXISTS on disk. This is the
 * stat-the-exe check #54 reuses — path.txt surviving is NOT enough.
 */
function isElectronUsable({ electronDir = defaultElectronDir(), env = process.env, platform = process.platform, fs = fsDefault } = {}) {
  const exe = resolveElectronBinary({ electronDir, env, platform, fs });
  try {
    return fs.existsSync(exe);
  } catch {
    return false;
  }
}

/** Bind the fs-aware probes for the post-extract AV-quarantine verify. */
function verifyExtractOutcome({ electronDir, platform, fs }) {
  return verifyQuarantine({
    isElectronUsable: () => isElectronUsable({ electronDir, platform, fs }),
    resolveExe: () => resolveElectronBinary({ electronDir, platform, fs }),
    platform,
  });
}

/**
 * Heal a broken electron install.
 *
 * @param {object} opts
 * @param {boolean} [opts.cacheOnly] never hit the network; return
 *   {deferred,reason} when there is no cached zip.
 * @param {number}  [opts.timeoutMs] best-effort download timeout.
 * @param {object}  [opts.deps] injected { cachedZip, extract, acquireLock, fs,
 *   selfElectronDir } — the last pins the digest anchor's top rung (null disables it).
 *
 * THERE IS NO `force` OPTION. There was, and it did nothing: it only ever set
 * `force_no_cache` for the install.js spawn (now deleted), and `force` is DEAD
 * in @electron/get 5.0.0 anyway — `effectiveCacheMode` never reads it, MEASURED.
 * An accepted-but-inert flag is worse than no flag, so it is gone rather than
 * documented.
 * @returns {Promise<{repaired?:boolean, deferred?:boolean, contended?:boolean, reason?:string}>}
 */
async function repairElectron({
  cacheOnly = false,
  timeoutMs,
  electronDir = defaultElectronDir(),
  platform = process.platform,
  version,
  arch = process.arch,
  deps = {},
} = {}) {
  const fs = deps.fs || fsDefault;
  // Default extract: from the BUFFER amicus already hashed, never from a name.
  // `unzip.js` is byte-for-byte unchanged and still exported; it is simply no
  // longer on this path, because every one of its strategies takes a PATH and a
  // path is what the custody finding is about (see zip-from-buffer.js).
  //
  // WHAT CAME WITH IT AND WHAT DID NOT. Its idle + hard-cap STALL BOUND is
  // reimplemented in `zip-from-buffer.js` with the same numbers, so this path is
  // bounded again (it was not, for three commits). Its NATIVE OS unzip fallback
  // is not, and cannot be: `tar`/`Expand-Archive`/`ditto`/`unzip` all take a
  // path, and feeding one either the artifact or a temp copy of our Buffer would
  // undo the custody property outright. The cost of that trade is named in
  // zip-from-buffer.js's docblock.
  const extract = deps.extract
    || ((bytes, o) => extractZipBuffer(bytes, { ...o, deps: { fs, log: stderrLog } }));
  const findZip = deps.cachedZip || ((o) => cachedZip(o));
  const acquireLock = deps.acquireLock || ((o) => acquireRepairLock({ ...o, fs }));
  // Lazy: import the ESM-only @electron/get only on the network path, so cacheOnly
  // repairs and injected mocks stay parseable under Jest (which can't import() ESM).
  const resolveDownloadArtifact = deps.downloadArtifact
    ? async () => deps.downloadArtifact
    : async () => (await import('@electron/get')).downloadArtifact;

  if (!version) {
    try { version = require(path.join(electronDir, 'package.json')).version; } catch { version = undefined; }
  }

  // The digest anchor and the trust policy, resolved ONCE for both routes. NOTE
  // `version` is deliberately NOT passed to resolveAnchor: it may have just been
  // read out of electronDir's own package.json above, and letting an untrusted
  // directory pick which anchor judges its bytes is the ANCHORFROMTARGET hole.
  const fileName = artifactFileName({ version, platform, arch });
  // F#3: `version` may have just been read out of an UNTRUSTED <electronDir>/
  // package.json (doctor --fix supplies none, for a dir it found by scanning npx
  // caches), and `fileName` is joined into paths downstream. MEASURED before the
  // check, with a planted "43.1.1/../../victim": a path two levels outside the
  // intended directory was written and a pre-existing file there was destroyed.
  // Nothing downstream ever sees a name that is not a plain filename.
  if (!isSafeArtifactName(fileName)) {
    return { repaired: false, integrity: 'unsafe-name', reason: `Refusing to provision electron: ${collapseExcerpt(fileName, 160)} is not a usable artifact name.` };
  }
  const policy = electronTrustPolicy(process.env);
  const anchor = resolveAnchor({ electronDir, fs, selfElectronDir: deps.selfElectronDir });

  // Single-flight: bail out gracefully if another caller is already repairing.
  let lock;
  try {
    lock = acquireLock({ electronDir, fs });
  } catch (e) {
    if (e && e.code === 'EEXIST') {
      return { contended: true, reason: 'Another electron repair is already in progress.' };
    }
    throw e;
  }

  let refusal = null;   // a cache refusal the caller must still hear about if the download also fails
  try {
    // Attempt 1: extract from cache (always preferred, fully offline). The whole
    // route lives in ./electron-repair-cache — read once into memory, hash THOSE
    // bytes, extract THOSE bytes — and answers `done` when nothing is left to try.
    const zip = findZip({ version, platform, arch, env: process.env, fs });
    if (zip) {
      const attempt = await repairFromCache({
        zip, fileName, anchor, policy, electronDir, platform, arch, version, cacheOnly,
        extract, verifyOutcome: () => verifyExtractOutcome({ electronDir, platform, fs }),
        fs, env: process.env, log: stderrLog,
      });
      if (attempt.done) { return attempt.result; }
      refusal = attempt.refusal;
    } else if (cacheOnly) {
      return { deferred: true, reason: `No cached electron zip found for v${version} (${platform}-${arch}); deferring download.${avHint(platform)}` };
    }

    // Attempt 2 (online): CONTROLLED download+extract instead of a blind install.js
    // spawn — the SAME @electron/get api install.js uses, extracted offline, then the
    // REAL usability reported. A download that produced no usable exe is a FAILURE (#53).
    // A non-null `provision` means download + extract returned without throwing;
    // its `pinned:false` means the extracted bytes were vouched for only by the
    // mirror — either no `checksums` went out (no anchor row, or the hatch dropped
    // the pin) or amicus's own hash of the bytes it read did not say `verified`.
    // F3 marks that, as both docs already promise it does.
    let provision = null;
    let provisionReason = null;
    try {
      const downloadArtifact = await resolveDownloadArtifact();
      const result = await controlledProvision({
        electronDir, platform, arch, version, anchor, downloadArtifact, extract,
        fs, env: process.env, downloadMs: timeoutMs, policy, log: stderrLog,
      });
      // F3 (seat B4) — FAIL CLOSED ON A SHAPE NOBODY RECOGNISES. This used to be
      // `|| { pinned: false }`, described as "an unrecognisable return marks,
      // never claims a pin". It did worse than that: a function that returned
      // NOTHING became a successful unpinned provision, so `verifyExtractOutcome`
      // ran on a directory nothing had written and reported the missing exe as
      // the AV-QUARANTINE signature — "electron.exe was removed right after it
      // was extracted", advice about an extraction that never happened. An
      // unrecognised return is a FAILURE, reported through the same path a throw
      // takes, because that path already says the true thing.
      if (!result || typeof result !== 'object' || typeof result.pinned !== 'boolean') {
        throw Object.assign(
          new Error(`the controlled provision returned no usable result (${result === undefined ? 'undefined' : typeof result})`),
          { code: 'PROVISION_NO_RESULT' },
        );
      }
      provision = result;
    } catch (provisionErr) {
      // C4: an unsafe archive is terminal — it is never retried through another
      // extractor, and it is not reported as an ordinary failure.
      if (isUnsafeArchive(provisionErr)) { return refuseUnsafeArchive({ err: provisionErr, fileName, log: stderrLog }); }
      // B1: this is where the last-resort install.js spawn used to be. It is gone
      // (see electron-provision.js), so the failure is REPORTED rather than
      // routed around. `provision` stays null and `out.repaired` is the honest
      // stat of the exe, but the REASON must survive — a bare {repaired:false}
      // is what made a failed provision indistinguishable from "not provisioned".
      provisionReason = collapseExcerpt((provisionErr && provisionErr.message) || String(provisionErr));
      stderrLog(`[amicus] the controlled Electron download did not complete: ${provisionReason}`);
      stderrLog('[amicus] Headless runs and the council work without the GUI.');
    }
    // F#2: the download hashed the bytes it read and refused them, or could not
    // read them at all. Nothing was extracted, so there is no outcome to verify —
    // return the refusal, carrying any cache refusal that preceded it.
    if (provision && provision.refused) {
      // A4/D4: this used to drop the cache refusal whenever the two shared an
      // `integrity` class — so TWO mismatches (a poisoned cache entry AND a
      // hostile mirror, the single most alarming pair this code can observe)
      // reported only the second, and never told the user the cached artifact had
      // also been refused and possibly deleted. Dedupe on the SENTENCE instead:
      // identical text is noise, a different path or a different digest is not.
      const carried = refusal && refusal.reason !== provision.refused.reason ? refusal.reason : null;
      return { ...provision.refused, reason: [carried, provision.refused.reason].filter(Boolean).join(' ') };
    }
    // A NON-throwing controlled extract that left no usable exe is the
    // AV-quarantine signature — surface it actionably (no false success, no loop).
    const out = provision
      ? verifyExtractOutcome({ electronDir, platform, fs })
      : { repaired: isElectronUsable({ electronDir, platform, fs }) };
    // A refusal the download did not rescue must reach doctor and the postinstall
    // notice; plain {repaired:false} is what made a REFUSED artifact read as an
    // ordinary "not provisioned" everywhere outside the cacheOnly path.
    if (!out.repaired && (refusal || provisionReason)) {
      const parts = [refusal && refusal.reason, provisionReason && `The controlled download failed: ${provisionReason}.`, out.reason];
      return { ...out, ...(refusal ? { integrity: refusal.integrity } : {}), reason: parts.filter(Boolean).join(' ') };
    }
    // F3: the SAME mark the cache route already applies, on the route that omitted it.
    if (out.repaired && provision && !provision.pinned) { return { ...out, unverified: true }; }
    return out;
  } finally {
    try { lock.release(); } catch { /* ignore */ }
  }
}

module.exports = {
  resolveElectronBinary,
  isElectronUsable,
  cachedZip,
  repairElectron,
  // exported for sibling/self-heal modules + tests
  platformExe,
  defaultElectronDir,
};

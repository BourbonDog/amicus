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
 * AT THE SIZE GATE, so pieces live next door: `./electron-layout` holds
 * `platformExe`/`writePathTxt`/`extractFromCache` (re-exported here for
 * `ei.platformExe`), `./electron-refuse` holds the refusal messages,
 * `./electron-stage` the private staging, `./electron-provision` the pinned
 * download. The arrow points one way out of this file and never back.
 */

'use strict';

const fsDefault = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { cachedZip } = require('./electron-cache');
const { avHint, verifyExtractOutcome: verifyQuarantine } = require('./electron-quarantine');
const { acquireRepairLock } = require('./electron-lock');
const { extractFromCache, platformExe } = require('./electron-layout');
const { controlledProvision, mayDeleteRejectedZip, runInstaller } = require('./electron-provision');
const {
  isUnsafeArchive, refuseUnsafeArchive, refuseUnstagedArtifact, rejectCachedZip,
} = require('./electron-refuse');
const {
  isSafeArtifactName, releaseStage, stageArtifact, sweepStaleStages,
} = require('./electron-stage');
const { artifactFileName, electronTrustPolicy, resolveAnchor, verifyArtifact } = require('./electron-trust');
const { robustExtract } = require('./unzip');
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
 * @param {boolean} [opts.force] force a fresh (no-cache) installer download.
 * @param {number}  [opts.timeoutMs] best-effort installer timeout.
 * @param {object}  [opts.deps] injected { cachedZip, extract, spawn, acquireLock, fs,
 *   selfElectronDir } — the last pins the digest anchor's top rung (null disables it).
 * @returns {Promise<{repaired?:boolean, deferred?:boolean, contended?:boolean, reason?:string}>}
 */
async function repairElectron({
  cacheOnly = false,
  force = false,
  timeoutMs,
  electronDir = defaultElectronDir(),
  platform = process.platform,
  version,
  arch = process.arch,
  deps = {},
} = {}) {
  const fs = deps.fs || fsDefault;
  // Default extract: extract-zip bounded (idle/max) + native-unzip fallback (extract-zip-node24 stall).
  const extract = deps.extract
    || ((zipPath, o) => robustExtract(zipPath, { ...o, platform, deps: { fs, log: stderrLog } }));
  // Default-bound (8 min) so a first-GUI-use provision that reaches runInstaller
  // without an explicit timeoutMs can't hang the holder; caller's value wins.
  const spawn = deps.spawn || ((cmd, args, o) => spawnSync(cmd, args, { ...o, timeout: timeoutMs || 480000 }));
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
  // caches), and `fileName` becomes a path component in stageArtifact. A `..` in
  // it escaped the private staging directory — MEASURED. Nothing downstream ever
  // sees a name that is not a plain filename.
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
    // Attempt 1: extract from cache (always preferred, fully offline).
    const zip = findZip({ version, platform, arch, env: process.env, fs });
    if (zip) {
      // F1: COPY the artifact into a private staging dir, then hash and extract
      // THERE. v4.9.5 hashed the cache path and re-opened it for the extract, so a
      // cache-dir writer — the exact actor C2 exists to stop — could swap the bytes
      // in between and have the unhashed replacement extracted. A copy makes an
      // inode nothing else has a name for or a handle on; the original stays put,
      // so no exit path can leave the user without it (electron-stage.js).
      const stage = stageArtifact({ zip, fileName, fs, log: stderrLog });
      try {
        // Unstaged bytes are never HASHED either: a verdict on a file its writer
        // still controls would only license an extract it cannot vouch for. This is
        // a REFUSAL, not a `deferred` — the download route stages too, so "try the
        // network" is not a fix for it, and postinstall must print the reason.
        if (!stage) {
          refusal = refuseUnstagedArtifact({ fileName, zip, log: stderrLog });
          if (cacheOnly) { return refusal; }
        } else {
          // C2: extraction must be unreachable for an artifact the anchor
          // contradicts. A missing anchor is NOT a refusal (see verifyArtifact).
          const gate = verifyArtifact({ zip: stage.path, anchor, fileName, policy, fs, log: stderrLog });
          if (!gate.allowed) {
            const mayDelete = mayDeleteRejectedZip({ zip, fileName, env: process.env });
            refusal = rejectCachedZip({ gate, zip, mayDelete, fileName, fs, log: stderrLog });
            if (cacheOnly) { return refusal; }
          } else {
            try {
              await extractFromCache({ zip: stage.path, electronDir, platform, extract, fs });
              // Non-throwing extract w/ absent exe = the AV-quarantine signature.
              const outcome = verifyExtractOutcome({ electronDir, platform, fs });
              return gate.verdict === 'no-digest' ? { ...outcome, unverified: true } : outcome;
            } catch (extractErr) {
              // C4 IS A CALL-SITE INVARIANT. A path-traversal refusal must not be
              // deleted-and-retried, nor reported as "corrupt" — it stops here, and
              // the archive is LEFT IN PLACE, because a refused archive is evidence.
              if (isUnsafeArchive(extractErr)) { return refuseUnsafeArchive({ err: extractErr, fileName, log: stderrLog }); }
              // F#4/F#5: EVICT THE CORRUPT ORIGINAL, and claim only what happened.
              // The first cut set `stage.discard`, which dropped the private COPY and
              // left the cache entry in place on the branch that copied — turning a
              // corrupt artifact into a permanent cacheOnly loop while the reason
              // asserted a removal. v4.9.5's own unconditional rmSync, restored.
              let removed = false;
              try { fs.rmSync(zip, { force: true }); removed = true; } catch { /* an unwritable cache is not a repair failure */ }
              if (cacheOnly) {
                return { repaired: false, reason: `Cached electron zip for v${version} (${platform}-${arch}) was corrupt and ${removed ? 'removed' : 'left in place'}; deferring re-download.${avHint(platform)}` };
              }
            }
          }
        }
        // Every branch that did not return drops into the controlled download below.
      } finally {
        releaseStage({ stage, fs });
      }
    } else if (cacheOnly) {
      // F#7: the ONE path that reaches no stageArtifact, and so no sweep — an
      // offline run with an empty cache. Anything a killed run left under
      // os.tmpdir() would otherwise wait for a cache hit that may never come.
      sweepStaleStages({ fs });
      return { deferred: true, reason: `No cached electron zip found for v${version} (${platform}-${arch}); deferring download.${avHint(platform)}` };
    }

    // Attempt 2 (online): CONTROLLED download+extract instead of a blind install.js
    // spawn — the SAME @electron/get api install.js uses, extracted offline, then the
    // REAL usability reported. A download that produced no usable exe is a FAILURE (#53).
    // A non-null `provision` means download + extract returned without throwing;
    // its `pinned:false` means the extracted bytes were vouched for only by the
    // mirror — either no `checksums` went out (no anchor row, or the hatch dropped
    // the pin) or amicus's own hash of the staged copy did not say `verified`.
    // F3 marks that, as both docs already promise it does.
    let provision = null;
    try {
      const downloadArtifact = await resolveDownloadArtifact();
      provision = await controlledProvision({
        electronDir, platform, arch, version, anchor, downloadArtifact, extract, extractFromCache,
        fs, env: process.env, downloadMs: timeoutMs, policy, log: stderrLog,
      }) || { pinned: false };   // an unrecognisable return marks, never claims a pin
    } catch (provisionErr) {
      // C4 again: an unsafe archive here must NOT reach runInstaller, which would
      // re-download and re-extract it through an extractor amicus does not drive.
      if (isUnsafeArchive(provisionErr)) { return refuseUnsafeArchive({ err: provisionErr, fileName, log: stderrLog }); }
      // Controlled download/extract failed (network, checksum, unzip). Try the
      // installer as a LAST resort — it can NEVER short-circuit the honest
      // verify below; we always return isElectronUsable().
      try { runInstaller({ electronDir, force, spawn, platform, arch }); } catch { /* ignore */ }
    }
    // F#2/F#6/F#8: the download hashed its own staged bytes and refused them, or
    // could not stage them at all. Nothing was extracted, so there is no outcome to
    // verify — return the refusal, carrying any cache refusal that preceded it.
    if (provision && provision.refused) {
      // Carry a cache refusal only when it says something DIFFERENT. Both routes
      // stage, so "temp is full" refuses twice; repeating the same sentence with a
      // second path is noise in the one message the user actually reads.
      const carried = refusal && refusal.integrity !== provision.refused.integrity ? refusal.reason : null;
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
    if (!out.repaired && refusal) { return { ...out, integrity: refusal.integrity, reason: [refusal.reason, out.reason].filter(Boolean).join(' ') }; }
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

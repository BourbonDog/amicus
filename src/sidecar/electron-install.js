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
 */

'use strict';

const fsDefault = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { cachedZip } = require('./electron-cache');
const { avHint, verifyExtractOutcome: verifyQuarantine } = require('./electron-quarantine');
const { acquireRepairLock } = require('./electron-lock');
const {
  controlledProvision, isUnsafeArchive, mayDeleteRejectedZip, refuseUnsafeArchive, rejectCachedZip, runInstaller,
} = require('./electron-provision');
const { releaseStage, stageArtifact } = require('./electron-stage');
const { artifactFileName, electronTrustPolicy, resolveAnchor, verifyArtifact } = require('./electron-trust');
const { robustExtract } = require('./unzip');

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

/** Platform exe basename, matching electron's getPlatformPath(). */
function platformExe(platform) {
  switch (platform) {
    case 'mas':
    case 'darwin':
      return path.join('Electron.app', 'Contents', 'MacOS', 'Electron');
    case 'win32':
      return 'electron.exe';
    default:
      return 'electron';
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

/** Restore path.txt so electron/index.js resolves the freshly-extracted exe. */
function writePathTxt({ electronDir, platform, fs }) {
  fs.writeFileSync(path.join(electronDir, 'path.txt'), platformExe(platform));
}

/** Extract a cached zip into <electronDir>/dist offline. */
async function extractFromCache({ zip, electronDir, platform, extract, fs }) {
  const distDir = path.join(electronDir, 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  await extract(zip, { dir: distDir });
  writePathTxt({ electronDir, platform, fs });
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
      // F1: MOVE the artifact into a private staging dir, then hash and extract
      // THERE. v4.9.5 hashed the cache path and re-opened it for the extract, so a
      // cache-dir writer — the exact actor C2 exists to stop — could swap the bytes
      // in between and have the unhashed replacement extracted. releaseStage puts
      // them back on EVERY exit path, except where a refusal below marks them for
      // the delete v4.9.5 already performed.
      // THE FENCE IS TAKEN BEFORE THE MOVE. mayDeleteRejectedZip realpaths the
      // artifact through containsOnDisk, which FAILS CLOSED on anything it cannot
      // resolve — and a staged artifact no longer exists at its cache path. Asking
      // after the move would answer "no" for every artifact and silently switch the
      // poison delete off, which is the same class of bug as reading a rule off the
      // surface its own writer just wrote.
      const mayDelete = mayDeleteRejectedZip({ zip, fileName, env: process.env });
      const stage = stageArtifact({ zip, fileName, fs, log: stderrLog });
      try {
        // C2: extraction must be unreachable for an artifact the anchor
        // contradicts. A missing anchor is NOT a refusal (see verifyArtifact).
        const gate = verifyArtifact({ zip: stage ? stage.path : zip, anchor, fileName, policy, fs, log: stderrLog });
        if (!gate.allowed) {
          refusal = rejectCachedZip({ gate, zip, stage, mayDelete, fileName, fs, log: stderrLog });
          if (cacheOnly) { return refusal; }
          // else: drop into the controlled download below.
        } else if (!stage) {
          // Bytes amicus could not take private are never extracted: unstaged, the
          // hash above vouches for a file its writer still controls.
          if (cacheOnly) { return { deferred: true, reason: `Cached electron zip for v${version} (${platform}-${arch}) could not be staged privately; deferring download.${avHint(platform)}` }; }
          // else: drop into the controlled download below.
        } else {
          try {
            await extractFromCache({ zip: stage.path, electronDir, platform, extract, fs });
            // Non-throwing extract w/ absent exe = the AV-quarantine signature.
            const outcome = verifyExtractOutcome({ electronDir, platform, fs });
            return gate.verdict === 'no-digest' ? { ...outcome, unverified: true } : outcome;
          } catch (extractErr) {
            // C4 IS A CALL-SITE INVARIANT. A path-traversal refusal must not be
            // deleted-and-retried, nor reported as "corrupt" — it stops here, and the
            // archive is put BACK, because a refused archive is the evidence.
            if (isUnsafeArchive(extractErr)) { return refuseUnsafeArchive({ err: extractErr, fileName, log: stderrLog }); }
            // Corrupt cached artifact: do NOT return it to the cache (this is v4.9.5's
            // unfenced rmSync, narrowed to a file inside our own temp dir), then fall
            // through to a forced fresh download (unless offline).
            stage.discard = true;
            if (cacheOnly) {
              return { repaired: false, reason: `Cached electron zip for v${version} (${platform}-${arch}) was corrupt and removed; deferring re-download.${avHint(platform)}` };
            }
            // else: drop into the controlled download below.
          }
        }
      } finally {
        releaseStage({ stage, fs, log: stderrLog });
      }
    } else if (cacheOnly) {
      return { deferred: true, reason: `No cached electron zip found for v${version} (${platform}-${arch}); deferring download.${avHint(platform)}` };
    }

    // Attempt 2 (online): CONTROLLED download+extract instead of a blind install.js
    // spawn — the SAME @electron/get api install.js uses, extracted offline, then the
    // REAL usability reported. A download that produced no usable exe is a FAILURE (#53).
    // A non-null `provision` means download + extract returned without throwing;
    // its `pinned:false` means no `checksums` went out (no anchor row for this
    // artifact, or the hatch dropped the pin), so the bytes were vouched for only
    // by the mirror — F3 marks that, as both docs already promise it does.
    let provision = null;
    try {
      const downloadArtifact = await resolveDownloadArtifact();
      provision = await controlledProvision({
        electronDir, platform, arch, version, anchor, downloadArtifact, extract, extractFromCache,
        fs, env: process.env, downloadMs: timeoutMs, policy, log: stderrLog,
      }) || { pinned: true };
    } catch (provisionErr) {
      // C4 again: an unsafe archive here must NOT reach runInstaller, which would
      // re-download and re-extract it through an extractor amicus does not drive.
      if (isUnsafeArchive(provisionErr)) { return refuseUnsafeArchive({ err: provisionErr, fileName, log: stderrLog }); }
      // Controlled download/extract failed (network, checksum, unzip). Try the
      // installer as a LAST resort — it can NEVER short-circuit the honest
      // verify below; we always return isElectronUsable().
      try { runInstaller({ electronDir, force, spawn, platform, arch }); } catch { /* ignore */ }
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

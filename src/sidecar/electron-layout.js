/**
 * The on-disk LAYOUT of an installed `electron` package: where the executable
 * lives, and how VERIFIED BYTES become a `dist/`.
 *
 * Layout (npm `electron`): `path.txt` -> the exe basename, `dist/<exe>` -> the
 * binary. Extraction restores `path.txt` afterwards, because a half-healed
 * package with a `dist/` and no `path.txt` is a shape `electron/index.js` cannot
 * resolve.
 *
 * SPLIT OUT of electron-install.js (v4.9.6, second council round): that file is
 * at the repo's 300-line gate, and the round's repairs had to land inside
 * `repairElectron` itself. These functions answer "where does the package keep
 * its exe", which is a different question from "how do I heal a broken install".
 *
 * WHAT CHANGED IN THE SECOND ROUND. `extractFromCache({zip, ...})` is GONE. It
 * took a PATH, which is the whole finding: the bytes that were hashed and the
 * bytes an extractor re-opens at a path are not the same bytes when the attacker
 * shares our uid. Its replacement, `extractBytesToDist`, takes a BUFFER the
 * caller already hashed and writes `dist/` by extract-into-incoming + promote
 * (see `promoteDist`).
 *
 * TRUE LEAF: `path` only, with `fs` and the extractor injected by the caller —
 * so electron-provision.js requires it too without any risk of a cycle.
 *
 * @module sidecar/electron-layout
 */

'use strict';

const crypto = require('crypto');
const path = require('path');

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

/** Restore path.txt so electron/index.js resolves the freshly-extracted exe. */
function writePathTxt({ electronDir, platform, fs }) {
  fs.writeFileSync(path.join(electronDir, 'path.txt'), platformExe(platform));
}

/**
 * RETIRE AND SWAP. Move a freshly-extracted tree into place as `dist/`, and
 * leave the previous one recoverable until the swap has actually happened.
 *
 * WHY NOT EXTRACT STRAIGHT INTO `dist/`, which is what every earlier cut did.
 * Because a half-written `dist/` IS a shape the rest of the self-heal cluster
 * reads as an install: `isElectronUsable` stats the exe, `verifyExtractOutcome`
 * calls a non-throwing extract with no exe the AV-quarantine signature. A kill
 * or an ENOSPC halfway through a 347 MB write used to leave exactly that, on top
 * of whatever was there before. Extraction now lands in
 * `<electronDir>/.amicus-incoming-<hex>/dist`, so a partial tree is never in the
 * place anything looks, and `dist/` changes in ONE rename.
 *
 * ORDER, and what survives each failure:
 *   1. rename `dist` -> `.amicus-retired-<hex>`   — old tree still whole, elsewhere
 *   2. rename `<incoming>/dist` -> `dist`         — the swap
 *   3. on a step-2 failure, rename the retired tree BACK                (rollback)
 *   4. delete the retired tree, then the incoming directory       (best-effort)
 * A step-1 failure (Windows, a handle held on the live tree) falls back to
 * `rmSync(dist)` — which is what the old code effectively did by overwriting —
 * and if THAT fails too the promote refuses with the previous `dist/` untouched.
 * No exit path can leave the user with neither the old tree nor the new one.
 *
 * `path.txt` is written LAST, after `dist/` is in place, so the "dist but no
 * path.txt" shape `electron/index.js` cannot resolve is never observable.
 * @param {object} o
 * @param {string} o.electronDir
 * @param {string} o.incomingDist the extracted tree to promote
 * @param {string} o.platform
 * @param {object} o.fs
 */
function promoteDist({ electronDir, incomingDist, platform, fs }) {
  const distDir = path.join(electronDir, 'dist');
  const retired = path.join(electronDir, `.amicus-retired-${crypto.randomBytes(6).toString('hex')}`);
  let retiredExists = false;
  if (fs.existsSync(distDir)) {
    try {
      fs.renameSync(distDir, retired);
      retiredExists = true;
    } catch {
      // A live handle on the old tree (Windows) — remove it in place instead.
      // If this throws, the promote fails with the old dist/ still there.
      fs.rmSync(distDir, { recursive: true, force: true });
    }
  }
  try {
    fs.renameSync(incomingDist, distDir);
  } catch (e) {
    if (retiredExists) { try { fs.renameSync(retired, distDir); } catch { /* nothing left to restore */ } }
    throw e;
  }
  if (retiredExists) { try { fs.rmSync(retired, { recursive: true, force: true }); } catch { /* swept next time */ } }
  writePathTxt({ electronDir, platform, fs });
}

/**
 * A failure that is about the DESTINATION, not the archive.
 *
 * The distinction is load-bearing, and getting it wrong here was MEASURED on
 * this very function: an EPERM from `renameSync` (a Windows handle held on the
 * live `dist/`) propagated out untagged, `repairFromCache` read "an extract
 * failure I cannot classify" as "the archive is bad", and DELETED the user's
 * cached artifact while telling them it "was corrupt and removed". The archive
 * was fine; the promote was not. Council finding D2 is the same shape one
 * function away, and this is the second place it could bite.
 */
function destinationFailure(e, what) {
  const err = new Error(`could not ${what}: ${(e && e.message) || e}`);
  err.code = 'UNZIP_DEST_FAILED';
  return err;
}

/**
 * Turn VERIFIED BYTES into `<electronDir>/dist`, offline.
 *
 * `bytes` is a Buffer whose sha256 the caller has ALREADY matched against the
 * anchor. There is no `zip` parameter and no path to the artifact anywhere in
 * this call, which is the property the whole change exists to establish:
 * **amicus never itself writes bytes it did not hash.**
 *
 * `extract` is injected — `zip-from-buffer.extractZipBuffer` in production —
 * and receives the Buffer, never a name.
 * @returns {Promise<void>}
 */
async function extractBytesToDist({ bytes, electronDir, platform, extract, fs }) {
  const incoming = path.join(electronDir, `.amicus-incoming-${crypto.randomBytes(6).toString('hex')}`);
  const incomingDist = path.join(incoming, 'dist');
  try {
    try {
      fs.mkdirSync(incomingDist, { recursive: true });
    } catch (e) {
      throw destinationFailure(e, `create ${incomingDist}`);
    }
    // NOT wrapped: the extractor classifies its own failures, and an archive
    // failure must keep saying so — it is the one thing that may evict.
    await extract(bytes, { dir: incomingDist });
    try {
      promoteDist({ electronDir, incomingDist, platform, fs });
    } catch (e) {
      throw destinationFailure(e, 'promote the extracted tree into dist/');
    }
  } finally {
    try { fs.rmSync(incoming, { recursive: true, force: true }); } catch { /* litter, not a failure */ }
  }
}

module.exports = { platformExe, writePathTxt, promoteDist, extractBytesToDist };

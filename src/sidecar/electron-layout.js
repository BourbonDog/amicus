/**
 * The on-disk LAYOUT of an installed `electron` package: where the executable
 * lives, and how VERIFIED BYTES become a `dist/`.
 *
 * Layout (npm `electron`): `path.txt` -> the exe basename, `dist/<exe>` -> the
 * binary. A promote writes `path.txt` FIRST and puts back what it overwrote on
 * every failure exit, so one that fails breaks nothing that resolved (`promoteDist`).
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

/** Write path.txt: the basename `electron/index.js` joins onto `dist/`. */
function writePathTxt({ electronDir, platform, fs }) {
  fs.writeFileSync(path.join(electronDir, 'path.txt'), platformExe(platform));
}

/**
 * The two litter prefixes this module creates, and how long one may survive.
 *
 * WHY A SWEEPER EXISTS AT ALL. Both trees are removed in the happy path — the
 * retired one right after the swap, the incoming one in `extractBytesToDist`'s
 * `finally` — and the docs said "a killed run leaves nothing to sweep up". That
 * was MEASURED FALSE twice. A `finally` does not run for a SIGKILL, a Ctrl-C
 * during `npm install`, a laptop lid close or an AV kill: a child SIGKILLed
 * mid-extract left `.amicus-incoming-<hex>` holding a partial tree, and a
 * subsequent `extractBytesToDist` on the same electronDir did not remove it. And
 * the retired tree leaks on its own path: on Windows 11 / NTFS with a process
 * running from `dist\\electron.exe`, `renameSync(dist, retired)` SUCCEEDS and the
 * follow-up `rmSync(retired)` fails EPERM with every entry still present — so
 * any repair that runs while an Electron is live off that tree strands the whole
 * previous ~350 MB dist, and the code comment said "swept next time" naming a
 * sweep that did not exist.
 *
 * Unlike the `amicus-electron-stage-*` litter this design replaced, these live
 * INSIDE the electron package directory, where no OS temp cleaner ever reaches
 * them. Ten interrupted provisions on a CI box was ten abandoned trees with no
 * code path that would ever remove them.
 *
 * THE AGE RULE, and why it is not zero. A provision holds the per-electronDir
 * repair lock, so in production nothing else is mid-extract in this directory —
 * but `promoteDist` and `extractBytesToDist` are callable without that lock, and
 * deleting a tree another process is actively writing is a worse failure than
 * leaving one behind. So the sweep takes only what is older than
 * `LITTER_MAX_AGE_MS`, which is the rule the deleted `sweepStaleStages` used and
 * the rule the docs stated honestly before this design replaced them: the next
 * provision sweeps any that is more than a day old.
 */
const LITTER_PREFIXES = ['.amicus-incoming-', '.amicus-retired-'];
const LITTER_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Remove abandoned incoming/retired trees from `electronDir`. BEST-EFFORT: a
 * tree that cannot be stat'ed or removed is left for the next run, and nothing
 * here can fail a provision.
 *
 * @param {object} o
 * @param {string} o.electronDir
 * @param {object} o.fs
 * @param {number} [o.maxAgeMs]
 * @param {number} [o.now]
 * @param {string} [o.keep] an absolute path never to remove (this run's own)
 * @returns {string[]} the names actually removed
 */
function sweepPromoteLitter({
  electronDir, fs, maxAgeMs = LITTER_MAX_AGE_MS, now = Date.now(), keep = null,
}) {
  let names;
  try {
    names = fs.readdirSync(electronDir);
  } catch {
    return [];
  }
  const swept = [];
  for (const name of names) {
    if (!LITTER_PREFIXES.some((p) => name.startsWith(p))) { continue; }
    const full = path.join(electronDir, name);
    if (keep && full === keep) { continue; }
    try {
      if (now - fs.statSync(full).mtimeMs < maxAgeMs) { continue; }
      fs.rmSync(full, { recursive: true, force: true });
      swept.push(name);
    } catch { /* a tree we cannot stat or remove waits for the next run */ }
  }
  return swept;
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
 *   0. write `path.txt` unless already right — a throw REFUSES, and puts it back
 *   1. rename `dist` -> `.amicus-retired-<hex>`   — old tree still whole, elsewhere
 *   2. rename `<incoming>/dist` -> `dist`         — the swap
 *   3. on a step-2 failure, rename the retired tree BACK                (rollback)
 *   4. delete the retired tree, then the incoming directory       (best-effort)
 *
 * WHAT A STEP-1 FAILURE MAY DO, AND THE CLAIM THAT WAS MEASURED FALSE. Step 1
 * failing means the old tree cannot be MOVED (a Windows handle held on the live
 * tree; an AV filter driver denying MoveFile on a tree holding a freshly written
 * electron.exe — this module's most-documented field failure). This used to fall
 * back to `rmSync(distDir)`, which is IRREVERSIBLE and has no rollback, while
 * the docblock asserted "No exit path can leave the user with neither the old
 * tree nor the new one".
 *
 * MEASURED FALSE (injected fs, every `renameSync` throwing EPERM, real
 * `rmSync`): the catch deleted the working tree, `retiredExists` stayed false,
 * the step-2 rename then failed with NO rollback, and `extractBytesToDist`'s
 * `finally` deleted the new tree immediately afterwards —
 * `{"threw":"EPERM","distExists":false,"userHasOldTree":false}`. A user who had
 * a working GUI was left with an electron package holding no `dist/` at all,
 * and the caller then downloaded 138 MB and repeated the same promote.
 *
 * So the in-place removal now happens ONLY when there is nothing to lose: a
 * `dist/` that holds no `platformExe` is not an install, and destroying it costs
 * the user nothing they had. When the old tree DOES hold an executable, the
 * promote REFUSES and that tree is untouched — the repair fails, which is
 * strictly better than a working GUI becoming no GUI.
 *
 * THE GUARANTEE, stated so it is checkable:
 *   **A promote never removes a `dist/` that held an executable unless the new
 *   tree is already in its place.**
 * The one exit that can still leave a user without a usable `dist/` is both
 * renames failing after step 1 SUCCEEDED. The old tree is then whole and
 * undeleted at `.amicus-retired-<hex>`, and the thrown message names it so the
 * user can rename it back.
 *
 * `path.txt` IS WRITTEN FIRST (B2). Writing it LAST made "dist but no path.txt"
 * unobservable only while that write SUCCEEDED, and it ran after the old tree was
 * retired AND DELETED, so one ENOSPC/EPERM/AV-locked 12-byte write left a `dist/`
 * that `electron/index.js` cannot resolve — amicus's own resolver falls back to
 * `platformExe`, that entry point does not. RULING on undoing the pre-write:
 * usually nothing to undo — the old tree resolved through that same string, and an
 * absent or EMPTY `path.txt` resolves through it in both resolvers — but it BREAKS
 * on one naming a DIFFERENT basename (`npm_config_platform` cross-installs one).
 * So step 0 sits INSIDE the same `try` as the swap, and its own refusal puts the
 * value back too: the write TRUNCATES at open (MEASURED — a real 12-byte path.txt
 * is 0 bytes after `openSync(p,'w')`, before any write can fail), so a refusal
 * that skipped the put-back destroyed the value it existed to keep. Best-effort:
 * a put-back that itself fails, or an UNREADABLE path.txt, loses the old basename.
 * @param {object} o
 * @param {string} o.electronDir
 * @param {string} o.incomingDist the extracted tree to promote
 * @param {string} o.platform
 * @param {object} o.fs
 */
function promoteDist({ electronDir, incomingDist, platform, fs }) {
  const distDir = path.join(electronDir, 'dist');
  const pathFile = path.join(electronDir, 'path.txt');
  let replaced = null;                    // step 0's overwritten DIFFERENT value
  try { replaced = fs.readFileSync(pathFile, 'utf8'); } catch { /* absent or unreadable */ }
  try {
    if (replaced === platformExe(platform)) { replaced = null; } else {
      try { writePathTxt({ electronDir, platform, fs }); } catch (e) {
        throw new Error(`${(e && e.message) || e} — path.txt could not be written, so the promote was refused and dist/ is exactly as it was`);
      }
    }
    const retired = path.join(electronDir, `.amicus-retired-${crypto.randomBytes(6).toString('hex')}`);
    let retiredExists = false;
    if (fs.existsSync(distDir)) {
      try {
        fs.renameSync(distDir, retired);
        retiredExists = true;
      } catch (e) {
        // The old tree cannot be moved. Removing it in place is irreversible, so
        // it is allowed only when the tree is not an install anyway.
        if (fs.existsSync(path.join(distDir, platformExe(platform)))) {
          throw new Error(`${(e && e.message) || e} — the existing dist/ holds a usable `
            + `${platformExe(platform)} and was left exactly as it was`);
        }
        fs.rmSync(distDir, { recursive: true, force: true });
      }
    }
    try {
      fs.renameSync(incomingDist, distDir);
    } catch (e) {
      if (retiredExists) {
        try {
          fs.renameSync(retired, distDir);
        } catch {
          // Both renames failed. The retired tree is WHOLE and is NOT deleted —
          // say where it is, because this is the only exit that leaves a user
          // without the dist/ they had.
          throw new Error(`${(e && e.message) || e} — the previous dist/ is intact at `
            + `${path.basename(retired)}; rename it back to dist/ to restore it`);
        }
      }
      throw e;
    }
    if (retiredExists) { try { fs.rmSync(retired, { recursive: true, force: true }); } catch { /* sweepPromoteLitter takes it */ } }
  } catch (e) {                           // EVERY exit undoes step 0 (see the RULING)
    if (replaced !== null) { try { fs.writeFileSync(pathFile, replaced); } catch { /* best-effort; the tree is what matters */ } }
    throw e;
  }
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
 *
 * It also SWEEPS, first: the incoming tree is removed in a `finally`, which a
 * kill does not run, and the retired tree's removal can fail EPERM while an
 * Electron is live off it. Both leak inside the electron package directory,
 * where no OS temp cleaner reaches them. See `sweepPromoteLitter`.
 * @returns {Promise<void>}
 */
async function extractBytesToDist({ bytes, electronDir, platform, extract, fs }) {
  const incoming = path.join(electronDir, `.amicus-incoming-${crypto.randomBytes(6).toString('hex')}`);
  const incomingDist = path.join(incoming, 'dist');
  // A killed run's `finally` never ran, and an EPERM `rmSync` of a retired tree
  // never finished. Take what they left before adding one more.
  sweepPromoteLitter({ electronDir, fs, keep: incoming });
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

module.exports = {
  platformExe, writePathTxt, promoteDist, extractBytesToDist, sweepPromoteLitter, LITTER_MAX_AGE_MS,
};

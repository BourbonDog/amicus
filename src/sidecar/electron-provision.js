/**
 * Electron CONTROLLED provision — the pinned download, and what happens to a
 * cached artifact the digest gate refuses.
 *
 * Split out of electron-install.js because that file sits at the repo's 300-line
 * gate and cannot grow. The require arrow is
 * electron-install -> electron-provision -> {electron-trust, electron-stage} and
 * must never point back, so `extractFromCache` arrives as an argument rather than
 * an import. electron-stage is a leaf (fs/os/path only) and is required by both
 * this module and electron-install.js, which adds no cycle.
 *
 * @module sidecar/electron-provision
 */

'use strict';

const path = require('path');

const { resolveCacheRoots } = require('./electron-cache');
const { releaseStage, stageArtifact } = require('./electron-stage');
const { artifactFileName, expectedDigest, scrubbedChildEnv } = require('./electron-trust');
const { containsOnDisk } = require('../utils/path-fence');

/** Best-effort cache root for downloadArtifact (first resolved root). */
function cacheRootFor(env = process.env) {
  return resolveCacheRoots(env)[0];
}

/**
 * CONTROLLED provision: fetch the zip ourselves with the SAME @electron/get
 * api install.js uses (downloadArtifact, force:true), extract offline, and let
 * the caller verify isElectronUsable(). No blind install.js spawn.
 *
 * C1 — THE PIN. `checksums` is what breaks the attack chain. Supplied, it makes
 * @electron/get write a LOCAL SHASUMS256.txt from this table and never fetch one
 * from the mirror, so a redirected download still has to produce bytes matching
 * electron's own published sha256. Passed as the ONE entry for this artifact:
 * an empty table is a hard throw upstream, and a table missing the requested
 * name fails the download outright — which is why no anchor means no `checksums`
 * key at all rather than an empty one. With no anchor, @electron/get falls back
 * to its own remote SHASUMS256.txt fetch: weaker, but never a re-download loop.
 *
 * THE HATCH REACHES THIS ROUTE TOO. `AMICUS_ALLOW_UNVERIFIED_ELECTRON=1` used to
 * be handed only to the cached-artifact gate, so the one case both docs describe
 * — a machine whose electron bytes legitimately differ (a local rebuild, an
 * internally-signed build on a corporate mirror) — still had its download pinned
 * to the official digest and failed. MEASURED before this change: with the hatch
 * set and nothing in any cache root, `checksums` was still sent and the call
 * returned `{repaired:false}` with no reason at all. When the hatch is set the
 * pin is dropped here and @electron/get falls back to the mirror's own
 * SHASUMS256.txt, which is what a rebuild publishes. That is a real downgrade,
 * so it is stated out loud on stderr every time rather than happening quietly —
 * and it is reachable ONLY through a bare env name a repository cannot plant.
 *
 * F3 — AND IT IS MARKED, NOT ONLY LOGGED (council seats C1 + B3). Both
 * `CHANGELOG.md` and `docs/troubleshooting.md` promise that an artifact no
 * published digest covers is "extracted and marked `unverified`". v4.9.5 kept
 * that promise on the CACHE route only: a no-digest DOWNLOAD silently omitted
 * `checksums`, extracted whatever the mirror served, and returned a plain
 * `{repaired:true}` with no mark and no line. The returned `pinned` flag is what
 * makes the promise true on this route too; `repairElectron` folds
 * `unverified:true` into its result whenever it is false.
 * @returns {Promise<{pinned:boolean}>} pinned:false = these bytes were vouched
 *   for only by the mirror that served them.
 */
async function controlledProvision({
  electronDir, platform, arch, version, anchor, downloadArtifact, extract, extractFromCache,
  fs, env = process.env, downloadMs = 480000, policy = {}, log = () => {},
}) {
  const fileName = artifactFileName({ version, platform, arch });
  let digest = expectedDigest(anchor, fileName);
  if (digest && policy.allowUnverified) {
    log('[amicus] WARNING: AMICUS_ALLOW_UNVERIFIED_ELECTRON=1 — downloading without the published');
    log(`[amicus]   sha256 pin for ${fileName}; its digest comes from the mirror you are using.`);
    digest = null;
  } else if (!digest) {
    log(`[amicus] NOTE: no published sha256 for ${fileName} (this electron package ships no`);
    log('[amicus]   checksums.json entry for it), so the download could not be pinned: its bytes');
    log('[amicus]   are checked against the SHASUMS256.txt the mirror itself serves. The result');
    log('[amicus]   is reported as unverified.');
  }
  const zip = await downloadArtifact({
    version,
    artifactName: 'electron',
    force: true,
    cacheRoot: cacheRootFor(env),
    platform,
    arch,
    ...(digest ? { checksums: { [fileName]: digest } } : {}),
    downloadOptions: { signal: AbortSignal.timeout(downloadMs) }, // 5.x native fetch: bound stalled downloads, free the lock
  });
  // F1 ON THIS ROUTE TOO. @electron/get validates in its own temp dir and THEN
  // moves the artifact into the cache root, so the path it hands back is one the
  // same cache-dir writer can swap before we open it. Without this, an attacker
  // who simply DELETES the cached zip forces the download route and wins the
  // identical race — the cache-route fix alone would be trivially side-stepped.
  const stage = stageArtifact({ zip, fileName, fs, log });
  try {
    await extractFromCache({ zip: stage ? stage.path : zip, electronDir, platform, extract, fs });
  } finally {
    releaseStage({ stage, fs, log });
  }
  return { pinned: !!digest };
}

/**
 * May this refused artifact be deleted? STRICTLY NARROWER than the unconditional
 * `fs.rmSync` on the corrupt-extract path: the basename must be exactly the
 * artifact we asked for, AND the file must resolve inside a resolved cache root.
 * `containsOnDisk` realpaths both sides and returns false on any error, so an
 * unresolvable path is refused rather than trusted — deleting at an
 * attacker-influenceable path is the one thing a poisoned cache could otherwise
 * turn into a weapon.
 *
 * Cost if it returns a wrong false: the mismatched zip stays and is re-downloaded
 * once per provision. An availability cost, never a safety one — the gate above
 * still refuses to extract it.
 */
function mayDeleteRejectedZip({ zip, fileName, env = process.env }) {
  if (path.basename(zip) !== fileName) { return false; }
  return resolveCacheRoots(env).some((root) => containsOnDisk(root, zip));
}

/**
 * Act on a REFUSED cached artifact: remove the poison when it is safe to, say
 * plainly what happened, and hand back the result shape a cacheOnly caller
 * returns. Deletion happens ONLY on `mismatch` — a `no-digest` artifact is not
 * evidence of anything, and an `unreadable` one is a file we could not even hash.
 *
 * `zip` is always the ORIGINAL cache path, never the staged copy: the message
 * tells the user about the path they can see. With an F1 `stage` in hand the
 * removal is not a delete at all — the artifact has already been moved out of
 * the cache, so "removed" means "not put back", and the only `rmSync` left runs
 * inside amicus's own temp directory. That is strictly NARROWER than v4.9.5's
 * reach: the fence still gates the outcome, and nothing outside it is unlinked.
 *
 * `mayDelete` IS THE FENCE'S ANSWER, PASSED IN, not re-derived here — see the
 * call site in electron-install.js for why it has to be taken before the move.
 * @returns {{repaired:false, integrity:string, reason:string}}
 */
function rejectCachedZip({ gate, zip, fileName, stage = null, mayDelete = false, fs, log = () => {} }) {
  let removed = false;
  if (gate.verdict === 'mismatch' && mayDelete) {
    try {
      // A MOVED artifact is already gone from the cache; discarding the staging
      // copy (below, in releaseStage) is the whole delete. A COPIED one — the
      // cross-volume fallback — still has its original in place.
      if (!stage || !stage.moved) { fs.rmSync(zip, { force: true }); }
      if (stage) { stage.discard = true; }
      removed = true;
    } catch { /* a cache we cannot write is not a reason to fail the repair */ }
  }
  const what = gate.verdict === 'mismatch'
    ? `sha256 ${gate.actual} does not match the published ${gate.expected}`
    : gate.reason;
  log(`[amicus] Electron artifact REFUSED: ${fileName}`);
  log(`[amicus]   ${zip}`);
  log(`[amicus]   ${what}`);
  log('[amicus] This is what a swapped mirror or a planted cache file looks like. It is ALSO');
  log('[amicus] what a truncated download, a failing disk, or a mirror serving a REBUILT');
  log('[amicus] electron looks like — amicus cannot tell them apart.');
  // ORDER MATTERS. The advice comes BEFORE the removal notice, and says what to
  // do about a file that is already gone: a hand-seeded air-gapped cache is the
  // one place the refused artifact was also the ONLY copy, and being told about
  // the hatch after "The file has been removed." is being told too late to use
  // it. The delete itself is required (a poisoned zip must not survive to be
  // re-offered); the words around it are what make it recoverable.
  log('[amicus] If you deliberately run a REBUILT electron, set');
  log('[amicus] AMICUS_ALLOW_UNVERIFIED_ELECTRON=1 BEFORE provisioning again — it accepts these');
  log('[amicus] bytes on the cache path and drops the digest pin on the download path.');
  log(`[amicus]   ${removed
    ? 'The file has been removed: re-copy it from the machine that downloaded it (or let'
      + '\n[amicus]   amicus download it again) once that variable is set.'
    : 'The file was left in place.'}`);
  log('[amicus] Headless runs and the council work without the GUI.');
  return {
    repaired: false,
    integrity: gate.verdict,
    reason: `Cached electron artifact ${fileName} was REFUSED: ${what}.`
      + `${removed ? ' It has been removed.' : ' It was left in place.'}`,
  };
}

/**
 * Drive electron's own install.js with force_no_cache semantics. C3: the spawn env
 * is SCRUBBED — install.js honours `npm_config_electron_mirror` AND
 * `npm_config_electron_use_remote_checksums` (which turns its own bundled pin off),
 * so `{...process.env}` here would funnel a blocked attacker into an unpinned
 * downloader and undo the pin on the route above.
 */
function runInstaller({ electronDir, force, spawn, platform, arch }) {
  const installScript = path.join(electronDir, 'install.js');
  const env = scrubbedChildEnv({ env: process.env, platform, arch });
  if (force) {
    env.force_no_cache = 'true';
  }
  return spawn(process.execPath, [installScript], { env, stdio: 'ignore' });
}

/** The terminal path-traversal refusal `robustExtract` throws (unzip.js C4). */
function isUnsafeArchive(err) {
  return !!err && err.code === 'UNZIP_UNSAFE_ARCHIVE';
}

/**
 * C4 AT THE CALL SITE. unzip.js classifies extract-zip's path-traversal refusals
 * as terminal so the same archive is never handed to an OS extractor that has no
 * such check. That invariant held only INSIDE unzip.js: both of repairElectron's
 * catch blocks used to swallow the refusal without reading `err.code` and launder
 * it back into exactly the retry the control forbids — the network path spawned
 * `node <electronDir>/install.js`, which re-downloads and re-extracts through
 * @electron-internal/extract-zip with no amicus supervision (the forbidden move,
 * one stack frame up), and the cache path deleted the zip through the UNFENCED
 * `fs.rmSync` and told the user it "was corrupt and removed" — a security refusal
 * reported as corruption. MEASURED both, before this change.
 *
 * So the refusal ends here: no retry, no fallback extractor, and no delete. The
 * archive is left where it is, because a refused archive is evidence, and
 * `err.message` already carries the path and extract-zip's own reason.
 * @returns {{repaired:false, integrity:'unsafe-archive', reason:string}}
 */
function refuseUnsafeArchive({ err, fileName, log = () => {} }) {
  const detail = (err && err.message) || 'the archive tried to write outside its destination';
  log(`[amicus] Electron artifact REFUSED (unsafe archive): ${fileName}`);
  log(`[amicus]   ${detail}`);
  log('[amicus] Entries in that zip tried to write OUTSIDE the destination directory. amicus');
  log('[amicus] will not retry it with another extractor, and has left the file in place.');
  log('[amicus] Headless runs and the council work without the GUI.');
  return {
    repaired: false,
    integrity: 'unsafe-archive',
    reason: `Electron artifact ${fileName} was REFUSED: ${detail}. It was NOT retried and NOT removed.`,
  };
}

module.exports = {
  cacheRootFor, controlledProvision, mayDeleteRejectedZip, rejectCachedZip, isUnsafeArchive, refuseUnsafeArchive,
  runInstaller,
};

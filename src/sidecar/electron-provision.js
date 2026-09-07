/**
 * Electron CONTROLLED provision — the pinned download, and the fence that says
 * whether a refused cache artifact may be deleted.
 *
 * Split out of electron-install.js because that file sits at the repo's 300-line
 * gate and cannot grow; the refusal MESSAGES were split out of this file, into
 * ./electron-refuse, for the same reason. The require arrow is
 * electron-install -> electron-provision -> {electron-trust, electron-stage,
 * electron-refuse} and must never point back, so `extractFromCache` arrives as
 * an argument rather than an import. electron-stage and electron-refuse are
 * near-leaves required by both this module and electron-install.js, which adds
 * no cycle.
 *
 * @module sidecar/electron-provision
 */

'use strict';

const path = require('path');

const { resolveCacheRoots } = require('./electron-cache');
const { refuseUnstagedArtifact, rejectDownloadedZip } = require('./electron-refuse');
const { releaseStage, stageArtifact } = require('./electron-stage');
const { artifactFileName, expectedDigest, scrubbedChildEnv, verifyArtifact } = require('./electron-trust');
const { containsOnDisk } = require('../utils/path-fence');

/** Best-effort cache root for downloadArtifact (first resolved root). */
function cacheRootFor(env = process.env) {
  return resolveCacheRoots(env)[0];
}

/**
 * CONTROLLED provision: fetch the zip ourselves with the SAME @electron/get
 * api install.js uses (downloadArtifact, force:true), stage it privately, hash
 * it OURSELVES, extract offline, and let the caller verify isElectronUsable().
 * No blind install.js spawn.
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
 * F#2 — AMICUS HASHES WHAT IT DOWNLOADED, ITSELF. Sending `checksums` records
 * that a table went out; it does not record that the bytes reaching the
 * extractor matched it. @electron/get validates in its own temp dir and then
 * RENAMES the artifact into the cache root, handing back THAT path — a path the
 * same cache-dir writer the digest gate exists to stop can swap before amicus
 * opens it. MEASURED before this change: with the swap fired inside amicus's own
 * post-download window, `BYTES EXTRACTED: "POISONED-BYTES"` and
 * `{"repaired":true}`. So the downloaded artifact is staged (copied into a
 * private 0700 directory) and re-hashed THERE against the same anchor the cache
 * route uses, and `pinned` now means what its name says: these exact bytes
 * matched a digest amicus anchored.
 *
 * F#6/F#8 — AND IT FAILS CLOSED. When staging is impossible (a full or
 * unwritable temp directory) this route used to extract the unstaged cache path
 * anyway, while the only line on screen said the bytes would not be extracted.
 * It now refuses, in the same words the cache route already used.
 *
 * F3 — AND AN UNPINNED SUCCESS IS MARKED, NOT ONLY LOGGED (seats C1 + B3). Both
 * `CHANGELOG.md` and `docs/troubleshooting.md` promise that an artifact no
 * published digest covers is "extracted and marked `unverified`". v4.9.5 kept
 * that promise on the CACHE route only. `repairElectron` folds `unverified:true`
 * into its result whenever `pinned` is false.
 * @returns {Promise<{pinned:boolean, refused?:object}>} pinned:false = these bytes
 *   were vouched for only by the mirror that served them; `refused` = a result
 *   shape the caller must return as-is, nothing was extracted.
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
  const stage = stageArtifact({ zip, fileName, fs, log });
  if (!stage) { return { pinned: false, refused: refuseUnstagedArtifact({ fileName, zip, log }) }; }
  try {
    // The gate runs on the STAGED copy, whose inode nothing else has a name for
    // or a handle on — so the bytes it hashes are the bytes extract() opens.
    const gate = verifyArtifact({ zip: stage.path, anchor, fileName, policy, fs, log });
    if (!gate.allowed) { return { pinned: false, refused: rejectDownloadedZip({ gate, fileName, log }) }; }
    await extractFromCache({ zip: stage.path, electronDir, platform, extract, fs });
    // BOTH halves, deliberately. `digest` says a `checksums` table went out, so a
    // hatch-dropped pin still reports unverified even when the anchor happens to
    // agree; `verdict === 'verified'` says amicus itself hashed these exact bytes
    // and they matched. Either half alone has been wrong: F3's first cut reported
    // the table, and the table alone is what seat F#2 showed does not describe the
    // bytes that reach the extractor.
    return { pinned: !!digest && gate.verdict === 'verified' };
  } finally {
    releaseStage({ stage, fs });
  }
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

module.exports = {
  cacheRootFor, controlledProvision, mayDeleteRejectedZip, runInstaller,
};

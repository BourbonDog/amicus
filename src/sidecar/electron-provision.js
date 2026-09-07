/**
 * Electron CONTROLLED provision — the pinned download, and what happens to a
 * cached artifact the digest gate refuses.
 *
 * Split out of electron-install.js because that file sits at the repo's 300-line
 * gate and cannot grow. The require arrow is
 * electron-install -> electron-provision -> electron-trust and must never point
 * back, so `extractFromCache` arrives as an argument rather than an import.
 *
 * @module sidecar/electron-provision
 */

'use strict';

const path = require('path');

const { resolveCacheRoots } = require('./electron-cache');
const { artifactFileName, expectedDigest } = require('./electron-trust');
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
 * @returns {Promise<void>}
 */
async function controlledProvision({
  electronDir, platform, arch, version, anchor, downloadArtifact, extract, extractFromCache,
  fs, env = process.env, downloadMs = 480000,
}) {
  const fileName = artifactFileName({ version, platform, arch });
  const digest = expectedDigest(anchor, fileName);
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
  await extractFromCache({ zip, electronDir, platform, extract, fs });
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
 * @returns {{repaired:false, integrity:string, reason:string}}
 */
function rejectCachedZip({ gate, zip, fileName, env = process.env, fs, log = () => {} }) {
  let removed = false;
  if (gate.verdict === 'mismatch' && mayDeleteRejectedZip({ zip, fileName, env })) {
    try {
      fs.rmSync(zip, { force: true });
      removed = true;
    } catch { /* a cache we cannot write is not a reason to fail the repair */ }
  }
  const what = gate.verdict === 'mismatch'
    ? `sha256 ${gate.actual} does not match the published ${gate.expected}`
    : gate.reason;
  log(`[amicus] Electron artifact REFUSED: ${fileName}`);
  log(`[amicus]   ${zip}`);
  log(`[amicus]   ${what}`);
  log(`[amicus]   ${removed ? 'The file has been removed.' : 'The file was left in place.'}`);
  log('[amicus] This is what a swapped mirror or a planted cache file looks like. It is ALSO');
  log('[amicus] what a truncated download, a failing disk, or a mirror serving a REBUILT');
  log('[amicus] electron looks like — amicus cannot tell them apart. If you deliberately run');
  log('[amicus] a rebuilt electron, set AMICUS_ALLOW_UNVERIFIED_ELECTRON=1 to accept it.');
  log('[amicus] Headless runs and the council work without the GUI.');
  return {
    repaired: false,
    integrity: gate.verdict,
    reason: `Cached electron artifact ${fileName} was REFUSED: ${what}.`
      + `${removed ? ' It has been removed.' : ' It was left in place.'}`,
  };
}

module.exports = { cacheRootFor, controlledProvision, mayDeleteRejectedZip, rejectCachedZip };

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

const { resolveCacheRoots } = require('./electron-cache');
const { artifactFileName, expectedDigest } = require('./electron-trust');

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

module.exports = { cacheRootFor, controlledProvision };

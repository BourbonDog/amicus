/**
 * Electron CONTROLLED provision — the pinned download, and the fence that says
 * whether a refused cache artifact may be deleted.
 *
 * Split out of electron-install.js because that file sits at the repo's 300-line
 * gate and cannot grow; the refusal MESSAGES were split out of this file, into
 * ./electron-refuse, for the same reason. The require arrow is
 * electron-install -> electron-provision -> {electron-custody, electron-layout,
 * electron-refuse, electron-trust} and must never point back. Those four are
 * near-leaves required by both this module and electron-install.js — and by
 * ./electron-repair-cache, which requires THIS module for `mayDeleteRejectedZip`
 * and is required only by electron-install.js, so the arrow stays acyclic.
 *
 * @module sidecar/electron-provision
 */

'use strict';

const path = require('path');

const { resolveCacheRoots } = require('./electron-cache');
const { readArtifactBytes } = require('./electron-custody');
const { extractBytesToDist } = require('./electron-layout');
const { withNativeRescue } = require('./electron-native-rescue');
const { refuseUnreadableArtifact, rejectDownloadedZip } = require('./electron-refuse');
const { withScrubbedRepoEnv } = require('./electron-env-scrub');
const { artifactFileName, expectedDigest, verifyArtifactBytes } = require('./electron-trust');
const { containsOnDisk } = require('../utils/path-fence');

/** Best-effort cache root for downloadArtifact (first resolved root). */
function cacheRootFor(env = process.env) {
  return resolveCacheRoots(env)[0];
}

/**
 * CONTROLLED provision: fetch the zip ourselves with the SAME @electron/get
 * api install.js uses, READ IT ONCE into memory, hash THOSE BYTES ourselves,
 * extract THOSE BYTES offline, and let the caller verify isElectronUsable().
 * No blind install.js spawn, and no path resolved a second time.
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
 * `{"repaired":true}`.
 *
 * THE SECOND ROUND MOVED WHERE THAT HASH HAPPENS, because the first answer was
 * not enough. It staged a private COPY and hashed the copy — and seat D1 showed
 * that copy is discoverable and openable by the same uid, so the race simply
 * moved onto the staged path. There is no copy now: the downloaded path is read
 * ONCE into a Buffer, that Buffer is hashed, and that Buffer is extracted. The
 * identical three steps run on the cache route (./electron-repair-cache), which
 * is what makes `pinned` mean what its name says.
 *
 * F#6/F#8 — AND IT FAILS CLOSED. When the bytes could not be read at all, this
 * route used to extract the unread path anyway while the only line on screen
 * said they would not be extracted. It refuses, in the cache route's own words.
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
  electronDir, platform, arch, version, anchor, downloadArtifact, extract,
  fs, spawn, env = process.env, downloadMs = 480000, policy = {}, log = () => {},
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
  // D5: @electron/get runs IN THIS PROCESS and reads the same repo-plantable
  // npm_config_electron_* / npm_package_config_electron_* names install.js does.
  // The scrub is held across the synchronous prefix ONLY, and the promise is
  // returned unawaited so no unrelated caller ever sees a scrubbed environment.
  //
  // WHAT THAT DOES AND DOES NOT COVER, MEASURED against the installed 5.0.0 and
  // re-measured by tests/electron-env-scrub-get5-contract.test.js on every run
  // (round 3, seat B1 — the previous claim here was reasoned, never run):
  // every read that decides the ARTIFACT's URL lands inside the window on BOTH
  // routes (20 of 20, 0 after the restore), so a planted mirror cannot move this
  // download. When `digest` is null there is no `checksums` table, and
  // @electron/get then recursively downloads SHASUMS256.txt AFTER awaits with
  // the environment restored — 13 planted reads, measured. That is
  // availability-only: the zip's URL is already fixed, so the planted mirror can
  // only serve a checksum file that disagrees with official bytes and FAIL the
  // download. See electron-env-scrub.js for the three closures rejected and why.
  //
  // IT SCRUBS `process.env`, NOT THIS FUNCTION'S `env` ARGUMENT, and that is the
  // point. `env` is an injectable input to cache-root RESOLUTION; the env
  // @electron/get actually reads is `process.env`, and the library offers no way
  // to change that. Threading `env` here would make the control silently do
  // nothing for any caller that passed a synthetic one — a guard aimed at a
  // surface its target never reads.
  const zip = await withScrubbedRepoEnv(() => downloadArtifact({
    version,
    artifactName: 'electron',
    // MEASURED, and stated because the surrounding prose used to claim
    // otherwise: `force` is DEAD in @electron/get 5.0.0 — `effectiveCacheMode`
    // never reads it — so this call can return a CACHE PATH with no network
    // fetch at all. It is left in place because removing it changes nothing
    // today and a later version may honour it again. What makes this route
    // sound is not freshness: it is that amicus reads and hashes whatever path
    // comes back, in its own memory.
    force: true,
    cacheRoot: cacheRootFor(env),
    platform,
    arch,
    ...(digest ? { checksums: { [fileName]: digest } } : {}),
    downloadOptions: { signal: AbortSignal.timeout(downloadMs) }, // 5.x native fetch: bound stalled downloads, free the lock
  }));
  // READ THE BYTES ONCE, and never resolve that path again. Everything after
  // this line acts on a Buffer in amicus's own heap.
  const held = readArtifactBytes({ zip, fs });
  if (!held.bytes) {
    return { pinned: false, refused: refuseUnreadableArtifact({ fileName, zip, why: held.why, detail: held.detail, log }) };
  }
  const gate = verifyArtifactBytes({ bytes: held.bytes, anchor, fileName, policy, log });
  if (!gate.allowed) { return { pinned: false, refused: rejectDownloadedZip({ gate, fileName, log }) }; }
  // C2, on BOTH routes — F3 is the standing reminder of what a rule wired to one
  // provision route and not the other costs. See ./electron-native-rescue for the
  // trigger boundary; `rescue.used` is folded into `pinned` below.
  const rescue = {};
  const extractOrRescue = withNativeRescue({ extract, gate, policy, rescue, platform, fs, spawn, log });
  await extractBytesToDist({ bytes: held.bytes, electronDir, platform, extract: extractOrRescue, fs });
  // BOTH halves, deliberately. `digest` says a `checksums` table went out, so a
  // hatch-dropped pin still reports unverified even when the anchor happens to
  // agree; `verdict === 'verified'` says amicus itself hashed these exact bytes
  // and they matched. Either half alone has been wrong: F3's first cut reported
  // the table, and the table alone is what seat F#2 showed does not describe the
  // bytes that reach the extractor.
  //
  // `!rescue.used` IS IMPLIED TODAY, AND IS STATED ANYWAY — said out loud so it
  // is not mistaken for a measured control. A rescue requires the hatch, and the
  // hatch has already set `digest` to null above, so `pinned` is false on every
  // hatch-on provision whether or not a rescue ran: on THIS route the term
  // changes no observable result. It is here because the property it encodes —
  // a tree a child process extracted from a path was never pinned — must not
  // depend on that coupling holding. On the CACHE route the same term is
  // load-bearing and observable (electron-repair-cache.js :: repairFromCache).
  return { pinned: !!digest && gate.verdict === 'verified' && !rescue.used };
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
 * THERE IS NO LAST-RESORT INSTALLER ANY MORE (council seat B1, BLOCKER,
 * confirmed 4 of 4). `runInstaller` spawned `<electronDir>/install.js`, which
 * did its OWN download and its OWN extraction, outside every control on this
 * page — and it was reached from `catch (provisionErr)` for ANY throw, so
 * inducing one failure was enough to route around the whole gate.
 *
 * It was worse than "a bypass". install.js pins with
 * `require('./checksums.json')` — the checksums of `<electronDir>`, the very
 * directory `doctor --fix` located by SCANNING npx caches. That is the
 * ANCHORFROMTARGET hole `resolveAnchor`'s rung 1 exists to close, and
 * electron-trust.js records it as MEASURED-exploitable. It also extracted
 * unbounded, with no stall protection and no path-traversal classification, and
 * its success came back as a plain `{repaired: isElectronUsable()}` — bytes
 * amicus never saw, labelled exactly like bytes it hashed.
 *
 * ITS ONE CLAIMED JUSTIFICATION WAS MEASURED FALSE. The case for keeping it was
 * "amicus's own tree cannot resolve @electron/get but electron's can". On this
 * machine, both resolve the SAME hoisted copy:
 *   amicus   require.resolve('@electron/get')                 -> node_modules/@electron/get/dist/index.js
 *   electron createRequire(electron/package.json).resolve(...) -> node_modules/@electron/get/dist/index.js
 * Every other trigger — a network failure, a mirror checksum failure, an abort
 * timeout, an extract failure — makes install.js do the same download the same
 * way with weaker checks. That is not a fallback; it is a bypass with a retry's
 * reputation. A failed provision is now reported honestly instead:
 * `ensureElectron` already turns that into "the GUI is unavailable, headless
 * runs and the council work", clears its single-flight guard so the next launch
 * retries, and points at `doctor --fix`.
 *
 * `scrubbedChildEnv` died with it (there is no child to build an env for). The
 * enumeration it encoded survives as `isRepoPlantedName` in electron-env-scrub,
 * which is what the IN-PROCESS download scrub uses.
 */

module.exports = { cacheRootFor, controlledProvision, mayDeleteRejectedZip };

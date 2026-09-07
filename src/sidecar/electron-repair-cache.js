/**
 * ATTEMPT 1 of the electron self-heal: turn a CACHED artifact into a `dist/`,
 * fully offline, in custody.
 *
 * SPLIT OUT of electron-install.js in the v4.9.6 second council round. That file
 * sits at the repo's 300-line gate and this route grew a step (read into memory)
 * while keeping every branch it already had. The seam is real: everything here
 * answers "can this cache entry become an install", and nothing here decides
 * where the cache is, what the anchor is, or what happens next — those arrive as
 * arguments.
 *
 * THE SHAPE OF THE ROUTE, and what each step now promises:
 *   1. READ the artifact ONCE into a Buffer (`electron-custody`). The path is
 *      resolved exactly once, ever. Anything that goes wrong here is a REFUSAL
 *      with a named `why`, never a silent fall-through.
 *   2. HASH THAT BUFFER against the anchor (`electron-trust.verifyArtifactBytes`).
 *   3. EXTRACT THAT BUFFER (`electron-layout.extractBytesToDist`), into an
 *      incoming directory that is promoted by rename.
 * There is no step in which a name is resolved a second time, which is what
 * makes the claim "the bytes that were hashed are the bytes that were written"
 * true rather than a race the attacker usually loses.
 *
 * WHAT AN EXTRACT FAILURE NOW MEANS (council finding D2). The old code deleted
 * the cached artifact on ANY extract error, including a failure to write
 * `dist/`. A full disk therefore destroyed a pristine cache entry — worst case
 * on an air-gapped run with no network to re-fetch from. `zip-from-buffer`
 * distinguishes the two: `UNZIP_BUFFER_FAILED` says the ARCHIVE is bad and is
 * the only failure that evicts anything; `UNZIP_DEST_FAILED` says the
 * DESTINATION is bad and never evicts.
 *
 * NEAR-LEAF: requires the custody, trust, refusal, layout and provision-fence
 * modules, and is required only by electron-install.js. The arrow is
 * electron-install -> electron-repair-cache -> {electron-custody, electron-trust,
 * electron-refuse, electron-layout, electron-provision} and never points back.
 *
 * @module sidecar/electron-repair-cache
 */

'use strict';

const { readArtifactBytes } = require('./electron-custody');
const { extractBytesToDist } = require('./electron-layout');
const { mayDeleteRejectedZip } = require('./electron-provision');
const { avHint } = require('./electron-quarantine');
const {
  isUnsafeArchive, refuseUnsafeArchive, refuseUnreadableArtifact, rejectCachedZip,
} = require('./electron-refuse');
const { verifyArtifactBytes } = require('./electron-trust');

/**
 * Try to provision from `zip`.
 *
 * @param {object} o
 * @param {string}  o.zip        the cached artifact's path (attacker-influenced)
 * @param {string}  o.fileName   the artifact name AMICUS resolved and validated
 * @param {object}  o.anchor     resolveAnchor's result
 * @param {object}  o.policy     electronTrustPolicy's result
 * @param {boolean} o.cacheOnly  true = never fall through to a download
 * @param {function} o.extract   the buffer extractor
 * @param {function} o.verifyOutcome  the bound AV-quarantine check
 * @returns {Promise<{done:true, result:object} | {done:false, refusal:object|null}>}
 *   `done:false` means "fall through to the controlled download", carrying a
 *   refusal the caller must still surface if the download also fails.
 */
async function repairFromCache({
  zip, fileName, anchor, policy, electronDir, platform, arch, version,
  cacheOnly, extract, verifyOutcome, fs, env = process.env, log = () => {},
}) {
  const held = readArtifactBytes({ zip, fs });
  if (!held.bytes) {
    const refusal = refuseUnreadableArtifact({ fileName, zip, why: held.why, detail: held.detail, log });
    return cacheOnly ? { done: true, result: refusal } : { done: false, refusal };
  }

  // C2: extraction must be unreachable for an artifact the anchor contradicts.
  // A missing anchor is NOT a refusal (see verifyArtifactBytes).
  const gate = verifyArtifactBytes({ bytes: held.bytes, anchor, fileName, policy, log });
  if (!gate.allowed) {
    const mayDelete = mayDeleteRejectedZip({ zip, fileName, env });
    const refusal = rejectCachedZip({ gate, zip, mayDelete, fileName, fs, log });
    return cacheOnly ? { done: true, result: refusal } : { done: false, refusal };
  }

  try {
    await extractBytesToDist({ bytes: held.bytes, electronDir, platform, extract, fs });
    // A non-throwing extract with no exe is the AV-quarantine signature.
    const outcome = verifyOutcome();
    return { done: true, result: gate.verdict === 'no-digest' ? { ...outcome, unverified: true } : outcome };
  } catch (err) {
    // C4 IS A CALL-SITE INVARIANT. A path-traversal refusal must not be
    // deleted-and-retried, nor reported as "corrupt" — it stops here, and the
    // archive is LEFT IN PLACE, because a refused archive is evidence.
    if (isUnsafeArchive(err)) { return { done: true, result: refuseUnsafeArchive({ err, fileName, log }) }; }
    // D2: only a bad ARCHIVE is evidence that the cached artifact is worthless.
    // A destination failure says nothing about it, so it keeps its bytes.
    if (err && err.code === 'UNZIP_DEST_FAILED') {
      const refusal = {
        repaired: false,
        integrity: 'extract-failed',
        reason: `Cached electron artifact ${fileName} could not be written to disk (${(err.message || '').trim()});`
          + ' it was LEFT IN PLACE because the artifact itself is not what failed.',
      };
      log(`[amicus] ${refusal.reason}`);
      return cacheOnly ? { done: true, result: refusal } : { done: false, refusal };
    }
    // The archive really is bad: evict it, and claim only what happened.
    let removed = false;
    try { fs.rmSync(zip, { force: true }); removed = true; } catch { /* an unwritable cache is not a repair failure */ }
    const reason = `Cached electron zip for v${version} (${platform}-${arch}) was corrupt and `
      + `${removed ? 'removed' : 'left in place'}; ${cacheOnly ? 'deferring re-download' : 'trying a fresh download'}.`
      + avHint(platform);
    // A1: this used to leave `refusal` null on the non-cacheOnly branch, so a
    // failed re-download afterwards returned a bare {repaired:false} with no
    // reason at all — after deleting the user's only artifact.
    return cacheOnly
      ? { done: true, result: { repaired: false, reason } }
      : { done: false, refusal: { repaired: false, integrity: 'corrupt-artifact', reason } };
  }
}

module.exports = { repairFromCache };

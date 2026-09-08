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
const { withNativeRescue } = require('./electron-native-rescue');
const { mayDeleteRejectedZip } = require('./electron-provision');
const { avHint } = require('./electron-quarantine');
const {
  isUnsafeArchive, refuseUnsafeArchive, refuseUnreadableArtifact, rejectCachedZip,
} = require('./electron-refuse');
const { verifyArtifactBytes } = require('./electron-trust');
const { collapseExcerpt } = require('../utils/text-sanitize');

/**
 * The ONE extract failure that is evidence the CACHED ARTIFACT is worthless,
 * and therefore the only one that may delete it.
 *
 * IT IS A ONE-ENTRY ALLOW-LIST BECAUSE THE RULE HAS TO FAIL CLOSED. The first
 * answer to D2 was a two-entry list of codes that KEEP the artifact, with
 * everything else evicting — which failed OPEN toward deletion on every failure
 * shape nobody had enumerated. MEASURED: an extractor throwing a plain `Error`
 * with no `code` (an internal bug) and one throwing a raw Node `ENOSPC` BOTH
 * deleted the artifact and told the user it "was corrupt and removed", which is
 * D2's own shape one classification gap to the left — and D2's stated worst case
 * is an air-gapped run with no network to re-fetch from.
 *
 * So the test is inverted: an extract failure removes the artifact only when the
 * extractor positively identified the ARCHIVE as bad. Everything else — a full
 * disk, an unwritable dist/, a promote that could not rename, an extractor that
 * would not load, a stall, and any error a future extractor forgets to classify
 * — keeps it. `zip-entry-write.js` is the other half of the contract: every
 * throw there goes through one of its three constructors.
 */
const EVICTS_THE_ARTIFACT = 'UNZIP_BUFFER_FAILED';

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
  cacheOnly, extract, verifyOutcome, fs, spawn, env = process.env, log = () => {},
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

  // C2: a PARSE FAILURE — and nothing else — may be answered by the native
  // extractor, and only when the hatch this route's own gate already honours is
  // set. `./electron-native-rescue` owns that boundary and the custody it spends;
  // `rescue.used` is what stops a rescued install ever reporting a clean repair,
  // because the bytes in dist/ were then placed by a child process from a path.
  const rescue = {};
  const extractOrRescue = withNativeRescue({ extract, gate, policy, rescue, platform, fs, spawn, log });
  try {
    await extractBytesToDist({ bytes: held.bytes, electronDir, platform, extract: extractOrRescue, fs });
    // A non-throwing extract with no exe is the AV-quarantine signature.
    const outcome = verifyOutcome();
    // A2/B3, and the gap the third round found in the first answer to them: the
    // mark is `verdict !== 'verified'`, NOT `verdict === 'no-digest'`. The
    // strictly more alarming case is the hatch-accepted MISMATCH — amicus
    // hashed the bytes and they CONTRADICT the published sha256 — and under the
    // narrow test that was the one case that reported a clean repair, with
    // postinstall's warning, ensureElectron's launch NOTE and `doctor --fix`'s
    // UNVERIFIED count all silent. MEASURED: same bytes, same contradicting
    // anchor, AMICUS_ALLOW_UNVERIFIED_ELECTRON=1 — the DOWNLOAD route marked it
    // (it drops the pin and requires `verified`) and this one did not. The two
    // routes now agree: `verified` is the only verdict that reports clean.
    //
    // C2 ADDS A SECOND WAY TO LOSE `verified`, for the same reason the first
    // exists: a NATIVE RESCUE extracted a path through a child process, so
    // whatever landed in dist/ is not what amicus hashed, whatever the artifact's
    // own digest said.
    return { done: true, result: gate.verdict === 'verified' && !rescue.used ? outcome : { ...outcome, unverified: true } };
  } catch (err) {
    // C4 IS A CALL-SITE INVARIANT. A path-traversal refusal must not be
    // deleted-and-retried, nor reported as "corrupt" — it stops here, and the
    // archive is LEFT IN PLACE, because a refused archive is evidence.
    if (isUnsafeArchive(err)) { return { done: true, result: refuseUnsafeArchive({ err, fileName, log }) }; }
    // D2: only a bad ARCHIVE is evidence that the cached artifact is worthless.
    // A full disk, an unwritable dist/, a promote that could not rename, an
    // extractor that would not load and an error nobody classified all say
    // nothing about the artifact, so it keeps its bytes. (The v4.5.2 outage is
    // why an unloadable extractor is in here: an undeclared zip library must not
    // be able to delete a user's only artifact on its way out.)
    if (!err || err.code !== EVICTS_THE_ARTIFACT) {
      const refusal = {
        repaired: false,
        integrity: 'extract-failed',
        // F5: the extractor's message can quote the ARCHIVE'S OWN entry name and
        // an fs error string built from an attacker-influenced path.
        reason: `Cached electron artifact ${fileName} was NOT extracted (${collapseExcerpt((err && err.message) || '')});`
          + ' it was LEFT IN PLACE: only an archive amicus positively identified as bad is removed.',
      };
      log(`[amicus] ${refusal.reason}`);
      return cacheOnly ? { done: true, result: refusal } : { done: false, refusal };
    }
    // The archive really is bad: evict it — THROUGH THE SAME FENCE the mismatch
    // eviction uses — and claim only what happened.
    //
    // C2 (round 3): this was a bare `fs.rmSync(zip, { force: true })`. Two
    // deletes of the same attacker-influenced path lived in this one module, one
    // fenced and one not, and `mayDeleteRejectedZip`'s own docblock had already
    // written the reason down — it called itself "STRICTLY NARROWER than the
    // unconditional `fs.rmSync` on the corrupt-extract path" and left that path
    // unconditional. `zip` comes out of a `readdirSync` of a directory anyone can
    // write, so the fence realpaths it, requires the basename to be exactly the
    // artifact amicus asked for, and requires it to resolve inside a resolved
    // cache root; `containsOnDisk` returns false on any error, so an
    // unresolvable path is refused rather than trusted.
    //
    // COST OF A WRONG `false`: a corrupt zip survives and is re-downloaded once
    // per provision, and the reason below says "left in place" — the same
    // availability cost the mismatch fence already accepts, never a safety one.
    let removed = false;
    if (mayDeleteRejectedZip({ zip, fileName, env })) {
      try { fs.rmSync(zip, { force: true }); removed = true; } catch { /* an unwritable cache is not a repair failure */ }
    }
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

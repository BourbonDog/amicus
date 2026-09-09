/**
 * THE NATIVE-EXTRACTOR RESCUE — the one way an archive amicus's own extractor
 * cannot parse still becomes an install, what it costs, and why it is reachable
 * from exactly one place.
 *
 * ── THE FINDING (council run 34182994208, major, deepseek seat) ───────────
 * "Deleting the native-unzip fallback and the last-resort install.js spawn
 * weakens the air-gapped recovery path to a permanent no-rescue failure for
 * archives yauzl cannot parse." True as filed. `zip-stall-bound.js` had already
 * written the loss down honestly — "an archive yauzl cannot parse but a native
 * extractor could is a failed repair plus a re-download" — and on a machine with
 * no network to re-download from, that is the end of the road.
 *
 * ── WHY IT CANNOT SIMPLY BE PUT BACK, WHICH IS THE WHOLE JUSTIFICATION ────
 * Every native extractor — `tar`, `Expand-Archive`, `ditto`, `unzip` — takes a
 * PATH. Using one therefore means writing bytes down and letting a child process
 * open them: the SECOND PATH RESOLUTION the custody design exists to eliminate
 * (`electron-custody.js` carries the three refuted remedies and the measurements
 * that killed them). The custody property — **amicus never itself writes, or
 * reports as verified, bytes it did not hash** — and a path-taking extractor
 * cannot both hold on the same run. There is no clever version of this: the two
 * properties are in direct contradiction.
 *
 * That trade is acceptable ONLY under a flag whose existing documented meaning is
 * already "I accept Electron bytes amicus cannot vouch for", and it must not be
 * reachable any other way. `AMICUS_ALLOW_UNVERIFIED_ELECTRON=1` is that flag, and
 * it is read in exactly one place (`electron-trust.js :: electronTrustPolicy`),
 * from a bare environment name a repository's `.npmrc` cannot plant. Custody
 * stays absolute by default. `runInstaller` is NOT coming back — it did its own
 * download with its own anchor, which is a different and much worse thing (see
 * `electron-provision.js`).
 *
 * ── THE TRIGGER BOUNDARY, WHICH MATTERS MORE THAN THE MECHANISM ───────────
 * "Fall back when extraction fails" would re-arm the laundering bug this cluster
 * already fixed once (C4): a security refusal handed to a tool with no such
 * check. So the trigger is ONE extractor verdict, `UNZIP_BUFFER_FAILED` — the
 * code whose defined meaning is "the ARCHIVE is bad", and already the only
 * failure that licences an eviction (`electron-repair-cache.js ::
 * EVICTS_THE_ARTIFACT`). The rescue and the eviction now share one trigger.
 *
 *   YES  the extractor positively identified the ARCHIVE as unreadable.
 *   NO   `UNZIP_UNSAFE_ARCHIVE` — a path-traversal REFUSAL. Terminal by design;
 *        C4 exists precisely to stop a refusal being retried through a tool
 *        amicus does not control, and the hatch is not even MENTIONED on that
 *        exit — advertising it there would be the same laundering with a human
 *        in the loop.
 *   NO   `UNZIP_BUFFER_STALLED` — the bound exists to STOP work, not to hand it
 *        to someone else, and a stall is a verdict about nothing.
 *   NO   a digest MISMATCH. The bytes are known wrong; there is nothing to
 *        rescue. This is the exclusion that is easy to get wrong, because the
 *        same flag that opens the rescue ALSO downgrades a mismatch refusal to a
 *        warning (`electron-trust.js :: verifyArtifactBytes`) — so with the hatch
 *        set, contradicted bytes really do reach the extractor. `gate.verdict`
 *        is checked here for that one reason.
 *   NO   `UNZIP_DEST_FAILED` — not the archive's fault, and a native extractor
 *        writing to the same full or unwritable destination fails identically.
 *   NO   `UNZIP_BUFFER_UNAVAILABLE`, and NO an error carrying no `code` at all.
 *        Neither is a parse failure, and a rule that fails OPEN on the shapes
 *        nobody enumerated is the shape D2 was filed against. Fail closed.
 *
 * AND A VERDICT IS NOT THE WHOLE QUESTION. Every line above keys on the refusal
 * yauzl FORMED, and yauzl checks an entry's size before its name — so an archive
 * whose first entry breaks the extraction arrives as `UNZIP_BUFFER_FAILED` with
 * its traversal entry never looked at. One flag bit, MEASURED, moves the same
 * archive from the terminal class into the rescuable one. So the boundary also
 * asks what names the archive DECLARES (`hostileName`), and a name yauzl would
 * have refused is treated as the refusal it would have raised. What that scan
 * cannot see is written down there rather than papered over.
 *
 * ── AND `no-digest` IS ALLOWED, DELIBERATELY ──────────────────────────────
 * Only `mismatch` is excluded. `no-digest` means nobody ever published a digest
 * for this artifact — an Electron package predating `checksums.json` — which is
 * exactly the old, air-gapped machine the finding is about. Nothing contradicts
 * those bytes; refusing them would delete the rescue for its main case.
 *
 * ── WHAT A RESCUE CAN NEVER DO: REPORT CLEAN ──────────────────────────────
 * `rescue.used` is set when the rescue runs, and both routes fold it into their
 * `unverified` mark, so a rescued install is never reported as verified even
 * when the artifact's own sha256 matched. It has to be: the bytes in `dist/` were
 * placed there by a child process reading a path, not by amicus writing what it
 * hashed. Reporting that as verified is the exact overclaim the custody property
 * forbids.
 *
 * ── OFFERED-BUT-UNARMED: THE OFFER IS A PROMISE ──────────────────────────
 * With the hatch OFF, a parse failure prints an offer naming the flag and telling
 * an air-gapped user to set it and provision again. The FIRST cut of C2 printed
 * that and then let the same `UNZIP_BUFFER_FAILED` reach the cache route's
 * eviction, which DELETED the artifact on the way out — MEASURED end to end: the
 * ten-line offer on stderr, `reason: "… was corrupt and removed"`, the zip gone,
 * and the re-run the message asks for ending in `No cached electron zip found`.
 * On the machine the whole finding is about, the offer named a rescue that its
 * own run had just made impossible.
 *
 * So `rescue.offered` is set HERE, where the promise is made, and
 * `electron-repair-cache.js` keeps the artifact when it is set. The cost is the
 * availability cost that module already accepts wherever its delete fence says
 * no: an unreadable zip survives and is re-downloaded once per provision. That
 * is the right way round — a copy nobody can read costs one download; a copy
 * that is gone costs the only rescue there was.
 *
 * @module sidecar/electron-native-rescue
 */

'use strict';

const { spawnSync } = require('child_process');

// The cap comes from `unzip.js`, which is byte-for-byte unchanged: this is a
// re-wiring of a caller, not a change to that module.
const { MAX_MS } = require('./unzip');
// The mechanism this file decides about: writing the buffer down, walking the
// platform's plan, sweeping up. `RESCUE_ZIP` and `INCOMING_PREFIX` are re-exported
// below because they name what a rescue leaves on disk, which is this module's
// subject even though the code that writes them is next door.
const { nativeRescue, RESCUE_ZIP, INCOMING_PREFIX } = require('./electron-native-plan');
// The offer a parse failure gets when the hatch is off. Every other user-facing
// sentence in this subsystem is written in the same two files.
const { offerNativeRescue } = require('./electron-rescue-notice');
// The read-only name walk the boundary consults before it trusts a verdict.
const { scanEntryNames, scanLocalNames } = require('./zip-name-scan');
const { collapseExcerpt } = require('../utils/text-sanitize');

/** The ONE extractor verdict a rescue may act on. See the docblock's boundary. */
const RESCUE_TRIGGER = 'UNZIP_BUFFER_FAILED';

/** True for the ONE failure class the owner authorised a rescue for. */
function isRescuableFailure(err) {
  return !!err && err.code === RESCUE_TRIGGER;
}

/**
 * A parse failure's archive, asked what ENTRY NAMES it declares.
 *
 * THE EXCLUSION ABOVE KEYS ON A REFUSAL, AND A REFUSAL HAS TO BE FORMED. yauzl
 * checks an entry's size before its name, so an archive whose FIRST entry breaks
 * the extraction never reaches the traversal entry behind it and arrives here as
 * `UNZIP_BUFFER_FAILED` — the one class a rescue acts on. MEASURED: one flag bit
 * moves the same archive from `UNZIP_UNSAFE_ARCHIVE` into the rescue, traversal
 * entry and all (`zip-name-scan.js` carries both measurements and the two
 * Windows tools' own refusals, which are what stopped the escape that run).
 *
 * So the boundary asks about the ENTRIES, not only the verdict, and a name yauzl
 * would have refused becomes the refusal yauzl would have raised: terminal,
 * unadvertised, left in place, exactly as if the archive had had nothing wrong
 * with it but that entry.
 *
 * BOTH TABLES, BECAUSE THE STRATEGIES DO NOT AGREE ON WHICH ONE THEY READ (B3).
 * Through v4.9.6 this asked the CENTRAL directory only, so an archive that blinds
 * yauzl there — a truncation, or any of four ONE-FIELD forgeries of a COMPLETE
 * end-of-central-directory record — declared no names amicus could see and went
 * to the native extractor anyway. MEASURED: seven such archives carrying
 * `../../../PWNED-BY-NATIVE.txt` reached a real spawn, and on two the rescue ran
 * to COMPLETION and promoted. Only the Windows tools' own `..` guards stopped the
 * escape — the exact reliance this module says amicus will not make.
 * And the tables can DISAGREE: on an archive declaring one name locally and
 * another centrally, `tar.exe` wrote the LOCAL name while `Expand-Archive` wrote
 * the CENTRAL one. So a refusal in EITHER table refuses the archive.
 *
 * THE RESIDUALS THAT REMAIN. Neither walk sees a SYMLINK whose target escapes:
 * that is a payload, not a name. And an archive that defeats BOTH walks still
 * reaches the extractor — rarer than before, but not impossible — so the notice
 * printed before the spawn now says WHICH names were checked, rather than letting
 * the user assume they all were. `docs/configuration.md` says the same thing to
 * the user who has to decide whether to set the flag.
 *
 * WHEN A NAME CHECK CANNOT SEE IT, the only check left is the extractor's own —
 * and that claim is now RE-MEASURED on every CI run rather than asserted once
 * (`tests/sidecar/native-extractor-containment.test.js`, 12 escape shapes per
 * strategy). `tar.exe`, `Expand-Archive` and Info-ZIP `unzip` all contain their
 * own escapes; GNU `tar` cannot read a zip at all; `ditto` is the one strategy
 * still unmeasured, and that suite measures it the first time it runs on a Mac.
 * What a failed strategy can still leave behind is ONLY a write to an ABSOLUTE
 * path outside the incoming tree: everything else the rescue writes lives under
 * that tree, which `extractBytesToDist`'s `finally` deletes unconditionally (B2).
 * @param {{central:object, local:object}} seen the two walks' results
 * @returns {Error|null} a terminal UNZIP_UNSAFE_ARCHIVE, or null
 */
function hostileName(seen, log) {
  const refusal = seen.central.refusal || seen.local.refusal;
  if (!refusal) { return null; }
  log('[amicus] REFUSING to rescue this archive: amicus could not read it, and while asking what');
  log('[amicus] it contains it found an entry that tries to write OUTSIDE the destination:');
  log(`[amicus]   ${collapseExcerpt(refusal)}`);
  log('[amicus] A native extractor may have no such check, so it is not offered this archive.');
  return Object.assign(
    new Error(`refusing to extract this archive: ${collapseExcerpt(refusal)}`),
    { code: 'UNZIP_UNSAFE_ARCHIVE' },
  );
}

/**
 * Wrap a buffer extractor so a PARSE FAILURE — and nothing else — may be rescued
 * by the native plan when the hatch is set.
 *
 * ONE WRAPPER, WIRED AT BOTH CALL SITES. `gate` and `policy` are only known after
 * the digest gate has run, which is why this is composed inside each route rather
 * than once in `repairElectron`; F3 is the standing reminder of what happens when
 * a rule lands on one provision route and not the other, so a test asserts both.
 *
 * @param {object} o
 * @param {function} o.extract  the buffer extractor being wrapped
 * @param {object}   o.gate     verifyArtifactBytes's result (its `verdict` is read)
 * @param {object}   o.policy   electronTrustPolicy's result (the hatch)
 * @param {object}   o.rescue   OUT: `{used, strategy}` when a rescue ran, and
 *   `{offered:true}` when one was named but not armed — the caller must not then
 *   discard the artifact the offer points at
 * @returns {function} an extractor with the same (bytes, {dir}) signature
 */
function withNativeRescue({
  extract, gate = {}, policy = {}, rescue = {}, platform = process.platform,
  fs, spawn = spawnSync, maxMs = MAX_MS, log = () => {},
}) {
  return async (bytes, o) => {
    try {
      return await extract(bytes, o);
    } catch (err) {
      // Every class but one leaves through here untouched and unadvertised.
      if (!isRescuableFailure(err)) { throw err; }
      // ...and the one class that IS rescuable is asked what names it declares
      // first, because the exclusion above keys on the refusal yauzl FORMED and
      // an earlier bad entry stops it forming one. See `hostileName`.
      const seen = { central: await scanEntryNames(bytes), local: scanLocalNames(bytes) };
      const hostile = hostileName(seen, log);
      if (hostile) { throw hostile; }
      if (!policy.allowUnverified) {
        // `offered` IS THE OFFER'S RECEIPT, and the cache route is required to
        // honour it: see the docblock's OFFERED-BUT-UNARMED section.
        rescue.offered = true;
        offerNativeRescue({ reason: (err && err.message) || '', log });
        throw err;
      }
      if (gate.verdict === 'mismatch') {
        log('[amicus] the native-extractor rescue was NOT attempted: these bytes contradict the published sha256, so there is nothing to rescue.');
        throw err;
      }
      const strategy = nativeRescue({
        bytes,
        dir: o.dir,
        reason: (err && err.message) || '',
        // WHAT THE NOTICE MAY CLAIM. Three states, not two: a real artifact
        // truncated by a few KB has BOTH walks incomplete while the local walk
        // read and cleared every name it found, so `central.read || local.complete`
        // would print "nothing checked its entries" over 73 checked entries.
        namesComplete: seen.central.read || seen.local.complete,
        namesChecked: seen.local.names,
        platform,
        fs,
        spawn,
        maxMs,
        log,
      });
      // A rescue that failed leaves the ORIGINAL classified error in flight, so
      // a genuinely bad archive is still evicted exactly as it was before.
      if (!strategy) { throw err; }
      rescue.used = true;
      rescue.strategy = strategy;
      return { strategy, rescued: true };
    }
  };
}

module.exports = {
  withNativeRescue, isRescuableFailure, RESCUE_TRIGGER, RESCUE_ZIP, INCOMING_PREFIX,
};

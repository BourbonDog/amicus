/**
 * THE TWO NOTICES the native-extractor rescue speaks — the offer a parse failure
 * gets when the hatch is OFF, and the window disclosure printed when it is ON.
 *
 * SPLIT OUT of `./electron-refuse` (v4.9.6, C2 round 4): that file sits at the
 * repo's 300-line gate and these two functions pushed it two lines over. The
 * seam is the one it already had — everything in both files composes a message
 * a user reads and decides nothing. `./electron-native-rescue` owns which
 * failures reach either of these, and it is the only caller.
 *
 * WHY THE WORDS ARE THIS BLUNT. The rescue writes bytes amicus hashed to a path
 * and hands that path to a child process, which is the one thing the rest of the
 * provisioning exists to avoid. Neither notice may describe that as safe; both
 * say what the window is while it is open. F5's sanitizer runs on everything
 * here that quotes an extractor message or a path.
 *
 * NEAR-LEAF: `./electron-refuse` (for `PATH_EXCERPT_CHARS`) and
 * `../utils/text-sanitize`. Nothing requires it back.
 *
 * @module sidecar/electron-rescue-notice
 */

'use strict';

const { PATH_EXCERPT_CHARS } = require('./electron-refuse');
const { collapseExcerpt } = require('../utils/text-sanitize');

/**
 * THE OFFER a parse failure gets when the native-extractor rescue is NOT armed.
 *
 * It NAMES `AMICUS_ALLOW_UNVERIFIED_ELECTRON` and says what setting it would do,
 * so an air-gapped user whose archive amicus cannot read can find the escape
 * hatch without reading the source — the whole point of the C2 finding. It is
 * printed for a PARSE FAILURE and nothing else: a security refusal must never be
 * answered with an offer to retry, which is C4 with a human in the loop.
 * `electron-native-rescue.js` owns which failures reach here.
 *
 * AND IT PROMISES THE ARCHIVE IS STILL THERE, which is a claim its callers now
 * keep: printing this offer sets `rescue.offered`, and the cache route reads that
 * and does NOT evict (`electron-repair-cache.js`). The first cut said all of the
 * above and then deleted the artifact on the way out, so the re-run it asks for
 * had nothing to rescue — the last sentence exists to be falsifiable.
 */
function offerNativeRescue({ reason, log = () => {} }) {
  log(`[amicus] amicus could not read this Electron archive: ${collapseExcerpt(reason)}`);
  log('[amicus] There is ONE rescue for that, and it is OFF. With');
  log('[amicus] AMICUS_ALLOW_UNVERIFIED_ELECTRON=1 set BEFORE provisioning, amicus writes the bytes');
  log('[amicus] it hashed into a private directory inside the electron package and hands that PATH');
  log('[amicus] to a native extractor (tar / Expand-Archive / ditto / unzip) — the only way an');
  log('[amicus] archive amicus cannot parse becomes an install on a machine with no network to');
  log('[amicus] re-download from. It COSTS custody: between amicus writing that file and the child');
  log('[amicus] process opening it, anything running as your user can substitute it, and what the');
  log('[amicus] child extracts is promoted into dist/ without ever being hashed again. That is not');
  log('[amicus] safe — it is the trade the flag buys. Prefer a different copy of the artifact.');
  log('[amicus] This run has NOT discarded the archive it could not read: the copy you have is still');
  log('[amicus] there, so setting the variable and running again has something to act on.');
}

/**
 * THE NOTICE a user sees when the rescue actually runs. Printed BEFORE the child
 * is spawned, because the window opens at the write, and it DESCRIBES that window
 * instead of reassuring anyone about it — the rescue is not safe, and the words a
 * user reads while it happens have to say so.
 */
function announceNativeRescue({
  zip, reason, namesComplete, namesChecked = 0, log = () => {},
}) {
  log('[amicus] AMICUS_ALLOW_UNVERIFIED_ELECTRON=1 — running the NATIVE-EXTRACTOR RESCUE.');
  log(`[amicus]   amicus could not read the archive itself: ${collapseExcerpt(reason)}`);
  // THREE STATES, NOT TWO, and the middle one is the common one: a real artifact
  // truncated by a few KB leaves both walks incomplete while the local walk still
  // read and cleared every name it reached. Saying "nothing checked its entries"
  // there would be a FALSE disclosure on the shape this rescue exists for.
  // `namesComplete` is undefined-means-no on purpose (see `nativeRescue`).
  if (!namesComplete && namesChecked > 0) {
    log(`[amicus]   IT CHECKED ${namesChecked} ENTRY NAMES AND COULD NOT CONFIRM IT SAW THEM ALL:`);
    log('[amicus]   the archive stopped amicus part-way through its own tables, so an entry that');
    log('[amicus]   writes OUTSIDE dist/ could sit past the point it reached.');
  } else if (!namesComplete) {
    log('[amicus]   AND IT COULD NOT READ THE ENTRY NAMES EITHER: neither this archive\'s central');
    log('[amicus]   directory nor its local file headers could be walked, so NOTHING checked its');
    log('[amicus]   entries for paths that write OUTSIDE dist/. The extractor below is the only');
    log('[amicus]   check left.');
  }
  log('[amicus] THE WINDOW THIS OPENS, stated plainly. amicus has written the bytes it hashed to');
  log(`[amicus]   ${collapseExcerpt(zip, PATH_EXCERPT_CHARS)}`);
  log('[amicus] and is about to hand that PATH to a native extractor it does not control. Between');
  log('[amicus] the write and the child opening the file, anything running as your user can');
  log('[amicus] replace it, and whatever the child extracts is promoted into dist/ WITHOUT being');
  log('[amicus] hashed again. So this run is not covered by the property the rest of the');
  log('[amicus] provisioning holds to — that amicus only ever writes bytes it hashed. It is NOT');
  log('[amicus] safe; it is what the flag buys, and the result is reported as unverified.');
}

module.exports = { offerNativeRescue, announceNativeRescue };

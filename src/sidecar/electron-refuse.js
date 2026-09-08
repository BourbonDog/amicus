/**
 * Electron artifact REFUSALS — the ways amicus declines to turn bytes into an
 * Electron install, and the exact words it uses each time. (Since C2 it also
 * holds the two NOTICES the native-extractor rescue speaks: the offer a parse
 * failure gets when the hatch is off, and the window disclosure it prints when
 * the hatch is on. Same seam — the words live here, the policy does not.)
 *
 * SPLIT OUT of electron-provision.js (v4.9.6, second council round) because that
 * file sits under the repo's 300-line gate and the round added two more
 * refusals: a DOWNLOADED artifact that fails amicus's own hash (F#2), and an
 * artifact that could not be taken private at all (F#6/F#8). The split is along
 * a real seam — everything here composes a message and returns a result shape,
 * and nothing here decides policy. The one `rmSync` in the file is fenced by an
 * answer its caller computed (`mayDelete`), never by anything derived here.
 *
 * F5 (council seat B5). Everything below that reaches stderr or a returned
 * `reason` goes through the house sanitizer first, because two of its inputs are
 * written by the attacker: an unsafe archive's refusal text carries the ARCHIVE'S
 * OWN entry name, and a cached artifact's path carries a `<sha>` directory name
 * read out of a cache root anyone can write. Unsanitized, either could embed ANSI
 * escapes, a newline plus a forged `[amicus] …` line, or a right-to-left override
 * that renders the rest of the sentence backwards — in the one message a user
 * reads when amicus is telling them something is wrong.
 *
 * NEAR-LEAF MODULE: `utils/text-sanitize` only. electron-install.js and
 * electron-provision.js both require it, which adds no cycle.
 *
 * @module sidecar/electron-refuse
 */

'use strict';

const { collapseExcerpt } = require('../utils/text-sanitize');

/**
 * A path gets a longer cap than an error excerpt: 200 characters truncates a real
 * npx-cache path, and a path the user cannot copy is not much use in a refusal.
 */
const PATH_EXCERPT_CHARS = 320;

/**
 * What each of `readArtifactBytes`'s refusals MEANS, in one clause the user can
 * act on. Kept here rather than in the custody module so every user-facing
 * sentence in this subsystem is written in one file.
 */
const UNREADABLE_REASON = {
  unreadable: 'could not be opened or read at all',
  'not-a-file': 'is not a regular file',
  empty: 'is empty',
  'too-large': 'is far larger than any electron artifact',
  'short-read': 'ended early while amicus was reading it',
  grew: 'changed size while amicus was reading it',
};

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
  // F5: this message quotes the ARCHIVE'S OWN entry name back at the user. The
  // house sanitizer runs before it reaches stderr or the returned reason.
  const detail = collapseExcerpt((err && err.message) || 'the archive tried to write outside its destination');
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

/**
 * Act on a REFUSED cached artifact: remove the poison when it is safe to, say
 * plainly what happened, and hand back the result shape a cacheOnly caller
 * returns. Deletion happens ONLY on `mismatch` — a `no-digest` artifact is not
 * evidence of anything, and an `unreadable` one is a file we could not even hash.
 *
 * `zip` is the ORIGINAL cache path, which is also the ONLY copy of these bytes
 * anyone can reach: staging COPIES, so the artifact never left the cache and
 * this `rmSync` is the whole delete, exactly as it was in v4.9.5. (The first cut
 * of the F1 work made it conditional on a `moved` flag the stage object carried;
 * seats F#4/F#5 caught the sibling branch where that silently removed nothing.)
 *
 * `mayDelete` IS THE FENCE'S ANSWER, PASSED IN, not re-derived here — the fence
 * realpaths the artifact, so it has to be asked while the file is still where the
 * caller found it.
 * @returns {{repaired:false, integrity:string, reason:string}}
 */
function rejectCachedZip({ gate, zip, fileName, mayDelete = false, fs, log = () => {} }) {
  let removed = false;
  if (gate.verdict === 'mismatch' && mayDelete) {
    try {
      fs.rmSync(zip, { force: true });
      removed = true;
    } catch { /* a cache we cannot write is not a reason to fail the repair */ }
  }
  // F5: `gate.reason` is an fs error string (an `unreadable` verdict) and `zip` is
  // an attacker-influenced cache path; the digests are 64-hex by construction.
  const what = gate.verdict === 'mismatch'
    ? `sha256 ${gate.actual} does not match the published ${gate.expected}`
    : collapseExcerpt(gate.reason);
  log(`[amicus] Electron artifact REFUSED: ${fileName}`);
  log(`[amicus]   ${collapseExcerpt(zip, PATH_EXCERPT_CHARS)}`);
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
 * F#2 — a DOWNLOADED artifact that amicus hashed for itself and refused.
 *
 * WHY THERE IS A SECOND GATE AT ALL, when `checksums` already went out.
 * @electron/get validates in its own temp dir and then RENAMES the artifact into
 * the cache root, returning THAT path (5.0.0, dist/index.js lines 148-160 and
 * Cache.js lines 60-76) — so the last bytes it vouched for live at a path the
 * same cache-dir writer controls. On a cache HIT it is looser still: `force` is
 * dead in 5.0.0 (the only read guard is `shouldTryReadCache(effectiveCacheMode(...))`,
 * and amicus sends no `cacheMode`), so it validates a file AT ITS CACHE PATH and
 * hands that back. Either way the vouching happened somewhere amicus does not
 * control, which is the whole reason the bytes are read into memory and
 * re-hashed here. (They are not COPIED anywhere: the private staging directory
 * that used to hold them was deleted in this change, its privacy claim having
 * been measured false.)
 *
 * NOTHING IS DELETED. The refused artifact stays where @electron/get put it, and
 * the CACHE route removes it on the next run through the fence that was written
 * for exactly that (`mayDeleteRejectedZip` + `rejectCachedZip`). Deleting from
 * here would add a second, differently-fenced unlink for no gain: the number of
 * downloads is the same either way.
 * @returns {{repaired:false, integrity:string, reason:string}}
 */
function rejectDownloadedZip({ gate, fileName, log = () => {} }) {
  const what = gate.verdict === 'mismatch'
    ? `sha256 ${gate.actual} does not match the published ${gate.expected}`
    : collapseExcerpt(gate.reason);
  log(`[amicus] DOWNLOADED electron artifact REFUSED: ${fileName}`);
  log(`[amicus]   ${what}`);
  // WHAT THIS LINE MAY CLAIM. It used to promise the download was hashed inside
  // a PRIVATE staging directory — a containment property that was DELETED in
  // this same change, because the council measured it false (mkdtempSync yields
  // mode 666 on Windows and the chmod(0o700) was skipped on win32, and a spinner
  // found the fixed `amicus-electron-stage-` prefix on its FIRST readdir). The
  // docs describing that copy were fixed and this string was missed; nothing
  // pinned it, so nothing caught it. It now states the property that is
  // actually true, and it is pinned by a test.
  log('[amicus] amicus read these bytes ONCE, into its own memory, and hashed THAT buffer — the');
  log('[amicus] same buffer it would have extracted. There is no copy on disk and no path in play');
  log('[amicus] after the read. These bytes were NOT extracted and no Electron was installed from');
  log('[amicus] them. Check what ELECTRON_MIRROR points at.');
  log('[amicus] Headless runs and the council work without the GUI.');
  return {
    repaired: false,
    integrity: gate.verdict,
    reason: `Downloaded electron artifact ${fileName} was REFUSED: ${what}. It was NOT extracted.`,
  };
}

/**
 * Bytes amicus could not take into custody are never extracted.
 *
 * REPLACES `refuseUnstagedArtifact`, and the replacement is not cosmetic. The
 * old refusal existed because staging COPIED the artifact into `os.tmpdir()`,
 * so its whole vocabulary was about temp: "could not be copied into a private
 * directory", "free up space in the temp directory". Council finding A3 caught
 * the consequence — a cache entry deleted by a concurrent repair mid-copy was
 * reported as "no space, or an unwritable temp directory", advice that could
 * not possibly help. There is no copy and no temp directory any more; the only
 * way to fail here is that the ARTIFACT ITSELF could not be read, and `why`
 * says which way.
 *
 * The first cut of the staging work FAILED OPEN in this position: when the
 * artifact could not be taken private the download route quietly extracted the
 * unstaged cache path anyway, while the one line on screen said the bytes would
 * not be extracted (seats F#6/F#8, MEASURED both shapes). Both routes refuse
 * here now, and `integrity` is set so `scripts/postinstall.js` prints the reason
 * instead of its generic "provisions on first use" notice.
 *
 * F5: `zip` is an attacker-influenced cache path (its `<sha>` directory name
 * came out of a `readdirSync` of a directory anyone can write) and `detail` is
 * an fs error string, so both are sanitized before reaching stderr or the
 * returned reason.
 * @param {object} o
 * @param {string} o.fileName
 * @param {string} o.zip
 * @param {string} o.why    one of readArtifactBytes's named refusals
 * @param {string} [o.detail]
 * @returns {{repaired:false, integrity:'unreadable', reason:string}}
 */
function refuseUnreadableArtifact({ fileName, zip, why, detail = '', log = () => {} }) {
  const where = collapseExcerpt(zip, PATH_EXCERPT_CHARS);
  const what = UNREADABLE_REASON[why] || 'could not be read';
  log(`[amicus] Electron artifact NOT extracted: ${fileName}`);
  log(`[amicus]   ${where}`);
  log(`[amicus]   ${what}${detail ? ` (${collapseExcerpt(detail)})` : ''}`);
  log('[amicus] amicus reads an artifact ONCE, into memory, and hashes and extracts THOSE');
  log('[amicus] bytes. It could not read these, so it has nothing it could vouch for and');
  log('[amicus] has extracted nothing. The file was left exactly where it is.');
  log('[amicus] Headless runs and the council work without the GUI.');
  return {
    repaired: false,
    integrity: 'unreadable',
    reason: `Electron artifact ${fileName} ${what}, so it was NOT extracted: ${where}.`
      + ' It was left in place.',
  };
}

/**
 * THE OFFER a parse failure gets when the native-extractor rescue is NOT armed.
 *
 * It NAMES `AMICUS_ALLOW_UNVERIFIED_ELECTRON` and says what setting it would do,
 * so an air-gapped user whose archive amicus cannot read can find the escape
 * hatch without reading the source — the whole point of the C2 finding. It is
 * printed for a PARSE FAILURE and nothing else: a security refusal must never be
 * answered with an offer to retry, which is C4 with a human in the loop.
 * `electron-native-rescue.js` owns which failures reach here.
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
}

/**
 * THE NOTICE a user sees when the rescue actually runs. Printed BEFORE the child
 * is spawned, because the window opens at the write, and it DESCRIBES that window
 * instead of reassuring anyone about it — the rescue is not safe, and the words a
 * user reads while it happens have to say so.
 */
function announceNativeRescue({ zip, reason, log = () => {} }) {
  log('[amicus] AMICUS_ALLOW_UNVERIFIED_ELECTRON=1 — running the NATIVE-EXTRACTOR RESCUE.');
  log(`[amicus]   amicus could not read the archive itself: ${collapseExcerpt(reason)}`);
  log('[amicus] THE WINDOW THIS OPENS, stated plainly. amicus has written the bytes it hashed to');
  log(`[amicus]   ${collapseExcerpt(zip, PATH_EXCERPT_CHARS)}`);
  log('[amicus] and is about to hand that PATH to a native extractor it does not control. Between');
  log('[amicus] the write and the child opening the file, anything running as your user can');
  log('[amicus] replace it, and whatever the child extracts is promoted into dist/ WITHOUT being');
  log('[amicus] hashed again. So this run is not covered by the property the rest of the');
  log('[amicus] provisioning holds to — that amicus only ever writes bytes it hashed. It is NOT');
  log('[amicus] safe; it is what the flag buys, and the result is reported as unverified.');
}

module.exports = {
  isUnsafeArchive, refuseUnsafeArchive, rejectCachedZip, rejectDownloadedZip, refuseUnreadableArtifact,
  offerNativeRescue, announceNativeRescue, PATH_EXCERPT_CHARS,
};

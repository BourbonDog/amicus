/**
 * Electron artifact REFUSALS — the four ways amicus declines to turn bytes into
 * an Electron install, and the exact words it uses each time.
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
 * control, which is the whole reason the bytes are staged and re-hashed here.
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
  log('[amicus] amicus hashes what it downloaded, in a directory only it can write, before');
  log('[amicus] extracting it. These bytes were NOT extracted and no Electron was installed');
  log('[amicus] from them. Check what ELECTRON_MIRROR points at.');
  log('[amicus] Headless runs and the council work without the GUI.');
  return {
    repaired: false,
    integrity: gate.verdict,
    reason: `Downloaded electron artifact ${fileName} was REFUSED: ${what}. It was NOT extracted.`,
  };
}

/**
 * F#6/F#8 — bytes amicus could not take private are never extracted.
 *
 * The first cut of the staging work FAILED OPEN here: when `stageArtifact`
 * returned null the download route quietly extracted the unstaged cache path —
 * the exact v4.9.5 hash-then-reopen race the staging exists to close — while the
 * one line on screen said "the cached bytes will not be extracted". MEASURED
 * both shapes: an unwritable `os.tmpdir()` (that message, and the cache path
 * extracted anyway) and a full one (no message at all).
 *
 * `stageArtifact` has already said WHICH step failed on stderr — an unreadable
 * artifact, a temp directory it could not create in, a copy that ran out of room;
 * this says what that MEANS and gives the caller a result shape instead of a
 * silent success. `integrity` is set, so `scripts/postinstall.js` prints the
 * reason instead of its generic "provisions on first use" notice.
 *
 * F5: `zip` is an attacker-influenced cache path (its `<sha>` directory name came
 * out of a `readdirSync` of a directory anyone can write), so it is sanitized
 * before it reaches stderr or the returned reason.
 * @returns {{repaired:false, integrity:'unstaged', reason:string}}
 */
function refuseUnstagedArtifact({ fileName, zip, log = () => {} }) {
  const where = collapseExcerpt(zip, PATH_EXCERPT_CHARS);
  log(`[amicus] Electron artifact NOT extracted: ${fileName}`);
  log(`[amicus]   ${where}`);
  log('[amicus] Its bytes could not be copied into a private directory, so amicus cannot');
  log('[amicus] promise the bytes it hashed are the bytes it would extract. Free up space in');
  log('[amicus] the temp directory (or point TMPDIR somewhere writable) and try again.');
  log('[amicus] Headless runs and the council work without the GUI.');
  return {
    repaired: false,
    integrity: 'unstaged',
    reason: `Electron artifact ${fileName} could not be staged privately, so it was NOT extracted`
      + `: ${where}. Free up space in the temp directory and provision again.`,
  };
}

module.exports = {
  isUnsafeArchive, refuseUnsafeArchive, rejectCachedZip, rejectDownloadedZip, refuseUnstagedArtifact,
  PATH_EXCERPT_CHARS,
};

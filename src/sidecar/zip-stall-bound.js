/**
 * WHEN AMICUS GIVES UP ON AN IN-MEMORY EXTRACTION, and how it stops the work.
 *
 * SPLIT OUT of zip-from-buffer.js in the v4.9.6 FOURTH council round, when the
 * repair below pushed that file back over the repo's 300-line gate. The seam is
 * the one the last three rounds have all been about: this module owns the
 * give-up POLICY — the two windows, the bounded wait for an aborted write, and
 * the classified failure that is raised — while zip-from-buffer.js owns the
 * yauzl event loop that the policy is applied to. Nothing here knows what a zip
 * entry is; nothing there decides how long to wait.
 *
 * @module sidecar/zip-stall-bound
 */

'use strict';

const { failure } = require('./zip-entry-write');

/**
 * THE STALL BOUND, and what did and did not come back with it.
 *
 * unzip.js exists for a field bug that was never root-caused: "on some Node 24
 * boxes extract-zip@2.0.1 STALLS mid-extract — its promise never resolves AND
 * never rejects", so the awaiting self-heal let the event loop drain and Node
 * exited 0 with a partial extract and no message. It answered that with three
 * layers: (1) an idle timer + a hard cap, whose LIVE handle is what stops the
 * process exiting mid-stall, (2) a native OS unzip fallback, (3) a
 * files-actually-landed check. All three went with unzip.js when the electron
 * artifact moved onto `extractZipBuffer` and nothing replaced them: it
 * had no timer of any kind, so a stalled write (a network volume, a hung AV
 * filter, an `openReadStream` callback that never arrives) hung `ensureElectron`
 * forever — and in `scripts/postinstall.js` the loop drained and Node exited 0.
 *
 * LAYER 1 IS BACK, with unzip.js's own numbers (30 s idle, 240 s hard) and
 * unzip.js itself untouched: `IDLE_MS`/`MAX_MS` below.
 *
 * ── THE FIRST CUT WAS WRONG IN BOTH DIRECTIONS (round 3) ──────────────────
 * Seat A1: "the advertised idle timeout fires during legitimate active writes
 * and does not actually stop extraction." Seat B2: "can false-fire on a single
 * slow entry write, failing a valid repair on slow storage." Two seats, opposite
 * directions, both true of code that re-armed on ENTRY COMPLETION and settled
 * its promise without stopping anything.
 *
 *   ARMED AGAINST BYTES, NOT ENTRIES. The real artifact contains a 225 MB
 *   `electron.exe`, which is ONE entry: on storage slower than 7.5 MB/s that
 *   entry alone exceeds a 30 s window while writing perfectly well. Progress is
 *   now `written` — reported by `zip-entry-write.writeEntry`'s CRC transform,
 *   the stage immediately upstream of the sink, so it counts bytes the
 *   DESTINATION accepted. The entry count is kept only as a SECOND progress
 *   term, because an archive of empty files legitimately writes zero bytes.
 *
 *   AND IT STOPS THE WORK. `fail()` aborts an `AbortController` BEFORE it
 *   rejects; `writeEntry` hands that signal to `pipeline`, which destroys the
 *   source and the sink. MEASURED (Node 24.18.0): after the abort not one
 *   further byte is accepted by the sink. `placeEntry` refuses to start a new
 *   entry once the signal is aborted, and `writeSymlink` re-checks it before
 *   `symlinkSync` (a link target is read through `collect`, not a pipeline).
 *
 *   A WATCHDOG, NOT A RE-ARM PER CHUNK. The idle timer re-arms ITSELF: when it
 *   fires it compares bytes and entries against the mark it took and fails only
 *   when neither moved. One timer per window instead of one per 64 KiB chunk,
 *   at the cost of detecting a stall between one and two idle windows after it
 *   starts — irrelevant at 30 s, and stated rather than left to be discovered.
 *
 * ── AND THAT REMEDY REINTRODUCED THE HANG IT REMOVED (round 4) ────────────
 * The round-3 repair also made the `finally` `await inFlight` — so the caller's
 * cleanup could not race a live descriptor — AFTER `cancelTimers()` had cleared
 * both handles. On the one shape the bound exists for, that await CANNOT settle:
 * `pipeline` waits for every stream to close, and yauzl@2.10.0 replaces its
 * endpoint stream's `destroy` with a no-arg function that emits neither 'error'
 * nor 'close' (node_modules/yauzl/index.js, lines 566-573 and 698-713).
 * MEASURED on the shipped code, Node 24.18.0, real yauzl and a real `pipeline`:
 * one 1 MiB entry into a sink whose `_write` never calls back, `idleMs: 300` —
 * the bound fired, the sink accepted nothing further, and the promise was STILL
 * PENDING at 6 s; in a bare process with no other handle the loop drained and
 * Node exited 0 having printed nothing. The original field bug, verbatim, from
 * the commit whose message claimed to prevent it.
 *
 *   SO THE UNWIND IS ITSELF BOUNDED. `awaitUnwind` races the in-flight write
 *   against `UNWIND_MS` on a LIVE timer: the wait keeps the loop alive, and
 *   then it ENDS. A write that comes apart normally is still awaited in full,
 *   which is all the round-3 repair actually wanted; one that never does costs
 *   `unwindMs` and the classified failure is thrown regardless. What that
 *   trades away is the descriptor race — whose cost is LITTER, not damage:
 *   `electron-layout.extractBytesToDist` removes the incoming tree best-effort
 *   (`try { rmSync } catch {}`) and `sweepPromoteLitter` takes what an EPERM
 *   leaves. A bound that cannot end is not a bound.
 *
 * LAYER 2 IS NOT THE DEFAULT AND NEVER CAN BE. Every native strategy (`tar`,
 * `Expand-Archive`, `ditto`, `unzip`) takes a PATH, and a path is what the
 * custody finding is about: handing one an artifact would extract bytes amicus
 * did not hash, and writing our hashed Buffer to a temp file for it would
 * rebuild the staged copy the council deleted. The two properties cannot both
 * hold on one run.
 *
 * WHAT THAT COST, AND WHAT C2 BOUGHT BACK. This paragraph used to end "an archive
 * yauzl cannot parse but a native extractor could is a failed repair plus a
 * re-download" — which on an air-gapped machine is a permanent no-rescue failure,
 * and a council seat filed it as such. Layer 2 is now reachable again as a
 * RESCUE, for that ONE failure class (`UNZIP_BUFFER_FAILED`) and only when
 * `AMICUS_ALLOW_UNVERIFIED_ELECTRON=1` was already set. `electron-native-rescue.js`
 * owns the whole boundary and the custody it spends; nothing here changed, and a
 * stall in particular is still NOT a rescue trigger — `UNZIP_BUFFER_STALLED` is
 * a verdict about nothing, this bound exists to STOP work rather than hand it to
 * someone else, and it is still never an eviction (see `electron-repair-cache.js`).
 * LAYER 3 lives upstream and always did:
 * `electron-quarantine.verifyExtractOutcome` stats the exe after a non-throwing
 * extract.
 */
/** No-progress window, then the hard cap. unzip.js's IDLE_MS / MAX_MS, to the ms. */
const IDLE_MS = 30_000;
const MAX_MS = 240_000;
/** How long an ABORTED write is given to come apart before it is abandoned. */
const UNWIND_MS = 5_000;

/**
 * @returns {Error} the extraction made no progress. NOT an archive verdict and
 * NOT a destination verdict — nobody learned anything about either — so it must
 * never be the code that evicts a user's cached artifact.
 */
const stalled = (message) => failure('UNZIP_BUFFER_STALLED', `the in-memory extraction stalled: ${message}`);

/**
 * Wait for an ABORTED entry to come apart — bounded, because it may never.
 *
 * yauzl's endpoint stream has a `destroy` that emits nothing, so `pipeline`'s
 * promise can stay pending forever after the abort (see the module docblock's
 * round-4 section above, where an unbounded wait was measured to hang the whole
 * extractor). The timer is a LIVE handle for the length of the wait, which is
 * what stops the process draining mid-stall, and it ends the wait when it fires.
 *
 * @returns {Promise<boolean>} true if the write unwound, false if it was abandoned
 */
function awaitUnwind(inFlight, ms, setTimer, clearTimer) {
  return new Promise((resolve) => {
    const t = setTimer(() => resolve(false), ms);
    // The rejection is already handled by the driver; this only observes settling.
    inFlight.then(() => {}, () => {}).then(() => { clearTimer(t); resolve(true); });
  });
}

module.exports = {
  IDLE_MS, MAX_MS, UNWIND_MS, stalled, awaitUnwind,
};

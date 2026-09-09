/**
 * Extract an archive that is ALREADY IN MEMORY and ALREADY HASHED.
 *
 * There is no `zip` parameter because there is no file. The bytes arrive as a
 * Buffer that `electron-custody.readArtifactBytes` read through a single
 * descriptor and that `electron-trust.verifyArtifactBytes` hashed; nothing here
 * resolves a path to the artifact, so there is no second read for a same-uid
 * attacker to race. `electron-custody.js` carries the measured refutations of
 * the two remedies this replaces. NO HAND-WRITTEN ZIP PARSING: a council judge
 * killed a design that sliced local file headers by hand — "a terminal path with
 * no rescue", since it would have had to re-derive ZIP64 local headers, data
 * descriptors and the central-vs-local size disagreement `openReadStream`
 * already handles. Every byte offset comes from `yauzl.openReadStream`, exactly
 * as under extract-zip; only WHERE yauzl reads from changes.
 *
 * ── THE `autoClose` TRAP, MEASURED ────────────────────────────────────────
 * `yauzl.fromBuffer` sets `options.autoClose = false` UNCONDITIONALLY
 * (yauzl@2.10.0 index.js, line 67) — an explicit `{autoClose: true}` is silently
 * discarded — and `extract-zip` resolves on the zipfile's `'close'` event
 * (extract-zip@2.0.1 index.js, lines 32-37), so a naive port of extract-zip onto
 * a buffer HANGS FOREVER. Both council judges hit it. MEASURED on the installed
 * libraries (Windows 11, Node 24.18.0) it is worse than the brief recorded:
 * `ZipFile.close()` only calls `reader.unref()`, and fd-slicer's BufferSlicer
 * has no close and emits nothing on unref (fd-slicer index.js, lines 282-288)
 * where FdSlicer closes the fd and emits `'close'` — so under `fromBuffer` that
 * event is UNREACHABLE even if you call `close()` (500 ms after END fired, close
 * had not). THE FIX, stated so nobody "tidies" it: this module resolves on
 * `'end'`, which yauzl emits once the central directory is exhausted, and drives
 * `readEntry()` only after the previous entry has been fully written, so `'end'`
 * cannot arrive before the last write lands. `close()` is still called, for the
 * reader refcount, but NOTHING waits on it. Pinned by YAUZLHANG.
 *
 * ── PARITY WITH extract-zip, AND THE ONE DELIBERATE DIFFERENCE ────────────
 * The per-entry decisions all live in `./zip-entry-write :: placeEntry` now, and
 * the `__MACOSX/` skip, the mode decode, both directory failsafes, the 0755/0644
 * defaults and the per-entry `realpath(destDir)` out-of-bound check with its
 * message VERBATIM are copied from extract-zip@2.0.1 index.js, lines 48-160, so
 * `UNSAFE_PATTERNS` and `electron-refuse.isUnsafeArchive` classify exactly what
 * they classified. The difference: a SYMLINK whose target resolves outside the
 * extraction root is REFUSED here and is not by extract-zip, and it is resolved
 * against the REALPATH of the directory the link lands in because the lexical
 * `path.dirname` was measured to be defeated outright by a chain of
 * directory-symlink entries earlier in the same archive. It is refused in the
 * same `Out of bound path` wording and exercised against synthetic archives
 * here; the darwin `.app` bundle is the only electron artifact with real
 * symlinks, and since v4.9.7 `.github/workflows/darwin-bundle.yml` runs this
 * path over the REAL artifact on a real Mac. The v4.9.6 worry that the check
 * might REJECT a working layout is refuted by measurement: the real
 * `electron-v43.1.1-darwin-arm64.zip` declares 585 records and 14 symlinks,
 * every target relative, none carrying a `..` component, none absolute, and 0
 * of the 585 entry names traversing a symlinked component. The linux artifacts
 * hold ZERO symlink entries, so `writeSymlink` is unreachable there at all.
 *
 * `root = fs.realpathSync(dir)` below is load-bearing for that answer and no
 * Windows probe would ever show it: on macOS the extraction root usually sits
 * under `/var`, which is itself a symlink to `/private/var`, so comparing a
 * resolved target against an UNRESOLVED root would read every link in a real
 * `.app` as an escape.
 *
 * ── ERROR CODES ARE A CAUSAL CLAIM ───────────────────────────────────────
 * `UNZIP_BUFFER_FAILED` = the ARCHIVE is bad. `UNZIP_DEST_FAILED` = the
 * DESTINATION is (no space, a read-only dist, a path too long).
 * `UNZIP_BUFFER_UNAVAILABLE` = neither, yauzl would not load.
 * `UNZIP_BUFFER_STALLED` = no progress inside the bound; nobody learned anything
 * about the archive OR the disk. The caller evicts on `UNZIP_BUFFER_FAILED`
 * ONLY (finding D2). The constructors and the writers live in `./zip-entry-write`;
 * `UNZIP_BUFFER_STALLED` and the windows that raise it live in `./zip-stall-bound`.
 *
 * @module sidecar/zip-from-buffer
 */

'use strict';

const fsDefault = require('fs');
const path = require('path');

// The classified failures, and `placeEntry` — everything that decides what ONE
// entry becomes on disk. THE ONE-WAY ARROW: zip-from-buffer -> zip-entry-write,
// never back. `placeEntry` moved across that seam in the third council round,
// when this file hit the 300-line gate again: it answers "what does one entry
// become on disk", which is the neighbouring module's whole subject, while what
// stays here is "how is the archive DRIVEN, and when do we give up on it".
const {
  failure, badArchive, badDestination, extractorUnavailable, placeEntry,
} = require('./zip-entry-write');
// THE GIVE-UP POLICY, and the whole record of how it has been wrong: the two
// windows, the bounded wait for an aborted write to come apart, and the
// classified failure. Read `./zip-stall-bound` before touching any of it.
const {
  IDLE_MS, MAX_MS, UNWIND_MS, stalled, awaitUnwind,
} = require('./zip-stall-bound');

/** yauzl's own validateFileName refusals — three of unzip.js's UNSAFE_PATTERNS. */
const NAME_REFUSAL = /^(absolute path|invalid relative path|invalid characters in fileName): /;

/** yauzl's callback API as a promise, with `fromBuffer`'s options pinned here. */
function openBuffer(yauzl, bytes) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true }, (err, zipfile) => {
      if (err) { reject(badArchive(`could not read the archive: ${(err && err.message) || err}`)); return; }
      resolve(zipfile);
    });
  });
}

/**
 * Extract `bytes` into `dir`. The caller has ALREADY hashed `bytes`.
 *
 * BOUNDED, AND EVERY WAIT IN IT IS BOUNDED. See `./zip-stall-bound`, which
 * carries the whole record: an idle watchdog armed against BYTES WRITTEN (not entries completed),
 * a hard cap, and a bounded wait for the aborted write to unwind — each one a
 * live `setTimeout` handle, so a write that never completes becomes a catchable
 * rejection instead of a promise that never settles, and SOME handle is alive
 * for the whole of it, which is what stops Node exiting 0 mid-stall with a
 * partial extract and no message. When a bound fires it ABORTS the in-flight
 * write first, so no byte lands after the failure is decided; it then waits up
 * to `unwindMs` for that write to come apart, and throws whether or not it did.
 *
 * @param {Buffer} bytes  the whole archive, in this process's heap
 * @param {object} o
 * @param {string} o.dir  absolute destination (created if absent)
 * @param {number} [o.idleMs] no-progress window before the extract is stalled
 * @param {number} [o.maxMs]  hard cap on the whole extraction
 * @param {number} [o.unwindMs] how long an aborted write may take to come apart
 * @param {object} [o.deps] { fs, yauzl, log, setTimeout, clearTimeout }
 * @returns {Promise<{strategy:'buffer', entries:number}>}
 * @throws {Error} code 'UNZIP_UNSAFE_ARCHIVE' — terminal; never retried
 * @throws {Error} code 'UNZIP_BUFFER_FAILED'  — the archive is bad
 * @throws {Error} code 'UNZIP_DEST_FAILED'    — the destination is bad
 * @throws {Error} code 'UNZIP_BUFFER_UNAVAILABLE' — yauzl could not be loaded
 * @throws {Error} code 'UNZIP_BUFFER_STALLED' — no progress; NOT an artifact verdict
 */
async function extractZipBuffer(bytes, {
  dir, idleMs = IDLE_MS, maxMs = MAX_MS, unwindMs = UNWIND_MS, deps = {},
} = {}) {
  const fs = deps.fs || fsDefault;
  const setTimer = deps.setTimeout || setTimeout;
  const clearTimer = deps.clearTimeout || clearTimeout;
  // GUARDED (the v4.5.2 lesson). `yauzl` IS declared in package.json; the guard
  // keeps a broken install a refusal rather than a deleted cache entry.
  let yauzl = deps.yauzl;
  if (!yauzl) {
    try { yauzl = require('yauzl'); } catch (e) { throw extractorUnavailable((e && e.message) || String(e)); }
  }
  if (!path.isAbsolute(dir)) { throw badDestination('Target directory is expected to be absolute'); }
  let root;
  try {
    fs.mkdirSync(dir, { recursive: true });
    root = fs.realpathSync(dir);
  } catch (e) {
    throw badDestination(`could not prepare ${dir}: ${(e && e.message) || e}`);
  }

  const zipfile = await openBuffer(yauzl, bytes);
  let entries = 0;
  let written = 0;                  // BYTES the destination accepted — the progress signal
  let idleTimer = null;
  let maxTimer = null;
  let inFlight = null;              // the entry being written when the bound fires
  const halt = new AbortController();
  const cancelTimers = () => {
    if (idleTimer !== null) { clearTimer(idleTimer); idleTimer = null; }
    if (maxTimer !== null) { clearTimer(maxTimer); maxTimer = null; }
  };
  let thrown = null;
  try {
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, value) => {
        if (settled) { return; }
        settled = true;
        cancelTimers();
        fn(value);
      };
      // STOP THE WORK FIRST, THEN REPORT IT. A control that reports a failure
      // while the work continues is not a control (round 3, seat A1): the abort
      // destroys the in-flight pipeline, and `placeEntry`/`writeSymlink` refuse
      // to start or finish anything once the signal is set.
      const fail = (e) => {
        if (!halt.signal.aborted) { halt.abort(e); }
        finish(reject, e);
      };
      // The idle WATCHDOG re-arms itself from the marks it took, so a single
      // huge entry that is writing steadily is progress and never a stall.
      const armIdle = () => {
        const atBytes = written;
        const atEntries = entries;
        idleTimer = setTimer(() => {
          if (written !== atBytes || entries !== atEntries) { armIdle(); return; }
          fail(stalled(`no extract progress for ${idleMs}ms`));
        }, idleMs);
      };
      maxTimer = setTimer(() => fail(stalled(`extraction exceeded ${maxMs}ms`)), maxMs);
      armIdle();
      // yauzl's own validateFileName refusals ('absolute path: ', 'invalid
      // relative path: ', 'invalid characters in fileName: ') arrive here.
      zipfile.on('error', (e) => fail(failure(
        NAME_REFUSAL.test((e && e.message) || '') ? 'UNZIP_UNSAFE_ARCHIVE' : 'UNZIP_BUFFER_FAILED',
        (e && e.message) || 'the archive could not be read',
      )));
      // RESOLVE ON 'end', NEVER ON 'close' — see the docblock. `close` is
      // unreachable under fromBuffer, so waiting for it hangs forever.
      zipfile.on('end', () => finish(resolve));
      zipfile.on('entry', (entry) => {
        inFlight = placeEntry({
          zipfile, entry, root, fs, signal: halt.signal, onBytes: (n) => { written += n; },
        });
        inFlight.then((placed) => {
          if (settled) { return; }        // the bound already fired; stop driving
          if (placed) { entries += 1; }
          zipfile.readEntry();
        }, fail);
      });
      zipfile.readEntry();
    });
  } catch (e) {
    thrown = e;
  } finally {
    cancelTimers();
    // The abort has been issued; give the destroyed pipeline a BOUNDED window to
    // unwind, so the caller's cleanup (extractBytesToDist deletes the incoming
    // tree in its own `finally`) does not usually race an open descriptor — and
    // so a pipeline that can never unwind cannot hang this call. Round 4.
    if (inFlight) { await awaitUnwind(inFlight, unwindMs, setTimer, clearTimer); }
    try { zipfile.close(); } catch { /* the buffer reader holds no fd */ }
  }
  if (thrown) { throw thrown; }
  return { strategy: 'buffer', entries };
}

module.exports = { extractZipBuffer };

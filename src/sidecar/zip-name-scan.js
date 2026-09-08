/**
 * WHAT NAMES DOES THIS ARCHIVE DECLARE? A read-only walk of the central
 * directory, for the one caller that is about to hand an archive to a tool with
 * no path-traversal check of its own.
 *
 * ── THE HOLE THIS CLOSES, MEASURED ────────────────────────────────────────
 * `electron-native-rescue.js` refuses to rescue a `UNZIP_UNSAFE_ARCHIVE`, and
 * that refusal is exactly right — but it keys on the REFUSAL yauzl happened to
 * form, not on the hostile ENTRY. yauzl validates an entry's NAME in
 * `_readEntry`, AFTER its size check (yauzl@2.10.0 index.js lines 407-426), so
 * one bad entry earlier in the same archive ends the walk before any later name
 * is ever looked at. MEASURED on the installed yauzl (Windows 11, Node 24), real
 * `extractZipBuffer`, one archive per line:
 *
 *   [`../../../PWNED.txt`]                        -> UNZIP_UNSAFE_ARCHIVE
 *                                                    ("invalid relative path: …")
 *   [`first.bin` w/ the encrypted flag set,
 *    `../../../PWNED.txt`, `electron.exe`]        -> UNZIP_BUFFER_FAILED
 *                                                    ("compressed/uncompressed size
 *                                                     mismatch for stored file: 4 != 4")
 *
 * The second archive is one flag bit different from the first and lands in the
 * ONE class the rescue acts on, so the whole thing — traversal entry included —
 * was handed to `tar` / `Expand-Archive`. What stopped the escape in that run was
 * each tool's own check (`tar.exe`: `../../../PWNED.txt: Path contains '..'`,
 * exit 1; `Expand-Archive`: `Can not process invalid archive entry '…'`, exit 0,
 * nothing outside the destination in either case) — precisely the reliance
 * `unzip.js` says amicus will not make: "a tool with no such check".
 *
 * ── WHAT THIS CAN AND CANNOT SEE, STATED BEFORE THE CODE ──────────────────
 * The scan reads the CENTRAL DIRECTORY with size validation and string decoding
 * both OFF, so the entry that breaks the extraction does not stop the walk.
 * MEASURED on the archive above: all three names come back, the traversal entry
 * included. It sees NOTHING when the central directory itself is unreadable —
 * a truncated zip answers `end of central directory record signature not found`
 * and yields no names at all — which is why the result carries `read` and the
 * caller states that residual out loud rather than pretending to a guarantee.
 * It also cannot see a SYMLINK whose TARGET escapes the root: that is bytes, not
 * a name, and `zip-from-buffer.js` refuses it only because it reads the payload.
 *
 * ── AND IT IS ONLY EVER A NARROWING ───────────────────────────────────────
 * Nothing here can make a rescue happen. A refusal it forms turns a
 * `UNZIP_BUFFER_FAILED` into the TERMINAL `UNZIP_UNSAFE_ARCHIVE` its caller
 * already excludes; silence changes nothing. So a bug in this file can cost the
 * rescue, never widen it.
 *
 * @module sidecar/zip-name-scan
 */

'use strict';

/** Hard bound: this is an in-memory walk, but nothing waits forever here. */
const SCAN_MS = 10_000;

/** No real electron artifact is near this; a hostile central directory can be. */
const MAX_ENTRIES = 200_000;

/**
 * yauzl's own `validateFileName` (index.js lines 607-619), under the options
 * amicus really extracts with — `decodeStrings` on and `strictFileNames` off,
 * which rewrites backslashes to `/` BEFORE validating (lines 420-426). The
 * wording is yauzl's verbatim so a refusal built from it is classified by
 * `unzip.js :: UNSAFE_PATTERNS` as well as by its `code`.
 *
 * `invalid characters in fileName` is deliberately absent: with the backslash
 * rewrite in force yauzl cannot produce it, and inventing a refusal yauzl would
 * not make is how a scan starts costing the rescue legitimate archives.
 * @returns {string|null} yauzl's refusal for this name, or null
 */
function nameRefusal(name) {
  const n = name.replace(/\\/g, '/');
  if (/^[a-zA-Z]:/.test(n) || n.startsWith('/')) { return `absolute path: ${name}`; }
  if (n.split('/').includes('..')) { return `invalid relative path: ${name}`; }
  return null;
}

/**
 * Walk `bytes`' central directory and report the first entry name yauzl would
 * refuse.
 *
 * DECODED AS LATIN-1, ON PURPOSE. `decodeStrings: false` hands back raw name
 * Buffers, and latin-1 is the one decoding that maps bytes to characters 1:1 —
 * no replacement characters, no multi-byte collapsing. Every byte the two rules
 * look at (`.`, `/`, `\`, `:`) is ASCII, and no continuation byte of a UTF-8
 * sequence can be ASCII, so this sees exactly what a correct decode would.
 *
 * NEVER THROWS, never rejects: a caller reaching this already has a failure in
 * flight and must not acquire a second one from a diagnostic.
 *
 * @param {Buffer} bytes the archive, in this process's heap
 * @param {object} [o]
 * @param {object} [o.deps] { yauzl, setTimeout, clearTimeout }
 * @returns {Promise<{read:boolean, refusal:string|null, why:string}>}
 *   `read` = the whole central directory was enumerated, so `refusal: null`
 *   really means "no such name in this archive". `read:false` means the scan
 *   proved nothing.
 */
function scanEntryNames(bytes, { deps = {} } = {}) {
  const setTimer = deps.setTimeout || setTimeout;
  const clearTimer = deps.clearTimeout || clearTimeout;
  let yauzl = deps.yauzl;
  if (!yauzl) {
    try {
      // eslint-disable-next-line global-require
      yauzl = require('yauzl');
    } catch (e) { return Promise.resolve({ read: false, refusal: null, why: `yauzl unavailable: ${(e && e.message) || e}` }); }
  }
  return new Promise((resolve) => {
    let settled = false;
    let refusal = null;
    let seen = 0;
    let timer = null;
    const done = (read, why) => {
      if (settled) { return; }
      settled = true;
      if (timer !== null) { clearTimer(timer); }
      resolve({ read, refusal, why });
    };
    timer = setTimer(() => done(false, `the name scan exceeded ${SCAN_MS}ms`), SCAN_MS);
    try {
      yauzl.fromBuffer(bytes, { lazyEntries: true, decodeStrings: false, validateEntrySizes: false }, (err, zipfile) => {
        if (err || !zipfile) { done(false, `could not read the central directory: ${(err && err.message) || 'no zipfile'}`); return; }
        zipfile.on('error', (e) => done(false, `could not read the central directory: ${(e && e.message) || e}`));
        zipfile.on('end', () => done(true, ''));
        zipfile.on('entry', (entry) => {
          seen += 1;
          const name = Buffer.isBuffer(entry.fileName) ? entry.fileName.toString('latin1') : String(entry.fileName);
          refusal = nameRefusal(name);
          if (refusal) { done(true, ''); return; }
          if (seen >= MAX_ENTRIES) { done(false, `stopped after ${MAX_ENTRIES} entries`); return; }
          zipfile.readEntry();
        });
        zipfile.readEntry();
      });
    } catch (e) {
      done(false, `could not read the central directory: ${(e && e.message) || e}`);
    }
  });
}

module.exports = { scanEntryNames, nameRefusal, SCAN_MS, MAX_ENTRIES };

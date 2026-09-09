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
 * THE BLINDNESS IN THE FIRST PARAGRAPH IS WHY `scanLocalNames` EXISTS (v4.9.7,
 * B3). An archive carries its names TWICE, and an unreadable central directory
 * says nothing about the local file headers — which is the table `tar` was
 * MEASURED to act on. The caller asks both.
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

/** The three signatures the local-header chain walks between. */
const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
/** Bit 3: the sizes are BEHIND the payload, in a data descriptor. */
const FLAG_SIZES_DEFERRED = 0x08;
/** The same local signature as bytes, for scanning a span the walk would jump. */
const LOCAL_SIG_BYTES = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/**
 * Where this archive's END-OF-CENTRAL-DIRECTORY record says its directory begins,
 * or -1 when no such record can be found.
 *
 * THE TERMINUS HAS TO BE ANCHORED TO SOMETHING THE ARCHIVE DECLARES. A walk that
 * stops the moment it lands on `PK\x01\x02` believes four bytes it has not
 * earned: MEASURED, planting that signature where an honest advance lands ends
 * the chain with every local header in the archive untouched and no field lying,
 * so neither the deferred-size demotion nor the span check fires -- and the walk
 * reports it saw everything while `tar.exe` went on to reach a `../../../` entry
 * sitting behind it.
 */
function declaredCentralOffset(bytes) {
  if (bytes.length < 22) { return -1; }
  const floor = Math.max(0, bytes.length - 22 - 0xFFFF);
  for (let i = bytes.length - 22; i >= floor; i -= 1) {
    if (bytes.readUInt32LE(i) === EOCD_SIG) { return bytes.readUInt32LE(i + 16); }
  }
  return -1;
}

/**
 * THE SAME QUESTION, ASKED OF THE LOCAL FILE HEADERS.
 *
 * WHY A SECOND WALK EXISTS. `scanEntryNames` reads the CENTRAL directory, and an
 * archive can make that unreadable while leaving every local header whole.
 * MEASURED: four ONE-FIELD edits to a COMPLETE end-of-central-directory record —
 * entry count `0xFFFF`, cd offset `0xFFFFFFFF`, a lying comment length, a
 * multi-disk marker — each blind yauzl on an archive whose `../../../` entry
 * `tar` and `Expand-Archive` then read perfectly. On the comment-length one the
 * rescue RAN TO COMPLETION and promoted the result. Cutting the tail off the file
 * does the same thing by accident.
 *
 * AND IT IS THE TABLE ONE OF THE STRATEGIES ACTUALLY USES. MEASURED on an archive
 * declaring one name locally and another centrally: `tar.exe` (bsdtar 3.8.4) wrote
 * the LOCAL name; `Expand-Archive` wrote the CENTRAL one. Neither table is the
 * right one to read. Both are. That is the whole ruling — the earlier candidates
 * argued about which BLINDNESS to tolerate while looking in one table.
 *
 * ONE NAME RULE, NOT TWO. It calls `nameRefusal` above, deliberately: a second
 * lexical rule free to drift from yauzl's would start costing the rescue archives
 * yauzl accepts, which is the failure this module was written to avoid.
 *
 * ONLY `refusal` MAY CHANGE CONTROL FLOW. `complete` and `names` exist for the
 * notice printed before a spawn and decide nothing, so the module's NARROWING
 * invariant above holds verbatim: nothing here can make a rescue HAPPEN.
 *
 * NEVER THROWS, and synchronous: it reads headers and SKIPS payloads, so it never
 * decompresses. MEASURED on six real electron artifacts (v28.0.0-v43.6.0,
 * 107-151 MB): 73-75 names in 0-1 ms, no data descriptors, and the local names
 * equal the central names entry for entry. Truncated, the central walk goes blind
 * and this one still enumerates all 73-75.
 *
 * WHAT `complete` MEANS, AND WHY IT IS A VARIABLE. It is the claim "I saw every
 * local header", it starts true, and it may only ever be turned OFF. Three things
 * turn it off: an entry declaring bit 3 (its stated size is not authoritative),
 * a declared size whose span HIDES another local signature, and a chain that ends
 * anywhere but the offset this archive's own EOCD names. All three DEMOTE and
 * keep walking. That distinction is the whole design: a name the walk can still
 * read is a name it can still REFUSE, and MEASURED, turning any of these into an
 * early `return` forfeits the refusal for every entry behind it — an archive
 * with bit 3, an honest size and `../../../PWNED.txt` at entry 2 went from a
 * terminal refusal to a completed rescue on 5.7% of forged shapes.
 *
 * THE RESIDUAL: the walk still trusts a local size to FIND the next header, so a
 * desynchronised walk can read a "name" out of payload bytes and refuse a name
 * that is not an entry. MEASURED constructible; MEASURED to need deliberate
 * construction — zero spurious `PK\x03\x04` signatures across 777 MB of six real
 * Electron artifacts. It fails toward REFUSING, which costs a rescue and never
 * grants one.
 *
 * @param {Buffer} bytes the archive, in this process's heap
 * @returns {{refusal:string|null, complete:boolean, names:number, why:string}}
 *   `complete` = the chain reached the directory, so EVERY local header was seen.
 *   A refusal stops the walk early, so it reports `complete:false` too: it did not
 *   see them all, and a field must not claim otherwise on any of its return sites.
 */
function scanLocalNames(bytes) {
  let at = 0;
  let names = 0;
  // `complete` MAY ONLY EVER BE TURNED OFF, and the walk is never SHORTENED by
  // anything but a refusal or a genuinely unknowable next offset. Turning a
  // doubt into an early `return` was MEASURED to destroy the refusal for every
  // entry behind it -- an archive with bit 3, an HONEST size and
  // `../../../PWNED.txt` at entry 2 went from a terminal UNZIP_UNSAFE_ARCHIVE to
  // a completed rescue. Deleting the one control-flow-changing power this module
  // has IS the control-flow change; demoting a claim is not.
  let complete = true;
  let why = '';
  const demote = (m) => { if (complete) { complete = false; why = m; } };
  const cdOffset = declaredCentralOffset(bytes);
  try {
    for (;;) {
      if (at + 4 > bytes.length) { return { refusal: null, complete: false, names, why: why || `the local-header chain ran off the end at ${at}` }; }
      const sig = bytes.readUInt32LE(at);
      if (sig === CENTRAL_SIG || sig === EOCD_SIG) {
        // ANCHORED: the chain may claim it reached the directory only where this
        // archive says its directory begins. See `declaredCentralOffset`.
        if (at !== cdOffset) { demote(`the chain ended at ${at}, not where this archive declares its directory begins (${cdOffset})`); }
        return { refusal: null, complete, names, why };
      }
      if (sig !== LOCAL_SIG || at + 30 > bytes.length) { return { refusal: null, complete: false, names, why: why || `no local file header at ${at}` }; }
      const flags = bytes.readUInt16LE(at + 6);
      const compressed = bytes.readUInt32LE(at + 18);
      const nameLen = bytes.readUInt16LE(at + 26);
      const extraLen = bytes.readUInt16LE(at + 28);
      if (at + 30 + nameLen > bytes.length) { return { refusal: null, complete: false, names, why: why || `a local file name was cut off at ${at}` }; }
      names += 1;
      // Latin-1 for the reason the central walk gives: bytes to characters 1:1.
      const refusal = nameRefusal(bytes.subarray(at + 30, at + 30 + nameLen).toString('latin1'));
      if (refusal) { return { refusal, complete: false, names, why: '' }; }
      // NO NEXT OFFSET AT ALL. These two are the only genuine stops: a zero size
      // under bit 3 would advance by nothing and resynchronise on payload, and
      // the zip64 sentinel names a size that is not here.
      if (((flags & FLAG_SIZES_DEFERRED) && compressed === 0) || compressed === 0xFFFFFFFF) {
        return { refusal: null, complete: false, names, why: why || `entry ${names} does not declare its size here` };
      }
      // BIT 3 SAYS THIS SIZE IS NOT AUTHORITATIVE. APPNOTE 4.4.4 has the writer
      // set it to ZERO, so a nonzero value beside the flag is malformed by
      // construction and `complete` may not rest on it -- but it is still the
      // only lead to the next header, and a name the walk can still read is a
      // name it can still REFUSE. Follow it; just stop claiming to have proved
      // anything (the filed blocker: a lying nonzero size jumped a hostile entry
      // and the walk reported it had seen them all).
      if (flags & FLAG_SIZES_DEFERRED) { demote(`entry ${names} declares bit 3, so the size it states here is not authoritative`); }
      const next = at + 30 + nameLen + extraLen + compressed;
      // THE SPAN THE WALK NEVER LOOKS AT -- name, extra field and payload, every
      // length the archive's to choose. A span holding a local signature may be
      // hiding an entry, so the claim is demoted; the walk still follows the
      // offset, because stopping here would forfeit the refusals behind it.
      if (next <= bytes.length && next > at + 30) {
        const hidden = bytes.indexOf(LOCAL_SIG_BYTES, at + 30);
        if (hidden !== -1 && hidden < next) { demote(`entry ${names}'s declared size jumps over a local file header at ${hidden}`); }
      }
      if (names >= MAX_ENTRIES) { return { refusal: null, complete: false, names, why: why || `stopped after ${MAX_ENTRIES} entries` }; }
      at = next;
    }
  } catch (e) {
    return { refusal: null, complete: false, names, why: `the local-header chain could not be walked: ${(e && e.message) || e}` };
  }
}

module.exports = { scanEntryNames, scanLocalNames, nameRefusal, SCAN_MS, MAX_ENTRIES };

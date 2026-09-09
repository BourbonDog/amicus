/**
 * THE OTHER TABLE AN ARCHIVE DECLARES ITS NAMES IN — the local file headers.
 *
 * SPLIT OUT of zip-name-scan.js (v4.9.7, council #239 round 2): that file reached
 * the repo's 300-line gate, and this walk answers a different question from the
 * central-directory scan beside it. `nameRefusal` is imported rather than
 * reimplemented, so there is exactly ONE rule about what yauzl would refuse and
 * the two tables cannot drift apart.
 *
 * WHY A SECOND WALK EXISTS. `scanEntryNames` reads the CENTRAL directory, and an
 * archive can make that unreadable while leaving every local header whole — a
 * truncation does it by accident, four one-field edits to a COMPLETE
 * end-of-central-directory record do it on purpose. MEASURED before this shipped:
 * seven such archives carrying `../../../PWNED-BY-NATIVE.txt` reached a real
 * spawn, two of them running to completion. And the tables can DISAGREE, which is
 * why both are read: on an archive declaring one name locally and another
 * centrally, `tar.exe` wrote the LOCAL name and `Expand-Archive` the CENTRAL one.
 *
 * ONLY EVER A NARROWING. Nothing here can make a rescue HAPPEN: the sole output
 * that changes control flow is a REFUSAL, and `complete`/`names` exist for the
 * notice printed before a spawn and decide nothing.
 *
 * @module sidecar/zip-local-name-scan
 */

'use strict';

const { nameRefusal, MAX_ENTRIES } = require('./zip-name-scan');

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
 * THE BYTES THE CHAIN COULD NOT REACH, ASKED THE SAME QUESTION ANYWAY.
 *
 * Every way the walk can stop early -- a size deferred to a data descriptor, the
 * zip64 sentinel, a chain that runs off the end or lands on a non-signature --
 * leaves the region AHEAD of it unexamined, and an entry the walk never reached
 * is an entry it cannot refuse. That is the council #239 round-2 BLOCKER, and it
 * needed no exotic archive: bit 3 with a zero size is a STANDARD encoding, so an
 * attacker puts one entry in front of `../../../PWNED.txt`, blinds the central
 * directory, and the walk stops before it ever sees the hostile name.
 *
 * WHY NOT SIMPLY REFUSE WHEN THE WALK CANNOT FINISH. Because that is the blanket
 * fail-closed this cluster already rejected on MEASURED availability grounds: a
 * truncated zip is the case the whole rescue exists for, and its walk cannot
 * finish either. Refusing there kills the feature to close the hole.
 *
 * So the region is SWEPT rather than trusted or refused: every local-header
 * signature in it is located and its declared name put through the SAME
 * `nameRefusal`. It cannot follow the chain (that is what broke), so it does not
 * pretend to -- `complete` stays false and the notice still says the names could
 * not be confirmed. It can only ADD refusals, so the narrowing invariant holds
 * and no archive that is rescued today stops being rescued unless it declares a
 * hostile name.
 *
 * THE RESIDUAL: a `PK\x03\x04` occurring by chance inside a payload is read as a
 * header, so a refusal can name something that is not an entry. MEASURED: zero
 * spurious signatures across 777 MB of six real Electron artifacts, and a false
 * hit must ALSO be followed by bytes that parse as a traversal or absolute name.
 * It fails toward REFUSING, which costs a rescue and never grants one.
 *
 * Bounded: one pass, and at most MAX_ENTRIES candidates.
 */
function sweepUnreached(bytes, from) {
  let seen = 0;
  let at = from;
  while (at >= 0 && at + 30 <= bytes.length && seen < MAX_ENTRIES) {
    const hit = bytes.indexOf(LOCAL_SIG_BYTES, at);
    if (hit === -1 || hit + 30 > bytes.length) { return null; }
    seen += 1;
    const nameLen = bytes.readUInt16LE(hit + 26);
    const stop = Math.min(hit + 30 + nameLen, bytes.length);
    const refusal = nameRefusal(bytes.subarray(hit + 30, stop).toString('latin1'));
    if (refusal) { return refusal; }
    at = hit + 4;
  }
  return null;
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
  // EVERY EARLY EXIT SWEEPS WHAT IT NEVER REACHED. A stop is not a clean bill,
  // and it is not a refusal either -- but the bytes ahead of it may declare a
  // name that IS one. See `sweepUnreached`.
  const stopped = (from, m) => ({ refusal: sweepUnreached(bytes, from), complete: false, names, why: why || m });
  try {
    for (;;) {
      if (at + 4 > bytes.length) { return stopped(at, `the local-header chain ran off the end at ${at}`); }
      const sig = bytes.readUInt32LE(at);
      if (sig === CENTRAL_SIG || sig === EOCD_SIG) {
        // ANCHORED: the chain may claim it reached the directory only where this
        // archive says its directory begins. See `declaredCentralOffset`.
        if (at !== cdOffset) { demote(`the chain ended at ${at}, not where this archive declares its directory begins (${cdOffset})`); }
        return { refusal: null, complete, names, why };
      }
      if (sig !== LOCAL_SIG || at + 30 > bytes.length) { return stopped(at, `no local file header at ${at}`); }
      const flags = bytes.readUInt16LE(at + 6);
      const compressed = bytes.readUInt32LE(at + 18);
      const nameLen = bytes.readUInt16LE(at + 26);
      const extraLen = bytes.readUInt16LE(at + 28);
      if (at + 30 + nameLen > bytes.length) { return stopped(at, `a local file name was cut off at ${at}`); }
      names += 1;
      // Latin-1 for the reason the central walk gives: bytes to characters 1:1.
      const refusal = nameRefusal(bytes.subarray(at + 30, at + 30 + nameLen).toString('latin1'));
      if (refusal) { return { refusal, complete: false, names, why: '' }; }
      // NO NEXT OFFSET AT ALL. These two are the only genuine stops: a zero size
      // under bit 3 would advance by nothing and resynchronise on payload, and
      // the zip64 sentinel names a size that is not here.
      if (((flags & FLAG_SIZES_DEFERRED) && compressed === 0) || compressed === 0xFFFFFFFF) {
        return stopped(at, `entry ${names} does not declare its size here`);
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
        // BOUNDED TO THE SPAN. Searching to the end of the archive and only then
        // comparing against `next` is the same answer for O(archive) work PER
        // ENTRY -- quadratic on attacker-chosen input, synchronous, and on the
        // rescue path before the hatch policy is even read (council #239 r2).
        // `subarray` is a view, not a copy, so the total is one pass.
        const hidden = bytes.subarray(at + 30, next).indexOf(LOCAL_SIG_BYTES);
        if (hidden !== -1) { demote(`entry ${names}'s declared size jumps over a local file header at ${at + 30 + hidden}`); }
      }
      if (names >= MAX_ENTRIES) { return stopped(at, `stopped after ${MAX_ENTRIES} entries`); }
      at = next;
    }
  } catch (e) {
    return { refusal: null, complete: false, names, why: `the local-header chain could not be walked: ${(e && e.message) || e}` };
  }
}

module.exports = { scanLocalNames, declaredCentralOffset };

/**
 * ONE ENTRY of an in-memory archive, and the classified failures every caller
 * acts on.
 *
 * SPLIT OUT of zip-from-buffer.js in the v4.9.6 third round: that file reached
 * the repo's 300-line gate when the symlink-target control and the stall bound
 * grew, and the seam is real. This module answers "what does one archive entry
 * become on disk, and whose fault is it when that fails"; zip-from-buffer.js
 * answers "how is the archive driven, and when do we give up on it". Nothing
 * here knows about yauzl's event loop and nothing there writes a byte.
 *
 * ── ERROR CODES ARE A CAUSAL CLAIM, AND THE CALLER DELETES ON ONE OF THEM ──
 * `UNZIP_BUFFER_FAILED` = the ARCHIVE is bad; it is the ONLY code that lets
 * `electron-repair-cache` evict a user's cached artifact. `UNZIP_DEST_FAILED` =
 * the DESTINATION is bad (no space, a read-only dist/, a path too long, a
 * machine that cannot represent a symlink). `UNZIP_BUFFER_UNAVAILABLE` =
 * neither; yauzl would not load. Every throw in this module goes through one of
 * the three constructors below, so no unclassified error can reach a caller
 * that reads "unclassified" as "the archive is bad" — council finding D2, and
 * the leak that reopened it (a raw stream error out of `collect`) is closed by
 * `collect` tagging its own rejection.
 *
 * @module sidecar/zip-entry-write
 */

'use strict';

const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');

const { collapseExcerpt } = require('../utils/text-sanitize');

/** @returns {Error} tagged with `code`, sanitized: every throw here is classified. */
function failure(code, message) {
  return Object.assign(new Error(collapseExcerpt(message)), { code });
}

/** @returns {Error} an archive-is-bad failure: the caller MAY evict the artifact. */
const badArchive = (message) => failure('UNZIP_BUFFER_FAILED', message);

/** @returns {Error} a destination-is-bad failure: the caller must NOT evict anything. */
const badDestination = (message) => failure('UNZIP_DEST_FAILED', message);

/** @returns {Error} the TERMINAL path-traversal refusal, in extract-zip's own
 *  `Out of bound path ` wording so unzip.js's UNSAFE_PATTERNS still classifies it. */
const outOfBound = (where, fileName) => failure('UNZIP_UNSAFE_ARCHIVE', `Out of bound path "${where}" found while processing file ${fileName}`);

/**
 * @returns {Error} yauzl would not load. NOT an archive failure and NOT a
 * destination failure: the artifact is fine and so is the disk. unzip.js
 * records the v4.5.2 outage where an undeclared `extract-zip` threw
 * MODULE_NOT_FOUND out of a bare `require` and took a whole function with it;
 * `yauzl` is declared for that reason, and this guard is what stops a hoisting
 * surprise from turning into a DELETED cache entry.
 */
const extractorUnavailable = (message) => failure('UNZIP_BUFFER_UNAVAILABLE', `the in-memory zip extractor is unavailable: ${message}`);

/**
 * Collect a readable fully into one Buffer (a symlink target is a few bytes).
 *
 * CLASSIFIED, like every other throw here. This was the ONE throw site that
 * rejected with the RAW yauzl/stream error, which carries no `code` — and
 * `electron-repair-cache` read an unclassified extract failure as "the archive
 * is bad" and DELETED the user's cached artifact. A read error on a symlink
 * target IS an archive-side failure, so it is named as one rather than left to
 * be guessed at.
 */
function collect(stream, what) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('error', (e) => reject(badArchive(`could not read ${what}: ${(e && e.message) || e}`)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

/** One entry's payload stream, decompressed by yauzl exactly as extract-zip gets it. */
function entryStream(zipfile, entry) {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, stream) => {
      if (err) { reject(badArchive(`${entry.fileName}: ${(err && err.message) || err}`)); return; }
      resolve(stream);
    });
  });
}

/**
 * Write one entry, checking its CRC-32 against the archive's own declaration.
 * An INTEGRITY check, not a security control (CRC-32 is linear and forgeable):
 * it catches a broken zlib or bad RAM, and is meaningful only because the
 * whole-buffer sha256 already ran on these exact bytes. yauzl checks no CRC at
 * all; `validateEntrySizes: true` covers the length half.
 *
 * `onBytes` AND `signal` ARE THE STALL BOUND'S TWO HALVES (round 3, seat A1 +
 * B2), and both live here because this is the only function that writes.
 *
 * `onBytes(n)` reports WRITE PROGRESS, which is what the bound is armed against
 * — the caller re-arms on bytes, never on entries, so a single 225 MB
 * `electron.exe` on slow storage cannot look idle. It fires from the CRC
 * transform, the stage immediately upstream of the sink, so it reports bytes the
 * DESTINATION has accepted rather than bytes read out of the buffer. MEASURED
 * (Node 24.18.0) against a sink whose `_write` never calls back: the counter
 * stops, overshooting the sink by exactly one 64 KiB readable-side highWaterMark
 * and no more, whether the wedge happens after 64 KiB or after 640 KiB. A hung
 * destination therefore still stops the counter, which is what makes a genuine
 * stall catchable.
 *
 * `signal` is what makes the bound STOP the work rather than merely report it.
 * `pipeline` destroys every stream on abort — MEASURED: source and sink both
 * `destroyed`, not one further byte counted or accepted — so no write can land
 * after the caller has given up and started cleaning the incoming tree. The
 * rejection it produces is a plain `AbortError` (`pipeline` does not carry the
 * abort reason), which is why the caller keeps its own classified failure and
 * discards this one.
 */
async function writeEntry({ zipfile, entry, dest, mode, fs, onBytes, signal }) {
  const source = await entryStream(zipfile, entry);
  let crc = 0;
  // Accumulated by a TRANSFORM in the pipeline, never by a `data` listener:
  // attaching one starts the flow before `pipeline` has piped it, losing bytes.
  const crcThrough = new Transform({
    transform(chunk, _enc, cb) {
      crc = zlib.crc32(chunk, crc);
      if (onBytes) { onBytes(chunk.length); }
      cb(null, chunk);
    },
  });
  let sink;
  try {
    sink = fs.createWriteStream(dest, { mode });
  } catch (e) {
    throw badDestination(`could not write ${entry.fileName}: ${(e && e.message) || e}`);
  }
  // WHICH SIDE FAILED FIRST is the causal claim the caller acts on (D2): a bad
  // archive may be evicted, a full disk must never be. `pipeline` destroys the
  // other half after the first error, so both ends usually end up emitting —
  // only the FIRST one recorded says what actually happened.
  let first = null;
  const note = (from) => (e) => { if (!first) { first = { from, e }; } };
  source.on('error', note('archive'));
  sink.on('error', note('dest'));
  try {
    await pipeline(source, crcThrough, sink, ...(signal ? [{ signal }] : []));
  } catch (e) {
    const cause = first ? first.e : e;
    const detail = `${entry.fileName}: ${(cause && cause.message) || cause}`;
    throw first && first.from === 'dest'
      ? badDestination(`could not write ${detail}`)
      : badArchive(`could not inflate ${detail}`);
  }
  if ((crc >>> 0) !== (entry.crc32 >>> 0)) {
    throw badArchive(`crc32 mismatch for ${entry.fileName}`);
  }
}

/**
 * Create one symlink, refusing a target that resolves outside `root`.
 *
 * `canonical` is `realpathSync` of the directory the link is ACTUALLY created
 * in — never `path.dirname(dest)`. That distinction is the whole control, and
 * getting it wrong was MEASURED to defeat the check completely: three entries
 * naming `L0`, `L0/L1`, `L0/L1/L2`, each a symlink to `.`, make the LEXICAL
 * dirname `<root>/L0/L1/L2` three levels deeper than the real one (`<root>`),
 * so a fourth entry `L0/L1/L2/x -> ../../../victim` resolved to `<root>/victim`
 * — inside, accepted — while the link really landed at `<root>/../../../victim`.
 * Escape depth tracked chain length 1:1. Every one of those names passes
 * yauzl's `validateFileName`, so one ordinary-looking archive was arbitrary
 * same-user file write outside the extraction root.
 *
 * WHAT THIS DOES AND DOES NOT PROMISE. It resolves the target from the real
 * directory and refuses anything that leaves `root`; it does NOT follow
 * symlinks inside the target's own intermediate components, so a link pointing
 * at an in-root path that some LATER entry turns into a link elsewhere is not
 * caught here — that shape is caught by the per-entry `realpath` bound check in
 * `placeEntry`, which re-runs after every earlier entry has been written.
 *
 * `signal` is checked immediately before the `symlinkSync`. A link target is a
 * handful of bytes read through `collect`, which is not a `pipeline` and so is
 * not destroyed by the abort — without this check the stall bound could fire and
 * a symlink still appear in the tree the caller is about to delete.
 */
async function writeSymlink({ zipfile, entry, canonical, root, fs, signal }) {
  const target = (await collect(await entryStream(zipfile, entry), `the symlink target for ${entry.fileName}`)).toString('utf8');
  const dest = path.join(canonical, path.basename(entry.fileName));
  const resolved = path.resolve(canonical, target);
  const rel = path.relative(root, resolved);
  // SYMLINKESCAPE: `..` at the head, or an absolute answer (a different Windows
  // drive), means the link points out of the tree amicus is allowed to write.
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw outOfBound(resolved, entry.fileName);
  }
  if (signal && signal.aborted) { return; }
  try {
    fs.symlinkSync(target, dest);
  } catch (e) {
    throw badDestination(`could not create the symlink ${entry.fileName}: ${(e && e.message) || e}`);
  }
}

/** stat mode constants, as extract-zip decodes them from externalFileAttributes. */
const IFMT = 61440;
const IFDIR = 16384;
const IFLNK = 40960;

/** extract-zip's getExtractedMode, with its 0755/0644 defaults. */
function extractedMode(entryMode, isDir) {
  if (entryMode !== 0) { return entryMode; }
  return isDir ? 0o755 : 0o644;
}

/**
 * One entry, mirroring extract-zip's Extractor.extractEntry decision order.
 *
 * MOVED HERE from zip-from-buffer.js in the third council round, when the stall
 * bound's repair pushed that file back over the 300-line gate. It is not a
 * convenience move: this function answers "what does one archive entry become on
 * disk, and whose fault is it when that fails", which is this module's whole
 * subject, and it calls nothing but this module's own writers. What stays next
 * door is the archive DRIVER — yauzl's event loop, the bound, and the decision
 * to give up.
 *
 * `signal` is the stall bound's halt: an entry that arrives after the bound
 * fired creates NOTHING — not the directory, not the file — because the caller
 * is already deleting the incoming tree.
 * @returns {Promise<boolean>} true if the entry was placed (false = skipped)
 */
async function placeEntry({ zipfile, entry, root, fs, signal, onBytes }) {
  // Nothing is created for an entry that arrives after the bound fired.
  if (signal && signal.aborted) { return false; }
  if (entry.fileName.startsWith('__MACOSX/')) { return false; }
  if (entry.isEncrypted()) { throw badArchive(`${entry.fileName} is encrypted`); }
  const dest = path.join(root, entry.fileName);
  const mode = (entry.externalFileAttributes >> 16) & 0xFFFF;
  const symlink = (mode & IFMT) === IFLNK;
  let isDir = (mode & IFMT) === IFDIR;
  if (!isDir && entry.fileName.endsWith('/')) { isDir = true; }
  if (!isDir) { isDir = ((entry.versionMadeBy >> 8) === 0 && entry.externalFileAttributes === 16); }
  const procMode = extractedMode(mode, isDir) & 0o777;
  const destDir = isDir ? dest : path.dirname(dest);
  let canonical;
  try {
    fs.mkdirSync(destDir, isDir ? { recursive: true, mode: procMode } : { recursive: true });
    canonical = fs.realpathSync(destDir);
  } catch (e) {
    throw badDestination(`could not create ${destDir}: ${(e && e.message) || e}`);
  }
  // extract-zip's check, VERBATIM — re-run per entry, AFTER earlier entries were
  // written, so a symlink an earlier entry created cannot redirect a later one.
  if (path.relative(root, canonical).split(path.sep).includes('..')) {
    throw outOfBound(canonical, entry.fileName);
  }
  if (isDir) { return true; }
  if (symlink) {
    // `canonical`, NEVER `dest`: the link's target is resolved against the
    // directory realpath says it is created in (see writeSymlink).
    await writeSymlink({ zipfile, entry, canonical, root, fs, signal });
  } else {
    await writeEntry({ zipfile, entry, dest, mode: procMode, fs, onBytes, signal });
  }
  return true;
}

module.exports = {
  failure, badArchive, badDestination, outOfBound, extractorUnavailable,
  collect, entryStream, writeEntry, writeSymlink, placeEntry,
};

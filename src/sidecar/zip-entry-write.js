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

/** Collect a readable fully into one Buffer (a symlink target is a few bytes). */
function collect(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('error', reject);
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
 */
async function writeEntry({ zipfile, entry, dest, mode, fs }) {
  const source = await entryStream(zipfile, entry);
  let crc = 0;
  // Accumulated by a TRANSFORM in the pipeline, never by a `data` listener:
  // attaching one starts the flow before `pipeline` has piped it, losing bytes.
  const crcThrough = new Transform({
    transform(chunk, _enc, cb) { crc = zlib.crc32(chunk, crc); cb(null, chunk); },
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
    await pipeline(source, crcThrough, sink);
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
 */
async function writeSymlink({ zipfile, entry, canonical, root, fs }) {
  const target = (await collect(await entryStream(zipfile, entry))).toString('utf8');
  const dest = path.join(canonical, path.basename(entry.fileName));
  const resolved = path.resolve(canonical, target);
  const rel = path.relative(root, resolved);
  // SYMLINKESCAPE: `..` at the head, or an absolute answer (a different Windows
  // drive), means the link points out of the tree amicus is allowed to write.
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw outOfBound(resolved, entry.fileName);
  }
  try {
    fs.symlinkSync(target, dest);
  } catch (e) {
    throw badDestination(`could not create the symlink ${entry.fileName}: ${(e && e.message) || e}`);
  }
}

module.exports = {
  failure, badArchive, badDestination, outOfBound, extractorUnavailable,
  collect, entryStream, writeEntry, writeSymlink,
};

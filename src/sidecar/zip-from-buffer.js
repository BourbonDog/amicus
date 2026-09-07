/**
 * Extract an archive that is ALREADY IN MEMORY and ALREADY HASHED.
 *
 * There is no `zip` parameter because there is no file. The bytes arrive as a
 * Buffer that `electron-custody.readArtifactBytes` read through a single
 * descriptor and that `electron-trust.verifyArtifactBytes` hashed; nothing here
 * resolves a path to the artifact, so there is no second read for a same-uid
 * attacker to race. That is the whole reason this module exists — see
 * `electron-custody.js` for the measured refutations of the two remedies it
 * replaces.
 *
 * NO HAND-WRITTEN ZIP PARSING. A council judge killed a design that sliced
 * local file headers by hand ("a terminal path with no rescue": it would have
 * had to re-derive ZIP64 local headers, data descriptors, and the
 * central-vs-local size disagreement `openReadStream` already handles). Every
 * byte offset here comes from `yauzl.openReadStream`, exactly as it does under
 * extract-zip. What changes is only WHERE yauzl reads from: `fromBuffer`
 * instead of `open`.
 *
 * ── THE `autoClose` TRAP, MEASURED ────────────────────────────────────────
 * `yauzl.fromBuffer` sets `options.autoClose = false` UNCONDITIONALLY
 * (yauzl@2.10.0 index.js, line 67) — an explicit `{autoClose: true}` is silently
 * discarded. And `extract-zip` resolves its promise on the zipfile's `'close'`
 * event (extract-zip@2.0.1 index.js, lines 32-37). So a naive port of extract-zip onto
 * a buffer HANGS FOREVER. Both council judges hit it.
 *
 * It is worse than the brief recorded, and this was MEASURED on the installed
 * libraries (Windows 11, Node 24.18.0): `ZipFile.close()` only calls
 * `reader.unref()`, and `fd_slicer`'s **BufferSlicer has no close and emits
 * nothing on unref** (fd-slicer index.js, lines 282-288) — where FdSlicer closes the
 * fd and emits `'close'`. So under `fromBuffer` the `'close'` event is
 * UNREACHABLE even if you call `close()` yourself:
 *
 *     autoClose after explicit {autoClose:true} : false
 *     END fired ... after 500ms: sawEnd=true sawClose=false
 *     VERDICT: extract-zip-style resolve-on-close would HANG FOREVER
 *
 * THE FIX, stated so nobody "tidies" it: this module resolves on `'end'`, which
 * yauzl emits once the central directory is exhausted, and it drives
 * `readEntry()` only after the previous entry has been fully written — so
 * `'end'` cannot arrive before the last write lands. `close()` is still called,
 * for the reader refcount, but NOTHING waits on it. Pinned by the YAUZLHANG
 * mutant in tests/electron-custody.test.js.
 *
 * ── PARITY WITH extract-zip, AND THE ONE DELIBERATE DIFFERENCE ────────────
 * `__MACOSX/` skip, the `IFMT`/`IFDIR`/`IFLNK` mode decode, the trailing-slash
 * and `madeBy === 0 && externalFileAttributes === 16` directory failsafes, the
 * `getExtractedMode` 0755/0644 defaults, and the per-entry
 * `realpath(destDir)` out-of-bound check with its message VERBATIM are all
 * copied from extract-zip@2.0.1 index.js, lines 48-160, so `UNSAFE_PATTERNS` and
 * `electron-refuse.isUnsafeArchive` keep classifying exactly what they did.
 *
 * The difference: a SYMLINK whose target resolves outside the extraction root
 * is REFUSED here and is not refused by extract-zip. That is a behaviour change
 * on a shape amicus cannot test on this machine (the darwin `.app` bundle is
 * the only electron artifact with real symlinks), so it is refused with the
 * same `Out of bound path` wording, exercised against synthetic archives
 * carrying the shapes a real `.app` uses, and named in the report as
 * unverified on macOS.
 *
 * ── ERROR CODES ARE A CAUSAL CLAIM ───────────────────────────────────────
 * `UNZIP_BUFFER_FAILED` means the ARCHIVE is bad (a truncated zip, a failed
 * inflate, an unsupported method, an encrypted entry). `UNZIP_DEST_FAILED`
 * means the DESTINATION is bad (no space, a read-only dist, a path too long).
 * The caller evicts the cached artifact on the first and never on the second —
 * council finding D2 was that a full disk deleted a pristine cache entry.
 *
 * @module sidecar/zip-from-buffer
 */

'use strict';

const fsDefault = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');

const { collapseExcerpt } = require('../utils/text-sanitize');

/** stat mode constants, as extract-zip decodes them from externalFileAttributes. */
const IFMT = 61440;
const IFDIR = 16384;
const IFLNK = 40960;

/** @returns {Error} an archive-is-bad failure: the caller MAY evict the artifact. */
function badArchive(message) {
  const err = new Error(collapseExcerpt(message));
  err.code = 'UNZIP_BUFFER_FAILED';
  return err;
}

/** @returns {Error} a destination-is-bad failure: the caller must NOT evict anything. */
function badDestination(message) {
  const err = new Error(collapseExcerpt(message));
  err.code = 'UNZIP_DEST_FAILED';
  return err;
}

/**
 * @returns {Error} the TERMINAL path-traversal refusal. The message keeps
 * extract-zip's `Out of bound path ` prefix so unzip.js's UNSAFE_PATTERNS
 * classifies it identically to the one extract-zip raises.
 */
function outOfBound(where, fileName) {
  const err = new Error(collapseExcerpt(`Out of bound path "${where}" found while processing file ${fileName}`));
  err.code = 'UNZIP_UNSAFE_ARCHIVE';
  return err;
}

/** extract-zip's getExtractedMode, with its 0755/0644 defaults. */
function extractedMode(entryMode, isDir) {
  if (entryMode !== 0) { return entryMode; }
  return isDir ? 0o755 : 0o644;
}

/** Collect a readable fully into one Buffer (a symlink target is a few bytes). */
function collect(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

/** yauzl's callback API as a promise, with `fromBuffer`'s options pinned here. */
function openBuffer(yauzl, bytes) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true }, (err, zipfile) => {
      if (err) { reject(badArchive(`could not read the archive: ${(err && err.message) || err}`)); return; }
      resolve(zipfile);
    });
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
 * Write one entry, and check its CRC-32 against the archive's own declaration.
 *
 * The CRC is an INTEGRITY check, not a security control: CRC-32 is linear and
 * trivially forgeable. It is here to catch a broken zlib or bad RAM, and it is
 * meaningful only because the whole-buffer sha256 already ran on these exact
 * bytes. yauzl checks neither CRC nor (without `validateEntrySizes`) length;
 * `validateEntrySizes: true` above covers the length half.
 */
async function writeEntry({ zipfile, entry, dest, mode, fs }) {
  const source = await entryStream(zipfile, entry);
  let crc = 0;
  // The CRC is accumulated by a TRANSFORM in the pipeline, never by a `data`
  // listener: attaching one puts the stream in flowing mode before `pipeline`
  // has piped it, which is how bytes go missing.
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

/** Create one symlink, refusing a target that resolves outside `root`. */
async function writeSymlink({ zipfile, entry, dest, root, fs }) {
  const target = (await collect(await entryStream(zipfile, entry))).toString('utf8');
  const resolved = path.resolve(path.dirname(dest), target);
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

/**
 * Extract `bytes` into `dir`. The caller has ALREADY hashed `bytes`.
 *
 * @param {Buffer} bytes  the whole archive, in this process's heap
 * @param {object} o
 * @param {string} o.dir  absolute destination (created if absent)
 * @param {object} [o.deps] { fs, yauzl, log }
 * @returns {Promise<{strategy:'buffer', entries:number}>}
 * @throws {Error} code 'UNZIP_UNSAFE_ARCHIVE' — terminal; never retried
 * @throws {Error} code 'UNZIP_BUFFER_FAILED'  — the archive is bad
 * @throws {Error} code 'UNZIP_DEST_FAILED'    — the destination is bad
 */
async function extractZipBuffer(bytes, { dir, deps = {} } = {}) {
  const fs = deps.fs || fsDefault;
  const yauzl = deps.yauzl || require('yauzl');
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
  try {
    await new Promise((resolve, reject) => {
      // yauzl's own validateFileName refusals ('absolute path: ', 'invalid
      // relative path: ', 'invalid characters in fileName: ') arrive here.
      zipfile.on('error', (e) => reject(
        /^(absolute path|invalid relative path|invalid characters in fileName): /.test((e && e.message) || '')
          ? Object.assign(new Error(collapseExcerpt((e && e.message) || 'refused')), { code: 'UNZIP_UNSAFE_ARCHIVE' })
          : badArchive((e && e.message) || 'the archive could not be read'),
      ));
      // RESOLVE ON 'end', NEVER ON 'close' — see the docblock. `close` is
      // unreachable under fromBuffer, so waiting for it hangs forever.
      zipfile.on('end', () => resolve());
      zipfile.on('entry', (entry) => {
        placeEntry({ zipfile, entry, root, fs }).then((placed) => {
          if (placed) { entries += 1; }
          zipfile.readEntry();
        }, reject);
      });
      zipfile.readEntry();
    });
  } finally {
    try { zipfile.close(); } catch { /* the buffer reader holds no fd */ }
  }
  return { strategy: 'buffer', entries };
}

/** One entry, mirroring extract-zip's Extractor.extractEntry decision order. */
async function placeEntry({ zipfile, entry, root, fs }) {
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
    await writeSymlink({ zipfile, entry, dest, root, fs });
  } else {
    await writeEntry({ zipfile, entry, dest, mode: procMode, fs });
  }
  return true;
}

module.exports = { extractZipBuffer };

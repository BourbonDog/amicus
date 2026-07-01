/**
 * Atomic file write helper.
 *
 * Writes data to a unique temp file alongside the target, then renames it into
 * place. Rename is atomic on a single filesystem, so a crash mid-write leaves
 * the original file intact rather than a truncated/corrupt one. This is the
 * pattern already used by council/verdict.js, session-index.js, and
 * model-catalog.js; this module shares it for metadata writes.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Atomically write `data` to `filePath` via temp file + rename.
 *
 * The temp name is unique per write (pid + random suffix) so concurrent writers
 * never collide on the same temp file. On any failure the temp file is cleaned
 * up best-effort. Errors propagate to the caller.
 *
 * @param {string} filePath - Destination path.
 * @param {string|Buffer} data - Content to write.
 * @param {{mode?: number}} [opts] - Write options; `mode` sets file permissions.
 */
function writeFileAtomic(filePath, data, opts = {}) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmp = path.join(dir, `.${base}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(tmp, data, { mode: opts.mode });
    fs.renameSync(tmp, filePath); // atomic on a single filesystem
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best-effort cleanup */ }
    throw err;
  }
}

module.exports = { writeFileAtomic };

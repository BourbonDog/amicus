/**
 * @module utils/engine-log-tail
 * One engine-log FILE: read its tail, find the newest usable excerpt in it.
 *
 * Extracted from `./engine-log.js` in PR #206's fix round, for the reason that
 * file's two earlier extractions happened (`./engine-log-parse.js` in W10 round
 * 2, `./text-sanitize.js` in round 3): it sat at exactly 300/300 lines, and the
 * A1+B2 fix — a MISS may not be served from the warm scan memo — needs both new
 * code and the disclosure of its residual. A same-line-count swap would have
 * had to pay for those by deleting prose three review rounds argued for, so the
 * stable neighbour moved instead and moved UNCHANGED.
 *
 * THE SPLIT. `./engine-log.js` decides WHICH files to open and in what order,
 * and holds the total byte budget one lookup may spend. This file spends it,
 * one file at a time: how much of a file to read, how to decode it safely, and
 * which line in it answers. The line SHAPE rules — what an ERROR line is, which
 * line is about a session, where its message begins — are `./engine-log-parse.js`.
 *
 * BEST-EFFORT, like its caller: an unreadable file yields null and no bytes
 * charged, never a throw. A log read must not become the failure it reports on.
 */

'use strict';

const {
  isErrorLine, extractMessage, collapseExcerpt, lineIsAboutSession,
} = require('./engine-log-parse');

/** Read at most the last 256 KiB of any candidate. The legacy single file is
 *  2.4 MB on the reference machine, and this runs on a leg's death path (often
 *  once per dead seat in a wave) — whole-file reads are not an acceptable cost
 *  for a diagnostic nicety. */
const MAX_TAIL_BYTES = 256 * 1024;

/** Read the last MAX_TAIL_BYTES of a file, or `budget` bytes if that is less.
 *  When the read started mid-file the first line is dropped: it is a fragment,
 *  and slicing at a byte offset can also land inside a multi-byte UTF-8
 *  sequence. `bytes` is what the read actually spent, so the caller can charge
 *  it against its own scan budget (`engine-log.js :: MAX_SCAN_BYTES`).
 *  @returns {{text: string, bytes: number}} */
function readTail(file, fsImpl, budget) {
  const size = fsImpl.statSync(file).size;
  const cap = Math.min(MAX_TAIL_BYTES, Math.max(0, budget));
  const start = Math.max(0, size - cap);
  const length = Math.min(size, cap);
  if (!(length > 0)) { return { text: '', bytes: 0 }; }
  const fd = fsImpl.openSync(file, 'r');
  let text;
  try {
    const buf = Buffer.alloc(length);
    // Decode only what was actually read: a short read would otherwise decode
    // the allocation's zero-fill as NUL characters, which no whitespace
    // collapse strips and which would ride into the excerpt.
    const bytesRead = fsImpl.readSync(fd, buf, 0, length, start);
    text = buf.toString('utf-8', 0, Number.isFinite(bytesRead) ? bytesRead : length);
  } finally {
    try { fsImpl.closeSync(fd); } catch (_e) { /* best effort */ }
  }
  if (start > 0) {
    const firstBreak = text.indexOf('\n');
    text = firstBreak === -1 ? '' : text.slice(firstBreak + 1);
  }
  return { text, bytes: length };
}

/**
 * The NEWEST usable excerpt in this file for `needle`. Logs are append-ordered,
 * so scanning backwards reaches the newest match first — and the newest is the
 * one that killed the leg (a session can log several errors while it degrades).
 *
 * ABOUT, not merely mentioning (round-2 review A1, tightened in round 3): a line
 * whose structural session field names someone else is skipped even when our id
 * appears elsewhere on it, and the walk continues to an older line that is
 * really ours.
 *
 * USABLE, not merely matching (round-3 review C4). A matching line whose message
 * part is empty used to end the file's scan, so the fallthrough skipped to the
 * next FILE and never reached the older line in THIS one that actually says what
 * happened — and those two are typically neighbours, the real failure followed by
 * a terse message-less line as the session tears down. The excerpt is therefore
 * built here, inside the walk, and an empty one just keeps walking. It costs no
 * extra I/O: the tail is already in memory, so the byte budget is unchanged.
 *
 * `isErrorLine` runs FIRST because it is the cheaper test — it rejects a
 * non-ERROR line on one `indexOf` and tokenizes only when the level substring
 * is actually present (#201 tail C1), while ownership tokenizes every line it
 * is handed. Only ERROR lines can ever answer.
 *
 * `tails` is the caller's memo (#201 tail C2); a cached entry carries the bytes
 * its ORIGINAL read spent, charged again here, so the budget accounts
 * identically warm or cold and both walk the same files to the same stop. A
 * FAILED read is deliberately not cached — an unreadable file is a transient.
 * @returns {{excerpt: string|null, bytes: number}} `bytes` is the budget spent.
 */
function newestExcerptInFile(file, needle, fsImpl, budget, tails) {
  let read = tails && tails.get(file);
  if (!read) {
    try { read = readTail(file, fsImpl, budget); } catch (_e) { return { excerpt: null, bytes: 0 }; }
    if (tails) { tails.set(file, read); }
  }
  const lines = read.text.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!isErrorLine(line) || !lineIsAboutSession(line, needle)) { continue; }
    const excerpt = collapseExcerpt(extractMessage(line));
    if (excerpt) { return { excerpt, bytes: read.bytes }; }
  }
  return { excerpt: null, bytes: read.bytes };
}

// `MAX_TAIL_BYTES` and `readTail` stay internal: nothing outside this file
// consumes either, and a constant in a `Key Exports` cell reads as a function
// it is not (engine-log.js's rule).
module.exports = { newestExcerptInFile };

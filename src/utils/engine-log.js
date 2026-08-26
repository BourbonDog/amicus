/**
 * @module utils/engine-log
 * Resolve the OpenCode engine's own error line for one session.
 *
 * A leg that dies silent can then quote the truth instead of a guess.
 *
 * WHY (#133). The NO_OUTPUT_BACKSTOP message reports only what the deadline
 * observed — deliberately, since the guess it replaced ("likely a listed-but-
 * not-serving model or a dead endpoint") sent 30 minutes of a real outage's
 * debugging at model ids and API keys. But the engine had written its real
 * failure to its own log at the exact timestamp of every dead session the
 * whole time. Reporting silence while the cause sits on disk unread is the
 * "correct but SILENT degrade" the product principle forbids as hard as a
 * crash. This module reads it; src/headless.js appends it to the reason.
 *
 * MEASURED (2026-08-25). The long-quoted single-file premise —
 * `~/.local/share/opencode/log/opencode.log` — is STALE. The current engine
 * writes ONE timestamped file PER PROCESS (`2026-08-25T185532.log`), and the
 * two schemes coexist across machines: the reference machine still carries a
 * 2.4 MB legacy `opencode.log`, while this one holds 12 timestamped files and
 * NO `opencode.log` at all. A resolver that opened only the legacy name would
 * therefore return nothing on a current install — silently, forever.
 *
 * THE TWO LINE FORMATS (logfmt at 1.17.x, columnar at 1.2.x), which line is an
 * ERROR, which line is about this session, and where its message begins all
 * live in `./engine-log-parse.js` — extracted in W10 round 2 and re-exported
 * below. This file is the I/O half: which files to open, in what order, how
 * many bytes to read — and how long one scan is reused (#201 tail C2).
 *
 * EVERYTHING HERE IS BEST-EFFORT: every path returns null rather than
 * throwing. A log read must never break a leg's death report — the report is
 * the product; the excerpt is a bonus on top of it.
 */

'use strict';

const os = require('os');
const path = require('path');
const {
  isErrorLine, extractMessage, collapseExcerpt, mentionsSession, lineIsAboutSession,
} = require('./engine-log-parse');

/** Read at most the last 256 KiB of any candidate. The legacy single file is
 *  2.4 MB on the reference machine, and this runs on a leg's death path (often
 *  once per dead seat in a wave) — whole-file reads are not an acceptable cost
 *  for a diagnostic nicety. */
const MAX_TAIL_BYTES = 256 * 1024;
/**
 * The TOTAL tail bytes one lookup may read across all candidates — 8 full tail
 * reads' worth. The bound that used to sit here was "the 3 newest files by
 * mtime", and it broke exactly where this module matters most (round-2 review
 * B1): the engine writes one log PER PROCESS, so in a mass-death wave every
 * seat has its own file and the SURVIVORS keep writing — the dead leg's own log
 * gets pushed out of the top 3 by the legs that did NOT die. A byte budget
 * bounds the same cost (I/O, not file handles) without letting the answer's
 * position in the mtime order decide whether it is ever read.
 */
const MAX_SCAN_BYTES = 2 * 1024 * 1024;
/**
 * How long ONE scan (the listing plus the tails it read) is reused (#201 tail
 * C2). MEASURED, not guessed: this runs on a leg's DEATH PATH and legs die in
 * WAVES — a wave's seats launch together, so their backstop deadlines land
 * together, each observed on a 2-second poll tick (`POLL_INTERVAL_MS`,
 * src/headless.js:80). Ten seconds is five of those ticks: wide enough for a
 * whole wave to share one scan, short enough that a LATER failure gets a
 * genuinely fresh read instead of a stale answer about an older death. Not a
 * knob — any second-granularity value trades the same way.
 */
const SCAN_CACHE_TTL_MS = 10 * 1000;
const scanCaches = new WeakMap();

/**
 * The live scan slot — `{key, at, files, tails}` — freshly reset when absent,
 * stale, or built for other dirs. Bounded BY CONSTRUCTION: ONE slot per fs
 * impl, holding one listing and one scan's worth of tails (MAX_SCAN_BYTES);
 * another dir set evicts rather than accumulating. Keyed by the fs IMPL:
 * production always passes the same `require('fs')` object, so a wave of seats
 * shares one slot, while a test seam (or a hostile one) is a fresh object with
 * a slot of its own — the fs seam is this module's whole testability and a
 * shared cache would quietly break it.
 */
function scanSlot(fsImpl, key) {
  const now = Date.now();
  let slot = scanCaches.get(fsImpl);
  if (!slot || slot.key !== key || now - slot.at >= SCAN_CACHE_TTL_MS) {
    slot = { key, at: now, files: null, tails: new Map() };
    scanCaches.set(fsImpl, slot);
  }
  return slot;
}

/**
 * Ordered, de-duplicated candidate engine-log DIRECTORIES, most specific first
 * — the same order as `src/utils/auth-json.js :: authJsonCandidates` (same
 * engine, same data root), whose comment records the measurement that on
 * Windows OpenCode still writes to `~/.local/share/opencode`, which is why the
 * `.local/share` path stays FIRST after XDG rather than APPDATA. Order is a
 * listing order, not a precedence: all of them are searched (see
 * existingEngineLogDirs), and mtime decides which file answers.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
function engineLogDirCandidates(env = process.env) {
  const home = os.homedir();
  const candidates = [];
  if (env.XDG_DATA_HOME) { candidates.push(path.join(env.XDG_DATA_HOME, 'opencode', 'log')); }
  candidates.push(path.join(home, '.local', 'share', 'opencode', 'log'));
  if (process.platform === 'win32') {
    const appData = env.APPDATA || path.join(home, 'AppData', 'Roaming');
    candidates.push(path.join(appData, 'opencode', 'log'));
  }
  return [...new Set(candidates)];
}

/**
 * EVERY candidate directory that exists, in candidate order — NOT "the first
 * one that exists" (W10 round-1 review A2). The dirs are alternative homes for
 * the SAME engine's logs, and existence says nothing about which one the live
 * engine writes to: a stale `$XDG_DATA_HOME`, or an empty dir left by a
 * previous install, would otherwise shadow the dir holding the answer — this
 * module's own silent-forever miss, one layer up from where it was fixed.
 * @returns {string[]}
 */
function existingEngineLogDirs(env, fsImpl) {
  const dirs = [];
  for (const dir of engineLogDirCandidates(env)) {
    try { if (fsImpl.existsSync(dir)) { dirs.push(dir); } } catch (_e) { /* try the next */ }
  }
  return dirs;
}

/**
 * EVERY `*.log` across all candidate dirs, newest first by mtime. The order is
 * taken over the UNION, not per directory, so which dir a file sits in never
 * outranks how recently the engine wrote to it.
 *
 * Not truncated here: the scan reads down this list until it finds a match or
 * spends MAX_SCAN_BYTES (see engineErrorForSession). Listing is a stat per
 * file; only the READS are the cost worth bounding. This also retires the
 * legacy `opencode.log`'s reserved slot — on a single-file machine it is the
 * newest file anyway (it is written continuously), and on a migrated machine it
 * is stale and simply sorts last, which is the same answer the reserved slot
 * was there to produce.
 * @param {string[]} dirs
 * @returns {string[]} absolute paths, newest first
 */
function candidateLogFiles(dirs, fsImpl) {
  const found = [];
  for (const dir of dirs) {
    let names;
    try { names = fsImpl.readdirSync(dir); } catch (_e) { continue; }
    for (const name of names) {
      if (!String(name).endsWith('.log')) { continue; }
      const full = path.join(dir, name);
      try {
        found.push({ full, mtimeMs: fsImpl.statSync(full).mtimeMs || 0 });
      } catch (_e) { /* vanished or unreadable — skip it */ }
    }
  }
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return found.map((f) => f.full);
}

/** Read the last MAX_TAIL_BYTES of a file, or `budget` bytes if that is less.
 *  When the read started mid-file the first line is dropped: it is a fragment,
 *  and slicing at a byte offset can also land inside a multi-byte UTF-8
 *  sequence. `bytes` is what the read actually spent, so the caller can charge
 *  it against MAX_SCAN_BYTES.
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

/**
 * The engine's own error line for a session, as a one-line excerpt.
 *
 * @param {string} sessionId - `ses_…` (createSession's return) or the bare id.
 * @param {object} [options]
 * @param {string} [options.dataDir] - XDG-style DATA dir override; the module
 *   appends `opencode/log` itself, exactly as `$XDG_DATA_HOME` behaves in
 *   src/utils/auth-json.js. Tests point this at a synthetic fixture tree. When
 *   given it is the ONLY dir searched — an explicit override is a statement,
 *   not one more candidate.
 * @param {NodeJS.ProcessEnv} [options.env] - environment for dir resolution.
 * @param {object} [options.fs] - fs seam (needs existsSync/readdirSync/
 *   statSync/openSync/readSync/closeSync); defaults to the real module.
 * @returns {string|null} excerpt, or null on EVERY miss path (no dir, no file,
 *   no line whose own session field names us, no ERROR line, every match empty,
 *   unreadable file, hostile fs, budget spent).
 */
function engineErrorForSession(sessionId, options = {}) {
  try {
    if (!sessionId || typeof sessionId !== 'string') { return null; }
    const fsImpl = options.fs || require('fs');
    const dirs = options.dataDir
      ? [path.join(options.dataDir, 'opencode', 'log')]
      : existingEngineLogDirs(options.env || process.env, fsImpl);
    if (!dirs.length) { return null; }
    const needle = sessionId.startsWith('ses_') ? sessionId : `ses_${sessionId}`;
    // Listing and tails are shared with any other seat that died in the same
    // window (#201 tail C2, see SCAN_CACHE_TTL_MS) — the SCAN is memoized,
    // never the ANSWER: each seat still walks the lines for its OWN id.
    const slot = scanSlot(fsImpl, dirs.join('\0'));
    if (!slot.files) { slot.files = candidateLogFiles(dirs, fsImpl); }
    // Newest first, reading until the answer turns up or the byte budget is
    // spent — NOT "the N newest files" (round-2 review B1, see MAX_SCAN_BYTES).
    let budget = MAX_SCAN_BYTES;
    for (const file of slot.files) {
      if (budget <= 0) { break; }
      const found = newestExcerptInFile(file, needle, fsImpl, budget, slot.tails);
      budget -= found.bytes;
      if (found.excerpt) { return found.excerpt; }
    }
    return null;
  } catch (_e) {
    return null; // a diagnostic read must never become the failure it reports on
  }
}

// The line-shape helpers are RE-EXPORTED from their new home in
// `engine-log-parse.js` so this module stays the single import site a consumer
// needs (tests/engine-log.test.js pins that they are the same function objects,
// not copies). The internal read bounds — and the scan TTL beside them — are
// deliberately NOT exported: nothing outside this file consumed them, and a
// constant in a `Key Exports` cell reads as a function it is not.
module.exports = {
  engineErrorForSession,
  engineLogDirCandidates,
  isErrorLine,
  extractMessage,
  collapseExcerpt,
  mentionsSession,
  lineIsAboutSession,
};

'use strict';

/**
 * @module utils/engine-log
 * Resolve the OpenCode ENGINE's own error line for one session, so a leg that
 * dies silent can quote the truth instead of a guess.
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
 * TWO LINE FORMATS are in the wild and both are matched:
 *   logfmt   (1.17.x): `… level=ERROR … session.id=ses_<id> error=<msg>`
 *   columnar (1.2.x):  `ERROR <iso> … id=ses_<id> <msg>`
 * The `ses_<id>` substring is the correlation key in both.
 *
 * EVERYTHING HERE IS BEST-EFFORT: every path returns null rather than
 * throwing. A log read must never break a leg's death report — the report is
 * the product; the excerpt is a bonus on top of it.
 */

const os = require('os');
const path = require('path');

/**
 * Read at most the last 256 KiB of any candidate. The legacy single file is
 * 2.4 MB on the reference machine, and this runs on a leg's death path (often
 * once per dead seat in a wave) — a whole-file read of every candidate is not
 * an acceptable cost for a diagnostic nicety.
 */
const MAX_TAIL_BYTES = 256 * 1024;
/** At most the 3 newest timestamped files by mtime (see candidateLogFiles). */
const MAX_TIMESTAMPED_FILES = 3;
/** One short line: long enough for a real engine error, short enough to ride
 *  inside an error string that already carries the backstop's own sentence. */
const MAX_EXCERPT_CHARS = 200;
const LEGACY_LOG_NAME = 'opencode.log';

/**
 * Ordered, de-duplicated candidate engine-log DIRECTORIES, most specific
 * first. Deliberately the same precedence as
 * `src/utils/auth-json.js :: authJsonCandidates` — same engine, same data
 * root, and that file's comment records the measurement that on Windows
 * OpenCode still writes to `~/.local/share/opencode`, which is why the
 * `.local/share` path stays FIRST after XDG rather than APPDATA.
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

/** First candidate directory that exists, else null. */
function resolveEngineLogDir(env, fsImpl) {
  for (const dir of engineLogDirCandidates(env)) {
    try { if (fsImpl.existsSync(dir)) { return dir; } } catch (_e) { /* try the next */ }
  }
  return null;
}

/**
 * The files worth opening, newest first: the 3 newest `*.log` by mtime, plus
 * the legacy `opencode.log` when it exists and did not already make that cut.
 *
 * WHY THE LEGACY FILE GETS AN EXTRA SLOT (bound: ≤4 files, ≤1 MiB read): on a
 * machine that still uses the single-file scheme it is the ONLY file that can
 * hold the answer, and it is written continuously, so a straight mtime cut
 * would usually keep it anyway — but on a machine that has migrated it can be
 * months stale and would push a live timestamped file out of the top 3.
 * Keeping it as an appended, lowest-priority candidate is what makes this
 * work on BOTH schemes, which is the whole point of the measurement above.
 * @returns {string[]} absolute paths, newest first
 */
function candidateLogFiles(dir, fsImpl) {
  let names;
  try { names = fsImpl.readdirSync(dir); } catch (_e) { return []; }
  const found = [];
  for (const name of names) {
    if (!String(name).endsWith('.log')) { continue; }
    const full = path.join(dir, name);
    try {
      found.push({ full, name, mtimeMs: fsImpl.statSync(full).mtimeMs || 0 });
    } catch (_e) { /* vanished or unreadable — skip it */ }
  }
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const picked = found.slice(0, MAX_TIMESTAMPED_FILES);
  const legacy = found.find((f) => f.name === LEGACY_LOG_NAME);
  if (legacy && !picked.includes(legacy)) { picked.push(legacy); }
  return picked.map((f) => f.full);
}

/**
 * Read at most the last MAX_TAIL_BYTES of a file. When the read started mid-
 * file the first line is dropped: it is a fragment, and slicing at a byte
 * offset can also land inside a multi-byte UTF-8 sequence.
 * @returns {string}
 */
function readTail(file, fsImpl) {
  const size = fsImpl.statSync(file).size;
  const start = Math.max(0, size - MAX_TAIL_BYTES);
  const length = size - start;
  if (!(length > 0)) { return ''; }
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
  return text;
}

/** ERROR level in either format: logfmt `level=ERROR`, columnar leading `ERROR`. */
function isErrorLine(line) {
  return /(^|\s)level=ERROR(\s|$)/.test(line) || /^\s*ERROR\b/.test(line);
}

/**
 * The human part of an ERROR line.
 * - logfmt: the `error=` value — quoted content when quoted, else the rest of
 *   the line (an unquoted engine error is a sentence, not one token, and it is
 *   conventionally last).
 * - columnar: everything after the final `key=value` token, which is exactly
 *   where the message starts in `ERROR <iso> +Nms service=… id=ses_… <msg>`.
 * - neither: the whole line, so an unrecognized future format degrades to
 *   "slightly noisy" rather than to silence.
 */
function extractMessage(line) {
  const quoted = /\berror="([^"]*)"/.exec(line);
  if (quoted) { return quoted[1]; }
  const bare = /\berror=(?!")(.*)$/.exec(line);
  if (bare) { return bare[1]; }
  const tokens = line.trim().split(/\s+/);
  let lastPair = -1;
  for (let i = 0; i < tokens.length; i++) {
    if (/^[\w.[\]-]+=/.test(tokens[i])) { lastPair = i; }
  }
  const tail = tokens.slice(lastPair + 1).join(' ');
  return tail || (lastPair === -1 ? line : '');
}

/** One line, no newlines/tabs, at most MAX_EXCERPT_CHARS characters. */
function collapseExcerpt(text) {
  const oneLine = String(text === undefined || text === null ? '' : text)
    .replace(/\s+/g, ' ').trim();
  if (oneLine.length <= MAX_EXCERPT_CHARS) { return oneLine; }
  return `${oneLine.slice(0, MAX_EXCERPT_CHARS - 1)}…`;
}

/**
 * The LAST ERROR line in this file mentioning `needle`. Logs are append-
 * ordered, so scanning backwards finds the newest match first — and the newest
 * is the one that killed the leg (a session can log several errors while it
 * degrades).
 */
function newestMatchingErrorLine(file, needle, fsImpl) {
  let text;
  try { text = readTail(file, fsImpl); } catch (_e) { return null; }
  const lines = text.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.includes(needle) && isErrorLine(line)) { return line; }
  }
  return null;
}

/**
 * The engine's own error line for a session, as a one-line excerpt.
 *
 * @param {string} sessionId - `ses_…` (createSession's return) or the bare id.
 * @param {object} [options]
 * @param {string} [options.dataDir] - XDG-style DATA dir override; the module
 *   appends `opencode/log` itself, exactly as `$XDG_DATA_HOME` behaves in
 *   src/utils/auth-json.js. Tests point this at a synthetic fixture tree.
 * @param {NodeJS.ProcessEnv} [options.env] - environment for dir resolution.
 * @param {object} [options.fs] - fs seam (needs existsSync/readdirSync/
 *   statSync/openSync/readSync/closeSync); defaults to the real module.
 * @returns {string|null} excerpt, or null on EVERY miss path (no dir, no file,
 *   no `ses_` match, no ERROR line, unreadable file, hostile fs).
 */
function engineErrorForSession(sessionId, options = {}) {
  try {
    if (!sessionId || typeof sessionId !== 'string') { return null; }
    const fsImpl = options.fs || require('fs');
    const dir = options.dataDir
      ? path.join(options.dataDir, 'opencode', 'log')
      : resolveEngineLogDir(options.env || process.env, fsImpl);
    if (!dir) { return null; }
    const needle = sessionId.startsWith('ses_') ? sessionId : `ses_${sessionId}`;
    for (const file of candidateLogFiles(dir, fsImpl)) {
      const line = newestMatchingErrorLine(file, needle, fsImpl);
      if (!line) { continue; }
      const excerpt = collapseExcerpt(extractMessage(line));
      if (excerpt) { return excerpt; }
    }
    return null;
  } catch (_e) {
    return null; // a diagnostic read must never become the failure it reports on
  }
}

module.exports = {
  engineErrorForSession,
  engineLogDirCandidates,
  MAX_TAIL_BYTES,
  MAX_TIMESTAMPED_FILES,
  MAX_EXCERPT_CHARS,
};

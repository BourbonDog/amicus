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
 * The `ses_<id>` token is the correlation key in both — as a whole token, NOT
 * as a bare substring: an id is a prefix of every longer id that starts with
 * it, so `ses_abc` would otherwise answer with `ses_abc123`'s failure.
 *
 * EVERYTHING HERE IS BEST-EFFORT: every path returns null rather than
 * throwing. A log read must never break a leg's death report — the report is
 * the product; the excerpt is a bonus on top of it.
 */

const os = require('os');
const path = require('path');

/** Read at most the last 256 KiB of any candidate. The legacy single file is
 *  2.4 MB on the reference machine, and this runs on a leg's death path (often
 *  once per dead seat in a wave) — whole-file reads are not an acceptable cost
 *  for a diagnostic nicety. */
const MAX_TAIL_BYTES = 256 * 1024;
/** At most the 3 newest timestamped files by mtime (see candidateLogFiles). */
const MAX_TIMESTAMPED_FILES = 3;
/** One short line: long enough for a real engine error, short enough to ride
 *  inside an error string that already carries the backstop's own sentence. */
const MAX_EXCERPT_CHARS = 200;
const LEGACY_LOG_NAME = 'opencode.log';

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
 * The files worth opening ACROSS all candidate dirs, newest first: the 3 newest
 * `*.log` by mtime, plus the newest legacy `opencode.log` when one exists and
 * did not already make that cut. The mtime cut is taken over the UNION, not per
 * directory, so which dir a file sits in never outranks how recently the engine
 * wrote to it.
 *
 * WHY THE LEGACY FILE GETS AN EXTRA SLOT (bound: ≤4 files, ≤1 MiB read): on a
 * machine that still uses the single-file scheme it is the ONLY file that can
 * hold the answer, and it is written continuously, so a straight mtime cut
 * would usually keep it anyway — but on a machine that has migrated it can be
 * months stale and would push a live timestamped file out of the top 3.
 * Keeping it as an appended, lowest-priority candidate is what makes this
 * work on BOTH schemes, which is the whole point of the measurement above.
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
        found.push({ full, name, mtimeMs: fsImpl.statSync(full).mtimeMs || 0 });
      } catch (_e) { /* vanished or unreadable — skip it */ }
    }
  }
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const picked = found.slice(0, MAX_TIMESTAMPED_FILES);
  const legacy = found.find((f) => f.name === LEGACY_LOG_NAME);
  if (legacy && !picked.includes(legacy)) { picked.push(legacy); }
  return picked.map((f) => f.full);
}

/** Read at most the last MAX_TAIL_BYTES of a file. When the read started mid-
 *  file the first line is dropped: it is a fragment, and slicing at a byte
 *  offset can also land inside a multi-byte UTF-8 sequence.
 *  @returns {string} */
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

/** A `key=value` token — the columnar format's structural shape. */
const PAIR_TOKEN = /^[\w.[\]-]+=/;
/** The columnar header before the first pair: `ERROR <iso> +Nms`. Matching it
 *  explicitly (not "skip to the first pair") keeps the scan out of the message
 *  on a line that carries no pairs at all. */
const HEADER_TOKEN = /^(?:[A-Z]+|[+-]?\d[\w.:+-]*)$/;

/**
 * The human part of an ERROR line.
 * - logfmt: the `error=` value — quoted content when quoted, else the rest of
 *   the line (an unquoted engine error is a sentence, not one token, and it is
 *   conventionally last).
 * - columnar: everything after the STRUCTURAL PREFIX RUN at the line's start
 *   (`ERROR <iso> +Nms service=… id=ses_…`), which is exactly where the message
 *   begins. Deliberately not "after the LAST key=value on the line" (W10
 *   round-1 review B2): an engine error naming a setting mid-sentence — `could
 *   not parse foo=bar in the config` — would lose everything before it. Once
 *   the prefix run ends, the rest of the line is text, `=` and all.
 * - neither: the whole line, so an unrecognized future format degrades to
 *   "slightly noisy" rather than to silence.
 */
function extractMessage(line) {
  const quoted = /\berror="([^"]*)"/.exec(line);
  if (quoted) { return quoted[1]; }
  const bare = /\berror=(?!")(.*)$/.exec(line);
  if (bare) { return bare[1]; }
  const tokens = line.trim().split(/\s+/);
  let prefixEnd = -1; // index of the last structural token at the line's start
  for (let i = 0; i < tokens.length; i++) {
    if (PAIR_TOKEN.test(tokens[i])) { prefixEnd = i; continue; }
    // Header tokens count only BEFORE the first pair; after it, the message.
    if (prefixEnd === -1 && HEADER_TOKEN.test(tokens[i])) { continue; }
    break;
  }
  const tail = tokens.slice(prefixEnd + 1).join(' ');
  return tail || (prefixEnd === -1 ? line : '');
}

/** One line, no newlines/tabs, at most MAX_EXCERPT_CHARS characters. */
function collapseExcerpt(text) {
  const oneLine = String(text === undefined || text === null ? '' : text)
    .replace(/\s+/g, ' ').trim();
  if (oneLine.length <= MAX_EXCERPT_CHARS) { return oneLine; }
  return `${oneLine.slice(0, MAX_EXCERPT_CHARS - 1)}…`;
}

/** An id character. MEASURED (2026-08-25) over this machine's own engine logs:
 *  369 distinct ids, each exactly `ses_` + 26 characters, every one of those 26
 *  drawn from `[A-Za-z0-9]` — no `-`, `_`, or `.`. */
function isIdCharCode(code) {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

/**
 * Does `line` mention session `needle` as a WHOLE id?
 *
 * `String.includes` is wrong here: ids share prefixes, so `ses_abc` matches
 * `ses_abc123`'s line and a leg would quote a stranger's failure as its own
 * (W10 round-1 review A1). The id must END at the match — next character not an
 * id character, or end of line. A char-code boundary test rather than a
 * per-line regex: this runs over every line of up to 4 tail reads, once per
 * dead seat in a wave.
 */
function mentionsSession(line, needle) {
  let from = 0;
  for (;;) {
    const at = line.indexOf(needle, from);
    if (at === -1) { return false; }
    const after = at + needle.length;
    if (after >= line.length || !isIdCharCode(line.charCodeAt(after))) { return true; }
    from = at + 1;
  }
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
    if (mentionsSession(line, needle) && isErrorLine(line)) { return line; }
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
 *   src/utils/auth-json.js. Tests point this at a synthetic fixture tree. When
 *   given it is the ONLY dir searched — an explicit override is a statement,
 *   not one more candidate.
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
    const dirs = options.dataDir
      ? [path.join(options.dataDir, 'opencode', 'log')]
      : existingEngineLogDirs(options.env || process.env, fsImpl);
    if (!dirs.length) { return null; }
    const needle = sessionId.startsWith('ses_') ? sessionId : `ses_${sessionId}`;
    for (const file of candidateLogFiles(dirs, fsImpl)) {
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

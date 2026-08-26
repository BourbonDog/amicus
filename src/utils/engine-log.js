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
 * below. Reading ONE file's tail and finding the newest usable line in it is
 * `./engine-log-tail.js`, extracted in PR #206's fix round. This file is what
 * is left of the I/O half: which files to open, in what order, the total bytes
 * one lookup may spend — and how long one scan is reused (#201 tail C2).
 *
 * THAT REUSE SERVES HITS ONLY (PR #206 round-1 A1+B2). A MISS re-lists and
 * re-reads before it is believed, because the engine writes a leg's error WHEN
 * that leg dies — possibly after the cached scan, possibly into a file it has
 * only just rolled over to — so an absence in a previous call's listing and
 * tails is not an absence on disk. The accepted residual runs the other way,
 * and round 3 states its REAL bound. What a warm HIT serves is the
 * newest-for-THIS-SESSION line as of the moment the slot was built, so the
 * TTL bounds the MISSED WINDOW — lines written in the last ≤10 seconds — and
 * bounds nothing about the AGE of what is served: the GAP between the quoted
 * line and the line it misses is unbounded, because the cached answer can be
 * arbitrarily old and still have been newest when it was read. A minutes-old
 * error can therefore be quoted while a fatal line written two seconds ago
 * sits unread. What it quotes is still a genuine ERROR line for THIS leg,
 * which is a true diagnostic; suppression — reporting silence while the cause
 * sits on disk unread — is the failure this module exists to end.
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
const { newestExcerptInFile } = require('./engine-log-tail');

/**
 * The TOTAL tail bytes one lookup may read across all candidates — 8 full tail
 * reads' worth (`engine-log-tail.js :: MAX_TAIL_BYTES`, 256 KiB). The bound that
 * used to sit here was "the 3 newest files by mtime", and it broke exactly where
 * this module matters most (round-2 review
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
 * shared cache would quietly break it. `engineErrorForSession` also DROPS the
 * live slot behind a MISS, so the pass after one builds a new one.
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
    const key = dirs.join('\0');
    // TWO passes at most. Pass 1 may run on a WARM slot — the listing and tails
    // another seat that died in the same window already read (#201 tail C2, see
    // SCAN_CACHE_TTL_MS): the SCAN is memoized, never the ANSWER, so each seat
    // still walks the lines for its OWN id. A HIT off that slot is served; a
    // MISS is not (PR #206 round-1 A1+B2, see the module header) — pass 2 drops
    // the slot and re-lists and re-reads before believing the absence.
    for (let pass = 0; pass < 2; pass++) {
      const slot = scanSlot(fsImpl, key);
      const cold = !slot.files; // a slot built just now carries no listing yet
      if (cold) { slot.files = candidateLogFiles(dirs, fsImpl); }
      // Newest first, reading until the answer turns up or the byte budget is
      // spent — NOT "the N newest files" (round-2 review B1, see MAX_SCAN_BYTES).
      let budget = MAX_SCAN_BYTES;
      for (const file of slot.files) {
        if (budget <= 0) { break; }
        const found = newestExcerptInFile(file, needle, fsImpl, budget, slot.tails);
        budget -= found.bytes;
        if (found.excerpt) { return found.excerpt; }
      }
      if (cold) { break; } // this pass read the disk itself: nothing to distrust
      scanCaches.delete(fsImpl);
    }
    return null;
  } catch (_e) {
    return null; // a diagnostic read must never become the failure it reports on
  }
}

// The line-shape helpers are RE-EXPORTED from their new home in
// `engine-log-parse.js` so this module stays the single import site a consumer
// needs (tests/engine-log.test.js pins that they are the same function objects,
// not copies). The scan budget and the TTL beside it — like the tail bound now
// in `engine-log-tail.js` — are deliberately NOT exported: nothing outside
// consumes them, and a constant in a `Key Exports` cell reads as a function it
// is not.
module.exports = {
  engineErrorForSession,
  engineLogDirCandidates,
  isErrorLine,
  extractMessage,
  collapseExcerpt,
  mentionsSession,
  lineIsAboutSession,
};

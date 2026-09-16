/**
 * @module utils/alias-notice-state
 * #238 D5 — the awareness layer's machine state, kept OUT of config.json.
 *
 * `alias-notice-state/` in the config dir holds one file per stamp the exit
 * hook (utils/alias-notice.js) writes — `last-notified.json` (Q5: the notice
 * fires at most once a day) and `last-refresh-spawned.json` (R-P4-11: one
 * background refresh start per day), each `{ "at": <epoch ms> }` — plus
 * `last-refresh.log`, the detached child's own output (R-P4-19). Council #254:
 * stamping into config.json meant a whole-file truncate-and-write of the USER's
 * config at routine exits (round 1); one merged state file meant a
 * read-merge-write that could drop the other stamp when two exits raced
 * (round 2). One file per stamp has no merge step: concurrent writers of the
 * same stamp write the same value milliseconds apart, and nothing crosses
 * keys. Each write is atomic (utils/atomic-write.js :: writeFileAtomic —
 * temp + rename, a crash mid-write leaves the old file). The directory is
 * machine-owned and safe to delete (the notice may fire once more, a refresh
 * may start once more). What no file layout removes is the same-instant
 * check-then-act race — two TTY exits within the same few milliseconds — whose
 * only consequence is one duplicate line or one duplicate idempotent refresh.
 * The user's own settings stay in config: `aliasReview.autoRefresh` (Q8) and
 * `aliasReview.dismissed` (D7); the hook only ever READS config.json.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('./atomic-write');

const STATE_DIR = 'alias-notice-state';
const FILES = { lastNotified: 'last-notified.json', lastRefreshSpawned: 'last-refresh-spawned.json' };

/** @returns {string} the state DIRECTORY's absolute path — beside the catalog cache, AMICUS_CONFIG_DIR-aware (config.js :: getConfigDir) */
function noticeStatePath() {
  return path.join(require('./config').getConfigDir(), STATE_DIR);
}

/** @returns {string} where the detached refresh child's stdout+stderr go (truncated per run) */
function refreshLogPath() {
  return path.join(noticeStatePath(), 'last-refresh.log');
}

/**
 * @returns {{lastNotified: number|null, lastRefreshSpawned: number|null}} the stamps on disk;
 *   a missing, corrupt or non-numeric file reads as null — never throws
 */
function readNoticeState() {
  const out = { lastNotified: null, lastRefreshSpawned: null };
  for (const key of Object.keys(FILES)) {
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(noticeStatePath(), FILES[key]), 'utf8'));
      if (doc && typeof doc.at === 'number') { out[key] = doc.at; }
    } catch { /* missing or corrupt: this stamp reads as never */ }
  }
  return out;
}

/**
 * Write each stamp in `patch` to its own file atomically; a null value removes that file.
 * @param {{lastNotified?: number|null, lastRefreshSpawned?: number|null}} patch only the keys present are touched
 * @returns {boolean} true when every write landed — the caller's receipt (R-P4-11, R-P4-15)
 */
function writeNoticeState(patch) {
  try {
    fs.mkdirSync(noticeStatePath(), { recursive: true, mode: 0o700 });
    for (const key of Object.keys(FILES)) {
      if (!Object.prototype.hasOwnProperty.call(patch, key)) { continue; }
      const file = path.join(noticeStatePath(), FILES[key]);
      if (patch[key] === null) { fs.rmSync(file, { force: true }); continue; }
      writeFileAtomic(file, JSON.stringify({ at: patch[key] }, null, 2) + '\n', { mode: 0o600 });
    }
    return true;
  } catch { return false; }
}

module.exports = { noticeStatePath, refreshLogPath, readNoticeState, writeNoticeState };

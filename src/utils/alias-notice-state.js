/**
 * @module utils/alias-notice-state
 * #238 D5 — the awareness layer's machine state, kept OUT of config.json.
 *
 * `alias-notice-state.json` in the config dir holds the two timestamps the exit
 * hook (utils/alias-notice.js) writes: `lastNotified` (Q5 — the notice fires
 * at most once a day) and `lastRefreshSpawned` (R-P4-11 — one background
 * refresh start per day). Council #254 round 1 (A2/D5, A1/D3): stamping them
 * into config.json meant a whole-file truncate-and-write of the USER's config
 * at the exit of routine commands — a lost-update window against any
 * concurrent `amicus` write, and a D6 normalization side effect at every
 * first stamp. Here the write is atomic (utils/atomic-write.js ::
 * writeFileAtomic — temp + rename, so a crash mid-write leaves the old file),
 * the file is machine-owned and safe to delete (the notice may fire once more,
 * a refresh may start once more), and the hook only ever READS config.json.
 * The user's own settings stay in config: `aliasReview.autoRefresh` (Q8) and
 * `aliasReview.dismissed` (D7).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('./atomic-write');

const STATE_FILE = 'alias-notice-state.json';

/** @returns {string} the state file's absolute path — beside the catalog cache, AMICUS_CONFIG_DIR-aware (config.js :: getConfigDir) */
function noticeStatePath() {
  return path.join(require('./config').getConfigDir(), STATE_FILE);
}

/**
 * @returns {{lastNotified: number|null, lastRefreshSpawned: number|null}} the stamps on disk;
 *   a missing, corrupt or non-numeric field reads as null — never throws
 */
function readNoticeState() {
  const out = { lastNotified: null, lastRefreshSpawned: null };
  try {
    const doc = JSON.parse(fs.readFileSync(noticeStatePath(), 'utf8'));
    for (const k of Object.keys(out)) { if (doc && typeof doc[k] === 'number') { out[k] = doc[k]; } }
  } catch { /* missing or corrupt: every stamp reads as never */ }
  return out;
}

/**
 * Merge `patch` onto the stamps on disk and write the file atomically.
 * @param {{lastNotified?: number|null, lastRefreshSpawned?: number|null}} patch a null value clears that stamp
 * @returns {boolean} true when the write landed — the caller's receipt (R-P4-11, R-P4-15)
 */
function writeNoticeState(patch) {
  try {
    const next = { ...readNoticeState(), ...patch };
    fs.mkdirSync(path.dirname(noticeStatePath()), { recursive: true, mode: 0o700 });
    writeFileAtomic(noticeStatePath(), JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
    return true;
  } catch { return false; }
}

module.exports = { noticeStatePath, readNoticeState, writeNoticeState };

// src/sidecar/heartbeat.js
'use strict';
// HEARTBEAT_INTERVAL + createHeartbeat — moved verbatim from session-utils.js
// (size-gate split, spec 2026-09-11 §4 PR 2: that file was already at the
// 300-line ceiling before this task's additions). Zero behavior change; both
// re-exported from session-utils.js's existing module.exports, so no caller
// (start.js, resume.js, continue.js, fanout.js, index.js, and their tests)
// needs to change — see tests/sidecar/session-utils.test.js and
// tests/sidecar/start.test.js, which exercise these through that re-export.

/** Standard heartbeat interval in milliseconds */
const HEARTBEAT_INTERVAL = 15000;

/**
 * Create a heartbeat that writes status to stderr periodically.
 * When sessionDir is provided, includes message count and latest activity.
 *
 * @param {number} [interval=HEARTBEAT_INTERVAL] - Interval in milliseconds
 * @param {string} [sessionDir] - Session directory to read progress from
 * @returns {{ stop: () => void }}
 */
function createHeartbeat(interval = HEARTBEAT_INTERVAL, sessionDir) {
  const startTime = Date.now();
  const intervalId = setInterval(() => {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    const ts = mins > 0 ? `${mins}m${secs}s` : `${secs}s`;

    if (sessionDir) {
      const { readProgress } = require('./progress');
      const progress = readProgress(sessionDir);
      process.stderr.write(`[amicus] ${ts} | ${progress.messages} messages | ${progress.latest}\n`);
    } else {
      process.stderr.write(`[amicus] still running... ${ts} elapsed\n`);
    }
  }, interval);

  return {
    stop() {
      clearInterval(intervalId);
    }
  };
}

module.exports = { HEARTBEAT_INTERVAL, createHeartbeat };

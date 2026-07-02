'use strict';

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');

const DEFAULT_INTERVAL_MS = 2000;

/**
 * Watch a session's metadata.json for an external abort marker
 * (status === 'aborted', written by `amicus abort` or MCP amicus_abort) and
 * tear the interactive session down when it appears:
 *   1. best-effort server-side abortSession (stops token spend immediately),
 *   2. SIGTERM the Electron process (killIfAlive).
 * Teardown then completes through the EXISTING Electron close handler
 * (mirror.stop → usage persist, server.close) — this watcher triggers
 * teardown but never owns it. Best-effort: read/parse errors keep polling.
 *
 * @param {object} opts
 * @param {string} opts.sessionDir
 * @param {() => Promise<void>} opts.abortOpenCodeSession
 * @param {() => void} opts.killElectron
 * @param {number} [opts.intervalMs=2000]
 * @returns {{ stop: () => void, wasAborted: () => boolean }}
 */
function startAbortWatch({ sessionDir, abortOpenCodeSession, killElectron, intervalMs = DEFAULT_INTERVAL_MS }) {
  const metaPath = path.join(sessionDir, 'metadata.json');
  let timer = null;
  let stopped = false;
  let aborted = false;

  const schedule = () => {
    if (stopped) { return; }
    timer = setTimeout(tick, intervalMs);
    if (timer.unref) { timer.unref(); }
  };

  async function tick() {
    if (stopped) { return; }
    try {
      if (fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        if (meta.status === 'aborted') {
          aborted = true;
          stopped = true;
          logger.info('External abort marker detected — tearing down interactive session', { sessionDir });
          try { await abortOpenCodeSession(); } catch (err) {
            logger.warn('abortSession failed during interactive abort', { error: err.message });
          }
          try { killElectron(); } catch (err) {
            logger.warn('Electron kill failed during interactive abort', { error: err.message });
          }
          return; // teardown continues via the Electron close handler
        }
      }
    } catch (err) {
      logger.debug('Abort watch poll failed (best-effort)', { error: err.message });
    }
    schedule();
  }

  schedule();
  return {
    stop() { stopped = true; if (timer) { clearTimeout(timer); timer = null; } },
    wasAborted() { return aborted; },
  };
}

/**
 * Fold the abort-watch outcome into the runInteractive result so
 * resolveTerminalState() maps a marker-triggered GUI teardown to 'aborted' —
 * never 'error' (SIGTERM'd Electron exits non-zero) and never 'complete'
 * (Electron exiting 0 after the marker landed).
 */
function markResultAborted(result, wasAborted) {
  if (wasAborted) {
    result.aborted = true;
    result.completed = false;
  }
  return result;
}

/**
 * Best-effort, ONE-SHOT read of metadata.json to check for a durable
 * 'aborted' marker written by `amicus abort` / MCP amicus_abort.
 *
 * Closes a race the poll-based startAbortWatch cannot: the marker can land
 * and Electron can exit naturally before the watch's next ~2s tick (or the
 * close handler can already be past markResultAborted, awaiting
 * mirror.stop()). In that window abortWatch.wasAborted() reads false even
 * though the session WAS aborted, so resolveTerminalState resolves
 * 'complete' and finalizeSession clobbers the on-disk 'aborted' status.
 * Callers should OR this into their aborted flag immediately before
 * markResultAborted. Missing/corrupt metadata reads as false (best-effort,
 * matches startAbortWatch's own error handling).
 *
 * @param {string} sessionDir
 * @returns {boolean} true iff metadata.json exists and status === 'aborted'
 */
function readAbortedMarker(sessionDir) {
  try {
    const metaPath = path.join(sessionDir, 'metadata.json');
    if (!fs.existsSync(metaPath)) { return false; }
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    return meta.status === 'aborted';
  } catch (err) {
    logger.debug('readAbortedMarker: metadata read failed (best-effort)', { error: err.message });
    return false;
  }
}

module.exports = { startAbortWatch, markResultAborted, readAbortedMarker, DEFAULT_INTERVAL_MS };

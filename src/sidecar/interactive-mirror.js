// src/sidecar/interactive-mirror.js
'use strict';

const path = require('path');
const { createMirrorState, mirrorMessages, logMessage } = require('./conversation-mirror');
const { writeProgress } = require('./progress');
const { sumPerMessageUsage } = require('../utils/pricing');
const { logger } = require('../utils/logger');

// Cap on the final flush poll during stop() so a wedged server cannot hang teardown.
const STOP_FLUSH_TIMEOUT_MS = 3000;

/**
 * Poll the OpenCode session and mirror it to conversation.jsonl + progress.json
 * live, exactly like headless. Best-effort and non-blocking — a poll/write error
 * never throws into the GUI session.
 *
 * @param {object} opts
 * @param {() => Promise<Array>} opts.getMessages
 * @param {string} opts.sessionDir
 * @param {number} [opts.intervalMs=2000]
 * @param {() => void} [opts.onActivity]
 * @param {() => string} [opts.now]
 * @param {number} [opts.stopFlushTimeoutMs=3000] - cap on the final flush poll in stop()
 * @returns {{ stop: () => Promise<{usage: object|null}> }}
 */
function startInteractiveMirror({ getMessages, sessionDir, intervalMs = 2000, onActivity, now, stopFlushTimeoutMs = STOP_FLUSH_TIMEOUT_MS }) {
  const state = createMirrorState();
  const conversationPath = path.join(sessionDir, 'conversation.jsonl');
  let timer = null;
  let stopped = false;

  async function pollOnce() {
    try {
      const messages = await getMessages();
      const mr = mirrorMessages(messages, state, { now });
      mr.appendLines.forEach(line => logMessage(conversationPath, line));
      mr.progressUpdates.forEach(p => writeProgress(sessionDir, p.stage, p.extra));
      if (mr.appendLines.length > 0 && onActivity) { onActivity(); }
    } catch (err) {
      logger.debug('Interactive mirror poll failed (best-effort)', { error: err.message });
    }
  }

  const schedule = () => {
    if (stopped) { return; }
    timer = setTimeout(tick, intervalMs);
    if (timer.unref) { timer.unref(); }
  };
  async function tick() {
    if (stopped) { return; }
    await pollOnce();
    schedule();
  }
  schedule();

  return {
    async stop() {
      stopped = true;
      if (timer) { clearTimeout(timer); timer = null; }
      // Final flush, but never let a wedged server hang teardown: race the poll
      // against a short timeout so stop() always resolves promptly.
      await Promise.race([
        pollOnce(),
        new Promise(resolve => {
          const t = setTimeout(resolve, stopFlushTimeoutMs);
          if (t.unref) { t.unref(); }
        }),
      ]);
      try { writeProgress(sessionDir, 'complete'); } catch { /* best-effort */ }
      let usage = null;
      try { usage = sumPerMessageUsage(state.usageByMsg); } catch { /* best-effort */ }
      return { usage };
    },
  };
}

module.exports = { startInteractiveMirror };

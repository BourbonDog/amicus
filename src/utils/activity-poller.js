'use strict';

/**
 * Poll an async status source on an interval and fire onActivity() on any non-idle state.
 * Best-effort: getStatus errors are swallowed and polling continues. Timers are unref'd
 * so the poller never keeps the process alive.
 *
 * @param {object} opts
 * @param {() => Promise<{type?:string}>} opts.getStatus
 * @param {() => void} opts.onActivity
 * @param {number} [opts.intervalMs=30000]
 * @returns {{ stop: () => void }}
 */
function createActivityPoller({ getStatus, onActivity, intervalMs = 30000 }) {
  let timer = null;
  let stopped = false;

  const schedule = () => {
    if (stopped) { return; }
    timer = setTimeout(tick, intervalMs);
    if (timer.unref) { timer.unref(); }
  };

  async function tick() {
    if (stopped) { return; }
    try {
      const status = await getStatus();
      if (status && status.type && status.type !== 'idle') { onActivity(); }
    } catch { /* best-effort */ }
    schedule();
  }

  schedule();
  return {
    stop() {
      stopped = true;
      if (timer) { clearTimeout(timer); timer = null; }
    },
  };
}

/** SIGTERM a child process if it exists and isn't already killed. */
function killIfAlive(child) {
  if (child && !child.killed) { child.kill('SIGTERM'); }
}

module.exports = { createActivityPoller, killIfAlive };

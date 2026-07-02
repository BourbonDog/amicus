'use strict';

/**
 * Marker-first abort coordination (Phase 3 abort overhaul).
 *
 * Contract: the caller writes the metadata marker (status='aborted') FIRST,
 * gives the running process a grace window to honor it (the headless loop and
 * the interactive abort watch both poll metadata every ~2s and tear down
 * gracefully — mirror flush, usage persist, server-side abortSession), and
 * only SIGTERMs a process that is STILL alive after the grace window.
 *
 * Windows: process.kill() is TerminateProcess — no handlers run — but libuv
 * job objects kill non-detached children with the parent, so the fallback
 * kill still reaps the tree. The grace window is what keeps the common path
 * graceful.
 */

const { logger } = require('./logger');

/** Grace window before the fallback SIGTERM. Env-overridable (tests). */
function abortGraceMs() {
  const n = Number(process.env.AMICUS_ABORT_GRACE_MS);
  return (Number.isFinite(n) && n > 0) ? n : 5000;
}

/**
 * @returns {boolean} true when a process with this pid exists. EPERM means
 * the pid exists but the caller lacks permission to signal it — that's
 * ALIVE, not dead; only ESRCH (and other non-EPERM errors) mean dead.
 */
function isAlive(pid, kill = process.kill.bind(process)) {
  if (!pid) { return false; }
  try {
    kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM' ? true : false;
  }
}

/** SIGTERM a pid, swallowing ESRCH. @returns {boolean} signal was sent */
function killPidBestEffort(pid, kill = process.kill.bind(process)) {
  if (!pid) { return false; }
  try { kill(pid, 'SIGTERM'); return true; } catch (err) {
    if (err.code !== 'ESRCH') {
      logger.warn('Failed to kill process', { pid, error: err.message });
    }
    return false;
  }
}

/**
 * Wait up to graceMs for the pids to exit on their own (marker-honoring
 * teardown), then SIGTERM any survivor. Early-exits as soon as every target
 * is gone, so a process that honors the marker in ~2s never sees a signal.
 *
 * NOTE: the poll timer is deliberately REF'D. The CLI awaits this call and
 * must stay alive through the grace window; callers that must not block
 * (MCP handler) fire-and-forget the returned promise instead.
 *
 * @param {number|null|Array<number|null>} pids
 * @param {{graceMs?:number, pollMs?:number, deps?:{kill?:Function, sleep?:Function}}} [opts]
 * @returns {Promise<{killed:number[], exited:number[]}>}
 */
async function waitThenKill(pids, opts = {}) {
  const graceMs = opts.graceMs !== undefined ? opts.graceMs : abortGraceMs();
  const pollMs = opts.pollMs || 250;
  const deps = opts.deps || {};
  const kill = deps.kill || process.kill.bind(process);
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));

  const targets = [...new Set((Array.isArray(pids) ? pids : [pids]).filter(Boolean))];
  const deadline = Date.now() + graceMs;
  let remaining = targets.filter((pid) => isAlive(pid, kill));
  while (remaining.length > 0 && Date.now() < deadline) {
    await sleep(pollMs);
    remaining = remaining.filter((pid) => isAlive(pid, kill));
  }
  const killed = remaining.filter((pid) => killPidBestEffort(pid, kill));
  return {
    killed,
    exited: targets.filter((pid) => !remaining.includes(pid)),
  };
}

module.exports = { abortGraceMs, isAlive, killPidBestEffort, waitThenKill };

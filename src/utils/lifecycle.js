'use strict';

/**
 * Process-lifecycle helpers for the one-shot CLI commands (F3 #15).
 *
 * One-shot commands must return control to the shell when their work is done.
 * If a stray handle (e.g. the OpenCode Go server) keeps Node's event loop
 * alive, the force-exit watchdog guarantees the process still exits.
 */

// One-shot commands spin up the OpenCode server and must return to the shell
// when done (F3 #15). Deliberately EXCLUDED: `mcp` (long-lived server), and
// `setup`/`update` (no OpenCode server to leak, and `setup` can be a long-lived
// interactive Electron flow that must never be force-exited).
const ONE_SHOT_COMMANDS = new Set(['start', 'continue', 'resume', 'list', 'status', 'read', 'abort', 'fanout', 'models', 'key', 'council', 'doctor', 'spend', 'provider', /* provider: runs a 2s socket probe (M11) — arm the watchdog so a stray handle can't hang the shell */
  'init' /* init (Task 15): runs the full doctor-check suite (network probes, OpenCode binary scan) via summarizeDoctor's runDoctorChecks() call — same lingering-handle risk 'doctor' already guards against */]);

/** @param {string} command @returns {boolean} */
function isOneShotCommand(command) {
  return ONE_SHOT_COMMANDS.has(command);
}

/**
 * Arm an unref'd timer that force-exits if the loop has not drained by `ms`.
 * Natural drain still wins: an unref'd timer never holds the process open, so
 * a clean exit happens before this fires. Injectable exit/log for tests.
 *
 * @param {number} [code=0]
 * @param {number} [ms=1500]
 * @param {{exit?: Function, log?: Function}} [deps]
 * @returns {NodeJS.Timeout}
 */
function armExitWatchdog(code = 0, ms = 1500, deps = {}) {
  const exit = deps.exit || process.exit;
  const log = deps.log;
  const t = setTimeout(() => {
    if (log) { log('force-exit watchdog fired — a handle kept the event loop alive', { code, ms }); }
    exit(code);
  }, ms);
  if (t.unref) { t.unref(); }
  return t;
}

/**
 * An `exit` hook for armExitWatchdog that REAPS an OpenCode server this process
 * is using but does not own, on its way out (v4.4.1 fix wave, finding F3).
 *
 * The force-exit path is the one place where "not ours to close" stops being the
 * safe answer. A wave running on an injected server deliberately never closes it
 * — the owner does, once, in its own finalize. But if the watchdog fires first
 * the parent dies anyway, and the Go server survives it: an orphan still holding
 * the OpenCode SQLite lock that the per-run shared server exists to stop
 * contending on. Before the external-server seam, fanout's own close() covered
 * this by accident; this restores it deliberately.
 *
 * SIGTERM only, and synchronous: process.exit cannot await server.close()'s
 * escalation, so this sends the one signal that fits in the window and gets out
 * of the way. Never signals this process, and never lets a dead/absent pid throw
 * — the exit must happen regardless.
 *
 * @param {{goPid?: number|null}|null} server the injected server handle
 * @param {{kill?: Function, exit?: Function}} [deps] test seams
 * @returns {(code: number) => void}
 */
function exitReaping(server, deps = {}) {
  return (code) => {
    // Resolved at CALL time, not creation time: this hook is built the instant a
    // signal lands and invoked up to 10s later, so binding process.kill/exit
    // early would freeze whatever was installed at signal time.
    const kill = deps.kill || ((p, sig) => process.kill(p, sig));
    const exit = deps.exit || ((c) => process.exit(c));
    const pid = server && server.goPid;
    if (pid && pid !== process.pid) {
      try { kill(pid, 'SIGTERM'); } catch { /* already gone: nothing to reap */ }
    }
    exit(code);
  };
}

module.exports = { isOneShotCommand, armExitWatchdog, exitReaping, ONE_SHOT_COMMANDS };

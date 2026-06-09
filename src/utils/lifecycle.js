'use strict';

/**
 * Process-lifecycle helpers for the one-shot CLI commands (F3 #15).
 *
 * One-shot commands must return control to the shell when their work is done.
 * If a stray handle (e.g. the OpenCode Go server) keeps Node's event loop
 * alive, the force-exit watchdog guarantees the process still exits.
 */

const ONE_SHOT_COMMANDS = new Set(['start', 'continue', 'resume', 'list', 'read', 'abort']);

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

module.exports = { isOneShotCommand, armExitWatchdog, ONE_SHOT_COMMANDS };

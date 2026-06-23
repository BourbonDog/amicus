'use strict';

/**
 * Map a runHeadless result to the canonical terminal status + process exit code.
 * Single source of truth so start.js, the signal handler, and the idle backstop
 * never disagree. Error wins over all other flags; signal callers pass the signal
 * name for the 130/143 convention.
 *
 * @param {{completed?:boolean,timedOut?:boolean,aborted?:boolean,error?:any}|null} result
 * @param {string} [signal] - 'SIGINT' | 'SIGTERM' | 'SIGBREAK' for signal aborts
 * @returns {{status:'complete'|'error'|'timed-out'|'aborted', exitCode:number}}
 */
function resolveTerminalState(result, signal) {
  if (!result || result.error) { return { status: 'error', exitCode: 1 }; }
  if (result.aborted) {
    const exitCode = signal === 'SIGINT' ? 130
      : (signal === 'SIGTERM' || signal === 'SIGBREAK') ? 143
      : 2;
    return { status: 'aborted', exitCode };
  }
  if (result.timedOut) { return { status: 'timed-out', exitCode: 2 }; }
  if (result.completed) { return { status: 'complete', exitCode: 0 }; }
  return { status: 'error', exitCode: 1 };
}

module.exports = { resolveTerminalState };

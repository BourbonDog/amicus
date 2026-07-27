// src/council/run-finalize.js
'use strict';

/**
 * @module council/run-finalize
 * The TERMINAL half of run.js's finalize(): the whole exit-code vocabulary
 * (signal → code, code → status, and the degradation that resolves the run's
 * FINAL code), the last-chance unknown-spend notice, run.json's terminal
 * checkpoint, the run-terminal event and the on-complete hook. Extracted from
 * run.js for the 300-line size gate (v4.4.1 fix wave) — run.js keeps the half
 * that must stay in the closure (uninstalling signals and releasing the run's
 * shared server).
 *
 * ⚠️ BOOKKEEPING MUST NEVER SINK A RUN THAT ALREADY FINISHED. run.js documents
 * "Never rejects for run errors: always resolves {exitCode, run}", but every
 * `return finalize(…)` in it is a bare `return` of a promise — which, by async
 * semantics, does NOT route through the enclosing catch. So a throw from the
 * terminal checkpoint (an unwritable run dir, a full disk) escaped runCouncil as
 * a REJECTION, past its own contract, and past run.js's `catch`. Worse, the
 * throw landed between the server release and the caller, so the caller had no
 * result to act on. Everything here is therefore guarded: a failure is announced
 * on stderr and the run still resolves with a document whose terminal fields are
 * authoritative.
 */

const { emitRunTerminal } = require('../observe/events');
const { fireCouncilOnComplete } = require('../observe/on-complete');
const runState = require('./run-state');

/** Abort signal → the run's exit code. Lives here with the rest of the exit-code
 *  vocabulary; re-exported from ./run (its long-standing public home). */
const SIGNAL_EXIT = { SIGINT: 130, SIGTERM: 143, SIGBREAK: 143 };

/**
 * run.json status for a council exit code (spec §4 degradation table).
 * @param {number} code @returns {string}
 */
function statusForExit(code) {
  return (code === 130 || code === 143) ? 'aborted'
    : code === 0 ? 'complete' : code === 1 ? 'error' : 'partial';
}

/**
 * The run's FINAL exit code, and the ONE place a would-be-clean run degrades.
 *
 * Precedence, highest first:
 *   1. a signal — an aborted run reports how it was killed, nothing else;
 *   2. a non-zero code the driver already decided (1 = error, 2 = degraded) —
 *      never re-labelled, because a failure is not a degradation;
 *   3. `degraded.value` — the flag a shrunken bench, a thin cross-review, a dead
 *      debate leg and (v4.4.1 CA-6) an inexact total under a `--max-cost`
 *      ceiling all already set. 0 becomes 2.
 *
 * ⚠️ CA-6 is wired here rather than at the ceiling itself ON PURPOSE. The
 * standing owner ruling — "I don't want hitting a ceiling to stop us from
 * solving real problems" — is absolute: `overBudget()` still trips on KNOWN
 * spend only and a ceiling still never blocks a run. What changes is only what
 * the run CLAIMS on the way out. Exit 0 means "clean, and inside your ceiling";
 * a run that published a total it knows is a floor has not earned that.
 *
 * @param {{signalled: number|null, exitCode: number, degraded?: {value: boolean},
 *   inexactUnderCeiling?: () => boolean}} args
 * @returns {number}
 */
function resolveTerminalExit({ signalled, exitCode, degraded, inexactUnderCeiling }) {
  if (signalled) { return signalled; }
  if (degraded && inexactUnderCeiling && inexactUnderCeiling()) { degraded.value = true; }
  return (exitCode === 0 && degraded && degraded.value) ? 2 : exitCode;
}

/**
 * Write the run's terminal record and fire its terminal observers.
 *
 * @param {{o: object, code: number, error?: object|null,
 *   noticeUnknownSpend: Function, usageBlock: Function,
 *   deps?: {fireOnCompleteFn?: Function, write?: Function}}} args
 * @returns {Promise<object>} the run document — always usable, even when the
 *   write failed (the on-disk doc merged under the authoritative terminal fields).
 */
async function writeRunTerminal({ o, code, error, noticeUnknownSpend, usageBlock, deps = {} }) {
  const status = statusForExit(code);
  const terminal = { status, exitCode: code, error: error || null };
  try {
    noticeUnknownSpend(); // v4.4: never finish a run silently short (run-budget.js)
    const run = runState.checkpoint(o.runDir, {
      ...terminal, usage: usageBlock(), completedAt: new Date().toISOString(),
    });
    emitRunTerminal(o.runDir, o.runId, status, code, o.follow);
    await (deps.fireOnCompleteFn || fireCouncilOnComplete)(o.onComplete, run,
      { runId: o.runId, runDir: o.runDir, exitCode: code, project: o.project }, o.onCompleteDeps);
    return run;
  } catch (err) {
    const write = deps.write || ((s) => process.stderr.write(s));
    write(`Notice: council run bookkeeping failed at finalize: ${err.message}. The run itself `
      + `finished with exit ${code} (${status}); run.json may be incomplete.\n`);
    let onDisk = {};
    try { onDisk = runState.readRun(o.runDir) || {}; } catch { /* unreadable too */ }
    return { runId: o.runId, ...onDisk, ...terminal };
  }
}

module.exports = { statusForExit, resolveTerminalExit, writeRunTerminal, SIGNAL_EXIT };

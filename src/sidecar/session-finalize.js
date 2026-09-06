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

/**
 * Finalize a headless run by routing through resolveTerminalState — the single
 * source of truth shared with the CLI start.js path. An errored run writes
 * status='error' + reason (and an EXISTING 0-byte summary.md so amicus_read hits
 * its file-exists branch); every other state persists the (possibly partial)
 * summary with the correct terminal status. Never defaults a failed run to
 * 'complete'. Used by the shared-server MCP .then handler (#36).
 *
 * @param {string} sessionDir
 * @param {{completed?:boolean,timedOut?:boolean,aborted?:boolean,error?:any,summary?:string}|null} result
 * @param {string} project
 * @param {object} metadata - mutated + persisted to metadata.json
 */
function finalizeHeadlessResult(sessionDir, result, project, metadata) {
  // Lazy require to avoid a circular dependency (session-utils requires nothing
  // here, but keep symmetry with start.js which also lazy-requires).
  const fs = require('fs');
  const path = require('path');
  const { finalizeSession, SessionPaths } = require('./session-utils');
  const { writeFileAtomic } = require('../utils/atomic-write');

  const terminal = resolveTerminalState(result);
  if (terminal.status === 'error') {
    // Write an existing (0-byte) summary so amicus_read hits the file-exists
    // branch and surfaces metadata.reason rather than "No summary available".
    fs.writeFileSync(SessionPaths.summaryFile(sessionDir), result && result.summary ? result.summary : '', { mode: 0o600 });
    metadata.status = 'error';
    metadata.reason = (result && result.error) ? String(result.error) : 'Incomplete';
    if (result && typeof result.finish === 'string') { metadata.finish = result.finish; } else { delete metadata.finish; } // #218 PR 3: emit-when-set; a stale one is removed (council #232 r1 B1)
    metadata.completedAt = new Date().toISOString();
    writeFileAtomic(
      path.join(sessionDir, 'metadata.json'),
      JSON.stringify(metadata, null, 2),
      { mode: 0o600 }
    );
    return;
  }
  // complete / timed-out / aborted: persist the (possibly partial) summary with
  // the resolved status. Explicit status means the #36 guard won't re-classify.
  finalizeSession(sessionDir, (result && result.summary) || '', project, metadata, { status: terminal.status, finish: result && result.finish });
}

module.exports = { resolveTerminalState, finalizeHeadlessResult };

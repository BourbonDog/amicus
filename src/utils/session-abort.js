/**
 * Session abort utilities: signal handler installation and terminal metadata writes.
 *
 * Handles two related responsibilities: (1) installing process signal handlers
 * (SIGINT, SIGTERM, SIGBREAK) that trigger abort callbacks, and (2) synchronously
 * writing terminal status to session metadata (markTerminal and markAborted).
 * These work together to ensure that when a session process is signaled, the
 * session is marked as aborted immediately, preventing orphaned sessions from
 * consuming API credits and ensuring `amicus list` reflects the true state.
 */

const fs = require('fs');
const path = require('path');

/**
 * Synchronously write a terminal status to a session's metadata. Best-effort: never throws.
 * `aborted` uses `abortedAt`; every other status uses `completedAt`.
 * @param {string} sessionDir
 * @param {'aborted'|'timed-out'|'error'|'complete'} status
 * @param {string} reason
 * @returns {boolean} true if written
 */
function markTerminal(sessionDir, status, reason) {
  try {
    const metaPath = path.join(sessionDir, 'metadata.json');
    if (!fs.existsSync(metaPath)) { return false; }
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    meta.status = status;
    meta.reason = reason;
    meta[status === 'aborted' ? 'abortedAt' : 'completedAt'] = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

/** Mark a session aborted (preserves prior behavior). */
function markAborted(sessionDir, reason) {
  return markTerminal(sessionDir, 'aborted', `Aborted (${reason})`);
}

/**
 * Register signal handlers that call onAbort(signal). Returns an uninstall fn.
 * @param {{onAbort: (signal: string) => void, signals?: string[]}} opts
 * @returns {() => void} uninstall
 */
function installSignalAbort({ onAbort, signals = ['SIGINT', 'SIGTERM', 'SIGBREAK'] }) {
  const registered = [];
  for (const sig of signals) {
    try {
      const sigHandler = () => { try { onAbort(sig); } catch { /* best-effort */ } };
      process.on(sig, sigHandler);
      registered.push({ sig, sigHandler });
    } catch { /* unsupported signal */ }
  }
  return function uninstall() {
    for (const { sig, sigHandler } of registered) { process.removeListener(sig, sigHandler); }
  };
}

/**
 * Idle-backstop teardown: mark timed-out, write a stub summary, close the owned server.
 * Returns the exit code (always 2).
 * @param {string} sessionDir
 * @param {{close: () => void}|null} server
 * @param {boolean} externalServer - when true, the server is not ours to close
 * @returns {2}
 */
function idleBackstopTeardown(sessionDir, server, externalServer) {
  try {
    markTerminal(sessionDir, 'timed-out', 'Idle backstop timeout');
    fs.writeFileSync(path.join(sessionDir, 'summary.md'),
      'Session timed out — idle backstop fired before completion.\n', { mode: 0o600 });
  } catch { /* best-effort */ }
  if (!externalServer && server) { try { server.close(); } catch { /* best-effort */ } }
  return 2;
}

module.exports = { markTerminal, markAborted, installSignalAbort, idleBackstopTeardown };

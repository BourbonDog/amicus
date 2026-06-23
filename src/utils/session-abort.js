/**
 * Session abort on process signals (F3 #20).
 *
 * When the parent process is killed (SIGTERM/SIGINT/SIGBREAK), the running
 * headless session must be aborted so no orphaned OpenCode session keeps
 * burning API credits. `markAborted` is the synchronous metadata write that
 * guarantees `amicus list` won't show an orphan afterward.
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

module.exports = { markTerminal, markAborted, installSignalAbort };

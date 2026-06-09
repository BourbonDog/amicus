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
 * Synchronously mark a session's metadata as aborted. Best-effort: never throws.
 * @param {string} sessionDir
 * @param {string} reason - e.g. a signal name
 * @returns {boolean} true if the session was marked aborted
 */
function markAborted(sessionDir, reason) {
  try {
    const metaPath = path.join(sessionDir, 'metadata.json');
    if (!fs.existsSync(metaPath)) { return false; }
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    meta.status = 'aborted';
    meta.reason = `Aborted (${reason})`;
    meta.abortedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
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

module.exports = { markAborted, installSignalAbort };

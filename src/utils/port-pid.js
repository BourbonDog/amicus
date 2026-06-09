/**
 * Cross-platform listener-PID lookup.
 *
 * Finds the PID of the process LISTENING on a local TCP port. Replaces the
 * Unix-only `lsof` call so the OpenCode Go server can be force-killed on
 * Windows too (F3 #15).
 */

const { execFileSync } = require('child_process');

/**
 * @param {number} port - TCP port to inspect
 * @returns {number|null} PID of the LISTENING process, or null if none/none found
 */
function findListenerPid(port) {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('netstat', ['-ano', '-p', 'TCP'], {
        encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      });
      for (const line of out.split(/\r?\n/)) {
        // Columns: Proto  Local  Foreign  State  PID
        const m = line.trim().match(/^TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)$/i);
        if (m && Number(m[1]) === port) { return Number(m[2]); }
      }
      return null;
    }
    const out = execFileSync('lsof', ['-ti', `:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    // take only the first PID if multiple processes share the port
    const pid = parseInt(out.split(/\s+/)[0], 10);
    return Number.isInteger(pid) ? pid : null;
  } catch {
    return null;
  }
}

module.exports = { findListenerPid };

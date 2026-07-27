/**
 * Server Setup Utilities
 *
 * Handles port management and cleanup for the OpenCode server.
 */

const { logger } = require('./logger');
const { findListenerPid } = require('./port-pid');

const DEFAULT_PORT = 4096;

/**
 * Check if a port is in use and get PID
 * @param {number} port - Port to check
 * @returns {number|null} PID or null if not in use
 */
function getPortPid(port) {
  // Delegate to the cross-platform lookup (netstat on Windows, lsof elsewhere)
  // so the port-in-use check and kill path work off Unix too.
  return findListenerPid(port);
}

/**
 * Check if a port is in use
 * @param {number} port - Port to check
 * @returns {boolean} True if port is in use
 */
function isPortInUse(port) {
  return getPortPid(port) !== null;
}

/**
 * Kill process using a port
 * @param {number} port - Port to free
 * @returns {boolean} True if process was killed or port was already free
 */
function killPortProcess(port) {
  const pid = getPortPid(port);
  if (!pid) {
    return true; // Port already free
  }

  try {
    process.kill(pid, 'SIGTERM');
    logger.debug('Killed stale process', { port, pid });
    return true;
  } catch (error) {
    logger.warn('Failed to kill process', { port, pid, error: error.message });
    return false;
  }
}

/**
 * Ensure the OpenCode server port is available
 * Kills any stale process using the port
 * @param {number} [port=4440] - Port to ensure is available
 * @returns {boolean} True if port is now available
 */
function ensurePortAvailable(port = DEFAULT_PORT) {
  if (!isPortInUse(port)) {
    return true;
  }

  logger.info('Port in use, cleaning up stale process', { port });

  if (killPortProcess(port)) {
    // Give the OS a moment to release the port
    const start = Date.now();
    while (isPortInUse(port) && Date.now() - start < 2000) {
      // Busy wait for up to 2 seconds
    }
    return !isPortInUse(port);
  }

  return false;
}

/**
 * A start failure that is a LOCK RACE, not a deterministic error.
 *
 * OpenCode opens one shared SQLite database (~/.local/share/opencode/opencode.db)
 * at startup, so two servers starting in the same instant can collide on it and
 * the loser exits 1 with `database is locked`. Measured: council run v441plan01
 * lost four of five seats in 736ms to exactly this.
 *
 * Deliberately NARROW. A missing binary, a bad key, a busy port and a config
 * error are all deterministic — retrying them only triples the latency before
 * the same failure, so they must fall straight through untouched.
 */
const LOCK_CLASS_START_FAILURE = /database is locked|database table is locked|SQLITE_BUSY/i;

/** Backoff between start attempts; 3 attempts total, ≤750ms of added latency. */
const LOCK_RETRY_DELAYS_MS = [250, 500];

/**
 * @param {Error|null} error
 * @returns {boolean} true only for a lock-class (retryable) start failure
 */
function isLockClassStartFailure(error) {
  if (!error) { return false; }
  // The real failure arrives as a message with the server's own stdout inlined
  // ("Server exited with code 1 / Server output: … database is locked"), but
  // check the usual carriers too so a wrapped/spawn-shaped error still matches.
  const carriers = [error.message, error.stderr, error.stdout, error.cause && error.cause.message];
  return carriers.some(c => typeof c === 'string' && LOCK_CLASS_START_FAILURE.test(c));
}

/**
 * Run `attempt` with a BOUNDED retry on a lock-class failure only.
 *
 * Never fails closed: the final failure is rethrown unchanged, so every caller
 * that already degrades on a start failure (runFanout writes an error wave; a
 * council run falls back to per-wave servers) degrades exactly as before —
 * just later, and far less often. This is the half of the fix that covers what
 * a per-run shared server cannot: two separate `amicus` processes, or a CLI run
 * beside a live MCP server, still contend for the same database.
 *
 * @param {(attempt: number) => Promise<T>} attempt
 * @param {{retryDelayMs?: number}} [opts] retryDelayMs: test seam — collapses
 *   every backoff to this value so a retry test does not sleep for real.
 * @returns {Promise<T>}
 * @template T
 */
async function retryOnLockRace(attempt, opts = {}) {
  const delays = opts.retryDelayMs === undefined
    ? LOCK_RETRY_DELAYS_MS
    : LOCK_RETRY_DELAYS_MS.map(() => opts.retryDelayMs);
  for (let i = 0; ; i += 1) {
    try {
      return await attempt(i);
    } catch (error) {
      if (i >= delays.length || !isLockClassStartFailure(error)) { throw error; }
      logger.warn('OpenCode server start lost a lock race — retrying', {
        attempt: i + 1, of: delays.length + 1, delayMs: delays[i], error: error.message,
      });
      await new Promise(resolve => setTimeout(resolve, delays[i]));
    }
  }
}

module.exports = {
  DEFAULT_PORT,
  LOCK_RETRY_DELAYS_MS,
  isPortInUse,
  getPortPid,
  killPortProcess,
  ensurePortAvailable,
  isLockClassStartFailure,
  retryOnLockRace
};

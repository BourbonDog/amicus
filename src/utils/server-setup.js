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

/**
 * A start failure that is a TIMEOUT, not a deterministic error.
 *
 * `@opencode-ai/sdk` rejects with `Timeout waiting for server to start after
 * ${timeout}ms` when OpenCode has not printed its listening line inside the
 * caller-supplied window (SDK default: 5000ms — see AMICUS_SERVER_START_TIMEOUT_MS
 * in src/opencode-client.js for why amicus no longer accepts that default).
 *
 * ⚠️ ADDED v4.5.2 from a field report. A start timeout is TRANSIENT — a cold
 * SQLite open on a sync-backed volume with an AV scanner attached simply takes
 * longer than the window — and is therefore *more* retryable than a lock race,
 * since retrying costs nothing but the backoff. Before this, it matched no
 * alternative in LOCK_CLASS_START_FAILURE and so fell straight through
 * `retryOnLockRace` with ZERO retries. A reporter's council degraded to per-wave
 * servers on this error and then lost its entire Stage-1 bench
 * (`COUNCIL_QUORUM: Only 0 Stage-1 review(s) survived`).
 *
 * Deliberately anchored to "…server to start". A REQUEST timeout, an ETIMEDOUT
 * connect, and a generic "timeout" are NOT this class and must not sleep here.
 */
const TIMEOUT_CLASS_START_FAILURE = /Timeout waiting for server to start/i;

/**
 * Backoff between start attempts; 5 attempts total, ≤3.75s of added latency.
 *
 * ⚠️ WIDENED from 3 attempts at 250/500ms (≤750ms) by v4.4.1 Step 10.5. 750ms is
 * thin against a multi-megabyte WAL and any concurrent process touching the same
 * OpenCode database: run v441plan02 exhausted it, the council degraded to one
 * server per wave, and then lost four of five seats to the very race the retry
 * exists to survive. The wait is bounded and paid at most once per acquisition;
 * the cost of not waiting is a dead bench.
 *
 * Still lock-class ONLY — a deterministic failure (missing binary, bad key, busy
 * port, config error) never sleeps a single millisecond here.
 */
const LOCK_RETRY_DELAYS_MS = [250, 500, 1000, 2000];

/**
 * @param {Error|null} error
 * @returns {boolean} true only for a lock-class (retryable) start failure
 */
function isLockClassStartFailure(error) {
  return matchesStartFailure(error, LOCK_CLASS_START_FAILURE);
}

/**
 * @param {Error|null} error
 * @returns {boolean} true only for a timeout-class (retryable) start failure
 */
function isTimeoutClassStartFailure(error) {
  return matchesStartFailure(error, TIMEOUT_CLASS_START_FAILURE);
}

/**
 * The union the retry actually applies to: lock-class OR timeout-class.
 *
 * Kept separate from the two predicates so each class keeps its own narrow,
 * accurate meaning — `isLockClassStartFailure` still answers "was this a lock
 * race?" and nothing else, so its docblock does not quietly become a lie.
 *
 * @param {Error|null} error
 * @returns {boolean} true for any transient (retryable) start failure
 */
function isRetryableStartFailure(error) {
  return isLockClassStartFailure(error) || isTimeoutClassStartFailure(error);
}

/**
 * Test `pattern` against every carrier an error might arrive on.
 *
 * The real failure arrives as a message with the server's own stdout inlined
 * ("Server exited with code 1 / Server output: … database is locked"), and
 * amicus prefixes it again at the fanout boundary (`Failed to start server:
 * …`), so check the usual carriers too — a wrapped/spawn-shaped error still
 * has to match.
 *
 * @param {Error|null} error
 * @param {RegExp} pattern
 * @returns {boolean}
 */
function matchesStartFailure(error, pattern) {
  if (!error) { return false; }
  const carriers = [error.message, error.stderr, error.stdout, error.cause && error.cause.message];
  return carriers.some(c => typeof c === 'string' && pattern.test(c));
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
      if (i >= delays.length || !isRetryableStartFailure(error)) { throw error; }
      logger.warn('OpenCode server start failed transiently — retrying', {
        attempt: i + 1,
        of: delays.length + 1,
        delayMs: delays[i],
        // Name WHICH transient class fired: a run that retried on `timeout`
        // wants a bigger AMICUS_SERVER_START_TIMEOUT_MS, one that retried on
        // `lock` wants less concurrency. Same retry, different operator action.
        failureClass: isLockClassStartFailure(error) ? 'lock' : 'timeout',
        error: error.message,
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
  isTimeoutClassStartFailure,
  isRetryableStartFailure,
  retryOnLockRace
};

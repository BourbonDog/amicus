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

module.exports = {
  DEFAULT_PORT,
  isPortInUse,
  getPortPid,
  killPortProcess,
  ensurePortAvailable
};

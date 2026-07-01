'use strict';

/**
 * @module shared-server
 * Manages a single shared OpenCode server for MCP sessions.
 */

const { IdleWatchdog } = require('./idle-watchdog');
const { getCompatEnv } = require('./env-compat');

const MAX_RESTARTS = 3;
const RESTART_WINDOW = 5 * 60 * 1000;
const RESTART_BACKOFF = 2000;

/**
 * SharedServerManager - manages a single shared OpenCode server for MCP sessions.
 *
 * Tracks active sessions, handles lazy server startup, deduplicates concurrent
 * start requests, and supervises the server with automatic restart on crash.
 */
class SharedServerManager {
  /**
   * @param {object} [options]
   * @param {object} [options.logger] - Logger with .info(), .warn(), .error() methods
   */
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.maxSessions = Number(process.env.SIDECAR_MAX_SESSIONS) || 20;
    this.enabled = getCompatEnv('SHARED_SERVER') !== '0';

    /** @type {object|null} Active server handle */
    this.server = null;

    /** @type {object|null} Active OpenCode client */
    this.client = null;

    /** @type {Map<string, IdleWatchdog>} Per-session watchdogs */
    this._sessionWatchdogs = new Map();

    /** @type {IdleWatchdog|null} Server-level idle watchdog (fires when no sessions remain) */
    this._serverWatchdog = null;

    /** @type {Promise|null} In-flight server start promise (for deduplication) */
    this._starting = null;

    /** @type {number[]} Timestamps of recent restart attempts */
    this._restartTimestamps = [];
  }

  /**
   * Number of active sessions.
   * @returns {number}
   */
  get sessionCount() {
    return this._sessionWatchdogs.size;
  }

  /**
   * Ensure the shared server is running. Lazy-starts on first call.
   * Deduplicates concurrent calls so only one start occurs.
   *
   * @param {object} [mcpConfig] - MCP configuration to pass to startOpenCodeServer
   * @returns {Promise<{server: object, client: object}>}
   */
  async ensureServer(mcpConfig) {
    if (this.server && this.client) {
      return { server: this.server, client: this.client };
    }
    if (this._starting) {
      return this._starting;
    }
    this._starting = this._doStartServer(mcpConfig).then(({ server, client }) => {
      this.server = server;
      this.client = client;
      this._starting = null;
      this._wireCrashListener(server);
      this._serverWatchdog = new IdleWatchdog({
        mode: 'server',
        onTimeout: () => {
          this.logger.info?.('Shared server idle (no sessions) - shutting down');
          this.shutdown();
        },
      }).start();
      return { server, client };
    }).catch((err) => {
      this._starting = null;
      throw err;
    });
    return this._starting;
  }

  /**
   * Start the OpenCode server. Overrideable for testing.
   *
   * @param {object} [mcpConfig]
   * @returns {Promise<{server: object, client: object}>}
   */
  async _doStartServer(mcpConfig) {
    const { startOpenCodeServer } = require('../sidecar/session-utils');
    return startOpenCodeServer(mcpConfig);
  }

  /**
   * Register a new session. Cancels the server idle watchdog while sessions are active.
   *
   * @param {string} sessionId - Unique session identifier
   * @param {Function} [onEvict] - Called when session is evicted due to idle timeout
   * @throws {Error} If max session capacity is reached
   */
  addSession(sessionId, onEvict) {
    if (this._sessionWatchdogs.size >= this.maxSessions) {
      throw new Error(`Max sessions reached (${this.maxSessions}). Cannot add session ${sessionId}.`);
    }
    const watchdog = new IdleWatchdog({
      mode: 'headless',
      onTimeout: () => {
        this.logger.info?.('Session idle timeout', { sessionId });
        if (onEvict) { onEvict(sessionId); }
        this.removeSession(sessionId);
      },
    }).start();
    this._sessionWatchdogs.set(sessionId, watchdog);
    if (this._serverWatchdog) {
      this._serverWatchdog.cancel();
    }
  }

  /**
   * Deregister a session. Starts the server idle watchdog when no sessions remain.
   *
   * @param {string} sessionId
   */
  removeSession(sessionId) {
    const watchdog = this._sessionWatchdogs.get(sessionId);
    if (watchdog) {
      watchdog.cancel();
      this._sessionWatchdogs.delete(sessionId);
    }
    if (this._sessionWatchdogs.size === 0 && this._serverWatchdog) {
      this._serverWatchdog.start();
    }
  }

  /**
   * Get the idle watchdog for a session.
   *
   * @param {string} sessionId
   * @returns {IdleWatchdog|undefined}
   */
  getSessionWatchdog(sessionId) {
    return this._sessionWatchdogs.get(sessionId);
  }

  /**
   * Shut down the manager: cancel all watchdogs, close the server.
   */
  shutdown() {
    for (const [, wd] of this._sessionWatchdogs) {
      wd.cancel();
    }
    this._sessionWatchdogs.clear();
    if (this._serverWatchdog) {
      this._serverWatchdog.cancel();
      this._serverWatchdog = null;
    }
    if (this.server) {
      this.server.close();
      this.server = null;
      this.client = null;
    }
  }

  /**
   * Wire crash detection onto a freshly started server handle so an unexpected
   * exit triggers _onServerCrash (and the restart machinery). The OpenCode
   * server handle is a plain wrapper; it may surface lifecycle events either on
   * itself or on an underlying child `process`. Attach to whichever is an event
   * emitter, guarding against double-wiring across restarts.
   *
   * @param {object} server - Server handle returned by _doStartServer
   */
  _wireCrashListener(server) {
    const emitter = (server && typeof server.on === 'function')
      ? server
      : (server && server.process && typeof server.process.on === 'function')
        ? server.process
        : null;
    if (!emitter || emitter._amicusCrashWired) {
      return;
    }
    emitter._amicusCrashWired = true;
    const onExit = (code) => {
      // Ignore exits from a stale handle we have already replaced/closed.
      if (this.server !== server) {
        return;
      }
      this._onServerCrash(code);
    };
    emitter.on('exit', onExit);
    emitter.on('close', onExit);
  }

  /**
   * Handle a server crash: log, notify sessions, then schedule restart.
   *
   * @param {number} exitCode - Process exit code from the crashed server
   */
  _onServerCrash(exitCode) {
    this.logger.error?.('Shared server crashed', { exitCode });
    for (const [id] of this._sessionWatchdogs) {
      this.logger.warn?.('Session interrupted by server crash', { sessionId: id });
    }
    this.server = null;
    this.client = null;
    setTimeout(() => this._handleRestart(), RESTART_BACKOFF);
  }

  /**
   * Attempt to restart the server, subject to rate limiting.
   *
   * @returns {Promise<boolean>} true if restart succeeded, false if rate-limited or failed
   */
  async _handleRestart() {
    const now = Date.now();
    this._restartTimestamps = this._restartTimestamps.filter(
      (ts) => now - ts < RESTART_WINDOW
    );
    if (this._restartTimestamps.length >= MAX_RESTARTS) {
      this.logger.error?.('Max restarts exceeded, not restarting shared server', {
        restarts: this._restartTimestamps.length,
        windowMs: RESTART_WINDOW,
      });
      return false;
    }
    this._restartTimestamps.push(now);
    try {
      await this.ensureServer();
      this.logger.info?.('Shared server restarted successfully');
      return true;
    } catch (err) {
      this.logger.error?.('Failed to restart shared server', { error: err.message });
      return false;
    }
  }
}

module.exports = { SharedServerManager };

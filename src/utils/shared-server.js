'use strict';

/**
 * @module shared-server
 * Manages a single shared OpenCode server for MCP sessions.
 */

const { IdleWatchdog } = require('./idle-watchdog');

const MAX_RESTARTS = 3;
const RESTART_WINDOW = 5 * 60 * 1000;
const RESTART_BACKOFF = 2000;
const CRASH_POLL_INTERVAL = 5000; // ms; env-tunable via AMICUS_CRASH_POLL_MS

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
    this.enabled = process.env.AMICUS_SHARED_SERVER !== '0';

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

    /** @type {NodeJS.Timeout|null} goPid liveness poll (H7) */
    this._crashPoll = null;

    /** @type {NodeJS.Timeout|null} Pending crash-restart backoff timer */
    this._restartTimer = null;

    /** Pid-liveness probe (test seam). Lazy default keeps construction light. */
    this._isProcessAlive = options.isProcessAlive
      || ((pid) => require('../sidecar/session-utils').isProcessAlive(pid));
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
    this._stopCrashPoll();
    if (this._restartTimer) { clearTimeout(this._restartTimer); this._restartTimer = null; }
    if (this.server) {
      // close() is async (B06 escalation); shutdown() stays sync so this
      // remains fire-and-forget — guard against an unhandled rejection.
      const closeResult = this.server.close();
      if (closeResult && typeof closeResult.catch === 'function') { closeResult.catch(() => {}); }
      this.server = null;
      this.client = null;
    }
  }

  /**
   * Wire crash detection onto a freshly started server handle. The REAL handle
   * from buildServerHandle is { url, goPid, close } — it surfaces NO lifecycle
   * events, so the emitter path alone was dead code (H7). Detection now polls
   * the Go engine pid; emitter wiring is kept for handles that do expose events.
   * @param {object} server - Server handle returned by _doStartServer
   */
  _wireCrashListener(server) {
    const emitter = (server && typeof server.on === 'function')
      ? server
      : (server && server.process && typeof server.process.on === 'function')
        ? server.process
        : null;
    if (emitter && !emitter._amicusCrashWired) {
      emitter._amicusCrashWired = true;
      const onExit = (code) => {
        if (this.server !== server) { return; } // stale handle already replaced/closed
        this._onServerCrash(code);
      };
      emitter.on('exit', onExit);
      emitter.on('close', onExit);
    }
    if (server && server.goPid) {
      this._startCrashPoll(server);
    } else if (!emitter) {
      this.logger.debug?.('Server handle has no goPid and no emitter — crash detection unavailable');
    }
  }

  /** Poll the Go engine pid; pid death IS the crash signal (H7). */
  _startCrashPoll(server) {
    this._stopCrashPoll();
    const interval = Number(process.env.AMICUS_CRASH_POLL_MS) || CRASH_POLL_INTERVAL;
    this._crashPoll = setInterval(() => {
      if (this.server !== server) { this._stopCrashPoll(); return; }
      if (!this._isProcessAlive(server.goPid)) {
        this._stopCrashPoll();
        this._onServerCrash(null);
      }
    }, interval);
    if (this._crashPoll.unref) { this._crashPoll.unref(); }
  }

  _stopCrashPoll() {
    if (this._crashPoll) { clearInterval(this._crashPoll); this._crashPoll = null; }
  }

  /**
   * Handle a server crash: log, notify sessions, then schedule restart.
   *
   * @param {number} exitCode - Process exit code from the crashed server
   */
  _onServerCrash(exitCode) {
    this._stopCrashPoll();
    this.logger.error?.('Shared server crashed', { exitCode });
    for (const [id] of this._sessionWatchdogs) {
      this.logger.warn?.('Session interrupted by server crash', { sessionId: id });
    }
    this.server = null;
    this.client = null;
    this._restartTimer = setTimeout(() => this._handleRestart(), RESTART_BACKOFF);
    if (this._restartTimer.unref) { this._restartTimer.unref(); }
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

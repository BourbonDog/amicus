/**
 * @module idle-watchdog
 * IdleWatchdog - BUSY/IDLE state machine with self-terminating timer.
 *
 * Tracks whether a sidecar session is actively processing (BUSY) or
 * waiting for work (IDLE). Fires an onTimeout callback after the
 * configured idle period elapses. Supports stuck-stream protection to
 * force-transition out of BUSY if a response stream never completes.
 *
 * Timeout priority (highest to lowest):
 *   1. Per-mode env var (AMICUS_IDLE_TIMEOUT_HEADLESS, etc.) in minutes
 *      (legacy SIDECAR_IDLE_TIMEOUT_* still honored via env-compat shim)
 *   2. Blanket env var AMICUS_IDLE_TIMEOUT / SIDECAR_IDLE_TIMEOUT in minutes
 *   3. Constructor option `timeout` in milliseconds
 *   4. Mode default (headless=15m, interactive=60m, server=30m)
 */

'use strict';

const { getCompatEnv } = require('./env-compat');

/** @type {Object.<string, number>} Default timeouts per mode in milliseconds */
const MODE_TIMEOUTS = {
  headless: 15 * 60 * 1000,
  interactive: 60 * 60 * 1000,
  server: 30 * 60 * 1000,
};

/** @type {Object.<string, string>} Per-mode env-compat suffixes */
const MODE_ENV_MAP = {
  headless: 'IDLE_TIMEOUT_HEADLESS',
  interactive: 'IDLE_TIMEOUT_INTERACTIVE',
  server: 'IDLE_TIMEOUT_SERVER',
};

/**
 * Resolve the effective timeout in milliseconds using the priority chain.
 *
 * @param {string} mode - The operating mode ('headless', 'interactive', 'server')
 * @param {number|undefined} optionTimeout - Caller-supplied timeout in ms (or undefined)
 * @returns {number} Effective timeout in ms, or Infinity if disabled
 */
function resolveTimeout(mode, optionTimeout) {
  const modeSuffix = MODE_ENV_MAP[mode];
  if (modeSuffix !== undefined) {
    const modeEnv = getCompatEnv(modeSuffix);
    if (modeEnv !== undefined) {
      const mins = Number(modeEnv);
      return mins === 0 ? Infinity : mins * 60 * 1000;
    }
  }

  const blanket = getCompatEnv('IDLE_TIMEOUT');
  if (blanket !== undefined) {
    const mins = Number(blanket);
    return mins === 0 ? Infinity : mins * 60 * 1000;
  }

  if (optionTimeout !== undefined) {
    return optionTimeout === 0 ? Infinity : optionTimeout;
  }

  return MODE_TIMEOUTS[mode] || MODE_TIMEOUTS.headless;
}

/**
 * IdleWatchdog - BUSY/IDLE state machine with configurable idle timeout.
 *
 * @example
 * const wd = new IdleWatchdog({ mode: 'headless', timeout: 60000, onTimeout: () => process.exit(0) });
 * wd.start();
 * wd.markBusy();   // called when a stream starts
 * wd.markIdle();   // called when a stream completes
 * wd.touch();      // called during polling to reset the idle clock
 * wd.cancel();     // stop all timers (e.g. on clean shutdown)
 */
class IdleWatchdog {
  /**
   * @param {object} options
   * @param {'headless'|'interactive'|'server'} [options.mode='headless'] - Operating mode
   * @param {number} [options.timeout] - Idle timeout in ms (0 = Infinity/disabled)
   * @param {number} [options.stuckStreamTimeout] - Max ms to remain in BUSY before force-idle
   * @param {Function} [options.onTimeout] - Called when idle timeout fires
   * @param {object} [options.logger] - Logger with .warn() and .info() (defaults to console)
   */
  constructor(options = {}) {
    const { mode = 'headless', timeout, stuckStreamTimeout, onTimeout, logger: log } = options;

    /** @type {string} Current operating mode */
    this.mode = mode;

    /** @type {number} Effective idle timeout in ms */
    this.timeout = resolveTimeout(mode, timeout);

    /** @type {number} Max ms to stay BUSY before force-transitioning to IDLE */
    this.stuckStreamTimeout = stuckStreamTimeout || 5 * 60 * 1000;

    /** @type {Function} Callback fired on idle timeout */
    this.onTimeout = onTimeout || (() => {});

    /** @type {object} Logger instance */
    this.logger = log || console;

    /** @type {'IDLE'|'BUSY'} Current state */
    this.state = 'IDLE';

    /** @type {ReturnType<typeof setTimeout>|null} Active idle countdown timer */
    this._timer = null;

    /** @type {ReturnType<typeof setTimeout>|null} Stuck-stream detection timer */
    this._stuckTimer = null;

    /** @type {number} Epoch ms when this watchdog was created */
    this._startedAt = Date.now();
  }

  /**
   * Activate the watchdog and begin the idle countdown.
   *
   * @returns {IdleWatchdog} Returns `this` for chaining
   */
  start() {
    this._resetTimer();
    return this;
  }

  /**
   * Transition to BUSY state, suspending the idle timer.
   * Starts the stuck-stream protection timer.
   * Idempotent: calling while already BUSY is a no-op for the state,
   * but does refresh the stuck timer.
   */
  markBusy() {
    this.state = 'BUSY';
    clearTimeout(this._timer);
    this._timer = null;
    this._startStuckTimer();
  }

  /**
   * Transition to IDLE state and restart the idle countdown.
   * Cancels the stuck-stream protection timer.
   */
  markIdle() {
    this.state = 'IDLE';
    this._clearStuckTimer();
    this._resetTimer();
  }

  /**
   * Reset the idle countdown without changing state.
   * Has no effect when in BUSY state.
   */
  touch() {
    if (this.state === 'IDLE') {
      this._resetTimer();
    }
  }

  /**
   * Cancel all active timers. The watchdog becomes inert.
   * Call this on clean shutdown to prevent stray callbacks.
   */
  cancel() {
    clearTimeout(this._timer);
    this._timer = null;
    this._clearStuckTimer();
  }

  /**
   * Clear and restart the idle countdown timer.
   *
   * @private
   */
  _resetTimer() {
    clearTimeout(this._timer);
    if (this.timeout === Infinity) {
      this._timer = null;
      return;
    }
    this._timer = setTimeout(() => {
      this.logger.info?.('Idle timeout reached', {
        mode: this.mode,
        uptimeMs: Date.now() - this._startedAt,
      });
      this.onTimeout();
    }, this.timeout);
    // Allow Node process to exit naturally if only this timer remains.
    if (this._timer.unref) {
      this._timer.unref();
    }
  }

  /**
   * Start the stuck-stream protection timer.
   * If it fires, the watchdog force-transitions to IDLE.
   *
   * @private
   */
  _startStuckTimer() {
    this._clearStuckTimer();
    if (this.stuckStreamTimeout === Infinity) { return; }
    this._stuckTimer = setTimeout(() => {
      this.logger.warn?.('Stuck stream detected, force-transitioning to IDLE', {
        stuckMs: this.stuckStreamTimeout,
      });
      this.markIdle();
    }, this.stuckStreamTimeout);
    if (this._stuckTimer.unref) {
      this._stuckTimer.unref();
    }
  }

  /**
   * Clear the stuck-stream protection timer.
   *
   * @private
   */
  _clearStuckTimer() {
    clearTimeout(this._stuckTimer);
    this._stuckTimer = null;
  }
}

module.exports = { IdleWatchdog, resolveTimeout };

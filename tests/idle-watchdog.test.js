/**
 * IdleWatchdog Tests
 *
 * Tests for the BUSY/IDLE state machine with self-terminating timer.
 * Uses Jest fake timers to verify timer-dependent behavior.
 */

'use strict';

const { IdleWatchdog } = require('../src/utils/idle-watchdog');

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('IdleWatchdog', () => {
  describe('construction', () => {
    test('creates with default headless timeout', () => {
      const wd = new IdleWatchdog({ mode: 'headless' });
      expect(wd.timeout).toBe(15 * 60 * 1000);
      expect(wd.state).toBe('IDLE');
    });

    test('creates with interactive timeout', () => {
      const wd = new IdleWatchdog({ mode: 'interactive' });
      expect(wd.timeout).toBe(60 * 60 * 1000);
    });

    test('creates with server timeout', () => {
      const wd = new IdleWatchdog({ mode: 'server' });
      expect(wd.timeout).toBe(30 * 60 * 1000);
    });

    test('custom timeout overrides mode default', () => {
      const wd = new IdleWatchdog({ mode: 'headless', timeout: 5000 });
      expect(wd.timeout).toBe(5000);
    });

    test('timeout of 0 means Infinity (disabled)', () => {
      const wd = new IdleWatchdog({ mode: 'headless', timeout: 0 });
      expect(wd.timeout).toBe(Infinity);
    });
  });

  describe('state transitions', () => {
    test('markBusy transitions to BUSY and suspends timer', () => {
      const onTimeout = jest.fn();
      const wd = new IdleWatchdog({ mode: 'headless', timeout: 1000, onTimeout });
      wd.start();
      wd.markBusy();
      expect(wd.state).toBe('BUSY');
      jest.advanceTimersByTime(2000);
      expect(onTimeout).not.toHaveBeenCalled();
    });

    test('markIdle transitions to IDLE and starts timer', () => {
      const onTimeout = jest.fn();
      const wd = new IdleWatchdog({ mode: 'headless', timeout: 1000, onTimeout });
      wd.start();
      wd.markBusy();
      wd.markIdle();
      expect(wd.state).toBe('IDLE');
      jest.advanceTimersByTime(1001);
      expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    test('touch resets idle timer without changing state', () => {
      const onTimeout = jest.fn();
      const wd = new IdleWatchdog({ mode: 'headless', timeout: 1000, onTimeout });
      wd.start();
      jest.advanceTimersByTime(800);
      wd.touch();
      jest.advanceTimersByTime(800);
      expect(onTimeout).not.toHaveBeenCalled();
      jest.advanceTimersByTime(201);
      expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    test('touch during BUSY does not start timer', () => {
      const onTimeout = jest.fn();
      const wd = new IdleWatchdog({ mode: 'headless', timeout: 1000, onTimeout });
      wd.start();
      wd.markBusy();
      wd.touch();
      expect(wd.state).toBe('BUSY');
      jest.advanceTimersByTime(2000);
      expect(onTimeout).not.toHaveBeenCalled();
    });

    test('multiple markBusy calls are idempotent', () => {
      const wd = new IdleWatchdog({ mode: 'headless', timeout: 1000 });
      wd.start();
      wd.markBusy();
      wd.markBusy();
      expect(wd.state).toBe('BUSY');
    });

    test('start() returns this for chaining', () => {
      const wd = new IdleWatchdog({ mode: 'headless' });
      const result = wd.start();
      expect(result).toBe(wd);
    });
  });

  describe('idle timeout', () => {
    test('fires onTimeout after idle period', () => {
      const onTimeout = jest.fn();
      const wd = new IdleWatchdog({ mode: 'headless', timeout: 5000, onTimeout });
      wd.start();
      jest.advanceTimersByTime(5001);
      expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    test('does not fire if Infinity timeout', () => {
      const onTimeout = jest.fn();
      const wd = new IdleWatchdog({ mode: 'headless', timeout: 0, onTimeout });
      wd.start();
      jest.advanceTimersByTime(999999999);
      expect(onTimeout).not.toHaveBeenCalled();
    });
  });

  describe('stuck stream protection', () => {
    test('force-transitions to IDLE after stuckStreamTimeout', () => {
      const onTimeout = jest.fn();
      const wd = new IdleWatchdog({
        mode: 'headless', timeout: 60000, stuckStreamTimeout: 3000, onTimeout,
      });
      wd.start();
      wd.markBusy();
      expect(wd.state).toBe('BUSY');
      jest.advanceTimersByTime(3001);
      expect(wd.state).toBe('IDLE');
      jest.advanceTimersByTime(60001);
      expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    test('markIdle before stuck timeout cancels stuck timer', () => {
      const wd = new IdleWatchdog({
        mode: 'headless', timeout: 60000, stuckStreamTimeout: 3000,
      });
      wd.start();
      wd.markBusy();
      jest.advanceTimersByTime(2000);
      wd.markIdle();
      jest.advanceTimersByTime(2000);
      expect(wd.state).toBe('IDLE');
    });

    test('cancel() clears all timers', () => {
      const onTimeout = jest.fn();
      const wd = new IdleWatchdog({ mode: 'headless', timeout: 1000, onTimeout });
      wd.start();
      wd.cancel();
      jest.advanceTimersByTime(5000);
      expect(onTimeout).not.toHaveBeenCalled();
    });
  });

  describe('env var resolution', () => {
    const originalEnv = process.env;
    beforeEach(() => { process.env = { ...originalEnv }; });
    afterEach(() => { process.env = originalEnv; });

    test('per-mode env var takes highest precedence', () => {
      process.env.AMICUS_IDLE_TIMEOUT_HEADLESS = '5';
      process.env.AMICUS_IDLE_TIMEOUT = '99';
      const wd = new IdleWatchdog({ mode: 'headless', timeout: 7000 });
      expect(wd.timeout).toBe(5 * 60 * 1000);
    });

    test('blanket env var overrides option and default', () => {
      process.env.AMICUS_IDLE_TIMEOUT = '20';
      const wd = new IdleWatchdog({ mode: 'headless', timeout: 7000 });
      expect(wd.timeout).toBe(20 * 60 * 1000);
    });

    test('AMICUS_IDLE_TIMEOUT_INTERACTIVE applies to interactive mode', () => {
      process.env.AMICUS_IDLE_TIMEOUT_INTERACTIVE = '120';
      const wd = new IdleWatchdog({ mode: 'interactive' });
      expect(wd.timeout).toBe(120 * 60 * 1000);
    });

    test('AMICUS_IDLE_TIMEOUT_SERVER applies to server mode', () => {
      process.env.AMICUS_IDLE_TIMEOUT_SERVER = '45';
      const wd = new IdleWatchdog({ mode: 'server' });
      expect(wd.timeout).toBe(45 * 60 * 1000);
    });

    test('env var 0 means Infinity', () => {
      process.env.AMICUS_IDLE_TIMEOUT = '0';
      const wd = new IdleWatchdog({ mode: 'headless' });
      expect(wd.timeout).toBe(Infinity);
    });

    test('AMICUS_IDLE_TIMEOUT_HEADLESS is honored', () => {
      process.env.AMICUS_IDLE_TIMEOUT_HEADLESS = '7';
      const wd = new IdleWatchdog({ mode: 'headless' });
      expect(wd.timeout).toBe(7 * 60 * 1000);
    });

    test('legacy SIDECAR_IDLE_TIMEOUT_HEADLESS is ignored (#19 absence pin) — falls through to default', () => {
      process.env.SIDECAR_IDLE_TIMEOUT_HEADLESS = '99';
      const wd = new IdleWatchdog({ mode: 'headless' });
      expect(wd.timeout).not.toBe(99 * 60 * 1000);
      expect(wd.timeout).toBe(15 * 60 * 1000); // headless default
    });

    test('legacy SIDECAR_IDLE_TIMEOUT (blanket) is ignored (#19 absence pin)', () => {
      process.env.SIDECAR_IDLE_TIMEOUT = '99';
      const wd = new IdleWatchdog({ mode: 'headless', timeout: 7000 });
      expect(wd.timeout).not.toBe(99 * 60 * 1000);
      expect(wd.timeout).toBe(7000); // falls through to the constructor option
    });
  });

  describe('full lifecycle', () => {
    test('start -> busy -> idle -> timeout', () => {
      const onTimeout = jest.fn();
      const wd = new IdleWatchdog({ mode: 'headless', timeout: 5000, onTimeout }).start();
      wd.markBusy();
      jest.advanceTimersByTime(10000);
      expect(onTimeout).not.toHaveBeenCalled();
      wd.markIdle();
      jest.advanceTimersByTime(4999);
      expect(onTimeout).not.toHaveBeenCalled();
      jest.advanceTimersByTime(2);
      expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    test('touch extends idle period during polling', () => {
      const onTimeout = jest.fn();
      const wd = new IdleWatchdog({ mode: 'headless', timeout: 3000, onTimeout }).start();
      for (let i = 0; i < 5; i++) {
        jest.advanceTimersByTime(2000);
        wd.touch();
      }
      expect(onTimeout).not.toHaveBeenCalled();
      jest.advanceTimersByTime(3001);
      expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    test('stuck stream forces idle after stuckStreamTimeout', () => {
      const onTimeout = jest.fn();
      const wd = new IdleWatchdog({
        mode: 'headless', timeout: 2000, stuckStreamTimeout: 1000, onTimeout,
      }).start();
      wd.markBusy();
      jest.advanceTimersByTime(1001);
      expect(wd.state).toBe('IDLE');
      jest.advanceTimersByTime(2001);
      expect(onTimeout).toHaveBeenCalledTimes(1);
    });
  });
});

describe('sendPrompt watchdog integration', () => {
  test('opencode-client.js wraps sendPrompt with watchdog markBusy/markIdle', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../src/opencode-client.js'), 'utf-8'
    );
    expect(src).toContain('watchdog');
    expect(src).toContain('markBusy');
    expect(src).toContain('markIdle');
  });
});

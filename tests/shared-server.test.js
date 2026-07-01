'use strict';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('SharedServerManager', () => {
  let SharedServerManager;

  beforeAll(() => {
    ({ SharedServerManager } = require('../src/utils/shared-server'));
  });

  describe('construction', () => {
    test('constructs with default options', () => {
      const mgr = new SharedServerManager();
      expect(mgr.maxSessions).toBe(20);
      expect(mgr.server).toBeNull();
      expect(mgr.sessionCount).toBe(0);
    });

    test('respects SIDECAR_MAX_SESSIONS env var', () => {
      const orig = process.env.SIDECAR_MAX_SESSIONS;
      process.env.SIDECAR_MAX_SESSIONS = '10';
      const mgr = new SharedServerManager();
      expect(mgr.maxSessions).toBe(10);
      process.env.SIDECAR_MAX_SESSIONS = orig;
    });

    test('disabled when SIDECAR_SHARED_SERVER=0', () => {
      const orig = process.env.SIDECAR_SHARED_SERVER;
      process.env.SIDECAR_SHARED_SERVER = '0';
      const mgr = new SharedServerManager();
      expect(mgr.enabled).toBe(false);
      process.env.SIDECAR_SHARED_SERVER = orig;
    });

    test('disabled when AMICUS_SHARED_SERVER=0', () => {
      const orig = process.env.AMICUS_SHARED_SERVER;
      delete process.env.AMICUS_SHARED_SERVER;
      process.env.AMICUS_SHARED_SERVER = '0';
      const mgr = new SharedServerManager();
      expect(mgr.enabled).toBe(false);
      if (orig === undefined) { delete process.env.AMICUS_SHARED_SERVER; }
      else { process.env.AMICUS_SHARED_SERVER = orig; }
    });

    test('AMICUS_SHARED_SERVER wins over SIDECAR_SHARED_SERVER (AMICUS=1, SIDECAR=0 → enabled)', () => {
      const origA = process.env.AMICUS_SHARED_SERVER;
      const origS = process.env.SIDECAR_SHARED_SERVER;
      process.env.AMICUS_SHARED_SERVER = '1';
      process.env.SIDECAR_SHARED_SERVER = '0';
      const mgr = new SharedServerManager();
      expect(mgr.enabled).toBe(true);
      if (origA === undefined) { delete process.env.AMICUS_SHARED_SERVER; }
      else { process.env.AMICUS_SHARED_SERVER = origA; }
      if (origS === undefined) { delete process.env.SIDECAR_SHARED_SERVER; }
      else { process.env.SIDECAR_SHARED_SERVER = origS; }
    });
  });

  describe('session tracking', () => {
    let mgr;

    beforeEach(() => {
      mgr = new SharedServerManager();
      mgr.server = { url: 'http://localhost:4096', close: jest.fn() };
      mgr.client = {};
      mgr._serverWatchdog = { cancel: jest.fn(), start: jest.fn() };
    });

    test('addSession increments count and creates watchdog', () => {
      mgr.addSession('session-1');
      expect(mgr.sessionCount).toBe(1);
      expect(mgr._sessionWatchdogs.has('session-1')).toBe(true);
    });

    test('removeSession decrements count', () => {
      mgr.addSession('session-1');
      mgr.removeSession('session-1');
      expect(mgr.sessionCount).toBe(0);
    });

    test('removeSession starts server watchdog when no sessions remain', () => {
      const startFn = jest.fn();
      mgr._serverWatchdog = { cancel: jest.fn(), start: startFn };
      mgr.addSession('session-1');
      mgr.removeSession('session-1');
      expect(startFn).toHaveBeenCalled();
    });

    test('addSession cancels server watchdog', () => {
      const cancelFn = jest.fn();
      mgr._serverWatchdog = { cancel: cancelFn, start: jest.fn() };
      mgr.addSession('session-1');
      expect(cancelFn).toHaveBeenCalled();
    });

    test('addSession rejects when at max capacity', () => {
      mgr.maxSessions = 2;
      mgr.addSession('s1');
      mgr.addSession('s2');
      expect(() => mgr.addSession('s3')).toThrow(/max.*sessions/i);
    });

    test('getSessionWatchdog returns watchdog for session', () => {
      mgr.addSession('session-1');
      const wd = mgr.getSessionWatchdog('session-1');
      expect(wd).toBeDefined();
      expect(wd.state).toBe('IDLE');
    });
  });

  describe('ensureServer', () => {
    test('starts server on first call', async () => {
      const mgr = new SharedServerManager();
      const mockServer = { url: 'http://localhost:4096', close: jest.fn(), goPid: 123 };
      const mockClient = { session: {} };
      mgr._doStartServer = jest.fn().mockResolvedValue({ server: mockServer, client: mockClient });
      const { server } = await mgr.ensureServer();
      expect(server.url).toBe('http://localhost:4096');
      expect(mgr._doStartServer).toHaveBeenCalledTimes(1);
    });

    test('reuses server on subsequent calls', async () => {
      const mgr = new SharedServerManager();
      const mockServer = { url: 'http://localhost:4096', close: jest.fn(), goPid: 123 };
      const mockClient = { session: {} };
      mgr._doStartServer = jest.fn().mockResolvedValue({ server: mockServer, client: mockClient });
      await mgr.ensureServer();
      await mgr.ensureServer();
      expect(mgr._doStartServer).toHaveBeenCalledTimes(1);
    });

    test('deduplicates concurrent ensureServer calls', async () => {
      const mgr = new SharedServerManager();
      const mockServer = { url: 'http://localhost:4096', close: jest.fn(), goPid: 123 };
      const mockClient = { session: {} };
      mgr._doStartServer = jest.fn().mockResolvedValue({ server: mockServer, client: mockClient });
      const [r1, r2] = await Promise.all([mgr.ensureServer(), mgr.ensureServer()]);
      expect(r1.server).toBe(r2.server);
      expect(mgr._doStartServer).toHaveBeenCalledTimes(1);
    });
  });

  describe('supervisor', () => {
    test('_handleRestart restarts server', async () => {
      const mgr = new SharedServerManager();
      let startCount = 0;
      mgr._doStartServer = jest.fn().mockImplementation(() => {
        startCount++;
        return Promise.resolve({
          server: { url: 'http://localhost:4096', close: jest.fn() },
          client: { session: {} },
        });
      });
      await mgr.ensureServer();
      expect(startCount).toBe(1);
      mgr.server = null;
      mgr.client = null;
      mgr._starting = null;
      await mgr._handleRestart();
      expect(startCount).toBe(2);
    });

    test('wires crash listener so a server exit triggers _onServerCrash', async () => {
      const { EventEmitter } = require('events');
      const mgr = new SharedServerManager();
      const proc = new EventEmitter();
      const mockServer = { url: 'http://localhost:4096', close: jest.fn(), process: proc };
      mgr._doStartServer = jest.fn().mockResolvedValue({
        server: mockServer,
        client: { session: {} },
      });
      const crashSpy = jest.spyOn(mgr, '_onServerCrash');
      await mgr.ensureServer();
      // Simulate the underlying process exiting unexpectedly.
      proc.emit('exit', 1);
      expect(crashSpy).toHaveBeenCalledWith(1);
    });

    test('server exit schedules a restart via the backoff timer', async () => {
      const { EventEmitter } = require('events');
      const mgr = new SharedServerManager();
      const proc = new EventEmitter();
      let startCount = 0;
      mgr._doStartServer = jest.fn().mockImplementation(() => {
        startCount++;
        return Promise.resolve({
          server: { url: 'http://localhost:4096', close: jest.fn(), process: proc },
          client: { session: {} },
        });
      });
      await mgr.ensureServer();
      expect(startCount).toBe(1);
      proc.emit('exit', 1);
      // _onServerCrash schedules _handleRestart after RESTART_BACKOFF.
      await jest.advanceTimersByTimeAsync(2000);
      expect(startCount).toBe(2);
    });

    test('crash listener is wired only once per server handle', async () => {
      const { EventEmitter } = require('events');
      const mgr = new SharedServerManager();
      const proc = new EventEmitter();
      const mockServer = { url: 'http://localhost:4096', close: jest.fn(), process: proc };
      mgr._doStartServer = jest.fn().mockResolvedValue({
        server: mockServer,
        client: { session: {} },
      });
      await mgr.ensureServer();
      // ensureServer returns cached handle without re-wiring.
      await mgr.ensureServer();
      expect(proc.listenerCount('exit')).toBe(1);
    });

    test('stops restarting after MAX_RESTARTS in window', async () => {
      const mgr = new SharedServerManager();
      mgr._doStartServer = jest.fn().mockResolvedValue({
        server: { url: 'http://localhost:4096', close: jest.fn() },
        client: { session: {} },
      });
      const now = Date.now();
      mgr._restartTimestamps = [now - 1000, now - 500, now - 100];
      const result = await mgr._handleRestart();
      expect(result).toBe(false);
    });
  });

  describe('shutdown', () => {
    test('clears all sessions and closes server', () => {
      const closeFn = jest.fn();
      const mgr = new SharedServerManager();
      mgr.server = { url: 'http://localhost:4096', close: closeFn };
      mgr.client = {};
      mgr._serverWatchdog = { cancel: jest.fn(), start: jest.fn() };
      mgr.addSession('s1');
      mgr.addSession('s2');
      mgr.shutdown();
      expect(mgr.sessionCount).toBe(0);
      expect(mgr.server).toBeNull();
      expect(closeFn).toHaveBeenCalled();
    });
  });
});

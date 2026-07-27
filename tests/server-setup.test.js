/**
 * Tests for src/utils/server-setup.js
 *
 * Port management: getPortPid, isPortInUse, killPortProcess, ensurePortAvailable.
 * Uses mocked execFileSync and process.kill to avoid real port operations.
 */

const { execFileSync } = require('child_process');

jest.mock('child_process', () => ({
  execFileSync: jest.fn()
}));

jest.mock('../src/utils/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  }
}));

const {
  getPortPid,
  isPortInUse,
  killPortProcess,
  ensurePortAvailable,
  isLockClassStartFailure,
  retryOnLockRace,
  LOCK_RETRY_DELAYS_MS,
  DEFAULT_PORT
} = require('../src/utils/server-setup');

const realPlatform = process.platform;
function setPlatform(p) {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

describe('server-setup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Pin a Unix platform so getPortPid's cross-platform delegate uses lsof.
    setPlatform('linux');
  });

  afterEach(() => {
    setPlatform(realPlatform);
  });

  describe('DEFAULT_PORT', () => {
    it('should be 4096', () => {
      expect(DEFAULT_PORT).toBe(4096);
    });
  });

  describe('getPortPid', () => {
    it('should return PID when lsof finds a process', () => {
      execFileSync.mockReturnValue('12345\n');
      const pid = getPortPid(4096);
      expect(pid).toBe(12345);
      expect(execFileSync).toHaveBeenCalledWith(
        'lsof', ['-ti', ':4096', '-sTCP:LISTEN'],
        expect.objectContaining({ encoding: 'utf8' })
      );
    });

    it('should resolve the LISTENING PID from netstat on Windows', () => {
      setPlatform('win32');
      execFileSync.mockReturnValue(
        '\r\n  Proto  Local Address      Foreign Address    State        PID\r\n' +
        '  TCP    127.0.0.1:4096     0.0.0.0:0          LISTENING    4321\r\n'
      );
      expect(getPortPid(4096)).toBe(4321);
      expect(execFileSync).toHaveBeenCalledWith(
        'netstat', ['-ano', '-p', 'TCP'],
        expect.objectContaining({ encoding: 'utf8' })
      );
    });

    it('should return null when lsof returns non-numeric output', () => {
      execFileSync.mockReturnValue('not-a-number\n');
      expect(getPortPid(4096)).toBeNull();
    });

    it('should return null when lsof throws (no process on port)', () => {
      execFileSync.mockImplementation(() => { throw new Error('exit code 1'); });
      expect(getPortPid(4096)).toBeNull();
    });

    it('should return null for empty lsof output', () => {
      execFileSync.mockReturnValue('');
      expect(getPortPid(4096)).toBeNull();
    });
  });

  describe('isPortInUse', () => {
    it('should return true when a process is on the port', () => {
      execFileSync.mockReturnValue('9999\n');
      expect(isPortInUse(4096)).toBe(true);
    });

    it('should return false when no process is on the port', () => {
      execFileSync.mockImplementation(() => { throw new Error('exit 1'); });
      expect(isPortInUse(4096)).toBe(false);
    });
  });

  describe('killPortProcess', () => {
    let killSpy;

    beforeEach(() => {
      killSpy = jest.spyOn(process, 'kill').mockImplementation(() => {});
    });

    afterEach(() => {
      killSpy.mockRestore();
    });

    it('should return true when port is already free', () => {
      execFileSync.mockImplementation(() => { throw new Error('exit 1'); });
      expect(killPortProcess(4096)).toBe(true);
      expect(killSpy).not.toHaveBeenCalled();
    });

    it('should kill the process and return true on success', () => {
      execFileSync.mockReturnValue('7777\n');
      expect(killPortProcess(4096)).toBe(true);
      expect(killSpy).toHaveBeenCalledWith(7777, 'SIGTERM');
    });

    it('should return false when process.kill throws', () => {
      execFileSync.mockReturnValue('7777\n');
      killSpy.mockImplementation(() => { throw new Error('EPERM'); });
      expect(killPortProcess(4096)).toBe(false);
    });
  });

  describe('ensurePortAvailable', () => {
    let killSpy;

    beforeEach(() => {
      killSpy = jest.spyOn(process, 'kill').mockImplementation(() => {});
    });

    afterEach(() => {
      killSpy.mockRestore();
    });

    it('should return true immediately when port is free', () => {
      execFileSync.mockImplementation(() => { throw new Error('exit 1'); });
      expect(ensurePortAvailable()).toBe(true);
    });

    it('should default to port 4096', () => {
      execFileSync.mockImplementation(() => { throw new Error('exit 1'); });
      ensurePortAvailable();
      expect(execFileSync).toHaveBeenCalledWith(
        'lsof', ['-ti', ':4096', '-sTCP:LISTEN'],
        expect.anything()
      );
    });

    it('should accept a custom port', () => {
      execFileSync.mockImplementation(() => { throw new Error('exit 1'); });
      ensurePortAvailable(8080);
      expect(execFileSync).toHaveBeenCalledWith(
        'lsof', ['-ti', ':8080', '-sTCP:LISTEN'],
        expect.anything()
      );
    });

    it('should kill stale process and return true when port is freed', () => {
      let callCount = 0;
      execFileSync.mockImplementation(() => {
        callCount++;
        // First two calls: port in use (getPortPid for isPortInUse + killPortProcess)
        // After kill, port is free
        if (callCount <= 2) {
          return '5555\n';
        }
        throw new Error('exit 1'); // port is now free
      });

      expect(ensurePortAvailable(4096)).toBe(true);
      expect(killSpy).toHaveBeenCalledWith(5555, 'SIGTERM');
    });

    it('should return false when kill fails and port stays occupied', () => {
      // Port always occupied, kill fails
      execFileSync.mockReturnValue('5555\n');
      killSpy.mockImplementation(() => { throw new Error('EPERM'); });
      expect(ensurePortAvailable(4096)).toBe(false);
    });
  });
});

/**
 * v4.4.1 Step 10.5 — the lock-race retry window, WIDENED.
 *
 * The first cut was 3 attempts at 250/500ms (~750ms). Run v441plan02 exhausted
 * it: the shared-server acquisition failed, the council silently dropped back to
 * one server per wave, and lost four of five seats to `database is locked`. The
 * window is now 5 attempts with exponential backoff to ~3.75s. These pin the
 * shape itself, so a future edit cannot quietly narrow it back.
 */
describe('lock-race retry window (Step 10.5)', () => {
  it('is 5 attempts — 4 backoffs — not 3', () => {
    expect(LOCK_RETRY_DELAYS_MS).toHaveLength(4);
  });

  it('backs off exponentially and totals ~3.75s, comfortably inside ~4s', () => {
    expect(LOCK_RETRY_DELAYS_MS).toEqual([250, 500, 1000, 2000]);
    for (let i = 1; i < LOCK_RETRY_DELAYS_MS.length; i += 1) {
      expect(LOCK_RETRY_DELAYS_MS[i]).toBe(LOCK_RETRY_DELAYS_MS[i - 1] * 2);
    }
    const total = LOCK_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);
    expect(total).toBe(3750);
    expect(total).toBeLessThanOrEqual(4000);
    // …and >4x the ~750ms window that was measured as too thin.
    expect(total).toBeGreaterThan(3000);
  });

  it('retries a lock-class failure exactly 5 times, then rethrows unchanged', async () => {
    const attempt = jest.fn(async () => { throw new Error('database is locked'); });
    await expect(retryOnLockRace(attempt, { retryDelayMs: 0 }))
      .rejects.toThrow('database is locked');
    expect(attempt).toHaveBeenCalledTimes(5);
  });

  // Widening the window must NOT widen what it applies to: a deterministic
  // failure still costs exactly one attempt and zero added latency.
  it('still never retries a deterministic failure', async () => {
    const attempt = jest.fn(async () => { throw new Error('ENOENT: opencode not found'); });
    await expect(retryOnLockRace(attempt, { retryDelayMs: 0 })).rejects.toThrow(/ENOENT/);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(isLockClassStartFailure(new Error('ENOENT: opencode not found'))).toBe(false);
  });

  it('a start that recovers on the 5th attempt still succeeds', async () => {
    let n = 0;
    const attempt = jest.fn(async () => {
      n += 1;
      if (n < 5) { throw new Error('SQLITE_BUSY: database is busy'); }
      return 'started';
    });
    await expect(retryOnLockRace(attempt, { retryDelayMs: 0 })).resolves.toBe('started');
    expect(attempt).toHaveBeenCalledTimes(5);
  });
});

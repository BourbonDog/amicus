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
  isTimeoutClassStartFailure,
  isRetryableStartFailure,
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

  /**
   * ⚠️ Finding D5: everything above pins the exported CONSTANT, and every other
   * retry test in the repo passes `retryDelayMs` (a test seam that collapses the
   * whole schedule to one value) — so nothing pinned the delays `retryOnLockRace`
   * ACTUALLY SLEEPS. "5 attempts with exponential backoff to ~4s" is satisfied by
   * 250/500/1000/2000 (3.75s), by 250/500/1000/2000/4000 (7.75s) and by
   * 100/200/400/800/1600 (3.1s) alike; a green suite distinguished none of them,
   * and an implementation that ignored the constant outright would still pass.
   *
   * This one observes the real schedule — no `retryDelayMs` override — by
   * intercepting setTimeout and recording the requested durations (firing the
   * callback immediately, so the test itself never sleeps).
   */
  it('the delays it actually SLEEPS are exactly 250/500/1000/2000 — the seam is not used here', async () => {
    const slept = [];
    const realSetTimeout = setTimeout;
    const spy = jest.spyOn(global, 'setTimeout').mockImplementation((fn, ms) => {
      slept.push(ms);
      return realSetTimeout(fn, 0);
    });
    try {
      const attempt = jest.fn(async () => { throw new Error('database is locked'); });
      await expect(retryOnLockRace(attempt)).rejects.toThrow('database is locked');
      // 5 attempts ⇒ 4 sleeps, in this order and no other.
      expect(slept).toEqual([250, 500, 1000, 2000]);
      expect(attempt).toHaveBeenCalledTimes(5);
      expect(slept.reduce((a, b) => a + b, 0)).toBe(3750);
    } finally { spy.mockRestore(); }
  });

  it('a deterministic failure sleeps ZERO times, not merely fewer', async () => {
    const slept = [];
    const realSetTimeout = setTimeout;
    const spy = jest.spyOn(global, 'setTimeout').mockImplementation((fn, ms) => {
      slept.push(ms);
      return realSetTimeout(fn, 0);
    });
    try {
      const attempt = jest.fn(async () => { throw new Error('EADDRINUSE: port busy'); });
      await expect(retryOnLockRace(attempt)).rejects.toThrow(/EADDRINUSE/);
      expect(slept).toEqual([]);
      expect(attempt).toHaveBeenCalledTimes(1);
    } finally { spy.mockRestore(); }
  });

  it('a start that recovers on attempt 3 sleeps only the first two delays', async () => {
    const slept = [];
    const realSetTimeout = setTimeout;
    const spy = jest.spyOn(global, 'setTimeout').mockImplementation((fn, ms) => {
      slept.push(ms);
      return realSetTimeout(fn, 0);
    });
    try {
      let n = 0;
      const attempt = jest.fn(async () => {
        n += 1;
        if (n < 3) { throw new Error('database is locked'); }
        return 'started';
      });
      await expect(retryOnLockRace(attempt)).resolves.toBe('started');
      expect(slept).toEqual([250, 500]);
    } finally { spy.mockRestore(); }
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

/**
 * A server-START TIMEOUT is retryable — the field bug behind the v4.5.2 fix.
 *
 * `@opencode-ai/sdk` rejects with `Timeout waiting for server to start after
 * 5000ms` when OpenCode has not printed its listening line inside the SDK's
 * default window. On a slow box (sync-backed volume + AV scanning a cold
 * SQLite open) that window is simply too tight — and the failure is TRANSIENT,
 * exactly like a lock race. Before this fix the classifier matched only
 * `database is locked|database table is locked|SQLITE_BUSY`, so a start timeout
 * fell straight through `retryOnLockRace` with ZERO retries, past machinery
 * that already existed and was already wired in at every call site.
 *
 * Field evidence: a council run degraded to per-wave servers on this error and
 * then lost its entire Stage-1 bench (`COUNCIL_QUORUM: Only 0 … survived`).
 */
describe('timeout-class start failure is retryable (v4.5.2)', () => {
  const SDK_MESSAGE = 'Timeout waiting for server to start after 5000ms';

  it('classifies the SDK start-timeout message as timeout-class', () => {
    expect(isTimeoutClassStartFailure(new Error(SDK_MESSAGE))).toBe(true);
  });

  it('classifies it as retryable, but NOT as lock-class', () => {
    const err = new Error(SDK_MESSAGE);
    expect(isRetryableStartFailure(err)).toBe(true);
    // The two classes stay distinct: lock-class keeps its narrow meaning so the
    // existing docblock ("database is locked") does not quietly become a lie.
    expect(isLockClassStartFailure(err)).toBe(false);
  });

  it('matches whatever timeout the SDK reports, not just the 5000ms default', () => {
    expect(isTimeoutClassStartFailure(
      new Error('Timeout waiting for server to start after 20000ms'))).toBe(true);
  });

  it('matches when amicus has prefixed the message at the fanout boundary', () => {
    // src/sidecar/fanout.js wraps it as `Failed to start server: ${err.message}`.
    expect(isRetryableStartFailure(
      new Error(`Failed to start server: ${SDK_MESSAGE}`))).toBe(true);
  });

  it('retries a start timeout the full 5 attempts, then rethrows unchanged', async () => {
    const attempt = jest.fn(async () => { throw new Error(SDK_MESSAGE); });
    await expect(retryOnLockRace(attempt, { retryDelayMs: 0 }))
      .rejects.toThrow(SDK_MESSAGE);
    expect(attempt).toHaveBeenCalledTimes(5);
  });

  it('sleeps the real 250/500/1000/2000 schedule for a start timeout', async () => {
    const slept = [];
    const realSetTimeout = setTimeout;
    const spy = jest.spyOn(global, 'setTimeout').mockImplementation((fn, ms) => {
      slept.push(ms);
      return realSetTimeout(fn, 0);
    });
    try {
      const attempt = jest.fn(async () => { throw new Error(SDK_MESSAGE); });
      await expect(retryOnLockRace(attempt)).rejects.toThrow(SDK_MESSAGE);
      expect(slept).toEqual([250, 500, 1000, 2000]);
    } finally { spy.mockRestore(); }
  });

  it('a start that times out twice then succeeds returns the server', async () => {
    let n = 0;
    const attempt = jest.fn(async () => {
      n += 1;
      if (n < 3) { throw new Error(SDK_MESSAGE); }
      return 'started';
    });
    await expect(retryOnLockRace(attempt, { retryDelayMs: 0 })).resolves.toBe('started');
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  /**
   * Widening the class must not widen it into deterministic territory. A
   * REQUEST timeout is not a START timeout, and a missing binary never sleeps.
   */
  it('does not swallow unrelated timeouts or deterministic failures', () => {
    for (const msg of [
      'Request timeout after 30000ms',
      'ETIMEDOUT connect 127.0.0.1:4096',
      'ENOENT: opencode not found',
      'EADDRINUSE: port busy',
    ]) {
      expect(isTimeoutClassStartFailure(new Error(msg))).toBe(false);
      expect(isRetryableStartFailure(new Error(msg))).toBe(false);
    }
  });

  it('handles a null/undefined error without throwing', () => {
    expect(isTimeoutClassStartFailure(null)).toBe(false);
    expect(isRetryableStartFailure(undefined)).toBe(false);
  });
});

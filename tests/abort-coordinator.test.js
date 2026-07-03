'use strict';

jest.mock('../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const { abortGraceMs, isAlive, killPidBestEffort, waitThenKill } = require('../src/utils/abort-coordinator');

const esrch = () => { const e = new Error('kill ESRCH'); e.code = 'ESRCH'; throw e; };
const eperm = () => { const e = new Error('kill EPERM'); e.code = 'EPERM'; throw e; };

describe('abort-coordinator', () => {
  afterEach(() => { delete process.env.AMICUS_ABORT_GRACE_MS; });

  test('abortGraceMs defaults to 5000 and honors the env override', () => {
    expect(abortGraceMs()).toBe(5000);
    process.env.AMICUS_ABORT_GRACE_MS = '40';
    expect(abortGraceMs()).toBe(40);
    process.env.AMICUS_ABORT_GRACE_MS = 'garbage';
    expect(abortGraceMs()).toBe(5000);
  });

  test('isAlive: kill(pid,0) success => true; ESRCH => false; falsy pid => false', () => {
    expect(isAlive(123, jest.fn())).toBe(true);
    expect(isAlive(123, esrch)).toBe(false);
    expect(isAlive(null)).toBe(false);
  });

  test('isAlive: EPERM => true (process exists, caller lacks permission to signal it)', () => {
    expect(isAlive(123, eperm)).toBe(true);
  });

  test('killPidBestEffort SIGTERMs and swallows ESRCH', () => {
    const kill = jest.fn();
    expect(killPidBestEffort(42, kill)).toBe(true);
    expect(kill).toHaveBeenCalledWith(42, 'SIGTERM');
    expect(killPidBestEffort(42, esrch)).toBe(false); // must not throw
    expect(killPidBestEffort(null)).toBe(false);
  });

  test('waitThenKill never signals a process that exits during the grace window', async () => {
    let alive = true;
    const kill = jest.fn((pid, sig) => {
      if (!alive) { esrch(); }
      if (sig !== 0) { throw new Error('must not SIGTERM a marker-honoring process'); }
    });
    const sleep = jest.fn(async () => { alive = false; }); // process dies during first poll
    const res = await waitThenKill(42, { graceMs: 60000, pollMs: 1, deps: { kill, sleep } });
    expect(res.killed).toEqual([]);
    expect(res.exited).toEqual([42]);
  });

  test('waitThenKill SIGTERMs every survivor once the window closes (graceMs 0 = immediate)', async () => {
    const signals = [];
    const kill = jest.fn((pid, sig) => { if (sig !== 0) { signals.push(pid); } });
    const res = await waitThenKill([10, null, 20], { graceMs: 0, deps: { kill } });
    expect(res.killed).toEqual([10, 20]);
    expect(signals).toEqual([10, 20]);
  });

  test('waitThenKill with only falsy pids is a no-op', async () => {
    const kill = jest.fn();
    const res = await waitThenKill([null, undefined], { graceMs: 0, deps: { kill } });
    expect(res).toEqual({ killed: [], exited: [] });
    expect(kill).not.toHaveBeenCalled();
  });

  test('waitThenKill: an always-EPERM pid ends up in neither killed nor exited', async () => {
    const kill = jest.fn(eperm);
    const res = await waitThenKill(42, { graceMs: 0, deps: { kill } });
    expect(res.killed).not.toContain(42);
    expect(res.exited).not.toContain(42);
  });

  test('waitThenKill dedupes duplicate pids: at most one entry, one kill attempt', async () => {
    const kill = jest.fn((pid, sig) => { if (sig !== 0) { /* SIGTERM: succeed */ } });
    const res = await waitThenKill([10, 10, null], { graceMs: 0, deps: { kill } });
    expect(res.killed).toEqual([10]);
    expect(res.exited).toEqual([]);
    const termCalls = kill.mock.calls.filter(([, sig]) => sig === 'SIGTERM');
    expect(termCalls).toHaveLength(1);
  });

  describe('waitThenKill escalation (opt-in SIGKILL-after-grace, B06)', () => {
    test('alive through both windows: TERM then KILL observed in order', async () => {
      const signals = [];
      // Never dies on its own — isAlive always true until we assert order.
      const kill = jest.fn((pid, sig) => { if (sig !== 0) { signals.push(sig); } });
      const res = await waitThenKill(42, {
        graceMs: 0,
        deps: { kill },
        escalate: { killGraceMs: 0 },
      });
      expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
      expect(res.killed).toEqual([42]);
      expect(res.escalated).toEqual([42]);
    });

    test('dies during the kill-grace window after TERM: SIGTERM sent, but no SIGKILL follows', async () => {
      let alive = true;
      const kill = jest.fn((pid, sig) => {
        if (!alive) { esrch(); }
        if (sig === 'SIGTERM') { /* accepted, still alive until next poll */ }
        if (sig === 'SIGKILL') { throw new Error('must not SIGKILL a process that exited after TERM'); }
      });
      const sleep = jest.fn(async () => { alive = false; }); // dies on first post-TERM poll
      const res = await waitThenKill(42, {
        graceMs: 0,
        pollMs: 1,
        deps: { kill, sleep },
        escalate: { killGraceMs: 60000 },
      });
      expect(res.killed).toEqual([42]); // SIGTERM was sent (graceMs:0 => immediate)
      expect(res.escalated).toEqual([]); // but it exited before escalation needed to act
      expect(res.exited).toEqual([42]);
      const killSignals = kill.mock.calls.filter(([, sig]) => sig === 'SIGKILL');
      expect(killSignals).toHaveLength(0);
    });

    test('already dead at entry: single liveness probe, no TERM, no KILL, no escalation', async () => {
      const kill = jest.fn(esrch);
      const res = await waitThenKill(42, {
        graceMs: 60000,
        deps: { kill },
        escalate: { killGraceMs: 60000 },
      });
      expect(res.killed).toEqual([]);
      expect(res.escalated).toEqual([]);
      expect(res.exited).toEqual([42]);
      // Only the initial isAlive probe — no signals of any kind.
      expect(kill).toHaveBeenCalledTimes(1);
      expect(kill).toHaveBeenCalledWith(42, 0);
    });

    test('non-escalating callers see unchanged shape: no "escalated" key added behavior', async () => {
      const kill = jest.fn((pid, sig) => { if (sig !== 0) { /* accept */ } });
      const res = await waitThenKill([10, null, 20], { graceMs: 0, deps: { kill } });
      expect(res.killed).toEqual([10, 20]);
      // No SIGKILL ever sent when escalate is not requested.
      const killSignals = kill.mock.calls.filter(([, sig]) => sig === 'SIGKILL');
      expect(killSignals).toHaveLength(0);
    });
  });
});

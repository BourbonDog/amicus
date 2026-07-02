// tests/mcp-wait.test.js — write FIRST; fails with MODULE_NOT_FOUND until src/mcp-wait.js exists.
// Run: npx jest tests/mcp-wait.test.js
'use strict';

const {
  runWait, registerInProcessRun, settleInProcessRun, hasInProcessRun,
  clampTimeout, isTerminalSnapshot, DEFAULT_WAIT_MS, MAX_WAIT_MS,
} = require('../src/mcp-wait');

/** Wrap a payload the way amicus_status does. */
const statusResult = (payload) => ({ content: [{ type: 'text', text: JSON.stringify(payload) }] });

describe('clampTimeout', () => {
  test('defaults when absent, floors at 1s, caps at MAX_WAIT_MS', () => {
    expect(clampTimeout(undefined)).toBe(DEFAULT_WAIT_MS);
    expect(clampTimeout(1)).toBe(1000);
    expect(clampTimeout(99999999)).toBe(MAX_WAIT_MS);
    expect(clampTimeout(5000)).toBe(5000);
  });
});

describe('isTerminalSnapshot', () => {
  test('single: running/unknown not terminal; complete/error/timed-out are', () => {
    expect(isTerminalSnapshot({ status: 'running' })).toBe(false);
    expect(isTerminalSnapshot({ status: 'unknown' })).toBe(false);
    expect(isTerminalSnapshot({ status: 'complete' })).toBe(true);
    expect(isTerminalSnapshot({ status: 'timed-out' })).toBe(true); // NOT in TERMINAL_STATUSES — the allowlist trap
    expect(isTerminalSnapshot({ status: 'crashed' })).toBe(true);
  });
  test('wave: all legs terminal counts even while status says running', () => {
    expect(isTerminalSnapshot({ type: 'wave', status: 'running', legsComplete: 1, legsTotal: 3 })).toBe(false);
    expect(isTerminalSnapshot({ type: 'wave', status: 'running', legsComplete: 3, legsTotal: 3 })).toBe(true);
    expect(isTerminalSnapshot({ type: 'wave', status: 'partial', legsComplete: 2, legsTotal: 3 })).toBe(true);
  });
});

describe('runWait', () => {
  const fastSleep = () => Promise.resolve();

  test('returns immediately with timedOut:false when already terminal', async () => {
    const statusFn = jest.fn().mockResolvedValue(statusResult({ taskId: 't1', status: 'complete', elapsed: '1m 0s' }));
    const res = await runWait({ taskId: 't1' }, '/proj', { statusFn, sleep: fastSleep });
    const body = JSON.parse(res.content[0].text);
    expect(body.status).toBe('complete');
    expect(body.timedOut).toBe(false);
    expect(statusFn).toHaveBeenCalledTimes(1);
  });

  test('poll fallback: resolves when a later poll turns terminal', async () => {
    const seq = [
      statusResult({ taskId: 't1', status: 'running' }),
      statusResult({ taskId: 't1', status: 'running' }),
      statusResult({ taskId: 't1', status: 'complete' }),
    ];
    const statusFn = jest.fn(() => Promise.resolve(seq.shift()));
    const res = await runWait({ taskId: 't1', timeoutMs: 60000 }, '/proj', { statusFn, sleep: fastSleep });
    const body = JSON.parse(res.content[0].text);
    expect(body.status).toBe('complete');
    expect(body.timedOut).toBe(false);
    expect(statusFn).toHaveBeenCalledTimes(3);
  });

  test('returns {timedOut:true}+hint and strips next_poll at the deadline', async () => {
    const statusFn = jest.fn().mockResolvedValue(statusResult({
      taskId: 't1', status: 'running', next_poll: { hint: 'sleep 25' },
    }));
    let t = 0;
    const now = jest.fn(() => { t += 3000; return t; }); // each now() advances 3s → deadline crossed on 2nd loop
    const res = await runWait({ taskId: 't1', timeoutMs: 5000 }, '/proj', { statusFn, sleep: fastSleep, now });
    const body = JSON.parse(res.content[0].text);
    expect(body.timedOut).toBe(true);
    expect(body.status).toBe('running');
    expect(body.next_poll).toBeUndefined();
    expect(body.hint).toMatch(/amicus_wait again/);
  });

  test('wave: all-legs-terminal ends the wait while wave still says running', async () => {
    const statusFn = jest.fn().mockResolvedValue(statusResult({
      taskId: 'w1', type: 'wave', status: 'running', legsComplete: 2, legsTotal: 2, legs: [],
    }));
    const res = await runWait({ waveId: 'w1' }, '/proj', { statusFn, sleep: fastSleep });
    const body = JSON.parse(res.content[0].text);
    expect(body.timedOut).toBe(false);
    expect(statusFn).toHaveBeenCalledTimes(1);
  });

  test('in-process settle wakes the loop when the sleep arm never fires', async () => {
    registerInProcessRun('t-inproc');
    expect(hasInProcessRun('t-inproc')).toBe(true);
    const neverSleep = () => new Promise(() => {}); // ONLY the waiter can wake the loop
    let payload = { taskId: 't-inproc', status: 'running' };
    const statusFn = jest.fn(() => Promise.resolve(statusResult(payload)));
    const p = runWait({ taskId: 't-inproc', timeoutMs: 60000 }, '/proj', { statusFn, sleep: neverSleep });
    await new Promise((r) => setImmediate(r)); // let the first poll reach the race
    payload = { taskId: 't-inproc', status: 'complete' };
    settleInProcessRun('t-inproc'); // finalize landed → waiter resolves
    const body = JSON.parse((await p).content[0].text);
    expect(body.status).toBe('complete');
    expect(body.timedOut).toBe(false);
    expect(hasInProcessRun('t-inproc')).toBe(false);
  });

  test('propagates a not-found status error unchanged', async () => {
    const err = { isError: true, content: [{ type: 'text', text: 'Session nope not found' }] };
    const statusFn = jest.fn().mockResolvedValue(err);
    const res = await runWait({ taskId: 'nope' }, '/proj', { statusFn, sleep: fastSleep });
    expect(res.isError).toBe(true);
  });

  test('errors when neither taskId nor waveId is provided', async () => {
    const res = await runWait({}, '/proj', { statusFn: jest.fn(), sleep: fastSleep });
    expect(res.isError).toBe(true);
  });
});
// Expected: all fail (module missing) → all pass after implementation.

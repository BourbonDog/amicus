// tests/council/run-finalize.test.js
'use strict';

/**
 * The exit-code vocabulary extracted out of src/council/run.js (which sits on
 * the 300-line size gate): SIGNAL_EXIT, statusForExit, and resolveTerminalExit —
 * the ONE place a would-be-clean run degrades.
 *
 * tests/council/run-cost-unknown.test.js drives the same behaviour end-to-end
 * through runCouncil; this file pins the precedence rules in isolation, where a
 * scripted driver test cannot easily produce every combination.
 */

const { statusForExit, resolveTerminalExit, SIGNAL_EXIT } = require('../../src/council/run-finalize');
const { createDegradeSink } = require('../../src/council/run-degrade');

describe('statusForExit (spec §4 degradation table)', () => {
  test('maps every code the driver can produce', () => {
    expect(statusForExit(0)).toBe('complete');
    expect(statusForExit(1)).toBe('error');
    expect(statusForExit(2)).toBe('partial');
    expect(statusForExit(130)).toBe('aborted');
    expect(statusForExit(143)).toBe('aborted');
  });
});

describe('SIGNAL_EXIT', () => {
  test('is the signal → exit-code map, and is still re-exported from ./run', () => {
    expect(SIGNAL_EXIT).toEqual({ SIGINT: 130, SIGTERM: 143, SIGBREAK: 143 });
    expect(require('../../src/council/run').SIGNAL_EXIT).toBe(SIGNAL_EXIT);
  });
});

describe('resolveTerminalExit', () => {
  const deg = (value) => ({ value });

  test('a clean, undegraded run is 0', () => {
    expect(resolveTerminalExit({ signalled: null, exitCode: 0, degraded: deg(false) })).toBe(0);
  });

  test('the degrade flag turns 0 into 2 (a shrunken bench, a thin cross-review, …)', () => {
    expect(resolveTerminalExit({ signalled: null, exitCode: 0, degraded: deg(true) })).toBe(2);
  });

  /**
   * v4.4.1 CA-6 (owner ruling). A ceiling over a total we know to be a floor is
   * not a clean run. It is still not a BLOCKED run: nothing here refuses,
   * skips, or aborts anything — only the code the driver reports changes.
   */
  test('an inexact total under a ceiling degrades 0 → 2 through the SAME flag', () => {
    const degraded = deg(false);
    // v4.6 Task 8: the flip now happens through a degrade.note() call, not a
    // bare assignment — wire the real sink so degraded.value still flips.
    const degrade = createDegradeSink({ degraded, write: () => {} });
    expect(resolveTerminalExit({ signalled: null, exitCode: 0, degraded, degrade,
      inexactUnderCeiling: () => true })).toBe(2);
    expect(degraded.value).toBe(true);
  });

  test('an EXACT total under a ceiling leaves the flag and the code alone', () => {
    const degraded = deg(false);
    expect(resolveTerminalExit({ signalled: null, exitCode: 0, degraded,
      inexactUnderCeiling: () => false })).toBe(0);
    expect(degraded.value).toBe(false);
  });

  test('an ERROR is never re-labelled a degradation — a failure is not a partial run', () => {
    expect(resolveTerminalExit({ signalled: null, exitCode: 1, degraded: deg(true),
      inexactUnderCeiling: () => true })).toBe(1);
  });

  test('a signal wins over everything — an aborted run reports how it was killed', () => {
    const degraded = deg(false);
    expect(resolveTerminalExit({ signalled: 130, exitCode: 0, degraded,
      inexactUnderCeiling: () => true })).toBe(130);
    expect(resolveTerminalExit({ signalled: 143, exitCode: 1, degraded: deg(true) })).toBe(143);
    // …and it short-circuits before the degrade, so nothing is mutated on the way out.
    expect(degraded.value).toBe(false);
  });

  test('an already-degraded 2 stays 2 (idempotent for the paths that pre-compute it)', () => {
    expect(resolveTerminalExit({ signalled: null, exitCode: 2, degraded: deg(true),
      inexactUnderCeiling: () => true })).toBe(2);
  });

  test('no degraded object / no predicate → the code passes through untouched', () => {
    expect(resolveTerminalExit({ signalled: null, exitCode: 0 })).toBe(0);
    expect(resolveTerminalExit({ signalled: null, exitCode: 0, degraded: deg(false) })).toBe(0);
  });
});

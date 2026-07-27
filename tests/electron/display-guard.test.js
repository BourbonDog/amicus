'use strict';

/**
 * TST-10c — drive the Electron E2E skip guard's `HAS_DISPLAY === false` branch directly.
 *
 * Before this, that branch was defended by a comment claiming the expression was "copied
 * verbatim from the toolbar suite". Code-identity is not a test: the branch lives inside a
 * suite that skips itself precisely when the branch is true, so on a developer machine
 * (win32/darwin, or Linux with a real DISPLAY) it never executed, and on display-less CI it
 * executed but asserted nothing. A regression to `HAS_DISPLAY = true` would be invisible
 * locally and would surface only as five mysterious CDP timeouts in the `integration` CI job.
 *
 * Both functions are pure and take their inputs as arguments, so every branch runs on every
 * platform with no environment mutation and no cross-test leakage.
 */

const { hasDisplay, chooseDescribe } = require('../helpers/display-guard');

describe('hasDisplay', () => {
  test('linux with NO DISPLAY is the skip case — the one that keeps display-less CI green', () => {
    expect(hasDisplay('linux', {})).toBe(false);
    expect(hasDisplay('linux', { DISPLAY: '' })).toBe(false);
  });

  test('linux WITH a DISPLAY runs — including the :99 that ensureDisplay() provisions via Xvfb', () => {
    expect(hasDisplay('linux', { DISPLAY: ':99' })).toBe(true);
    expect(hasDisplay('linux', { DISPLAY: ':0' })).toBe(true);
  });

  test('non-linux platforms never need a DISPLAY', () => {
    expect(hasDisplay('win32', {})).toBe(true);
    expect(hasDisplay('darwin', {})).toBe(true);
  });

  test('it defaults to the real platform/env when called with no arguments', () => {
    expect(hasDisplay()).toBe(hasDisplay(process.platform, process.env));
  });
});

describe('chooseDescribe', () => {
  test('a missing display skips the suite even when electron IS installed', () => {
    // The exact combination that broke CI before the guard existed.
    expect(chooseDescribe(true, false)).toBe(describe.skip);
  });

  test('a missing electron binary skips the suite even when a display IS available', () => {
    expect(chooseDescribe(false, true)).toBe(describe.skip);
  });

  test('neither available also skips', () => {
    expect(chooseDescribe(false, false)).toBe(describe.skip);
  });

  test('both available runs the real suite', () => {
    expect(chooseDescribe(true, true)).toBe(describe);
  });
});

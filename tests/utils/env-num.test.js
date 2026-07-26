// tests/utils/env-num.test.js
'use strict';

/**
 * v4.4 cost-council finding 3 — `Number(process.env.X) || default` discards an
 * explicit `0`.
 *
 * `0` is the DOCUMENTED "turn this off" value for the v4.4 settle knobs
 * (`AMICUS_USAGE_SETTLE_POLLS`, `AMICUS_TOOL_SETTLE_GRACE_MS`), and `0` is
 * falsy — so `Number(process.env.AMICUS_USAGE_SETTLE_POLLS) || 3` silently
 * rewrote the operator's "off" into "3". The escape hatch documented in the
 * module docblock and the CHANGELOG could not be reached from the environment
 * at all.
 *
 * `envNumber` is the shared replacement: an explicit numeric value ALWAYS
 * wins, including `0`; only unset / blank / non-numeric falls back.
 */

const { envNumber } = require('../../src/utils/env-num');

describe('envNumber', () => {
  test('an explicit 0 is honored, not swallowed by the default (the defect)', () => {
    expect(envNumber('X', 3, { X: '0' })).toBe(0);
    expect(envNumber('X', 300000, { X: '0' })).toBe(0);
  });

  test('a normal numeric override wins', () => {
    expect(envNumber('X', 3, { X: '7' })).toBe(7);
    expect(envNumber('X', 400, { X: '1250' })).toBe(1250);
  });

  test('unset falls back to the default', () => {
    expect(envNumber('X', 3, {})).toBe(3);
    expect(envNumber('X', 3, { X: undefined })).toBe(3);
  });

  test('blank / whitespace-only falls back (an empty export is not "0")', () => {
    // Number('') === 0, so a bare `export AMICUS_USAGE_SETTLE_POLLS=` would
    // otherwise read as an intentional disable. It is not one.
    expect(envNumber('X', 3, { X: '' })).toBe(3);
    expect(envNumber('X', 3, { X: '   ' })).toBe(3);
  });

  test('non-numeric and non-finite fall back rather than poisoning a timer', () => {
    expect(envNumber('X', 3, { X: 'nope' })).toBe(3);
    expect(envNumber('X', 3, { X: 'Infinity' })).toBe(3);
    expect(envNumber('X', 3, { X: 'NaN' })).toBe(3);
  });

  test('surrounding whitespace on a real value is tolerated', () => {
    expect(envNumber('X', 3, { X: ' 0 ' })).toBe(0);
    expect(envNumber('X', 3, { X: ' 12 ' })).toBe(12);
  });

  test('reads process.env when no env object is supplied', () => {
    const prev = process.env.AMICUS_ENV_NUM_PROBE;
    try {
      process.env.AMICUS_ENV_NUM_PROBE = '0';
      expect(envNumber('AMICUS_ENV_NUM_PROBE', 9)).toBe(0);
    } finally {
      if (prev === undefined) { delete process.env.AMICUS_ENV_NUM_PROBE; }
      else { process.env.AMICUS_ENV_NUM_PROBE = prev; }
    }
  });
});

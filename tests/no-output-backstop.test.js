'use strict';

const {
  resolveNoOutputBackstopMs, createNoOutputBackstop,
} = require('../src/utils/no-output-backstop');

describe('resolveNoOutputBackstopMs', () => {
  test('default 300000 when unset', () => {
    expect(resolveNoOutputBackstopMs({})).toBe(300000);
  });
  test('explicit value wins', () => {
    expect(resolveNoOutputBackstopMs({ AMICUS_NO_OUTPUT_BACKSTOP_MS: '30000' })).toBe(30000);
  });
  test('explicit 0 is honored (the documented disable)', () => {
    expect(resolveNoOutputBackstopMs({ AMICUS_NO_OUTPUT_BACKSTOP_MS: '0' })).toBe(0);
  });
  test('blank and non-finite fall back to the default', () => {
    expect(resolveNoOutputBackstopMs({ AMICUS_NO_OUTPUT_BACKSTOP_MS: '' })).toBe(300000);
    expect(resolveNoOutputBackstopMs({ AMICUS_NO_OUTPUT_BACKSTOP_MS: 'Infinity' })).toBe(300000);
  });
});

describe('createNoOutputBackstop', () => {
  const T0 = 1_000_000;

  test('fires at the deadline when nothing ever progressed', () => {
    const b = createNoOutputBackstop({ ms: 120000, startedAt: T0 });
    expect(b.tick(false, T0 + 119999)).toBe('armed');
    expect(b.tick(false, T0 + 120000)).toBe('fired');
  });

  test('first progress disarms permanently — later silence never fires', () => {
    const b = createNoOutputBackstop({ ms: 120000, startedAt: T0 });
    expect(b.tick(true, T0 + 5000)).toBe('disarmed');
    expect(b.tick(false, T0 + 500000)).toBe('disarmed');
    expect(b.state()).toBe('disarmed');
  });

  test('fired is terminal — later ticks stay fired and progress cannot resurrect it', () => {
    const b = createNoOutputBackstop({ ms: 1000, startedAt: T0 });
    expect(b.tick(false, T0 + 1000)).toBe('fired');
    expect(b.tick(true, T0 + 2000)).toBe('fired');
  });

  test('ms <= 0 never arms', () => {
    const off = createNoOutputBackstop({ ms: 0, startedAt: T0 });
    expect(off.tick(false, T0 + 10_000_000)).toBe('disarmed');
    const neg = createNoOutputBackstop({ ms: -5, startedAt: T0 });
    expect(neg.tick(false, T0 + 10_000_000)).toBe('disarmed');
  });
});

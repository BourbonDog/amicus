'use strict';
/**
 * Issue #214: `String(model).startsWith('openrouter/') ? 'openrouter' : 'direct'`
 * was written out three times (fanout-leg-fallback, reopen-spend, start). Each
 * copy was correct, but three copies of a routing predicate is three places to
 * get it wrong later. gateway-router already owns the inverse (executableFor).
 */
const { gatewayOf } = require('../src/utils/gateway-router');

describe('gatewayOf (#214)', () => {
  test('an openrouter/-prefixed id is gateway-routed', () => {
    expect(gatewayOf('openrouter/deepseek/deepseek-v4-pro')).toBe('openrouter');
  });

  test('a bare vendor/model id is direct', () => {
    expect(gatewayOf('deepseek/deepseek-v4-pro')).toBe('direct');
  });

  test('a vendor merely NAMED like the prefix is still direct', () => {
    expect(gatewayOf('openrouterish/model')).toBe('direct');
  });

  test('non-string input is direct, never a throw (callers pass raw metadata)', () => {
    expect(gatewayOf(undefined)).toBe('direct');
    expect(gatewayOf(null)).toBe('direct');
    expect(gatewayOf(42)).toBe('direct');
  });
});

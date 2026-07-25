'use strict';

const { classifyLegError, isRetryable } = require('../../src/utils/error-classify');

describe('classifyLegError (spec 6.2)', () => {
  test.each([
    ['HTTP 429 Too Many Requests', 'rate-limit'],
    ['rate limit exceeded for model', 'rate-limit'],
    ['quota exceeded', 'rate-limit'],
    ['resource exhausted', 'rate-limit'],
    ['529 overloaded', 'overload'],
    ['503 Service Unavailable', 'overload'],
    ['server busy, try later', 'overload'],
    ['capacity constraints', 'overload'],
    ['401 Unauthorized: invalid api key', 'auth'],
    ['403 forbidden', 'auth'],
    ['request timed out after 900000ms', 'timeout'],
    ['some other explosion', 'other'],
    ['', 'other'],
    [undefined, 'other'],
  ])('%s -> %s', (msg, expected) => {
    expect(classifyLegError(msg)).toBe(expected);
  });
});

describe('isRetryable — capacity signals only (resolved Q3)', () => {
  test('rate-limit and overload are retryable; timeout/auth/other are NOT', () => {
    expect(isRetryable('rate-limit')).toBe(true);
    expect(isRetryable('overload')).toBe(true);
    expect(isRetryable('timeout')).toBe(false);
    expect(isRetryable('auth')).toBe(false);
    expect(isRetryable('other')).toBe(false);
  });
});

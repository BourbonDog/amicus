// tests/helpers/doctor-base-deps.test.js
'use strict';

const { makeBaseDeps } = require('./doctor-base-deps');

describe('helpers/doctor-base-deps: makeBaseDeps() contract', () => {
  test('a bare call has exactly 27 keys', () => {
    expect(Object.keys(makeBaseDeps())).toHaveLength(27);
  });

  test('omit produces true key ABSENCE, not key: undefined', () => {
    expect('getElectronPath' in makeBaseDeps({ omit: ['getElectronPath'] })).toBe(false);
  });

  test('two calls yield different probeLocalProvider jest.fn instances', () => {
    expect(makeBaseDeps().probeLocalProvider).not.toBe(makeBaseDeps().probeLocalProvider);
  });
});

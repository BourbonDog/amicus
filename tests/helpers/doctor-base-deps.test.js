// tests/helpers/doctor-base-deps.test.js
'use strict';

const { makeBaseDeps } = require('./doctor-base-deps');

describe('helpers/doctor-base-deps: makeBaseDeps() contract', () => {
  // B3 (council review of PR 198): +2 keys (findFabricatedAliasRepairs, repairAlias).
  // #210: +1 key (validateApiKey) — the key-auth check's injectable probe.
  test('a bare call has exactly 30 keys', () => {
    expect(Object.keys(makeBaseDeps())).toHaveLength(30);
  });

  test('omit produces true key ABSENCE, not key: undefined', () => {
    expect('getElectronPath' in makeBaseDeps({ omit: ['getElectronPath'] })).toBe(false);
  });

  test('two calls yield different probeLocalProvider jest.fn instances', () => {
    expect(makeBaseDeps().probeLocalProvider).not.toBe(makeBaseDeps().probeLocalProvider);
  });
});

// tests/helpers/doctor-base-deps.test.js
'use strict';

const { makeBaseDeps } = require('./doctor-base-deps');

describe('helpers/doctor-base-deps: makeBaseDeps() contract', () => {
  // B3 (council review of PR 198): +2 keys (findFabricatedAliasRepairs, repairAlias).
  // #210: +1 key (validateApiKey) — the key-auth check's injectable probe.
  // #218 PR 2: +1 key (readOutputBudgetRaw) — the output-budget row's read of the stored value.
  // #238 Phase 2 follow-up: +3 keys (loadCuratedPins, buildFallbackDriftReport,
  // isSourceCheckout) — the curated-pins row's facts + owner-checkout hint.
  test('a bare call has exactly 34 keys', () => {
    expect(Object.keys(makeBaseDeps())).toHaveLength(34);
  });

  test('omit produces true key ABSENCE, not key: undefined', () => {
    expect('getElectronPath' in makeBaseDeps({ omit: ['getElectronPath'] })).toBe(false);
  });

  test('two calls yield different probeLocalProvider jest.fn instances', () => {
    expect(makeBaseDeps().probeLocalProvider).not.toBe(makeBaseDeps().probeLocalProvider);
  });
});

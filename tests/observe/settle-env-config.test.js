// tests/observe/settle-env-config.test.js
'use strict';

/**
 * v4.4 cost-council finding 3, at the real call sites.
 *
 * The four knobs introduced by 21eefa2 / dcb0792 all documented `0` as a
 * meaningful value ("disable the re-poll", "disable the deferral", "no extra
 * timer"), and all four parsed it with `Number(process.env.X) || default` —
 * which turns the operator's explicit `0` back into the default. These tests
 * re-require src/headless.js with the environment set and assert the exported
 * constants, so they fail against the `||` form and pass against `envNumber`.
 *
 * Scope note: the PRE-EXISTING knobs (AMICUS_POLL_INTERVAL_MS,
 * AMICUS_STABLE_*_POLLS, AMICUS_POLL_CALL_TIMEOUT_MS,
 * AMICUS_MAX_CONSECUTIVE_POLL_FAILURES, AMICUS_TOOL_CALL_STALL_MS) are
 * deliberately left on `||`: `0` is not a documented escape hatch for any of
 * them and honoring it would busy-loop the poller or disable a stall guard.
 */

const KNOBS = [
  ['AMICUS_USAGE_SETTLE_POLLS', 'USAGE_SETTLE_POLLS', 3],
  ['AMICUS_USAGE_SETTLE_INTERVAL_MS', 'USAGE_SETTLE_INTERVAL_MS', 400],
  ['AMICUS_USAGE_SETTLE_CALL_TIMEOUT_MS', 'USAGE_SETTLE_CALL_TIMEOUT_MS', 5000],
  ['AMICUS_TOOL_SETTLE_GRACE_MS', 'TOOL_SETTLE_GRACE_MS', 300000],
];

/** Re-require headless.js with `env` applied, then restore the environment. */
function loadHeadlessWith(env) {
  const saved = {};
  for (const key of Object.keys(env)) { saved[key] = process.env[key]; }
  try {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) { delete process.env[key]; } else { process.env[key] = value; }
    }
    let mod;
    jest.isolateModules(() => { mod = require('../../src/headless'); });
    return mod;
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) { delete process.env[key]; } else { process.env[key] = value; }
    }
  }
}

describe('v4.4 settle knobs: an explicit 0 must reach the constant', () => {
  test.each(KNOBS)('%s=0 yields 0 (the documented disable)', (envName, exportName) => {
    const mod = loadHeadlessWith({ [envName]: '0' });
    expect(mod[exportName]).toBe(0);
  });

  test.each(KNOBS)('%s unset yields the documented default', (envName, exportName, dflt) => {
    const mod = loadHeadlessWith({ [envName]: undefined });
    expect(mod[exportName]).toBe(dflt);
  });

  test.each(KNOBS)('%s with a real value is honored', (envName, exportName) => {
    const mod = loadHeadlessWith({ [envName]: '11' });
    expect(mod[exportName]).toBe(11);
  });

  test.each(KNOBS)('%s set to garbage falls back to the default', (envName, exportName, dflt) => {
    const mod = loadHeadlessWith({ [envName]: 'later' });
    expect(mod[exportName]).toBe(dflt);
  });

  // A bare `export AMICUS_USAGE_SETTLE_POLLS=` is an EMPTY value, not a zero —
  // Number('') === 0 would otherwise silently disable the re-poll for anyone
  // who exported the variable without a value.
  test.each(KNOBS)('%s set to an empty string is NOT read as 0', (envName, exportName, dflt) => {
    const mod = loadHeadlessWith({ [envName]: '' });
    expect(mod[exportName]).toBe(dflt);
  });
});

describe('pre-v4.4 poll knobs are deliberately out of scope', () => {
  test('AMICUS_POLL_INTERVAL_MS=0 still falls back (a 0 ms poll would spin)', () => {
    const mod = loadHeadlessWith({ AMICUS_POLL_INTERVAL_MS: '0' });
    expect(mod.POLL_INTERVAL_MS).toBe(2000);
  });
});

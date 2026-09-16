// tests/utils/alias-refresh-state.test.js
'use strict';
/**
 * #238 D5/Q8 — the ONE predicate behind the alias notice and the background
 * refresh (one test per term, spec §6 row 7), the `amicus aliases` footer
 * line (spec §4), and the cache-only catalogInfo read. Pure: env and config
 * are arguments, never process state.
 */
const {
  refreshState, exitHookAllowed, refreshStateLine, catalogInfoFromCache, REFRESH_MAX_AGE_MS,
} = require('../../src/utils/alias-refresh-state');

const H = 60 * 60 * 1000;
const D = 24 * H;
const NOW = 1_800_000_000_000;
const clean = () => ({ PATH: 'x' });   // an env carrying none of the signals

describe('refreshState — the standing half (config, env, CI)', () => {
  test('nothing set: enabled', () => {
    expect(refreshState({ config: null, env: clean() })).toEqual({ enabled: true, disabledBy: null });
    expect(refreshState({ config: { aliasReview: { dismissed: {} } }, env: clean() })).toEqual({ enabled: true, disabledBy: null });
  });
  test('config: only a literal autoRefresh false disables (mutant CONFIGSTRING: "false" or 0 would)', () => {
    expect(refreshState({ config: { aliasReview: { autoRefresh: false } }, env: clean() })).toEqual({ enabled: false, disabledBy: 'config' });
    expect(refreshState({ config: { aliasReview: { autoRefresh: 'false' } }, env: clean() }).enabled).toBe(true);
    expect(refreshState({ config: { aliasReview: { autoRefresh: 0 } }, env: clean() }).enabled).toBe(true);
    expect(refreshState({ config: { aliasReview: null }, env: clean() }).enabled).toBe(true);
  });
  test('env: only AMICUS_NO_NETWORK_PROBES=1 disables — the live-probes literal (mutant ENVANY: "0"/"true" would)', () => {
    expect(refreshState({ env: { ...clean(), AMICUS_NO_NETWORK_PROBES: '1' } })).toEqual({ enabled: false, disabledBy: 'env' });
    expect(refreshState({ env: { ...clean(), AMICUS_NO_NETWORK_PROBES: '0' } }).enabled).toBe(true);
    expect(refreshState({ env: { ...clean(), AMICUS_NO_NETWORK_PROBES: 'true' } }).enabled).toBe(true);
  });
  test("CI: is-in-ci's signal — CI set, CONTINUOUS_INTEGRATION set, any CI_* variable; CI=0 / CI=false are NOT CI (mutant CIFALSE)", () => {
    expect(refreshState({ env: { ...clean(), CI: 'true' } })).toEqual({ enabled: false, disabledBy: 'ci' });
    expect(refreshState({ env: { ...clean(), CI: '' } }).disabledBy).toBe('ci');              // presence, not truthiness
    expect(refreshState({ env: { ...clean(), CONTINUOUS_INTEGRATION: '1' } }).disabledBy).toBe('ci');
    expect(refreshState({ env: { ...clean(), CI_NAME: 'x' } }).disabledBy).toBe('ci');
    expect(refreshState({ env: { ...clean(), CI: '0' } }).enabled).toBe(true);
    expect(refreshState({ env: { ...clean(), CI: 'false' } }).enabled).toBe(true);
    expect(refreshState({ env: { ...clean(), CI: '0', CI_NAME: 'x' } }).enabled).toBe(true);  // CI=0 overrides the prefix signal, as in is-in-ci
    expect(refreshState({ env: { ...clean(), CIRCLE: '1' } }).enabled).toBe(true);            // no underscore: not the CI_ prefix
  });
  test('reason precedence: config, then env, then CI', () => {
    const env = { ...clean(), AMICUS_NO_NETWORK_PROBES: '1', CI: 'true' };
    expect(refreshState({ config: { aliasReview: { autoRefresh: false } }, env }).disabledBy).toBe('config');
    expect(refreshState({ env }).disabledBy).toBe('env');
  });
});

describe('exitHookAllowed — the per-invocation half, one term each', () => {
  const ok = { command: 'list', args: {}, stdinIsTTY: true, config: null, env: clean() };
  test('all clear: allowed', () => { expect(exitHookAllowed(ok)).toBe(true); });
  test('no terminal on stdin (mutant TTYOFF)', () => { expect(exitHookAllowed({ ...ok, stdinIsTTY: false })).toBe(false); });
  test('--json (mutant JSONON)', () => { expect(exitHookAllowed({ ...ok, args: { json: true } })).toBe(false); });
  test('--quiet, boolean or valued — quiet is not a BOOLEAN_FLAG, so `--quiet x` parses as "x" (mutant QUIETON)', () => {
    expect(exitHookAllowed({ ...ok, args: { quiet: true } })).toBe(false);
    expect(exitHookAllowed({ ...ok, args: { quiet: 'x' } })).toBe(false);
  });
  test('the mcp command (mutant MCPON)', () => { expect(exitHookAllowed({ ...ok, command: 'mcp' })).toBe(false); });
  test('the update command — its exit runs after the install directory was replaced (R-P4-12; mutant UPDATEON)', () => { expect(exitHookAllowed({ ...ok, command: 'update' })).toBe(false); });
  test('no command — a bare `amicus` printing usage is not a run (R-P4-12; mutant NOCOMMAND)', () => {
    expect(exitHookAllowed({ ...ok, command: undefined })).toBe(false);
    expect(exitHookAllowed({ ...ok, command: '' })).toBe(false);
  });
  test('the standing half is consulted: CI, env, config each veto', () => {
    expect(exitHookAllowed({ ...ok, env: { ...clean(), CI: 'true' } })).toBe(false);
    expect(exitHookAllowed({ ...ok, env: { ...clean(), AMICUS_NO_NETWORK_PROBES: '1' } })).toBe(false);
    expect(exitHookAllowed({ ...ok, config: { aliasReview: { autoRefresh: false } } })).toBe(false);
  });
  test('a missing args object is not a crash', () => { expect(exitHookAllowed({ ...ok, args: undefined })).toBe(true); });
});

describe('refreshStateLine — the amicus aliases footer (spec §4)', () => {
  const on = { enabled: true, disabledBy: null };
  test("on, three days old: the spec's example line, no hint", () => {
    expect(refreshStateLine(on, NOW - 3 * D, NOW)).toBe('  background catalog refresh: on (weekly) — catalog is 3 days old');
  });
  test('ages read as the Electron banner does: hours below a day, never "0 hours", singulars (mutant AGEWORD)', () => {
    expect(refreshStateLine(on, NOW - 5 * H, NOW)).toContain('catalog is 5 hours old');
    expect(refreshStateLine(on, NOW - 30 * 60 * 1000, NOW)).toContain('catalog is 1 hour old');
    expect(refreshStateLine(on, NOW - 25 * H, NOW)).toContain('catalog is 1 day old');
    expect(refreshStateLine(on, NOW + H, NOW)).toContain('catalog is 1 hour old');   // a future stamp never reads negative
    expect(refreshStateLine(on, null, NOW)).toBe('  background catalog refresh: on (weekly) — no catalog');
  });
  test('off: names the reason in the words the user can act on', () => {
    expect(refreshStateLine({ enabled: false, disabledBy: 'config' }, NOW - H, NOW))
      .toBe('  background catalog refresh: off (aliasReview.autoRefresh: false) — catalog is 1 hour old');
    expect(refreshStateLine({ enabled: false, disabledBy: 'env' }, NOW - H, NOW)).toContain('off (AMICUS_NO_NETWORK_PROBES=1)');
    expect(refreshStateLine({ enabled: false, disabledBy: 'ci' }, NOW - H, NOW)).toContain('off (CI)');
  });
  test('the models --refresh hint rides exactly when nothing else will refresh: off past 24 h, on past a week (mutant HINTALWAYS)', () => {
    const off = { enabled: false, disabledBy: 'config' };
    expect(refreshStateLine(off, NOW - 25 * H, NOW)).toMatch(/ — amicus models --refresh$/);
    expect(refreshStateLine(off, NOW - 23 * H, NOW)).not.toContain('models --refresh');
    expect(refreshStateLine(on, NOW - 3 * D, NOW)).not.toContain('models --refresh');
    expect(refreshStateLine(on, NOW - REFRESH_MAX_AGE_MS - 1, NOW)).toMatch(/catalog is 7 days old — amicus models --refresh$/);
    expect(refreshStateLine(on, NOW - REFRESH_MAX_AGE_MS, NOW)).not.toContain('models --refresh');
  });
});

describe('catalogInfoFromCache — the §5 display-gate read', () => {
  test('no cache: the empty shape the engine treats as "nothing"', () => {
    expect(catalogInfoFromCache(null)).toEqual({ models: [], fetchedAt: null, providerFailures: [] });
  });
  test('a cache doc: models and providerFailures verbatim, fetchedAt only when a number', () => {
    const models = [{ id: 'a/b' }];
    expect(catalogInfoFromCache({ models, fetchedAt: 5, providerFailures: [{ provider: 'x' }] }))
      .toEqual({ models, fetchedAt: 5, providerFailures: [{ provider: 'x' }] });
    expect(catalogInfoFromCache({ models, fetchedAt: '5', providerFailures: {} }))
      .toEqual({ models, fetchedAt: null, providerFailures: [] });
  });
  test('REFRESH_MAX_AGE_MS is a week', () => { expect(REFRESH_MAX_AGE_MS).toBe(7 * D); });
});

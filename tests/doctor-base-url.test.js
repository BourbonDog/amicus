'use strict';

const { evaluateAnthropicBaseUrl } = require('../src/utils/doctor-base-url-check');

describe('evaluateAnthropicBaseUrl', () => {
  test('unset -> ok "not set"', () => {
    const row = evaluateAnthropicBaseUrl({ env: {} });
    expect(row).toMatchObject({ id: 'anthropic-base-url', status: 'ok', message: 'not set' });
  });

  test('full-prefix form -> ok, value shown', () => {
    const row = evaluateAnthropicBaseUrl({ env: { ANTHROPIC_BASE_URL: 'https://x.test/v1' } });
    expect(row.status).toBe('ok');
    expect(row.message).toContain('https://x.test/v1');
    expect(row.message).toContain('full-prefix');
  });

  test('host form -> warn, prints the value it SEES and the treatment', () => {
    const row = evaluateAnthropicBaseUrl({ env: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' } });
    expect(row.status).toBe('warn');
    expect(row.message).toContain('https://api.anthropic.com');
    expect(row.message).toContain('https://api.anthropic.com/v1');
    expect(row.message).toMatch(/passes .*\/v1 to the engine/);
    expect(row.hint).toBeNull();
  });

  test('host form with normalization disabled -> warn + actionable hint', () => {
    const row = evaluateAnthropicBaseUrl({
      env: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com', AMICUS_BASE_URL_NORMALIZE: '0' },
    });
    expect(row.status).toBe('warn');
    expect(row.message).toContain('disabled');
    expect(row.hint).toContain('https://api.anthropic.com/v1');
  });

  test('nonstandard path -> ok, passed through unchanged', () => {
    const row = evaluateAnthropicBaseUrl({ env: { ANTHROPIC_BASE_URL: 'https://gw.test/custom' } });
    expect(row.status).toBe('ok');
    expect(row.message).toContain('passed through unchanged');
  });
});

// Hermeticity guard (final-review Item 1): runDoctorChecks always computes
// the FULL check list, not just 'anthropic-base-url' -- calling it bare (as
// this test used to) leaves every dep to fall through to realDeps() and run
// for real: engine-install subprocess scans, the OpenRouter credit network
// probe, local-provider probes against the real user config, etc. baseDeps
// mirrors the same full-deps shape as tests/cli-handlers-doctor.test.js's
// `allGood` fixture (see that file's M14 comment for the original writeup of
// this exact hazard) so this file's registration test never touches real IO.
const { makeBaseDeps } = require('./helpers/doctor-base-deps');
const baseDeps = makeBaseDeps();

describe('doctor registration', () => {
  test('runDoctorChecks carries the anthropic-base-url row', async () => {
    const { runDoctorChecks } = require('../src/cli-handlers-doctor');
    const rows = await runDoctorChecks(baseDeps);
    expect(rows.map(r => r.id)).toContain('anthropic-base-url');
  });
});

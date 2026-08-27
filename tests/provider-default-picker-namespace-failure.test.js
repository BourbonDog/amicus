'use strict';
/**
 * Issue #208, production-path pin.
 *
 * `directFormIfSafe` gained a namespace-failure gate, but the picker
 * RECONSTRUCTS its own `catalogInfo` from a bare catalog array
 * (provider-default-picker.js:123 / :274). Without threading the failure list
 * through, the gate is dead code on the only path the wizard actually takes --
 * a green unit test against a branch production never enters.
 */
const { buildProviderDefaultChoices } = require('../src/utils/provider-default-picker');
const { buildModelShortlist } = require('../src/utils/model-shortlist');

// deepseek's DIRECT namespace is absent -- exactly the shape a 401'd fetch
// leaves behind. Only OpenRouter rows survive.
const CATALOG = [
  { id: 'openrouter/deepseek/deepseek-v4-flash-0731', name: 'DeepSeek V4 Flash 0731',
    pricing: { prompt: '0.0000002', completion: '0.0000008' } },
  { id: 'openrouter/deepseek/deepseek-v4-pro', name: 'DeepSeek V4 Pro',
    pricing: { prompt: '0.0000005', completion: '0.000002' } },
];
const FAILURES = [{ provider: 'deepseek', reason: 'http-status', status: 401 }];

describe('provider-default-picker: namespace fetch failure suppresses synthesis (#208)', () => {
  test('offers no bare direct id when the vendor namespace fetch was rejected', () => {
    const { rows } = buildProviderDefaultChoices('deepseek', {
      catalog: CATALOG, providerFailures: FAILURES,
    });
    expect(rows.length).toBeGreaterThan(0);
    const bare = rows.filter(r => !r.id.startsWith('openrouter/'));
    expect(bare).toEqual([]);
  });

  test('still synthesises when nothing recorded a failure (optimism preserved)', () => {
    const { rows } = buildProviderDefaultChoices('deepseek', {
      catalog: CATALOG, providerFailures: [],
    });
    expect(rows.some(r => r.id.startsWith('deepseek/'))).toBe(true);
  });
});

describe('model-shortlist: threads providerFailures to the picker (#208)', () => {
  test('shortlist rows carry no bare direct id for a rejected namespace', () => {
    const { suggested, rest } = buildModelShortlist('deepseek', {
      catalog: CATALOG, providerFailures: FAILURES,
    });
    const all = [...suggested, ...rest];
    expect(all.length).toBeGreaterThan(0);
    expect(all.filter(r => !r.id.startsWith('openrouter/'))).toEqual([]);
  });
});

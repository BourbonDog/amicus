'use strict';

/**
 * Rewritten (post-review fix, Task 9 Critical). The original version of this
 * file called `pricePerMInputFrom(localRow)`, passing the local catalog row
 * DIRECTLY as the `orRow` argument -- a call shape that never happens at the
 * real call site. `buildRows` (provider-default-picker.js) always passes the
 * separately-derived OpenRouter-namespace twin, which is null for every
 * local vendor by construction (OpenRouter cannot proxy a localhost model).
 * That let the picker ship displaying "n/a" for every local model's price
 * while this exact unit kept passing -- it proved the helper COULD handle a
 * `{prompt:0}` object, never that the picker actually fed it one.
 *
 * These tests instead drive `buildProviderDefaultChoices` end-to-end with a
 * local-shaped catalog (mirrors `local-probe.js`'s `listLocalModels` output:
 * direct-namespace id, `pricing: {prompt:0, completion:0}`, `local: true`),
 * so a regression here has to break through the same path the real picker
 * uses.
 */
describe('provider-default-picker: local vendor $0 display (end-to-end)', () => {
  afterEach(() => jest.resetModules());

  /**
   * Fresh `provider-default-picker` / `provider-default-prompt` requires
   * with `local-providers` mocked to a fixed id list -- deterministic, no
   * dependency on real config/fs state. Both modules pick up the same mock
   * since `jest.doMock` applies to every requirer until the next
   * `resetModules()`.
   * @param {string[]} localIds
   */
  function load(localIds) {
    jest.resetModules();
    jest.doMock('../src/utils/local-providers', () => ({
      isLocalProvider: (id) => localIds.includes(id),
      getLocalProviders: () => Object.fromEntries(localIds.map((id) => [id, { id }])),
    }));
    return {
      picker: require('../src/utils/provider-default-picker'),
      prompt: require('../src/utils/provider-default-prompt'),
    };
  }

  test('a local row prices at exactly 0 (not null), and the rendered choice shows "$0.00/M in" (not "n/a")', () => {
    const { picker, prompt } = load(['ollama']);
    const catalog = [
      { id: 'ollama/llama3.3', name: 'llama3.3', contextLength: 8192,
        pricing: { prompt: 0, completion: 0 }, local: true },
    ];

    const { rows } = picker.buildProviderDefaultChoices('ollama', { catalog, tier: 'balanced' });

    expect(rows).toHaveLength(1);
    expect(rows[0].pricePerMInput).toBe(0);
    expect(rows[0].pricePerMInput).not.toBeNull();

    const line = prompt.formatRow({ ...rows[0], isPreselected: true }, 1);
    expect(line).toContain('$0.00/M in');
    expect(line).not.toContain('n/a');
  });

  test('cheapest-row preselection actually compares price for an all-local catalog, not catalog order (2nd consequence of the same root cause)', () => {
    const { picker } = load(['ollama']);
    // 'ollama' has no model-tiers.js TIERS entry, so resolveTier() always
    // returns null for it and computePreselectedId falls straight through
    // to the priced-cheapest fallback -- exercising exactly the branch that
    // was silently vacuous (`rows.filter(r => r.pricePerMInput !== null)`
    // was always empty) before this fix.
    //
    // The metered (non-zero) row is listed FIRST and the free row SECOND:
    // pre-fix, both priced `null` and the fallback silently took
    // `rows[0].id` (catalog order) -- the metered, more expensive one. If
    // that bug were still present this assertion would catch it, since the
    // correct cheapest-row answer is the row listed second.
    const catalog = [
      { id: 'ollama/metered', name: 'metered', contextLength: 4096,
        pricing: { prompt: 0.000005, completion: 0.00001 }, local: true }, // $5/M
      { id: 'ollama/free', name: 'free', contextLength: 8192,
        pricing: { prompt: 0, completion: 0 }, local: true }, // $0/M
    ];

    const { preselectedId, rows } = picker.buildProviderDefaultChoices('ollama', { catalog, tier: 'balanced' });

    expect(rows.find(r => r.id === 'ollama/metered').pricePerMInput).toBe(5);
    expect(rows.find(r => r.id === 'ollama/free').pricePerMInput).toBe(0);
    expect(preselectedId).toBe('ollama/free');
    expect(rows.filter(r => r.isPreselected)).toEqual([expect.objectContaining({ id: 'ollama/free' })]);
  });

  test('pricePerMInputFrom itself already handles a {prompt:0} row correctly (low-level guard, distinct from the buildRows plumbing above)', () => {
    const { picker } = load(['ollama']);
    const localRow = { id: 'ollama/llama3.3', pricing: { prompt: 0, completion: 0 }, local: true };
    expect(picker.pricePerMInputFrom(localRow)).toBe(0);
  });
});

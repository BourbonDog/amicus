'use strict';

describe('pricing: $0 local tier', () => {
  afterEach(() => jest.resetModules());

  function withLocal(providers) {
    jest.resetModules();
    jest.doMock('../src/utils/local-providers', () => ({
      isLocalProvider: (id) => Object.prototype.hasOwnProperty.call(providers, id),
      getLocalProviders: () => providers,
    }));
    jest.doMock('../src/utils/model-catalog', () => ({ readCache: () => ({ models: [] }) }));
    return require('../src/utils/pricing');
  }

  test('lookupPricing falls back to the provider pricing (default zeros) for a local vendor with no catalog row', () => {
    const pricing = withLocal({ ollama: { id: 'ollama', pricing: { prompt: 0, completion: 0 } } });
    expect(pricing.lookupPricing('ollama/llama3.3')).toEqual({ prompt: 0, completion: 0 });
    expect(pricing.lookupPricing('openai/gpt-5')).toBeNull(); // non-local unchanged
  });

  test('lookupPricing honors a metered local override', () => {
    const pricing = withLocal({ lab: { id: 'lab', pricing: { prompt: 0.000001, completion: 0.000002 } } });
    expect(pricing.lookupPricing('lab/m')).toEqual({ prompt: 0.000001, completion: 0.000002 });
  });

  test('resolveLegCost: pricing present + estimate exactly 0 → {amount:0, source:estimated}', () => {
    const pricing = withLocal({});
    const c = pricing.resolveLegCost({ reportedCost: 0, tokens: { input: 1000, output: 500 }, pricing: { prompt: 0, completion: 0 } });
    expect(c).toEqual({ amount: 0, currency: 'USD', source: 'estimated' });
  });

  test('formatCost renders ~$0.0000 for a $0 estimated leg', () => {
    const pricing = withLocal({});
    expect(pricing.formatCost({ amount: 0, source: 'estimated' })).toBe('~$0.0000');
  });
});

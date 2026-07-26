'use strict';
const pricing = require('../../src/utils/pricing');

describe('sumPerMessageUsage', () => {
  it('sums tokens + cost across messages without double-counting (map is keyed by id)', () => {
    const map = new Map();
    map.set('m1', { tokens: { input: 100, output: 200, reasoning: 10, cache: { read: 5, write: 1 } }, cost: 0.0021 });
    map.set('m2', { tokens: { input: 50, output: 60, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0.0009 });
    const t = pricing.sumPerMessageUsage(map);
    expect(t.tokens).toEqual({ input: 150, output: 260, reasoning: 10, cacheRead: 5, cacheWrite: 1 });
    expect(t.costReported).toBeCloseTo(0.003, 6);
  });

  it('tolerates missing tokens/cost fields → zeros', () => {
    const map = new Map();
    map.set('m1', { tokens: undefined, cost: undefined });
    const t = pricing.sumPerMessageUsage(map);
    expect(t.tokens).toEqual({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 });
    expect(t.costReported).toBe(0);
  });
});

describe('resolveLegCost', () => {
  const tokens = { input: 1_000_000, output: 1_000_000 };
  it('uses reported cost when > 0 → source reported', () => {
    expect(pricing.resolveLegCost({ reportedCost: 0.42, tokens, pricing: { prompt: 0.000003, completion: 0.00001 } }))
      .toEqual({ amount: 0.42, currency: 'USD', source: 'reported' });
  });
  it('estimates from pricing when reported is 0/absent → source estimated', () => {
    const r = pricing.resolveLegCost({ reportedCost: 0, tokens, pricing: { prompt: 0.000003, completion: 0.00001 } });
    expect(r.source).toBe('estimated');
    expect(r.amount).toBeCloseTo(0.000003 * 1e6 + 0.00001 * 1e6, 6); // 3 + 10 = 13
  });
  it('unknown when no reported and no pricing', () => {
    expect(pricing.resolveLegCost({ reportedCost: 0, tokens, pricing: null }))
      .toEqual({ amount: null, currency: 'USD', source: 'unknown' });
  });
});

/**
 * v4.4 B2 — "no usage observed" must never be priced as an authoritative $0.
 * A leg whose captured token totals are ALL zero is an absence of observation,
 * not a $0 bill: pricing it `0 × catalog = estimated $0.0000` asserts "this seat
 * was free", a claim that (per the v4.4 diagnosis, four real paid runs) was false
 * on every occurrence and silently under-counted the --max-cost ceiling.
 * The v4.2 §4.5 free-local-tier carve-out survives because a local seat still
 * REPORTS tokens — the predicate keys on observed tokens, never on the price.
 */
describe('resolveLegCost: zero-token totals are unknown, not $0 (B2)', () => {
  const glm = { prompt: 7.168e-7, completion: 2.2528e-6 }; // real catalog row

  it('all-zero tokens + a real catalog price → unknown, NOT estimated $0', () => {
    expect(pricing.resolveLegCost({ reportedCost: 0, tokens: { input: 0, output: 0 }, pricing: glm }))
      .toEqual({ amount: null, currency: 'USD', source: 'unknown' });
  });

  it('the full zero token block (normalized shape) + price → unknown', () => {
    const tokens = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
    expect(pricing.resolveLegCost({ reportedCost: 0, tokens, pricing: glm }))
      .toEqual({ amount: null, currency: 'USD', source: 'unknown' });
  });

  it('undefined/null tokens + price → unknown', () => {
    expect(pricing.resolveLegCost({ reportedCost: 0, tokens: undefined, pricing: glm }).source).toBe('unknown');
    expect(pricing.resolveLegCost({ reportedCost: 0, tokens: null, pricing: glm }).source).toBe('unknown');
  });

  it('observed OUTPUT tokens alone still estimate', () => {
    const r = pricing.resolveLegCost({ reportedCost: 0, tokens: { input: 0, output: 1000 }, pricing: glm });
    expect(r.source).toBe('estimated');
    expect(r.amount).toBeCloseTo(1000 * 2.2528e-6, 12);
  });

  it('reasoning-only observation counts as observed (estimate may be $0 for an unpriced class)', () => {
    const r = pricing.resolveLegCost({ reportedCost: 0, tokens: { input: 0, output: 0, reasoning: 500 }, pricing: glm });
    expect(r.source).toBe('estimated');
    expect(r.amount).toBe(0);
  });

  it('cache tokens in the RAW OpenCode shape ({cache:{read,write}}) count as observed', () => {
    const r = pricing.resolveLegCost({ reportedCost: 0, tokens: { input: 0, output: 0, cache: { read: 900, write: 0 } }, pricing: glm });
    expect(r.source).toBe('estimated');
  });

  it('v4.2 §4.5 REGRESSION GUARD: a free local seat with real tokens stays estimated $0', () => {
    expect(pricing.resolveLegCost({ reportedCost: 0, tokens: { input: 1200, output: 340 }, pricing: { prompt: 0, completion: 0 } }))
      .toEqual({ amount: 0, currency: 'USD', source: 'estimated' });
  });

  it('a local seat that produced NO tokens is unknown too (it genuinely did nothing)', () => {
    expect(pricing.resolveLegCost({ reportedCost: 0, tokens: { input: 0, output: 0 }, pricing: { prompt: 0, completion: 0 } }))
      .toEqual({ amount: null, currency: 'USD', source: 'unknown' });
  });

  it('a reported cost > 0 still wins even with no token observation', () => {
    expect(pricing.resolveLegCost({ reportedCost: 0.0075, tokens: { input: 0, output: 0 }, pricing: glm }))
      .toEqual({ amount: 0.0075, currency: 'USD', source: 'reported' });
  });

  it('hasObservedTokens is exported so other layers ask the same question one way', () => {
    expect(typeof pricing.hasObservedTokens).toBe('function');
    expect(pricing.hasObservedTokens({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 })).toBe(false);
    expect(pricing.hasObservedTokens({ input: 1 })).toBe(true);
    expect(pricing.hasObservedTokens(null)).toBe(false);
  });
});

describe('sumWaveUsage', () => {
  const leg = (source, amount, input = 10) => ({ usage: { tokens: { input, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, cost: { amount, currency: 'USD', source } } });
  it('sums tokens, sums non-null amounts, classifies mixed + counts buckets', () => {
    const w = pricing.sumWaveUsage([leg('reported', 0.10), leg('estimated', 0.02), leg('unknown', null)]);
    expect(w.tokens.input).toBe(30);
    expect(w.cost.amount).toBeCloseTo(0.12, 6);
    expect(w.cost.source).toBe('mixed');
    expect(w.cost).toMatchObject({ reportedLegs: 1, estimatedLegs: 1, unpricedLegs: 1 });
  });
  it('all reported → source reported', () => {
    expect(pricing.sumWaveUsage([leg('reported', 0.1), leg('reported', 0.2)]).cost.source).toBe('reported');
  });
  it('no usage on a leg counts as unpriced', () => {
    const w = pricing.sumWaveUsage([{}, leg('reported', 0.1)]);
    expect(w.cost.unpricedLegs).toBe(1);
    expect(w.cost.source).toBe('mixed');
  });
});

describe('formatCost', () => {
  const { formatCost } = require('../../src/utils/pricing');
  test('reported renders a plain dollar figure', () => {
    expect(formatCost({ amount: 0.0123, currency: 'USD', source: 'reported' })).toBe('$0.0123');
    expect(formatCost({ amount: 25, currency: 'USD', source: 'reported' })).toBe('$25.00');
  });
  test('estimated and mixed get a ~ prefix', () => {
    expect(formatCost({ amount: 0.02, source: 'estimated' })).toBe('~$0.0200');
    expect(formatCost({ amount: 0.5, source: 'mixed' })).toBe('~$0.5000');
  });
  test('unknown source with null amount renders ?', () => {
    expect(formatCost({ amount: null, source: 'unknown' })).toBe('?');
  });
  test('missing cost renders an em dash', () => {
    expect(formatCost(null)).toBe('—');
    expect(formatCost(undefined)).toBe('—');
    expect(formatCost({ amount: null, source: 'reported' })).toBe('—');
  });
});

describe('lookupPricing', () => {
  afterEach(() => jest.restoreAllMocks());
  it('returns numeric per-token pricing for a catalog row', () => {
    jest.spyOn(require('../../src/utils/model-catalog'), 'readCache')
      .mockReturnValue({ models: [{ id: 'openrouter/x/y', pricing: { prompt: '0.000003', completion: '0.00001' } }] });
    expect(pricing.lookupPricing('openrouter/x/y')).toEqual({ prompt: 0.000003, completion: 0.00001 });
  });
  it('returns null for pricing:null (direct providers) and for missing rows', () => {
    jest.spyOn(require('../../src/utils/model-catalog'), 'readCache')
      .mockReturnValue({ models: [{ id: 'google/gemini-3.5-flash', pricing: null }] });
    expect(pricing.lookupPricing('google/gemini-3.5-flash')).toBeNull();
    expect(pricing.lookupPricing('nope/missing')).toBeNull();
  });
});

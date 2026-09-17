// tests/utils/council-credit-reservation.test.js
'use strict';

/**
 * #256 / council #264 r2 (HQ1, findings A1 + D1) — PRICING THE RESERVATION.
 *
 * The bench's central objection to the first two rounds: clamping the run's
 * AGGREGATE `--max-cost` cannot prevent a PER-REQUEST refusal, because that is
 * not the quantity OpenRouter refuses on. Run 35143585179's gpt retry was told
 * `You requested up to 64000 tokens, but can only afford 56097` — a statement
 * about ONE request's `max_tokens` reservation against the key's remaining
 * money, with no reference to any aggregate at all.
 *
 * So the preflight has to price the thing that actually gets refused:
 *
 *   oneSeatReservationUsd = outputBudget x max(pricing.completion over the bench)
 *
 * `outputBudget` and the bench's ids come from the alias map this job's own
 * earlier step provisioned; the per-token completion prices come from a keyless
 * `GET /api/v1/models`. Below that figure NOTHING can be dispatched — that is a
 * refusal. Below `seats x` it, the first wave will see refusals — that is a
 * warning. Unpriced, the rule is skipped and the outcome is a warning, never ok.
 */

const https = require('https');

jest.mock('https');

const {
  resolveBenchIds, priceOneSeatReservation, fetchOpenRouterModelPrices,
} = require('../../src/utils/council-credit-reservation');

const ALIASES = {
  glm: 'openrouter/z-ai/glm-5.3',
  qwen: 'openrouter/qwen/qwen3.8-27b',
  gpt: 'openrouter/openai/gpt-5.6-terra',
  'gemini-pro': 'openrouter/google/gemini-3.1-pro-preview',
};

describe('#256 resolveBenchIds', () => {
  test('aliases resolve through the provisioned map, gateway prefix stripped for lookup', () => {
    const r = resolveBenchIds({ aliases: ALIASES, seats: ['glm', 'qwen'] });
    expect(r.ids).toEqual(['z-ai/glm-5.3', 'qwen/qwen3.8-27b']);
    expect(r.unresolved).toEqual([]);
  });

  test('a full id passes through, with its gateway prefix stripped the same way', () => {
    const r = resolveBenchIds({ aliases: ALIASES, seats: ['openrouter/moonshotai/kimi-k3', 'deepseek/deepseek-v4'] });
    expect(r.ids).toEqual(['moonshotai/kimi-k3', 'deepseek/deepseek-v4']);
    expect(r.unresolved).toEqual([]);
  });

  test('an alias the map does not carry is reported, not silently dropped', () => {
    const r = resolveBenchIds({ aliases: ALIASES, seats: ['glm', 'nope'] });
    expect(r.ids).toEqual(['z-ai/glm-5.3']);
    expect(r.unresolved).toEqual(['nope']);
  });

  test('blanks and duplicates are removed; order is preserved', () => {
    const r = resolveBenchIds({ aliases: ALIASES, seats: ['glm', '', '  ', 'glm', 'qwen'] });
    expect(r.ids).toEqual(['z-ai/glm-5.3', 'qwen/qwen3.8-27b']);
  });

  test('a missing or unusable map yields no ids and no crash', () => {
    for (const aliases of [null, undefined, 'nope', 42, []]) {
      expect(resolveBenchIds({ aliases, seats: ['glm'] })).toEqual({ ids: [], unresolved: ['glm'] });
    }
    expect(resolveBenchIds({ aliases: ALIASES, seats: null })).toEqual({ ids: [], unresolved: [] });
  });
});

describe('#256 priceOneSeatReservation', () => {
  // The r3 numbers: a $0.000015/token completion price over a 64000-token
  // budget reserves $0.96 for ONE seat.
  const PRICES = {
    'z-ai/glm-5.3': 0.0000005,
    'qwen/qwen3.8-27b': 0.0000002,
    'openai/gpt-5.6-terra': 0.000015,
    'google/gemini-3.1-pro-preview': 0.00001,
  };
  const IDS = Object.keys(PRICES);

  test('one seat reserves the budget times the DEAREST seat on the bench', () => {
    const r = priceOneSeatReservation({ prices: PRICES, ids: IDS, outputBudget: 64000 });
    expect(r.priced).toBe(true);
    expect(r.maxCompletionPrice).toBe(0.000015);
    expect(r.oneSeatUsd).toBeCloseTo(0.96, 10);
    expect(r.unpriced).toEqual([]);
  });

  test('the DEAREST seat is what sets it — a cheap majority cannot hide one expensive row', () => {
    // The reservation is per-request, so the bench's worst row is the one that
    // decides whether a request can be admitted at all.
    const r = priceOneSeatReservation({ prices: PRICES, ids: ['z-ai/glm-5.3', 'openai/gpt-5.6-terra'], outputBudget: 1000 });
    expect(r.maxCompletionPrice).toBe(0.000015);
    expect(r.oneSeatUsd).toBeCloseTo(0.015, 10);
  });

  test('the lookup is case-insensitive on both sides', () => {
    const r = priceOneSeatReservation({ prices: { 'Z-AI/GLM-5.3': 0.000002 }, ids: ['z-ai/glm-5.3'], outputBudget: 100 });
    expect(r.priced).toBe(true);
    expect(r.oneSeatUsd).toBeCloseTo(0.0002, 10);
  });

  describe('NOT priced — the rule is skipped rather than guessed at', () => {
    test('ANY unpriced bench row makes the whole bench unpriced', () => {
      // The missing row could be the dearest one, so a max over the rest is not
      // a bound on anything.
      const r = priceOneSeatReservation({ prices: PRICES, ids: [...IDS, 'mystery/model-x'], outputBudget: 64000 });
      expect(r.priced).toBe(false);
      expect(r.unpriced).toEqual(['mystery/model-x']);
      expect(r.oneSeatUsd).toBeNull();
    });

    test('an empty bench, an empty price table, or a missing one', () => {
      expect(priceOneSeatReservation({ prices: PRICES, ids: [], outputBudget: 64000 }).priced).toBe(false);
      expect(priceOneSeatReservation({ prices: {}, ids: IDS, outputBudget: 64000 }).priced).toBe(false);
      expect(priceOneSeatReservation({ prices: null, ids: IDS, outputBudget: 64000 }).priced).toBe(false);
    });

    test('a non-positive or unreadable output budget', () => {
      for (const outputBudget of [0, -1, NaN, Infinity, null, undefined, '64000', {}]) {
        const r = priceOneSeatReservation({ prices: PRICES, ids: IDS, outputBudget });
        expect(r.priced).toBe(false);
        expect(r.oneSeatUsd).toBeNull();
      }
    });

    test('a zero or negative price is not a price', () => {
      // A free row is legitimate, but a bench whose DEAREST row prices at zero
      // means the table told us nothing usable about a paid run.
      const r = priceOneSeatReservation({ prices: { 'a/b': 0 }, ids: ['a/b'], outputBudget: 64000 });
      expect(r.priced).toBe(false);
    });
  });
});

describe('#256 fetchOpenRouterModelPrices', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  function mockResponse(statusCode, body, { streamError = false } = {}) {
    const res = {
      statusCode,
      on: jest.fn((event, cb) => {
        if (event === 'error' && streamError) { cb(new Error('socket died')); return res; }
        if (event === 'data' && !streamError) { cb(typeof body === 'string' ? body : JSON.stringify(body)); }
        if (event === 'end' && !streamError) { cb(); }
        return res;
      }),
    };
    const req = { on: jest.fn(), setTimeout: jest.fn(), destroy: jest.fn() };
    https.get.mockImplementation((url, opts, cb) => { cb(res); return req; });
    return req;
  }

  test('parses id -> completion price, which the API sends as a USD-per-token STRING', () => {
    mockResponse(200, { data: [
      { id: 'z-ai/glm-5.3', pricing: { completion: '0.0000005', prompt: '0.0000001' } },
      { id: 'openai/gpt-5.6-terra', pricing: { completion: '0.000015' } },
    ] });
    return fetchOpenRouterModelPrices().then((r) => {
      expect(r.checked).toBe(true);
      expect(r.prices['z-ai/glm-5.3']).toBe(0.0000005);
      expect(r.prices['openai/gpt-5.6-terra']).toBe(0.000015);
    });
  });

  test('it is KEYLESS — a catalog read must never carry the secret', async () => {
    mockResponse(200, { data: [] });
    await fetchOpenRouterModelPrices();
    const [url, opts] = https.get.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/models');
    expect(JSON.stringify(opts.headers || {})).not.toMatch(/authorization/i);
  });

  test('rows without a usable completion price are skipped, not defaulted', () => {
    mockResponse(200, { data: [
      { id: 'a/ok', pricing: { completion: '0.000002' } },
      { id: 'b/missing-pricing' },
      { id: 'c/empty', pricing: {} },
      { id: 'd/not-a-number', pricing: { completion: 'free' } },
      { pricing: { completion: '0.1' } },
    ] });
    return fetchOpenRouterModelPrices().then((r) => {
      expect(Object.keys(r.prices)).toEqual(['a/ok']);
    });
  });

  test('every failure resolves checked:false with no prices', async () => {
    const unchecked = (r) => { expect(r.checked).toBe(false); expect(r.prices).toEqual({}); };
    mockResponse(500, { data: [] });
    unchecked(await fetchOpenRouterModelPrices());
    mockResponse(200, 'not json {{{');
    unchecked(await fetchOpenRouterModelPrices());
    mockResponse(200, { data: 'not an array' });
    unchecked(await fetchOpenRouterModelPrices());
    mockResponse(200, null, { streamError: true });
    unchecked(await fetchOpenRouterModelPrices());
    const req = { on: jest.fn((e, cb) => { if (e === 'error') { cb(new Error('ENOTFOUND')); } return req; }),
      setTimeout: jest.fn(), destroy: jest.fn() };
    https.get.mockImplementation(() => req);
    unchecked(await fetchOpenRouterModelPrices());
  });

  test('a bounded timeout destroys the request and resolves unchecked', async () => {
    const destroy = jest.fn();
    const req = { on: jest.fn(() => req), setTimeout: jest.fn((ms, cb) => { expect(ms).toBe(10000); cb(); }), destroy };
    https.get.mockImplementation(() => req);
    const r = await fetchOpenRouterModelPrices();
    expect(r.checked).toBe(false);
    expect(destroy).toHaveBeenCalled();
  });
});

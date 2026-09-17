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
 * So the preflight has to price the thing that actually gets refused, per row:
 *
 *   seatReservationUsd = outputBudget x that row's pricing.completion
 *
 * `outputBudget` and the bench's ids come from the alias map this job's own
 * earlier step provisioned; the per-token completion prices come from a keyless
 * `GET /api/v1/models`. Four figures come out of it (council #264 r3, B1 + C1):
 * the CHEAPEST bench seat — below it nothing at all can be dispatched, which is
 * the refusal; the DEAREST — below it those seat(s) will be refused while a
 * cheaper quorum may still seat; the SUM over the bench — below it the wave
 * cannot be funded concurrently, since each seat holds its own reservation; and
 * the CHAIR, priced apart because it runs sequentially and can never gate the
 * bench. Unpriced, the rule is skipped and the outcome is a warning, never ok.
 */

const https = require('https');

jest.mock('https');

const {
  resolveBenchIds, priceBenchReservation, fetchOpenRouterModelPrices,
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

  test('blanks are dropped but DUPLICATES are kept — two seats hold two reservations', () => {
    // Council #264 r3 polish. Deduping by catalog key made the wave SUM
    // under-count: two aliases pointing at one model are still two concurrent
    // requests, each holding its own max_tokens reservation. One id per SEAT.
    const r = resolveBenchIds({ aliases: ALIASES, seats: ['glm', '', '  ', 'glm', 'qwen'] });
    expect(r.ids).toEqual(['z-ai/glm-5.3', 'z-ai/glm-5.3', 'qwen/qwen3.8-27b']);
  });

  test('a missing or unusable map yields no ids and no crash', () => {
    for (const aliases of [null, undefined, 'nope', 42, []]) {
      expect(resolveBenchIds({ aliases, seats: ['glm'] })).toEqual({ ids: [], unresolved: ['glm'] });
    }
    expect(resolveBenchIds({ aliases: ALIASES, seats: null })).toEqual({ ids: [], unresolved: [] });
  });
});

describe('#256 priceBenchReservation', () => {
  // Council #264 r3 (B1 + C1) reshaped this: one `max` is not enough. The gate
  // needs the CHEAPEST bench seat (below it, nothing can run), the DEAREST
  // (below it, some seats certainly will not), the SUM (the concurrent first
  // wave), and the CHAIR priced apart from all three — it runs sequentially
  // after the wave, so it can never be a reason to refuse the bench.
  const PRICES = {
    'z-ai/glm-5.3': 0.0000005,
    'qwen/qwen3.8-27b': 0.0000002,
    'openai/gpt-5.6-terra': 0.000015,
    'google/gemini-3.1-pro-preview': 0.00001,
  };
  const BENCH = ['z-ai/glm-5.3', 'qwen/qwen3.8-27b', 'openai/gpt-5.6-terra'];
  const CHAIR = ['google/gemini-3.1-pro-preview'];
  const price = (over = {}) => priceBenchReservation({
    prices: PRICES, benchIds: BENCH, chairIds: CHAIR, outputBudget: 64000, ...over });

  test('the four figures the gate needs, over the BENCH alone', () => {
    const r = price();
    expect(r.priced).toBe(true);
    // 64000 x each row's completion price.
    expect(r.cheapestSeatUsd).toBeCloseTo(0.0128, 10);  // qwen
    expect(r.dearestSeatUsd).toBeCloseTo(0.96, 10);     // gpt
    expect(r.waveUsd).toBeCloseTo(0.0128 + 0.032 + 0.96, 10);
    expect(r.chairUsd).toBeCloseTo(0.64, 10);           // gemini-pro, priced apart
  });

  test('the CHAIR is never folded into the bench figures', () => {
    // B1: the chair used to set the maximum that gated the bench, so a dear
    // chair refused a bench that could have seated fine.
    const dearChair = price({ prices: { ...PRICES, 'google/gemini-3.1-pro-preview': 0.001 } });
    expect(dearChair.dearestSeatUsd).toBeCloseTo(0.96, 10);
    expect(dearChair.waveUsd).toBeCloseTo(0.0128 + 0.032 + 0.96, 10);
    expect(dearChair.chairUsd).toBeCloseTo(64, 10);
  });

  test('the wave is the SUM of the bench, not seats x the dearest', () => {
    // The old approximation over-stated a mixed bench by 3x here.
    const r = price();
    expect(r.waveUsd).toBeLessThan(r.dearestSeatUsd * BENCH.length);
    expect(r.waveUsd).toBeCloseTo(1.0048, 10);
  });

  test('two aliases on ONE model still reserve twice over (council #264 r3 polish)', () => {
    const r = price({ benchIds: ['openai/gpt-5.6-terra', 'openai/gpt-5.6-terra'] });
    expect(r.cheapestSeatUsd).toBeCloseTo(0.96, 10);   // min is unaffected
    expect(r.dearestSeatUsd).toBeCloseTo(0.96, 10);    // max is unaffected
    expect(r.waveUsd).toBeCloseTo(1.92, 10);           // the SUM is not
  });

  test('a one-row bench makes cheapest, dearest and wave the same figure', () => {
    const r = price({ benchIds: ['openai/gpt-5.6-terra'] });
    expect(r.cheapestSeatUsd).toBeCloseTo(0.96, 10);
    expect(r.dearestSeatUsd).toBeCloseTo(0.96, 10);
    expect(r.waveUsd).toBeCloseTo(0.96, 10);
  });

  test('no chair at all prices cleanly, with chairUsd null', () => {
    const r = price({ chairIds: [] });
    expect(r.priced).toBe(true);
    expect(r.chairUsd).toBeNull();
  });

  test('the lookup is case-insensitive on both sides', () => {
    const r = priceBenchReservation({ prices: { 'Z-AI/GLM-5.3': 0.000002 },
      benchIds: ['z-ai/glm-5.3'], chairIds: [], outputBudget: 100 });
    expect(r.priced).toBe(true);
    expect(r.cheapestSeatUsd).toBeCloseTo(0.0002, 10);
  });

  describe('NOT priced — the rule is skipped rather than guessed at', () => {
    test('ANY unpriced BENCH row makes the whole bench unpriced', () => {
      const r = price({ benchIds: [...BENCH, 'mystery/model-x'] });
      expect(r.priced).toBe(false);
      expect(r.unpriced).toEqual(['mystery/model-x']);
      expect(r.cheapestSeatUsd).toBeNull();
      expect(r.dearestSeatUsd).toBeNull();
      expect(r.waveUsd).toBeNull();
    });

    test('an unpriced CHAIR leaves the bench priced — it gates nothing', () => {
      // The chair's affordability is a separate clause, so not knowing it must
      // not suppress a bench verdict the bench's own prices support.
      const r = price({ chairIds: ['mystery/chair'] });
      expect(r.priced).toBe(true);
      expect(r.chairUsd).toBeNull();
      expect(r.unpricedChair).toEqual(['mystery/chair']);
    });

    test('an empty bench, an empty price table, or a missing one', () => {
      expect(price({ benchIds: [] }).priced).toBe(false);
      expect(price({ prices: {} }).priced).toBe(false);
      expect(price({ prices: null }).priced).toBe(false);
    });

    test('a non-positive or unreadable output budget', () => {
      for (const outputBudget of [0, -1, NaN, Infinity, null, undefined, '64000', {}]) {
        const r = price({ outputBudget });
        expect(r.priced).toBe(false);
        expect(r.cheapestSeatUsd).toBeNull();
      }
    });

    test('a zero or negative price is not a price', () => {
      const r = priceBenchReservation({ prices: { 'a/b': 0 }, benchIds: ['a/b'], chairIds: [], outputBudget: 64000 });
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

// tests/utils/openrouter-balance.test.js
'use strict';

/**
 * #256 / council #264 r2 (HQ2, findings D1 + A1) — the ACCOUNT BALANCE probe.
 *
 * `GET /api/v1/key` reports the key's monthly usage CAP and nothing else. A key
 * with `limit_remaining: null` — no monthly cap at all, the healthiest answer
 * that endpoint can give — sitting on a depleted account balance passed the
 * preflight as `ok` and dispatched the whole bench. That is the blind spot the
 * bench named, and it is a second read, not a reinterpretation of the first:
 * `GET /api/v1/credits` → `data.total_credits` and `data.total_usage`.
 *
 * Same discipline as `checkOpenRouterCredit`: every failure resolves
 * `checked: false`, never rejects, and never blocks anything on its own.
 * `checkOpenRouterCredit`'s own shape is deliberately untouched — `amicus
 * doctor` consumes it.
 */

const https = require('https');

jest.mock('https');

const { checkOpenRouterBalance, checkOpenRouterCredit } = require('../../src/utils/openrouter-credit');

/** Mock one https.get: a response with the given status and raw body text. */
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

describe('#256 checkOpenRouterBalance', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('a healthy account reports credits minus usage', async () => {
    mockResponse(200, { data: { total_credits: 25, total_usage: 4.5 } });
    const r = await checkOpenRouterBalance('sk-or-live');
    expect(r.checked).toBe(true);
    expect(r.balanceRemaining).toBeCloseTo(20.5, 10);
    expect(r.totalCredits).toBe(25);
    expect(r.totalUsage).toBe(4.5);
  });

  test('a depleted account reports a balance at or below zero', async () => {
    mockResponse(200, { data: { total_credits: 5, total_usage: 5 } });
    const r = await checkOpenRouterBalance('sk-or-spent');
    expect(r.checked).toBe(true);
    expect(r.balanceRemaining).toBe(0);
  });

  test('the key is sent as a bearer and never appears in the result', async () => {
    mockResponse(200, { data: { total_credits: 1, total_usage: 0 } });
    const r = await checkOpenRouterBalance('sk-or-secret-value');
    const [url, opts] = https.get.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/credits');
    expect(opts.headers.Authorization).toBe('Bearer sk-or-secret-value');
    expect(JSON.stringify(r)).not.toContain('sk-or-secret-value');
  });

  test('the key is trimmed before it is sent', async () => {
    mockResponse(200, { data: { total_credits: 1, total_usage: 0 } });
    await checkOpenRouterBalance('  sk-or-padded  ');
    expect(https.get.mock.calls[0][1].headers.Authorization).toBe('Bearer sk-or-padded');
  });

  describe('every failure resolves checked:false — never a rejection, never a guess', () => {
    const unchecked = (r) => {
      expect(r.checked).toBe(false);
      expect(r.balanceRemaining).toBeNull();
      expect(r.totalCredits).toBeNull();
      expect(r.totalUsage).toBeNull();
    };

    test('no key at all', async () => {
      unchecked(await checkOpenRouterBalance(''));
      unchecked(await checkOpenRouterBalance('   '));
      unchecked(await checkOpenRouterBalance(null));
      unchecked(await checkOpenRouterBalance(undefined));
      expect(https.get).not.toHaveBeenCalled(); // no key, no request
    });

    test('a non-200 status', async () => {
      for (const status of [401, 403, 404, 429, 500, 503]) {
        mockResponse(status, { data: { total_credits: 9, total_usage: 0 } });
        unchecked(await checkOpenRouterBalance('sk-or-live'));
      }
    });

    test('a malformed body', async () => {
      mockResponse(200, 'not json at all {{{');
      unchecked(await checkOpenRouterBalance('sk-or-live'));
    });

    test('a 200 whose payload carries no usable numbers', async () => {
      for (const body of [{}, { data: {} }, { data: null },
        { data: { total_credits: 'lots', total_usage: 0 } },
        { data: { total_credits: 5 } },
        { data: { total_credits: Infinity, total_usage: 0 } }]) {
        mockResponse(200, body);
        unchecked(await checkOpenRouterBalance('sk-or-live'));
      }
    });

    test('a response stream that dies mid-flight', async () => {
      // The #224 gap: `res.on('error')` must resolve, not hang or fall through
      // to a confident answer.
      mockResponse(200, null, { streamError: true });
      unchecked(await checkOpenRouterBalance('sk-or-live'));
    });

    test('a request error', async () => {
      const req = { on: jest.fn((e, cb) => { if (e === 'error') { cb(new Error('ENOTFOUND')); } return req; }),
        setTimeout: jest.fn(), destroy: jest.fn() };
      https.get.mockImplementation(() => req);
      unchecked(await checkOpenRouterBalance('sk-or-live'));
    });

    test('a timeout destroys the request and resolves unchecked', async () => {
      const destroy = jest.fn();
      const req = { on: jest.fn(() => req), setTimeout: jest.fn((ms, cb) => { expect(ms).toBe(10000); cb(); }), destroy };
      https.get.mockImplementation(() => req);
      unchecked(await checkOpenRouterBalance('sk-or-live'));
      expect(destroy).toHaveBeenCalled();
    });
  });

  test('checkOpenRouterCredit is untouched — doctor still gets its exact shape', async () => {
    mockResponse(200, { data: { limit: 5, usage: 1, is_free_tier: false, limit_remaining: 4 } });
    const r = await checkOpenRouterCredit('sk-or-live');
    expect(Object.keys(r).sort())
      .toEqual(['checked', 'isFreeTier', 'limit', 'limitRemaining', 'usage', 'warning']);
  });
});

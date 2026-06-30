/**
 * Tests for src/utils/api-key-validation.js — checkOpenRouterCredit (#38)
 *
 * A zero-credit or free-tier OpenRouter key passes /api/v1/models validation
 * but every paid model 402s at runtime. checkOpenRouterCredit does a
 * NON-BLOCKING GET https://openrouter.ai/api/v1/key and WARNS (never blocks)
 * when is_free_tier is true or limit_remaining <= 0.
 *
 * Network is fully mocked — no live HTTP.
 */

const https = require('https');

jest.mock('https');

const { checkOpenRouterCredit } = require('../src/utils/api-key-validation');

/** Build a mocked https.get returning the given status + JSON body */
function mockKeyResponse(statusCode, bodyObj) {
  const mockResponse = {
    statusCode,
    on: jest.fn((event, cb) => {
      if (event === 'data') { cb(JSON.stringify(bodyObj)); }
      if (event === 'end') { cb(); }
      return mockResponse;
    })
  };
  https.get.mockImplementation((url, opts, cb) => {
    // emulate https.get(url, opts, cb)
    cb(mockResponse);
    return { on: jest.fn(), setTimeout: jest.fn(), destroy: jest.fn() };
  });
}

describe('checkOpenRouterCredit (#38)', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('warns when the key is free tier', async () => {
    mockKeyResponse(200, {
      data: { limit: 0, usage: 0, is_free_tier: true, limit_remaining: null }
    });
    const result = await checkOpenRouterCredit('sk-or-free');
    expect(result.warning).toBeTruthy();
    expect(result.warning).toMatch(/free/i);
    expect(result.isFreeTier).toBe(true);
  });

  it('warns when limit_remaining is zero', async () => {
    mockKeyResponse(200, {
      data: { limit: 5, usage: 5, is_free_tier: false, limit_remaining: 0 }
    });
    const result = await checkOpenRouterCredit('sk-or-empty');
    expect(result.warning).toBeTruthy();
    expect(result.warning).toMatch(/credit/i);
    expect(result.limitRemaining).toBe(0);
  });

  it('warns when limit_remaining is negative', async () => {
    mockKeyResponse(200, {
      data: { limit: 5, usage: 7, is_free_tier: false, limit_remaining: -2 }
    });
    const result = await checkOpenRouterCredit('sk-or-over');
    expect(result.warning).toBeTruthy();
  });

  it('does NOT warn for a paid key with positive remaining credit', async () => {
    mockKeyResponse(200, {
      data: { limit: 10, usage: 2, is_free_tier: false, limit_remaining: 8 }
    });
    const result = await checkOpenRouterCredit('sk-or-paid');
    expect(result.warning).toBeNull();
    expect(result.isFreeTier).toBe(false);
    expect(result.limitRemaining).toBe(8);
  });

  it('does NOT warn when limit is null (unlimited / pay-as-you-go)', async () => {
    mockKeyResponse(200, {
      data: { limit: null, usage: 3, is_free_tier: false, limit_remaining: null }
    });
    const result = await checkOpenRouterCredit('sk-or-unlimited');
    expect(result.warning).toBeNull();
  });

  it('is non-blocking: returns no warning on a non-200 response', async () => {
    mockKeyResponse(500, { error: 'boom' });
    const result = await checkOpenRouterCredit('sk-or-err');
    expect(result.warning).toBeNull();
  });

  it('is non-blocking: returns no warning on a network error', async () => {
    https.get.mockImplementation((_url, _opts, _cb) => {
      const req = { on: jest.fn(), setTimeout: jest.fn(), destroy: jest.fn() };
      setTimeout(() => {
        const errCall = req.on.mock.calls.find(c => c[0] === 'error');
        if (errCall) { errCall[1](new Error('Network error')); }
      }, 0);
      return req;
    });
    const result = await checkOpenRouterCredit('sk-or-neterr');
    expect(result.warning).toBeNull();
  });

  it('is non-blocking: returns no warning on malformed JSON', async () => {
    const mockResponse = {
      statusCode: 200,
      on: jest.fn((event, cb) => {
        if (event === 'data') { cb('not json'); }
        if (event === 'end') { cb(); }
        return mockResponse;
      })
    };
    https.get.mockImplementation((_url, _opts, cb) => {
      cb(mockResponse);
      return { on: jest.fn(), setTimeout: jest.fn(), destroy: jest.fn() };
    });
    const result = await checkOpenRouterCredit('sk-or-garbage');
    expect(result.warning).toBeNull();
  });

  it('hits the /api/v1/key endpoint with Bearer auth', async () => {
    let capturedUrl;
    let capturedHeaders;
    const mockResponse = {
      statusCode: 200,
      on: jest.fn((event, cb) => {
        if (event === 'data') { cb(JSON.stringify({ data: { limit_remaining: 5, is_free_tier: false } })); }
        if (event === 'end') { cb(); }
        return mockResponse;
      })
    };
    https.get.mockImplementation((url, opts, cb) => {
      capturedUrl = url;
      capturedHeaders = opts.headers;
      cb(mockResponse);
      return { on: jest.fn(), setTimeout: jest.fn(), destroy: jest.fn() };
    });
    await checkOpenRouterCredit('sk-or-xyz');
    expect(capturedUrl).toBe('https://openrouter.ai/api/v1/key');
    expect(capturedHeaders.Authorization).toBe('Bearer sk-or-xyz');
  });
});

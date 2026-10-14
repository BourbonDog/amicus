'use strict';

/**
 * Which endpoint each key probe hits, and what its answers MEAN (2026-10-14
 * setup "Save & Test" diagnosis).
 *
 * A probe can only vouch for a key if the endpoint it hits REQUIRES auth. Two
 * did not:
 *   - anthropic probed GET /v1/messages, which answers 405 (wrong method)
 *     BEFORE it looks at the key, and 405 was on the success allowlist. A fake
 *     key got 405 and read as valid:true.
 *   - openrouter probed the PUBLIC /api/v1/models listing, which answers 200
 *     to anyone. A fake key got 200 and read as valid:true.
 * So the wizard, `amicus key` and doctor's key-auth row all accepted ANY
 * anthropic or openrouter key. Measured against the live APIs on 2026-10-14:
 * anthropic GET /v1/models and openrouter GET /api/v1/key both answer 200 to
 * a real key and 401 to a fake one.
 *
 * Network is fully mocked: https.get is spied, never called for real.
 */

const https = require('https');
const { EventEmitter } = require('events');

const { validateApiKey, VALIDATION_ENDPOINTS } = require('../src/utils/api-key-validation');

/**
 * Fake https.get: answer `statusCode` (and `body`, if given) and record what
 * was requested.
 */
function mockProbe(statusCode, body) {
  const calls = [];
  jest.spyOn(https, 'get').mockImplementation((url, opts, cb) => {
    calls.push({ url, headers: opts.headers });
    const res = new EventEmitter();
    res.statusCode = statusCode;
    const req = new EventEmitter();
    req.setTimeout = () => {};
    req.destroy = () => {};
    process.nextTick(() => {
      cb(res);
      if (body !== undefined) { res.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))); }
      res.emit('end');
    });
    return req;
  });
  return calls;
}

afterEach(() => { jest.restoreAllMocks(); });

describe('anthropic probes an endpoint that REQUIRES auth', () => {
  it('hits GET /v1/models, not /v1/messages', async () => {
    const calls = mockProbe(200);
    await validateApiKey('anthropic', 'sk-ant-real');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/models');
    expect(VALIDATION_ENDPOINTS.anthropic.url).toBe('https://api.anthropic.com/v1/models');
  });

  it('sends the key as x-api-key with an anthropic-version header', async () => {
    const calls = mockProbe(200);
    await validateApiKey('anthropic', 'sk-ant-real');
    expect(calls[0].headers['x-api-key']).toBe('sk-ant-real');
    expect(calls[0].headers['anthropic-version']).toBe('2023-06-01');
  });

  it('200 is the pass', async () => {
    mockProbe(200);
    await expect(validateApiKey('anthropic', 'sk-ant-real'))
      .resolves.toMatchObject({ valid: true, status: 200 });
  });

  // These were the success allowlist while the probe was a GET against
  // /v1/messages: the endpoint answered them before it checked the key, so
  // they evidenced nothing about the key at all.
  it.each([400, 404, 405])('%p is NOT a pass', async (code) => {
    mockProbe(code);
    const r = await validateApiKey('anthropic', 'sk-ant-fake');
    expect(r.valid).toBe(false);
    expect(r.status).toBe(code);
  });
});

describe('openrouter probes an endpoint that REQUIRES auth', () => {
  it('hits GET /api/v1/key, not the public /api/v1/models', async () => {
    const calls = mockProbe(200);
    await validateApiKey('openrouter', 'sk-or-v1-real');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://openrouter.ai/api/v1/key');
    expect(VALIDATION_ENDPOINTS.openrouter.url).toBe('https://openrouter.ai/api/v1/key');
  });

  it('sends the key as a Bearer token', async () => {
    const calls = mockProbe(200);
    await validateApiKey('openrouter', 'sk-or-v1-real');
    expect(calls[0].headers.Authorization).toBe('Bearer sk-or-v1-real');
  });

  it('a 401 from /api/v1/key is the rejection a fake key gets', async () => {
    mockProbe(401);
    await expect(validateApiKey('openrouter', 'sk-or-v1-fake'))
      .resolves.toMatchObject({ valid: false, status: 401 });
  });
});

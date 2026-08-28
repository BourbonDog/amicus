'use strict';

/**
 * Council findings 1, 2 and 3 from the second review of PR 221.
 *
 * All three trace to one seam: validateApiKey returned only `{valid, error}`,
 * so its single consumer had to recover the HTTP status by REGEXING THE PROSE,
 * and the leak fix for a key-bearing URL lived in that consumer rather than
 * here — leaving the two save-time call sites unprotected.
 *
 *   F1  403 was treated as a definitive credential rejection. Google returns
 *       403 for "API not enabled" and quota; WAFs return it for bot protection.
 *       Telling someone to re-enter a working key is the false-ALARM twin of
 *       the false-GREEN this check was built to kill.
 *   F2  Parsing "(401)" out of an error string couples control flow to message
 *       wording. Drop the parens upstream and detection silently degrades to
 *       permanent 'unverified'. Return the status as data instead.
 *   F3  https.get can throw SYNCHRONOUSLY inside the promise executor, and the
 *       Google probe URL embeds the key as `?key=...`. That rejection reached
 *       electron/ipc-setup.js — which RETURNS err.message to the renderer AND
 *       logs it — and src/cli-handlers.js, which has no try/catch at all.
 */

const https = require('https');
const { EventEmitter } = require('events');

const { validateApiKey } = require('../src/utils/api-key-validation');

/** Fake an https.get that answers with `statusCode`. */
function mockResponse(statusCode) {
  return jest.spyOn(https, 'get').mockImplementation((_url, _opts, cb) => {
    const res = new EventEmitter();
    res.statusCode = statusCode;
    const req = new EventEmitter();
    req.setTimeout = () => {};
    req.destroy = () => {};
    process.nextTick(() => { cb(res); res.emit('end'); });
    return req;
  });
}

afterEach(() => { jest.restoreAllMocks(); });

describe('F2: validateApiKey reports the HTTP status as DATA, not prose', () => {
  test.each([200, 401, 403, 429, 500, 404])('status %p is returned verbatim', async (code) => {
    mockResponse(code);
    const r = await validateApiKey('openrouter', 'sk-test');
    expect(r.status).toBe(code);
  });

  it('status is null when no response was ever received', async () => {
    jest.spyOn(https, 'get').mockImplementation(() => {
      const req = new EventEmitter();
      req.setTimeout = () => {};
      req.destroy = () => {};
      process.nextTick(() => req.emit('error', new Error('socket hang up')));
      return req;
    });
    const r = await validateApiKey('openrouter', 'sk-test');
    expect(r.status).toBeNull();
    expect(r.valid).toBe(false);
  });

  it('still carries valid/error, so existing callers keep working', async () => {
    mockResponse(200);
    await expect(validateApiKey('openrouter', 'sk-test'))
      .resolves.toMatchObject({ valid: true, status: 200 });
  });
});

describe('F1: 403 is reported as forbidden, not as a bad key', () => {
  it('403 does not claim the credential is invalid', async () => {
    mockResponse(403);
    const r = await validateApiKey('openrouter', 'sk-test');
    expect(r.valid).toBe(false);
    expect(r.status).toBe(403);
    // Google uses 403 for API-not-enabled / quota; a WAF uses it for bots.
    expect(r.error).not.toMatch(/invalid api key/i);
    expect(r.error).toMatch(/forbidden/i);
  });

  it('401 still says exactly what it is', async () => {
    mockResponse(401);
    const r = await validateApiKey('openrouter', 'sk-test');
    expect(r.error).toMatch(/invalid api key/i);
    expect(r.status).toBe(401);
  });
});

describe('F3: a key can never escape in an error message — fixed at the ROOT', () => {
  const KEY = 'AIzaSy-SUPER-SECRET-KEY-0123456789';

  it('a SYNCHRONOUS throw from https.get resolves and never leaks the key', async () => {
    jest.spyOn(https, 'get').mockImplementation((url) => {
      // Node's ERR_INVALID_URL quotes the whole URL — key included.
      throw new Error(`Invalid URL: ${url}`);
    });
    // Google is the dangerous one: its probe embeds the key as ?key=...
    const r = await validateApiKey('google', KEY);
    expect(r.valid).toBe(false);
    expect(r.status).toBeNull();
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  it('it RESOLVES rather than rejecting — the save-time call sites have no catch', async () => {
    jest.spyOn(https, 'get').mockImplementation(() => { throw new Error('boom'); });
    // src/cli-handlers.js:178 awaits this with no try/catch; a rejection there
    // would surface as an unhandled rejection carrying the message.
    await expect(validateApiKey('google', KEY)).resolves.toBeDefined();
  });

  it('an async socket error cannot carry the key either', async () => {
    jest.spyOn(https, 'get').mockImplementation((url) => {
      const req = new EventEmitter();
      req.setTimeout = () => {};
      req.destroy = () => {};
      process.nextTick(() => req.emit('error', new Error(`connect ECONNREFUSED ${url}`)));
      return req;
    });
    const r = await validateApiKey('google', KEY);
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  it('redaction also catches the URL-ENCODED spelling of the key', async () => {
    const spaced = 'key with spaces+and/slashes';
    jest.spyOn(https, 'get').mockImplementation((url) => {
      throw new Error(`Invalid URL: ${url}`);
    });
    const r = await validateApiKey('google', spaced);
    expect(JSON.stringify(r)).not.toContain(encodeURIComponent(spaced));
    expect(JSON.stringify(r)).not.toContain(spaced);
  });

  it('a non-secret-bearing message is still reported usefully', async () => {
    jest.spyOn(https, 'get').mockImplementation(() => {
      const req = new EventEmitter();
      req.setTimeout = () => {};
      req.destroy = () => {};
      process.nextTick(() => req.emit('error', new Error('getaddrinfo ENOTFOUND api.deepseek.com')));
      return req;
    });
    const r = await validateApiKey('deepseek', 'sk-abc');
    expect(r.error).toMatch(/ENOTFOUND/);
  });
});

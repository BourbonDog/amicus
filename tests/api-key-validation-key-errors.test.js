'use strict';

/**
 * What a failed key probe SAYS (2026-10-14 setup "Save & Test" diagnosis).
 *
 * Two answers reached the user as noise:
 *   - Google answers a bad key with HTTP 400 and `reason: API_KEY_INVALID` in
 *     the body. That read as "Unexpected response (400)", which says nothing,
 *     even though it is as definitive a rejection as anyone's 401.
 *   - A key holding characters no API key can contain (the wizard's masked
 *     hint, `sk-or-v1•••…`, is the case that bit) made Node throw
 *     `Invalid character in header content ["Authorization"]` before any
 *     request, and that raw message was what the user saw.
 *
 * Both are now definitive rejections, flagged `keyRejected: true` (as a 401
 * is), so a save can refuse them the way it refuses a 401. Google's 403 stays
 * a warning: it means a disabled API, a quota or a block, not a bad key.
 *
 * Network is fully mocked: https.get is spied, never called for real.
 */

const https = require('https');
const { EventEmitter } = require('events');

const { validateApiKey } = require('../src/utils/api-key-validation');

const MALFORMED_MESSAGE =
  "The key contains characters that aren't valid in an API key — paste the full key";

/** Google's real invalid-key body (shape captured 2026-10-14; no key in it). */
const GOOGLE_INVALID_KEY_BODY = {
  error: {
    code: 400,
    message: 'API key not valid. Please pass a valid API key.',
    status: 'INVALID_ARGUMENT',
    details: [{
      '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
      reason: 'API_KEY_INVALID',
      domain: 'googleapis.com',
      metadata: { service: 'generativelanguage.googleapis.com' },
    }],
  },
};

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

describe("google's invalid-key 400 is an Invalid API key result", () => {
  const KEY = 'AIzaSy-NOT-A-REAL-KEY-0123456789';

  it('400 + API_KEY_INVALID → invalid, flagged as a rejection', async () => {
    mockProbe(400, GOOGLE_INVALID_KEY_BODY);
    const r = await validateApiKey('google', KEY);
    expect(r.valid).toBe(false);
    expect(r.status).toBe(400);
    expect(r.keyRejected).toBe(true);
    expect(r.error).toMatch(/^Invalid API key/);
  });

  it('the message is built here, never echoed from the body or the URL', async () => {
    mockProbe(400, GOOGLE_INVALID_KEY_BODY);
    const r = await validateApiKey('google', KEY);
    expect(JSON.stringify(r)).not.toContain(KEY);
    expect(r.error).not.toMatch(/Please pass a valid API key/);
  });

  it('a 400 WITHOUT that reason is still only an unexpected response', async () => {
    mockProbe(400, { error: { code: 400, status: 'INVALID_ARGUMENT', details: [{ reason: 'SOMETHING_ELSE' }] } });
    const r = await validateApiKey('google', KEY);
    expect(r).toEqual({ valid: false, status: 400, error: 'Unexpected response (400)' });
  });

  it('a 400 with an unparseable body is still only an unexpected response', async () => {
    mockProbe(400, '<html>bad gateway-ish</html>');
    const r = await validateApiKey('google', KEY);
    expect(r).toEqual({ valid: false, status: 400, error: 'Unexpected response (400)' });
  });

  it("another provider's 400 is not read for google's reason", async () => {
    mockProbe(400, GOOGLE_INVALID_KEY_BODY);
    const r = await validateApiKey('openai', 'sk-proj-x');
    expect(r.keyRejected).toBeUndefined();
    expect(r.error).toBe('Unexpected response (400)');
  });

  it("google's 403 stays a warning — a disabled API or quota, not the key", async () => {
    mockProbe(403, { error: { code: 403, status: 'PERMISSION_DENIED', details: [{ reason: 'SERVICE_DISABLED' }] } });
    const r = await validateApiKey('google', KEY);
    expect(r.valid).toBe(false);
    expect(r.status).toBe(403);
    expect(r.keyRejected).toBeUndefined();
    expect(r.error).toMatch(/forbidden/i);
  });
});

describe('a 401 is flagged as a rejection for every provider', () => {
  it.each(['openrouter', 'openai', 'anthropic', 'google', 'deepseek'])('%s', async (provider) => {
    mockProbe(401);
    await expect(validateApiKey(provider, 'sk-fake-0123456789'))
      .resolves.toEqual({ valid: false, status: 401, keyRejected: true, error: 'Invalid API key (401)' });
  });
});

describe('a key no provider could issue is refused BEFORE any request, in words', () => {
  // The wizard's masked hint: the first 8 characters, then U+2022 bullets.
  const HINT = 'sk-or-v1' + '•'.repeat(12);

  it.each(['openrouter', 'openai', 'anthropic', 'google', 'deepseek'])('%s: the masked hint', async (provider) => {
    const calls = mockProbe(200);
    const r = await validateApiKey(provider, HINT);
    expect(calls).toHaveLength(0);
    expect(r).toEqual({ valid: false, status: null, keyRejected: true, error: MALFORMED_MESSAGE });
  });

  it('the hint with a real key pasted onto its end (the append case)', async () => {
    const calls = mockProbe(200);
    const r = await validateApiKey('openai', HINT + 'sk-proj-abcdef0123456789');
    expect(calls).toHaveLength(0);
    expect(r.error).toBe(MALFORMED_MESSAGE);
  });

  it.each([
    ['an inner space', 'sk-proj-abc def0123456789'],
    ['an inner newline', 'sk-proj-abc\ndef0123456789'],
    ['a non-ASCII letter', 'sk-proj-abcdéf0123456789'],
  ])('%s', async (_label, key) => {
    const calls = mockProbe(200);
    const r = await validateApiKey('deepseek', key);
    expect(calls).toHaveLength(0);
    expect(r.keyRejected).toBe(true);
    expect(r.error).toBe(MALFORMED_MESSAGE);
  });

  it('never the raw Node header error (REAL https.get: Node throws before any socket)', async () => {
    // No mock on purpose: this is the exact error the user saw. Node validates
    // header values in the ClientRequest constructor, synchronously, before a
    // DNS lookup, so a header vendor cannot reach the network with this key.
    const r = await validateApiKey('anthropic', HINT);
    expect(r.valid).toBe(false);
    expect(r.error).not.toMatch(/Invalid character in header content/);
    expect(r.error).toBe(MALFORMED_MESSAGE);
  });

  it('surrounding whitespace is still trimmed, not refused', async () => {
    const calls = mockProbe(200);
    const r = await validateApiKey('openai', '  sk-proj-abcdef0123456789\n');
    expect(calls).toHaveLength(1);
    expect(r).toMatchObject({ valid: true, status: 200 });
  });
});

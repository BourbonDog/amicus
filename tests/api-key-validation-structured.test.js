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

// ---------------------------------------------------------------------------
// Council review of PR 222 — the PR failed to apply its own doctrine.
// ---------------------------------------------------------------------------
describe('anthropic: no status may produce a FALSE GREEN', () => {
  // The anthropic branch resolved `valid: true` for anything that was not
  // 401/429/5xx — including 403. So a region block or WAF reported the key as
  // GOOD. That is the false-green class this whole line of work exists to kill,
  // sitting inside the function rewritten to fix 403 handling.
  //
  // The probe is a GET against /v1/messages, so a working key answers with a
  // method/shape complaint (400/404/405), not 200. Those are the only codes
  // that evidence a key reaching auth and passing.
  it.each([400, 404, 405])('%p means the key reached auth and passed', async (code) => {
    mockResponse(code);
    await expect(validateApiKey('anthropic', 'sk-ant-x'))
      .resolves.toMatchObject({ valid: true, status: code });
  });

  it('403 is NOT valid and NOT a credential verdict', async () => {
    mockResponse(403);
    const r = await validateApiKey('anthropic', 'sk-ant-x');
    expect(r.valid).toBe(false);
    expect(r.status).toBe(403);
    expect(r.error).toMatch(/forbidden/i);
    expect(r.error).not.toMatch(/invalid api key/i);
  });

  it('401 is still the definitive rejection', async () => {
    mockResponse(401);
    await expect(validateApiKey('anthropic', 'sk-ant-x'))
      .resolves.toMatchObject({ valid: false, status: 401 });
  });

  it.each([429, 500, 503])('%p is a server error, not a verdict', async (code) => {
    mockResponse(code);
    await expect(validateApiKey('anthropic', 'sk-ant-x'))
      .resolves.toMatchObject({ valid: false, status: code });
  });

  it.each([301, 418, 451])('an UNEXPECTED %p is not silently green', async (code) => {
    // The old `else` swallowed every unlisted code as success.
    mockResponse(code);
    await expect(validateApiKey('anthropic', 'sk-ant-x'))
      .resolves.toMatchObject({ valid: false, status: code });
  });
});

describe('redactSecret: targeted, not brute-force', () => {
  const { redactSecret } = require('../src/utils/api-key-validation');

  it('masks a key= query param regardless of key length', () => {
    const out = redactSecret('Invalid URL: https://x/v1/models?key=ab&z=1', 'ab');
    expect(out).not.toMatch(/key=ab/);
    expect(out).toMatch(/key=\*\*\*/);
  });

  it('does NOT mangle unrelated text for a pathologically short key', () => {
    // Blind substring replacement turned every "a" in the message into ***.
    const msg = 'getaddrinfo ENOTFOUND api.anthropic.com';
    expect(redactSecret(msg, 'a')).toBe(msg);
  });

  it('redacts the form-encoded (+ for space) spelling too', () => {
    const key = 'my key';
    const formed = `Invalid URL: https://x/v1?key=${encodeURIComponent(key).replace(/%20/g, '+')}`;
    const out = redactSecret(formed, key);
    expect(out).not.toContain('my+key');
  });

  it('still redacts a normal-length key appearing bare in the text', () => {
    const key = 'sk-ant-0123456789abcdef';
    expect(redactSecret(`boom ${key} boom`, key)).not.toContain(key);
  });
});

// ---------------------------------------------------------------------------
// Issue #224 — the "ALWAYS RESOLVES" contract vs a RESPONSE-STREAM error.
// ---------------------------------------------------------------------------
describe('#224: an error AFTER the response object exists must not escape', () => {
  const { checkOpenRouterCredit, redactSecret } = require('../src/utils/api-key-validation');

  // `req.on('error')` covers the connection phase only. Nothing covered a
  // failure once `res` existed — a socket reset mid-body, a TLS failure after
  // headers — so the 'error' event had no listener. Node turns that into a
  // THROW: the promise never settles and the process dies. Measured, not
  // argued: the reproduction in #224 printed "UNCAUGHT EXCEPTION", never
  // 'resolved' and never 'REJECTED'.
  function mockStreamError(err = new Error('ECONNRESET mid-response')) {
    return jest.spyOn(https, 'get').mockImplementation((_url, _opts, cb) => {
      const req = new EventEmitter();
      req.setTimeout = () => {}; req.destroy = () => {};
      const res = new EventEmitter();
      res.statusCode = 200;
      process.nextTick(() => { cb(res); res.emit('error', err); });
      return req;
    });
  }

  it('validateApiKey RESOLVES instead of throwing', async () => {
    mockStreamError();
    await expect(validateApiKey('openrouter', 'sk-test'))
      .resolves.toMatchObject({ valid: false, status: null });
  });

  it('the resolved error names the failure rather than going blank', async () => {
    mockStreamError();
    const r = await validateApiKey('openrouter', 'sk-test');
    expect(r.error).toMatch(/ECONNRESET/);
  });

  it('a stream error cannot leak the key either — google embeds it in the URL', async () => {
    const KEY = 'AIzaSy-SECRET-STREAM-0123456789';
    mockStreamError(new Error(`socket hang up for https://x/v1/models?key=${KEY}`));
    const r = await validateApiKey('google', KEY);
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  it('checkOpenRouterCredit has the SAME gap and must also resolve', async () => {
    mockStreamError();
    // Not merely "does not throw": it must report checked:false, or the row
    // renders "credit ok" for an account whose response died mid-flight.
    await expect(checkOpenRouterCredit('sk-or-x'))
      .resolves.toMatchObject({ checked: false, warning: null });
  });

  it('a non-Error throwable still produces a usable message, not a blank', async () => {
    // redactSecret returned '' for anything that was not a string, so a thrown
    // string or object degraded the diagnostic to nothing at all.
    expect(redactSecret('boom', 'k')).toBe('boom');
    expect(redactSecret(undefined, 'k')).toBe('');
    // Direct pin on redactSecret's OWN contract — it is exported, so it must
    // hold independently of messageOf() upstream coercing for the call sites.
    // Without this the coercion went green against its own mutant: every
    // caller already handed it a string, so nothing exercised the branch.
    expect(redactSecret(42, 'k')).toBe('42');
    expect(redactSecret({ toString: () => 'objful' }, 'k')).toBe('objful');
    expect(redactSecret(null, 'k')).toBe('');
    jest.spyOn(https, 'get').mockImplementation(() => { throw 'a bare string throw'; });
    const r = await validateApiKey('openrouter', 'sk-test');
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/bare string throw/);
  });
});

describe('#224: enableLiveProbes has exactly ONE caller', () => {
  const fs = require('fs');
  const path = require('path');

  // The old pin asserted bin/amicus.js CALLS it. That cannot notice a SECOND
  // caller appearing — and a second caller is precisely what would quietly
  // re-open live probes to a context that should not have them.
  it('bin/amicus.js is the only place that enables live probes', () => {
    const root = path.join(__dirname, '..');
    const hits = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) { continue; }
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (!e.name.endsWith('.js')) { continue; }
        const src = fs.readFileSync(full, 'utf-8');
        // The definition and the tests are not callers.
        if (full.includes('live-probes.js') || full.includes(`${path.sep}tests${path.sep}`)) { continue; }
        if (/\benableLiveProbes\s*\(/.test(src)) { hits.push(path.relative(root, full)); }
      }
    };
    for (const d of ['src', 'bin', 'electron', 'scripts']) { walk(path.join(root, d)); }
    expect(hits).toEqual(['bin' + path.sep + 'amicus.js']);
  });
});

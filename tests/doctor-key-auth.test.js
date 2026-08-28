// tests/doctor-key-auth.test.js
'use strict';

/**
 * Issue #210: `amicus doctor` never re-validated a STORED api key — the `keys`
 * check only ever tested PRESENCE (readApiKeys() returns booleans), so a key
 * that rotted after it was entered (or that reached .env by any path other
 * than the wizard / `amicus key`) printed ✓ forever. On the reporter's machine
 * doctor was green while the stored DeepSeek key returned 401 and the catalog
 * served 0 deepseek rows.
 *
 * The new 'key-auth' row probes every stored key. Its whole design problem is
 * FALSE ALARMS: being offline must never look like a rotted key, so only a
 * definitive auth rejection (401 only) is an `error` — every ambiguous outcome
 * (timeout, DNS/network, 5xx, unexpected status) is a `warn`.
 */

const { runDoctorChecks, handleDoctor } = require('../src/cli-handlers-doctor');
const { makeBaseDeps } = require('./helpers/doctor-base-deps');
const {
  evaluateKeyAuth, classifyProbeFailure,
} = require('../src/utils/doctor-key-auth-check');

/** Direct unit call — every dep injected, nothing falls through to realDeps(). */
function keyAuth({ keys, validate }) {
  return evaluateKeyAuth({
    readApiKeyValues: () => keys,
    validateApiKey: validate,
  });
}

/** Mirrors tests/doctor-local-providers.test.js's capture(). */
function capture(fn) {
  const out = [];
  const orig = process.stdout.write;
  process.stdout.write = (s) => { out.push(s); return true; };
  return Promise.resolve(fn()).then((code) => { process.stdout.write = orig; return { code, out: out.join('') }; })
    .catch((e) => { process.stdout.write = orig; throw e; });
}

describe('doctor: key-auth check (#210)', () => {
  // Same leak-closed proof doctor-local-providers.test.js uses: this suite must
  // never reach the real https primitives. A validator that fell through to
  // realDeps() would fire a live authenticated request against the machine's
  // OWN ~/.config/amicus/.env keys — the exact hazard the injectable dep exists
  // to prevent.
  let httpsGetSpy;
  let httpsRequestSpy;

  beforeAll(() => {
    const https = require('https');
    httpsGetSpy = jest.spyOn(https, 'get');
    httpsRequestSpy = jest.spyOn(https, 'request');
  });

  afterEach(() => {
    expect(httpsGetSpy).not.toHaveBeenCalled();
    expect(httpsRequestSpy).not.toHaveBeenCalled();
  });

  afterAll(() => {
    httpsGetSpy.mockRestore();
    httpsRequestSpy.mockRestore();
  });

  describe('status semantics', () => {
    test('no keys stored → ok "no keys stored — skipped", validator never called', async () => {
      const validate = jest.fn();
      const c = await keyAuth({ keys: {}, validate });
      expect(c.id).toBe('key-auth');
      expect(c.status).toBe('ok');
      expect(c.message).toMatch(/no keys stored/i);
      expect(c.message).toMatch(/skipped/i);
      expect(validate).not.toHaveBeenCalled();
    });

    test('every stored key valid → ok, naming each probed provider', async () => {
      const c = await keyAuth({
        keys: { openrouter: 'sk-or-x', deepseek: 'sk-ds-x' },
        validate: jest.fn().mockResolvedValue({ valid: true }),
      });
      expect(c.status).toBe('ok');
      expect(c.message).toMatch(/openrouter/);
      expect(c.message).toMatch(/deepseek/);
      expect(c.hint).toBeNull();
    });

    test('a definitive 401 → ERROR naming the provider, with the amicus key hint', async () => {
      const c = await keyAuth({
        keys: { deepseek: 'sk-ds-rotted' },
        validate: jest.fn().mockResolvedValue({ valid: false, status: 401, error: 'Invalid API key (401)' }),
      });
      expect(c.status).toBe('error');
      expect(c.message).toMatch(/deepseek/);
      expect(c.message).toMatch(/401/);
      expect(c.hint).toMatch(/amicus key <provider> <key>/);
      expect(c.hint).toMatch(/deepseek/);
    });

    test('a 403 → WARN, not error (council finding 1, PR 221)', async () => {
      // Google returns 403 for "API not enabled" and for quota; a WAF returns
      // it for bot protection. This used to be an error, which meant telling
      // someone to re-enter a key that works.
      const c = await keyAuth({
        keys: { openrouter: 'a' },
        validate: jest.fn().mockResolvedValue({
          valid: false, status: 403,
          error: 'Forbidden (403) — the request was rejected, but this may be a disabled API',
        }),
      });
      expect(c.status).toBe('warn');
      expect(c.message).toMatch(/403/);
      expect(c.hint).not.toMatch(/re-enter/);
    });

    test.each([
      ['a timeout', 'Request timed out'],
      ['a DNS/network error', 'getaddrinfo ENOTFOUND api.deepseek.com'],
      ['a 5xx', 'Server error (503)'],
      ['a 429 rate limit', 'Server error (429)'],
      ['an unexpected status', 'Unexpected response (404)'],
    ])('%s → WARN, never error (being offline is not a rotted key)', async (_label, error) => {
      const c = await keyAuth({
        keys: { deepseek: 'sk-ds-x' },
        validate: jest.fn().mockResolvedValue({ valid: false, error }),
      });
      expect(c.status).toBe('warn');
      expect(c.message).toMatch(/deepseek/);
      // An unverifiable key must never be described as rejected.
      expect(c.message).not.toMatch(/rejected/i);
    });

    test('mixed valid + 401 → error; the message still reports the healthy key', async () => {
      const c = await keyAuth({
        keys: { openrouter: 'sk-or-good', deepseek: 'sk-ds-rotted' },
        validate: jest.fn((provider) => Promise.resolve(
          provider === 'deepseek'
            ? { valid: false, status: 401, error: 'Invalid API key (401)' }
            : { valid: true },
        )),
      });
      expect(c.status).toBe('error');
      expect(c.message).toMatch(/openrouter: valid/);
      expect(c.message).toMatch(/deepseek/);
      expect(c.hint).toMatch(/deepseek/);
      // Only the rejected provider belongs in the re-enter hint.
      expect(c.hint).not.toMatch(/openrouter/);
    });

    test('mixed 401 + timeout → error (definitive wins), message carries both', async () => {
      const c = await keyAuth({
        keys: { deepseek: 'sk-ds-rotted', openai: 'sk-oa-x' },
        validate: jest.fn((provider) => Promise.resolve(
          provider === 'deepseek'
            ? { valid: false, status: 401, error: 'Invalid API key (401)' }
            : { valid: false, error: 'Request timed out' },
        )),
      });
      expect(c.status).toBe('error');
      expect(c.message).toMatch(/deepseek/);
      expect(c.message).toMatch(/openai/);
      expect(c.hint).toMatch(/deepseek/);
      expect(c.hint).not.toMatch(/openai/);
    });

    test('two rejected providers are BOTH named', async () => {
      const c = await keyAuth({
        keys: { deepseek: 'a', openai: 'b' },
        validate: jest.fn().mockResolvedValue({ valid: false, status: 401, error: 'Invalid API key (401)' }),
      });
      expect(c.status).toBe('error');
      expect(c.hint).toMatch(/deepseek/);
      expect(c.hint).toMatch(/openai/);
    });
  });

  describe('classifyProbeFailure: the definitive-vs-ambiguous rule', () => {
    // Reads the STRUCTURED `status` field. It used to regex "(401)" out of the
    // error prose, which tied control flow to message wording (council finding
    // 2, PR 221). These now pass results, not strings.
    it('401 is DEFINITIVE — the one status that means "credential not accepted"', () => {
      expect(classifyProbeFailure({ status: 401, error: 'Invalid API key (401)' }).definitive)
        .toBe(true);
    });

    it('403 is AMBIGUOUS — council finding 1 moved it off the definitive side', () => {
      // Google returns 403 for "API not enabled" and for quota; a WAF returns
      // it for bot protection. Sending someone to re-enter a working key is
      // the false-ALARM twin of the false-GREEN this check exists to kill.
      const c = classifyProbeFailure({ status: 403, error: 'Forbidden (403) — ...' });
      expect(c.definitive).toBe(false);
      expect(c.reason).toMatch(/403/);
      expect(c.reason).toMatch(/forbidden/i);
    });

    test.each([500, 429, 404, 400, 502])('%p is AMBIGUOUS', (status) => {
      expect(classifyProbeFailure({ status }).definitive).toBe(false);
    });

    test.each([
      { status: null, error: 'Request timed out' },
      { status: null, error: 'socket hang up' },
      { status: null },
      {},
      undefined,
      null,
    ])('a result with no status is AMBIGUOUS: %p', (res) => {
      expect(classifyProbeFailure(res).definitive).toBe(false);
    });

    it('a timeout is named as such, an unreachable host is not', () => {
      expect(classifyProbeFailure({ status: null, error: 'Request timed out' }).reason)
        .toMatch(/timed out/);
      expect(classifyProbeFailure({ status: null, error: 'socket hang up' }).reason)
        .toMatch(/unreachable/);
    });

    it('prose alone can no longer make a finding definitive', () => {
      // The whole point of finding 2: an error that SAYS 401 but carries no
      // status must not be treated as a verdict.
      expect(classifyProbeFailure({ error: 'Invalid API key (401)' }).definitive).toBe(false);
    });
  });

  describe('no key material, no URLs, ever', () => {
    test('a REJECTING validator is caught and its message never surfaced', async () => {
      // validateApiKey builds the Google probe as
      // `${endpoint.url}?key=${trimmedKey}` and calls https.get(url) inside its
      // promise executor — a synchronous throw there (e.g. ERR_INVALID_URL)
      // REJECTS, and Node's message echoes that URL verbatim, key and all.
      // Without a per-probe catch, guardAsync would print it as the row message.
      const leak = new Error('Invalid URL: https://generativelanguage.googleapis.com/v1beta/models?key=AIzaSUPERSECRET');
      const c = await keyAuth({
        keys: { google: 'AIzaSUPERSECRET' },
        validate: jest.fn().mockRejectedValue(leak),
      });
      expect(c.status).toBe('warn');
      expect(JSON.stringify(c)).not.toMatch(/AIzaSUPERSECRET/);
      expect(JSON.stringify(c)).not.toMatch(/https?:\/\//);
    });

    test('raw provider error prose is sanitized, not echoed', async () => {
      const c = await keyAuth({
        keys: { google: 'AIzaSUPERSECRET' },
        validate: jest.fn().mockResolvedValue({
          valid: false,
          error: 'connect ECONNREFUSED https://generativelanguage.googleapis.com/v1beta/models?key=AIzaSUPERSECRET',
        }),
      });
      expect(c.status).toBe('warn');
      expect(JSON.stringify(c)).not.toMatch(/AIzaSUPERSECRET/);
      expect(JSON.stringify(c)).not.toMatch(/https?:\/\//);
    });

    test('the key string is never in the row, even on the happy path', async () => {
      const c = await keyAuth({
        keys: { openrouter: 'sk-or-v1-TOPSECRETVALUE' },
        validate: jest.fn().mockResolvedValue({ valid: true }),
      });
      expect(JSON.stringify(c)).not.toMatch(/TOPSECRETVALUE/);
    });
  });

  describe('probe fan-out', () => {
    test('all stored keys are probed IN PARALLEL (5 × 10s sequential would make doctor unusable)', async () => {
      const started = [];
      const resolvers = [];
      const validate = jest.fn((provider) => {
        started.push(provider);
        return new Promise((resolve) => resolvers.push(resolve));
      });
      const pending = keyAuth({
        keys: { openrouter: 'a', google: 'b', openai: 'c', anthropic: 'd', deepseek: 'e' },
        validate,
      });
      // Promise.all fans out synchronously: every probe is in flight before any
      // has settled. A sequential `for await` loop would show exactly one here.
      expect(started).toEqual(['openrouter', 'google', 'openai', 'anthropic', 'deepseek']);
      resolvers.forEach((r) => r({ valid: true }));
      const c = await pending;
      expect(c.status).toBe('ok');
      expect(validate).toHaveBeenCalledTimes(5);
    });

    // SUPERSEDED by council finding C1 on PR #221. This test originally
    // asserted `status: 'ok'` here — i.e. a stored key nothing could check
    // still reported healthy. That is the same false-green shape #210 exists
    // to close, so the behaviour changed and this pin changed with it. The
    // "not probed" half is unchanged and still pinned: no endpoint, no call.
    test('a provider with no validation endpoint is not probed, and warns', async () => {
      const validate = jest.fn().mockResolvedValue({ valid: true });
      const c = await keyAuth({ keys: { openrouter: 'a', mystery: 'b' }, validate });
      expect(validate).toHaveBeenCalledTimes(1);
      expect(validate).toHaveBeenCalledWith('openrouter', 'a');
      expect(c.status).toBe('warn');
      expect(c.message).toMatch(/mystery/);
    });

    test('every stored key is probed exactly once, with its own provider id and key', async () => {
      const validate = jest.fn().mockResolvedValue({ valid: true });
      await keyAuth({ keys: { openrouter: 'a', deepseek: 'b' }, validate });
      expect(validate.mock.calls).toEqual([['openrouter', 'a'], ['deepseek', 'b']]);
    });
  });

  describe('wiring into runDoctorChecks', () => {
    const byId = (checks) => Object.fromEntries(checks.map((c) => [c.id, c]));

    test('the row is present and injected — the base fixture never fires a real probe', async () => {
      const validateApiKey = jest.fn().mockResolvedValue({ valid: true });
      const checks = await runDoctorChecks(makeBaseDeps({ validateApiKey }));
      const c = byId(checks)['key-auth'];
      expect(c).toBeDefined();
      expect(c.name).toMatch(/API key auth/i);
      expect(c.status).toBe('ok');
      // makeBaseDeps stores exactly one key (openrouter).
      expect(validateApiKey).toHaveBeenCalledTimes(1);
      expect(validateApiKey.mock.calls[0][0]).toBe('openrouter');
    });

    test('a rotted stored key surfaces as an error row (the #210 reporter\'s case)', async () => {
      const checks = await runDoctorChecks(makeBaseDeps({
        readApiKeys: () => ({ openrouter: false, google: false, openai: false, anthropic: false, deepseek: true }),
        readApiKeyValues: () => ({ deepseek: 'sk-ds-rotted' }),
        validateApiKey: () => Promise.resolve({ valid: false, status: 401, error: 'Invalid API key (401)' }),
      }));
      const c = byId(checks)['key-auth'];
      expect(c.status).toBe('error');
      expect(c.message).toMatch(/deepseek/);
      // The presence-only 'keys' row still reports green — that IS the bug #210
      // describes, and it is why this second row had to exist.
      expect(byId(checks).keys.status).toBe('ok');
    });

    test('an offline machine warns, and does NOT flip doctor\'s exit code', async () => {
      const checks = await runDoctorChecks(makeBaseDeps({
        validateApiKey: () => Promise.resolve({ valid: false, error: 'Request timed out' }),
      }));
      expect(byId(checks)['key-auth'].status).toBe('warn');
      const { code } = await capture(() => handleDoctor({ _: [] }, async () => checks));
      expect(code).toBe(0);
    });

    test('a rejected key DOES flip doctor\'s exit code to 1', async () => {
      const checks = await runDoctorChecks(makeBaseDeps({
        validateApiKey: () => Promise.resolve({ valid: false, status: 401, error: 'Invalid API key (401)' }),
      }));
      const { code } = await capture(() => handleDoctor({ _: [] }, async () => checks));
      expect(code).toBe(1);
    });

    test('a throwing readApiKeyValues degrades to a guarded error line, never throws', async () => {
      await expect(runDoctorChecks(makeBaseDeps({
        readApiKeyValues: () => { throw new Error('boom'); },
      }))).resolves.toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Council review of PR #221, finding C1 (raised by `gpt`, Confirmed).
// ---------------------------------------------------------------------------
describe('#210 C1: a stored key with no validation endpoint must not read as healthy', () => {
  const { evaluateKeyAuth } = require('../src/utils/doctor-key-auth-check');

  // LATENT, not live: PROVIDER_ENV_MAP and VALIDATION_ENDPOINTS carry identical
  // key sets today, so `unprobeable` is always empty. It becomes reachable the
  // moment a provider is added to provider-registry.js ahead of an endpoint in
  // api-key-validation.js — and reporting `ok` there would be the exact
  // false-green this whole check exists to close. Silence is not health.
  const deps = (values, valid = true) => ({
    readApiKeyValues: () => values,
    validateApiKey: () => Promise.resolve({ valid }),
  });

  it('warns when a stored key cannot be probed at all', async () => {
    const r = await evaluateKeyAuth(deps({ openrouter: 'k', mystery: 'k2' }));
    expect(r.status).toBe('warn');
    expect(r.message).toContain('mystery');
    expect(r.message).toContain('not probeable');
  });

  it('still reports the probeable ones alongside it', async () => {
    const r = await evaluateKeyAuth(deps({ openrouter: 'k', mystery: 'k2' }));
    expect(r.message).toContain('openrouter: valid');
  });

  it('a definitive rejection still outranks an unprobeable key (error beats warn)', async () => {
    const r = await evaluateKeyAuth({
      readApiKeyValues: () => ({ openrouter: 'k', mystery: 'k2' }),
      validateApiKey: () => Promise.resolve({ valid: false, status: 401, error: 'Invalid API key (401)' }),
    });
    expect(r.status).toBe('error');
  });

  it('all-probeable-and-valid is still a clean ok (no gratuitous yellow)', async () => {
    const r = await evaluateKeyAuth(deps({ openrouter: 'k', deepseek: 'k2' }));
    expect(r.status).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// Council finding 7 (second review of PR 221).
// ---------------------------------------------------------------------------
describe('#210 F7 / PR 222: live probes are OPT-IN, and a skip is never healthy', () => {
  const {
    probeApiKey, probeOpenRouterCredit, SKIPPED_REASON,
  } = require('../src/utils/doctor-key-auth-check');
  const live = require('../src/utils/live-probes');
  const https = require('https');

  afterEach(() => { live._resetLiveProbes(); delete process.env.AMICUS_NO_NETWORK_PROBES; });

  // The gate used to DETECT TEST RUNNERS (JEST_WORKER_ID, VITEST, ...). A
  // blocklist is only as good as its enumeration: a bespoke runner or a plain
  // `node script.js` walked past it and spent real credentials. Council review
  // of PR 222. "Am I in a test?" is unbounded; "am I the CLI?" is one fact.
  it('probes are DISABLED by default — nothing but the CLI turns them on', () => {
    expect(live.liveProbesAllowed()).toBe(false);
  });

  it('enableLiveProbes() turns them on, and the env escape hatch still wins', () => {
    live.enableLiveProbes();
    expect(live.liveProbesAllowed()).toBe(true);
    process.env.AMICUS_NO_NETWORK_PROBES = '1';
    expect(live.liveProbesAllowed()).toBe(false);
  });

  it('bin/amicus.js is the one caller of enableLiveProbes', () => {
    const read = (f) => require('fs').readFileSync(require('path').join(__dirname, '..', f), 'utf-8');
    expect(read('bin/amicus.js')).toMatch(/enableLiveProbes\(\)/);
  });

  it('a disabled key probe opens no socket and is marked skipped', async () => {
    const spy = jest.spyOn(https, 'get');
    const r = await probeApiKey('openrouter', 'sk-real-looking-key');
    expect(spy).not.toHaveBeenCalled();
    expect(r).toEqual({ valid: false, status: null, skipped: true, error: SKIPPED_REASON });
    spy.mockRestore();
  });

  it('a skip reads as a SKIP, not as "unreachable"', async () => {
    const c = classifyProbeFailure(await probeApiKey('openrouter', 'k'));
    expect(c.definitive).toBe(false);
    expect(c.reason).toMatch(/skipped/);
  });

  it('the OpenRouter CREDIT probe is behind the same gate', async () => {
    const spy = jest.spyOn(https, 'get');
    const r = await probeOpenRouterCredit('sk-or-real-looking');
    expect(spy).not.toHaveBeenCalled();
    expect(r.skipped).toBe(true);
    spy.mockRestore();
  });

  it('a full runDoctorChecks with NO network deps injected opens no socket', async () => {
    // The sharpest pin, and the one that actually fails when a probe is
    // unguarded. Asserting on the ROW cannot: an unguarded credit probe that
    // fails or times out resolves the same no-warning shape the gate returns.
    const spy = jest.spyOn(https, 'get');
    const { runDoctorChecks } = require('../src/cli-handlers-doctor');
    await runDoctorChecks({
      readApiKeyValues: () => ({ openrouter: 'sk-or-x', deepseek: 'sk-d' }),
      readApiKeys: () => ({ openrouter: true, deepseek: true }),
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  // Executes the wiring rather than regexing the source: a missing
  // keyAuthCheck/creditCheck import throws ReferenceError here, where the old
  // source-text assertion would have passed straight over it.
  it('realDeps() EXECUTES its probes, and a skipped credit probe is NOT "credit ok"', async () => {
    const { runDoctorChecks } = require('../src/cli-handlers-doctor');
    const checks = await runDoctorChecks({
      readApiKeyValues: () => ({ openrouter: 'sk-or-x' }),
      readApiKeys: () => ({ openrouter: true }),
    });
    expect(checks.find((c) => c.id === 'key-auth').status).toBe('warn');
    // ⚠️ THE A2 PIN. This returned 'ok' with the message "credit ok" — a funded
    // account reported for one nobody checked, in the same commit that removed
    // the identical false green from the anthropic branch.
    const credit = checks.find((c) => c.id === 'openrouter-credit');
    expect(credit.status).toBe('warn');
    expect(credit.message).not.toMatch(/credit ok/);
    expect(credit.message).toMatch(/not checked/);
  });
});

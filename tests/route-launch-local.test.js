'use strict';

describe('resolveRouteForLaunch: local assembly', () => {
  afterEach(() => jest.resetModules());

  function load({ providers, probe, env = {} }) {
    jest.resetModules();
    jest.doMock('../src/utils/local-providers', () => ({
      // B2/D3: resolveLocalRouteInputs now lives in this module, so the mock must
      // keep the REAL implementation (it takes `providers` as a parameter, so no
      // bare-identifier trap) while faking only the config-reading entry points.
      ...jest.requireActual('../src/utils/local-providers'),
      getLocalProviders: () => providers,
      isLocalProvider: (id) => Object.prototype.hasOwnProperty.call(providers, id),
      deriveKeyEnv: (id) => `${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`,
    }));
    jest.doMock('../src/utils/local-probe', () => ({ probeLocalProvider: probe }));
    // Keep the direct-vendor key/catalog reads inert.
    // M5: mocking config alone does NOT achieve that. resolveRouteForLaunch
    // unconditionally calls buildLaunchKeys() (route-launch.js :: buildLaunchKeys) → the real
    // readApiKeys()/readAuthJsonKeys(), an fs.readFileSync of ~/.config/amicus/.env;
    // and when validateModel !== false (tests 1, 3, 4) it calls the real
    // getRouteCatalogInfo() → getCatalogInfo() → refreshCatalog() → fetchAllModels(),
    // which hits the NETWORK on a machine with no model-catalog.json. The sibling
    // suite tests/route-launch.test.js:22-42 mocks all four for exactly this reason.
    jest.doMock('../src/utils/config', () => ({ getEffectiveAliases: () => ({}) }));
    jest.doMock('../src/utils/api-key-store', () => ({
      readApiKeys: () => ({ openrouter: false, google: false, openai: false, anthropic: false, deepseek: false }),
      // B1: resolveLocalRouteInputs no longer reads readApiKeyValues() (dropped
      // dead/unsafe fallback) — kept here only so any other transitive require of
      // this mocked module still finds a shape-compatible stub.
      readApiKeyValues: () => ({}),
    }));
    jest.doMock('../src/utils/auth-json', () => ({ readAuthJsonKeys: () => ({}) }));
    jest.doMock('../src/utils/model-catalog', () => ({ getCatalogInfo: async () => ({ models: [], lastRefreshError: null }) }));
    for (const [k, v] of Object.entries(env)) { process.env[k] = v; }
    return require('../src/utils/route-launch').resolveRouteForLaunch;
  }

  test('probes a configured local vendor and resolves gateway:local', async () => {
    const probe = jest.fn().mockResolvedValue({ status: 'ok', models: ['ollama/llama3.3'] });
    const resolve = load({ providers: { ollama: { id: 'ollama', baseURL: 'http://127.0.0.1:11434/v1', flavor: 'ollama' } }, probe });
    const r = await resolve({ model: 'ollama/llama3.3', gatewayMode: 'auto', source: 'test', validateModel: true });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(r.kind).toBe('resolved');
    expect(r.gateway).toBe('local');
  });

  test('--no-validate-model skips the probe (localLive.status = skipped)', async () => {
    const probe = jest.fn();
    const resolve = load({ providers: { ollama: { id: 'ollama', baseURL: 'http://127.0.0.1:11434/v1', flavor: 'ollama' } }, probe });
    const r = await resolve({ model: 'ollama/llama3.3', gatewayMode: 'auto', source: 'test', validateModel: false });
    expect(probe).not.toHaveBeenCalled();
    expect(r.kind).toBe('resolved');
    expect(r.notice).toMatch(/unverified/i);
  });

  test('a declared bearer present in env → keyPresent true → resolves', async () => {
    const probe = jest.fn().mockResolvedValue({ status: 'ok', models: ['lab/m'] });
    const resolve = load({
      providers: { lab: { id: 'lab', baseURL: 'https://10.0.0.5:8000/v1', flavor: 'vllm', apiKeyEnv: 'LAB_API_KEY' } },
      probe, env: { LAB_API_KEY: 'tok' },
    });
    const r = await resolve({ model: 'lab/m', gatewayMode: 'auto', source: 'test', validateModel: true });
    expect(probe).toHaveBeenCalledWith(expect.objectContaining({ id: 'lab' }), expect.objectContaining({ bearer: 'tok' }));
    expect(r.kind).toBe('resolved');
  });

  // Companion to the "present" case above: a declared apiKeyEnv whose value is
  // ABSENT from env must resolve keyPresent:false, which the router (gateway-router.js's
  // resolveLocal step 2) turns into a no_local_key error rather than a resolved route.
  // Uses a distinct vendor id / env var name (not 'lab'/'LAB_API_KEY') so it cannot
  // inherit process.env pollution left behind by the "present" test above, which
  // never unsets what it seeds.
  test('a declared bearer absent from env → keyPresent false → no_local_key (different outcome than keyPresent true)', async () => {
    const probe = jest.fn().mockResolvedValue({ status: 'ok', models: ['lab2/m'] });
    const resolve = load({
      providers: { lab2: { id: 'lab2', baseURL: 'https://10.0.0.6:8000/v1', flavor: 'vllm', apiKeyEnv: 'LAB2_API_KEY' } },
      probe, // env intentionally NOT seeded with LAB2_API_KEY -> keyPresent must resolve false
    });
    const r = await resolve({ model: 'lab2/m', gatewayMode: 'auto', source: 'test', validateModel: true });
    expect(r.kind).toBe('error');
    expect(r.reason).toBe('no_local_key');
  });

  // B1 (whole-branch review, CRITICAL): the OLD resolveLocalRouteInputs fell back to
  // `readApiKeyValues()[vendor]` when process.env[apiKeyEnv] was unset. readApiKeyValues()
  // returns a plain `{}`-shaped object keyed only by the 5 static PROVIDER_ENV_MAP vendor
  // ids -- never a local id -- so for a local vendor named 'constructor' the bracket lookup
  // walked the prototype chain to Object.prototype.constructor (the Object function,
  // truthy), fabricating a bearer and flipping keyPresent to true even though no token was
  // ever configured. Same template as the "declared bearer absent" test above, instantiated
  // with id 'constructor' and NO env seeded for its apiKeyEnv.
  test('a local id named "constructor" with an unset apiKeyEnv resolves keyPresent false / no_local_key, not a fabricated bearer', async () => {
    const probe = jest.fn().mockResolvedValue({ status: 'ok', models: ['constructor/m'] });
    const resolve = load({
      providers: { constructor: { id: 'constructor', baseURL: 'https://10.0.0.7:8000/v1', flavor: 'vllm', apiKeyEnv: 'CTOR_API_KEY' } },
      probe, // env intentionally NOT seeded with CTOR_API_KEY -> keyPresent must resolve false
    });
    const r = await resolve({ model: 'constructor/m', gatewayMode: 'auto', source: 'test', validateModel: true });
    expect(r.kind).toBe('error');
    expect(r.reason).toBe('no_local_key');
  });

  test('a non-local model is unaffected (no probe, normal routing)', async () => {
    const probe = jest.fn();
    const resolve = load({ providers: {}, probe });
    const r = await resolve({ model: 'openrouter/x-ai/grok-4', gatewayMode: 'auto', source: 'test', validateModel: true });
    expect(probe).not.toHaveBeenCalled();
    expect(r.gateway === 'local').toBe(false);
  });

  // D10/M24: the router builds live-probe suggestions (gateway:'local'), but
  // route-launch.js :: applySuggestions then OVERWRITES result.suggestions unconditionally with
  // buildSuggestions(), which reads only the 24h catalog cache and hardcodes
  // gateway:'direct' (route-suggestions.js:65). Without the applySuggestions guard (written in Step 3-pre,
  // wired in Step 3c) the live roster is discarded —
  // defeating the spec's stated reason for probing live ("local rosters churn far
  // faster than the 24h cache", §4.2 point 4). Tasks 4's tests call bare resolveRoute()
  // and never traverse this wrapper, so this is the ONLY place it can be caught.
  test('a local selection_required keeps the router live-probe suggestions (not buildSuggestions)', async () => {
    const probe = jest.fn().mockResolvedValue({ status: 'ok', models: ['ollama/llama3.3', 'ollama/qwen3:14b'] });
    const resolve = load({ providers: { ollama: { id: 'ollama', baseURL: 'http://127.0.0.1:11434/v1', flavor: 'ollama' } }, probe });
    const r = await resolve({ model: 'ollama/ghost', gatewayMode: 'auto', source: 'test', validateModel: true, allowSelection: true });
    expect(r.kind).toBe('selection_required');
    expect(r.suggestions.map((s) => s.model)).toEqual(['ollama/llama3.3', 'ollama/qwen3:14b']);
    expect(r.suggestions.every((s) => s.gateway === 'local')).toBe(true);
  });
});

// Review Finding 1 (post-Task-5 review, CRITICAL): resolveLocalRouteInputs read
// `all[vendor]` with a bare bracket lookup. `all` (the local-provider map) is
// `{}` -- a truthy empty object -- for any user with no local providers
// configured, the common case. A bare lookup on a truthy `{}` walks the
// prototype chain, so a vendor name colliding with an Object.prototype member
// (e.g. 'constructor', which parseDescriptor lets through with zero vendor
// validation) resolved the INHERITED value (truthy) and fabricated a fake
// local-provider entry even though no such provider is configured. Worse: the
// fabricated entry carries a genuine OWN key by the time it reaches
// gateway-router.js's resolveRoute, which defeats that module's own
// hasOwnProperty guards (Task 4, commit 19aade4) with corrupt input assembled
// upstream. Fixed to match the same Object.prototype.hasOwnProperty.call idiom
// used at gateway-router.js:142/146/159 and local-providers.js:103
// (isLocalProvider). No mocking needed: `providers` is passed explicitly, so
// getLocalProviders()/config.js is never consulted, and on the FIXED path the
// function returns before touching api-key-store or local-probe.
describe('resolveLocalRouteInputs: prototype-chain guard (Finding 1, review pass)', () => {
  test('a vendor name colliding with Object.prototype does not fabricate a local-provider entry from an empty providers map', async () => {
    const { resolveLocalRouteInputs } = require('../src/utils/local-providers');
    const result = await resolveLocalRouteInputs(
      { vendor: 'constructor', model: 'foo' },
      { validateModel: true, providers: {} }
    );
    // Contract (local-providers.js:111): "`{}` for a non-local vendor" -- against
    // an empty providers map, 'constructor' must be treated as non-local, full stop.
    expect(result).toEqual({});
    expect(Object.prototype.hasOwnProperty.call(result.localProviders || {}, 'constructor')).toBe(false);
  });
});

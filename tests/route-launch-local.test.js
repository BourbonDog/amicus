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
    // unconditionally calls buildLaunchKeys() (route-launch.js:269) → the real
    // readApiKeys()/readAuthJsonKeys(), an fs.readFileSync of ~/.config/amicus/.env;
    // and when validateModel !== false (tests 1, 3, 4) it calls the real
    // getRouteCatalogInfo() → getCatalogInfo() → refreshCatalog() → fetchAllModels(),
    // which hits the NETWORK on a machine with no model-catalog.json. The sibling
    // suite tests/route-launch.test.js:22-42 mocks all four for exactly this reason.
    jest.doMock('../src/utils/config', () => ({ getEffectiveAliases: () => ({}) }));
    jest.doMock('../src/utils/api-key-store', () => ({
      readApiKeys: () => ({ openrouter: false, google: false, openai: false, anthropic: false, deepseek: false }),
      readApiKeyValues: () => ({}),   // resolveLocalRouteInputs lazy-requires this for the bearer fallback
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

  test('a non-local model is unaffected (no probe, normal routing)', async () => {
    const probe = jest.fn();
    const resolve = load({ providers: {}, probe });
    const r = await resolve({ model: 'openrouter/x-ai/grok-4', gatewayMode: 'auto', source: 'test', validateModel: true });
    expect(probe).not.toHaveBeenCalled();
    expect(r.gateway === 'local').toBe(false);
  });

  // D10/M24: the router builds live-probe suggestions (gateway:'local'), but
  // route-launch.js:292-294 then OVERWRITES result.suggestions unconditionally with
  // buildSuggestions(), which reads only the 24h catalog cache and hardcodes
  // gateway:'direct' (:110). Without the applySuggestions guard (written in Step 3-pre,
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

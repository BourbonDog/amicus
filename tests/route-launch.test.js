'use strict';

// resolveRouteForLaunch (#61 gateway routing integration, Task 4.4) — the
// bridge: alias -> descriptor -> resolveRoute. Injects config/keys/catalog via
// jest.doMock, mirroring the pattern in tests/route-launch-keys.test.js.
// gateway-router and model-descriptor are NOT mocked — they're pure, so the
// real implementations exercise the actual routing decisions end to end.

const ALL_FALSE = { openrouter: false, google: false, openai: false, anthropic: false, deepseek: false };

// Known aliases exercising both bridge shapes (per Task 4.4's ambiguity note):
//  - grok  -> an `openrouter/...` literal: must be treated as an explicit,
//             force-OR descriptor once resolved (honored, conflicts with
//             --gateway direct).
//  - gpt   -> a bare `vendor/model`: must be policy-routed (direct-first
//             under auto), NOT treated as a forced OR literal.
const ALIASES = {
  grok: 'openrouter/x-ai/grok-4.3',
  gpt: 'openai/gpt-5.5',
};

function loadRouteLaunch({ aliases = {}, apiKeys = ALL_FALSE, authKeys = {}, catalogModels = [] } = {}) {
  jest.resetModules();
  jest.doMock('../src/utils/config', () => ({
    getEffectiveAliases: () => aliases,
  }));
  jest.doMock('../src/utils/api-key-store', () => ({
    readApiKeys: () => apiKeys,
  }));
  jest.doMock('../src/utils/auth-json', () => ({
    readAuthJsonKeys: () => authKeys,
  }));
  jest.doMock('../src/utils/model-catalog', () => ({
    getCatalogInfo: async () => ({ models: catalogModels, lastRefreshError: null }),
  }));
  return require('../src/utils/route-launch');
}

afterEach(() => {
  jest.dontMock('../src/utils/config');
  jest.dontMock('../src/utils/api-key-store');
  jest.dontMock('../src/utils/auth-json');
  jest.dontMock('../src/utils/model-catalog');
  jest.resetModules();
});

describe('resolveRouteForLaunch', () => {
  test('alias -> openrouter/... literal is honored explicitly (auto, OR key present)', async () => {
    const { resolveRouteForLaunch } = loadRouteLaunch({
      aliases: ALIASES,
      apiKeys: { ...ALL_FALSE, openrouter: true },
    });
    const r = await resolveRouteForLaunch({ model: 'grok', gatewayMode: 'auto', source: 'cli', allowSelection: false, validateModel: false });
    expect(r).toMatchObject({ kind: 'resolved', gateway: 'openrouter', executableId: 'openrouter/x-ai/grok-4.3' });
    expect(r.provenance.resolutionVersion).toBe(1);
  });

  test('alias -> openrouter/... literal conflicts with --gateway direct (force-OR honored)', async () => {
    const { resolveRouteForLaunch } = loadRouteLaunch({
      aliases: ALIASES,
      apiKeys: { ...ALL_FALSE, openrouter: true, openai: true },
    });
    const r = await resolveRouteForLaunch({ model: 'grok', gatewayMode: 'direct', source: 'cli', allowSelection: false, validateModel: false });
    expect(r).toMatchObject({ kind: 'error', reason: 'gateway_conflict' });
  });

  test('alias -> openrouter/... literal without an OR key errors no_openrouter_key', async () => {
    const { resolveRouteForLaunch } = loadRouteLaunch({ aliases: ALIASES, apiKeys: { ...ALL_FALSE } });
    const r = await resolveRouteForLaunch({ model: 'grok', gatewayMode: 'auto', source: 'cli', allowSelection: false, validateModel: false });
    expect(r).toMatchObject({ kind: 'error', reason: 'no_openrouter_key' });
  });

  test('bare canonical direct vendor routes direct-first under auto when its key is present', async () => {
    const { resolveRouteForLaunch } = loadRouteLaunch({
      aliases: ALIASES,
      apiKeys: { ...ALL_FALSE, openai: true, openrouter: true },
    });
    const r = await resolveRouteForLaunch({ model: 'openai/gpt-5.5', gatewayMode: 'auto', source: 'cli', allowSelection: false, validateModel: false });
    expect(r).toMatchObject({ kind: 'resolved', gateway: 'direct', executableId: 'openai/gpt-5.5' });
    expect(r.provenance.resolutionVersion).toBe(1);
  });

  test('bare canonical direct vendor falls back to openrouter under auto when only the OR key is present', async () => {
    const { resolveRouteForLaunch } = loadRouteLaunch({
      aliases: ALIASES,
      apiKeys: { ...ALL_FALSE, openrouter: true },
    });
    const r = await resolveRouteForLaunch({ model: 'openai/gpt-5.5', gatewayMode: 'auto', source: 'cli', allowSelection: false, validateModel: false });
    expect(r).toMatchObject({ kind: 'resolved', gateway: 'openrouter', executableId: 'openrouter/openai/gpt-5.5' });
  });

  test('bare canonical direct vendor honors --gateway openrouter explicitly', async () => {
    const { resolveRouteForLaunch } = loadRouteLaunch({
      aliases: ALIASES,
      apiKeys: { ...ALL_FALSE, openai: true, openrouter: true },
    });
    const r = await resolveRouteForLaunch({ model: 'openai/gpt-5.5', gatewayMode: 'openrouter', source: 'cli', allowSelection: false, validateModel: false });
    expect(r).toMatchObject({ kind: 'resolved', gateway: 'openrouter', executableId: 'openrouter/openai/gpt-5.5' });
  });

  test('alias -> bare vendor/model is policy-routed (direct-first), not forced onto OpenRouter', async () => {
    const { resolveRouteForLaunch } = loadRouteLaunch({
      aliases: ALIASES,
      apiKeys: { ...ALL_FALSE, openai: true, openrouter: true },
    });
    const r = await resolveRouteForLaunch({ model: 'gpt', gatewayMode: 'auto', source: 'cli', allowSelection: false, validateModel: false });
    // Proves the alias->bare-vendor path is NOT force-OR: with both keys
    // present, auto picks direct first (it would be 'openrouter' if the
    // alias were incorrectly treated as an explicit literal).
    expect(r).toMatchObject({ kind: 'resolved', gateway: 'direct', executableId: 'openai/gpt-5.5' });
  });

  test('gateway-only vendor (no direct integration) routes to openrouter under auto', async () => {
    const { resolveRouteForLaunch } = loadRouteLaunch({
      aliases: ALIASES,
      apiKeys: { ...ALL_FALSE, openrouter: true },
    });
    const r = await resolveRouteForLaunch({ model: 'x-ai/grok-4.3', gatewayMode: 'auto', source: 'cli', allowSelection: false, validateModel: false });
    expect(r).toMatchObject({ kind: 'resolved', gateway: 'openrouter', executableId: 'openrouter/x-ai/grok-4.3' });
    expect(r.provenance.resolutionVersion).toBe(1);
  });

  test('gateway-only vendor errors under --gateway direct (no direct integration)', async () => {
    const { resolveRouteForLaunch } = loadRouteLaunch({
      aliases: ALIASES,
      apiKeys: { ...ALL_FALSE, openrouter: true },
    });
    const r = await resolveRouteForLaunch({ model: 'x-ai/grok-4.3', gatewayMode: 'direct', source: 'cli', allowSelection: false, validateModel: false });
    expect(r).toMatchObject({ kind: 'error', reason: 'no_direct_integration' });
  });

  test('gateway-only vendor without an OR key errors no_openrouter_key', async () => {
    const { resolveRouteForLaunch } = loadRouteLaunch({ aliases: ALIASES, apiKeys: { ...ALL_FALSE } });
    const r = await resolveRouteForLaunch({ model: 'x-ai/grok-4.3', gatewayMode: 'auto', source: 'cli', allowSelection: false, validateModel: false });
    expect(r).toMatchObject({ kind: 'error', reason: 'no_openrouter_key' });
  });

  test('validateModel:true with a matching catalog row still resolves and stamps resolutionVersion', async () => {
    const { resolveRouteForLaunch } = loadRouteLaunch({
      aliases: ALIASES,
      apiKeys: { ...ALL_FALSE, openai: true },
      catalogModels: [{ id: 'openai/gpt-5.5', authoritative: true }],
    });
    const r = await resolveRouteForLaunch({ model: 'openai/gpt-5.5', gatewayMode: 'auto', source: 'cli', allowSelection: false, validateModel: true });
    expect(r).toMatchObject({ kind: 'resolved', gateway: 'direct', executableId: 'openai/gpt-5.5' });
    expect(r.provenance.resolutionVersion).toBe(1);
  });
});

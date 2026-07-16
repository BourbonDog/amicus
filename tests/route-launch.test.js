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

function loadRouteLaunch({ aliases = {}, defaultAliases, apiKeys = ALL_FALSE, authKeys = {}, catalogModels = [], getCatalogInfoSpy } = {}) {
  jest.resetModules();
  jest.doMock('../src/utils/config', () => ({
    getEffectiveAliases: () => aliases,
    // Defaults to `aliases` itself (trivially "not overridden") when the
    // caller doesn't care about the override-guard distinction; tests that
    // exercise Task 3's gatewayIds bridge pass a distinct `defaultAliases`.
    getDefaultAliases: () => (defaultAliases !== undefined ? defaultAliases : aliases),
  }));
  jest.doMock('../src/utils/api-key-store', () => ({
    readApiKeys: () => apiKeys,
  }));
  jest.doMock('../src/utils/auth-json', () => ({
    readAuthJsonKeys: () => authKeys,
  }));
  const getCatalogInfo = getCatalogInfoSpy || (async () => ({ models: catalogModels, lastRefreshError: null }));
  jest.doMock('../src/utils/model-catalog', () => ({
    getCatalogInfo,
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

  // #61 perf cleanup: validateModel:false must skip the catalog fetch
  // entirely — gateway-router's catalogGate short-circuits to { ok:true }
  // before ever consulting catalogInfo when validateModel is false, so
  // fetching the catalog for that path is wasted latency/network.
  test('validateModel:false does not call getRouteCatalogInfo / getCatalogInfo, still resolves correctly', async () => {
    const getCatalogInfoSpy = jest.fn(async () => ({ models: [], lastRefreshError: null }));
    const { resolveRouteForLaunch } = loadRouteLaunch({
      aliases: ALIASES,
      apiKeys: { ...ALL_FALSE, openai: true },
      getCatalogInfoSpy,
    });
    const r = await resolveRouteForLaunch({ model: 'openai/gpt-5.5', gatewayMode: 'auto', source: 'cli', allowSelection: false, validateModel: false });
    expect(getCatalogInfoSpy).not.toHaveBeenCalled();
    expect(r).toMatchObject({ kind: 'resolved', gateway: 'direct', executableId: 'openai/gpt-5.5' });
    expect(r.provenance.resolutionVersion).toBe(1);
  });

  test('validateModel:true still fetches the catalog (getRouteCatalogInfo -> getCatalogInfo called once)', async () => {
    const getCatalogInfoSpy = jest.fn(async () => ({
      models: [{ id: 'openai/gpt-5.5', authoritative: true }], lastRefreshError: null,
    }));
    const { resolveRouteForLaunch } = loadRouteLaunch({
      aliases: ALIASES,
      apiKeys: { ...ALL_FALSE, openai: true },
      getCatalogInfoSpy,
    });
    const r = await resolveRouteForLaunch({ model: 'openai/gpt-5.5', gatewayMode: 'auto', source: 'cli', allowSelection: false, validateModel: true });
    expect(getCatalogInfoSpy).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ kind: 'resolved', gateway: 'direct', executableId: 'openai/gpt-5.5' });
  });

  test('selection_required (direct key present, model invalid, allowSelection) carries populated suggestions (#61 Task 6.3)', async () => {
    const { resolveRouteForLaunch } = loadRouteLaunch({
      aliases: ALIASES,
      apiKeys: { ...ALL_FALSE, openai: true, openrouter: true },
      catalogModels: [
        { id: 'openai/gpt-5.5', authoritative: true },
        { id: 'openai/gpt-4o', authoritative: true },
        { id: 'openrouter/openai/gpt-9', authoritative: true },
      ],
    });
    const r = await resolveRouteForLaunch({ model: 'openai/gpt-9', gatewayMode: 'auto', source: 'cli', allowSelection: true, validateModel: true });
    expect(r.kind).toBe('selection_required');
    expect(r.suggestions).toEqual(expect.arrayContaining([
      { model: 'openrouter/openai/gpt-9', gateway: 'openrouter', note: 'same model via OpenRouter' },
      { model: 'openai/gpt-5.5', gateway: 'direct', note: 'openai model' },
      { model: 'openai/gpt-4o', gateway: 'direct', note: 'openai model' },
    ]));
    expect(r.suggestions.length).toBe(3);
  });
});

describe('resolveRouteForLaunch — gatewayIds bridging for curated aliases (Task 3)', () => {
  // Real (unmocked) curated-models.toGatewayRoutes().opus, so this test tracks
  // the actual curated Anthropic ids rather than hand-duplicating them.
  const { toGatewayRoutes, toDefaultAliases } = require('../src/utils/curated-models');
  const opusRoutes = toGatewayRoutes().opus; // { direct: 'anthropic/claude-opus-4-8', openrouter: 'openrouter/anthropic/claude-opus-4.8' }
  const opusDefault = toDefaultAliases().opus; // whatever config stores as the effective alias today

  test('opus alias (curated default, not overridden) resolves direct via the bridged dash-form gatewayIds id', async () => {
    const { resolveRouteForLaunch } = loadRouteLaunch({
      aliases: { ...ALIASES, opus: opusDefault },
      defaultAliases: { opus: opusDefault },
      apiKeys: { ...ALL_FALSE, anthropic: true },
    });
    const r = await resolveRouteForLaunch({ model: 'opus', gatewayMode: 'auto', source: 'cli', allowSelection: false, validateModel: false });
    expect(r).toMatchObject({ kind: 'resolved', gateway: 'direct', executableId: opusRoutes.direct });
    expect(r.executableId).toBe('anthropic/claude-opus-4-8');
  });

  test('opus alias (curated default, not overridden), OR-only key, resolves openrouter via the bridged gatewayIds id', async () => {
    const { resolveRouteForLaunch } = loadRouteLaunch({
      aliases: { ...ALIASES, opus: opusDefault },
      defaultAliases: { opus: opusDefault },
      apiKeys: { ...ALL_FALSE, openrouter: true },
    });
    const r = await resolveRouteForLaunch({ model: 'opus', gatewayMode: 'auto', source: 'cli', allowSelection: false, validateModel: false });
    expect(r).toMatchObject({ kind: 'resolved', gateway: 'openrouter', executableId: opusRoutes.openrouter });
    expect(r.executableId).toBe('openrouter/anthropic/claude-opus-4.8');
  });

  test('user-overridden opus alias does NOT get curated gatewayIds — resolves the user\'s custom target', async () => {
    const { resolveRouteForLaunch } = loadRouteLaunch({
      // User has repointed `opus` at some other model — effective alias
      // differs from the curated default, so the override guard must skip
      // the curated Anthropic gatewayIds entirely.
      aliases: { ...ALIASES, opus: 'openai/gpt-9-custom' },
      defaultAliases: { opus: opusDefault },
      apiKeys: { ...ALL_FALSE, openai: true },
    });
    const r = await resolveRouteForLaunch({ model: 'opus', gatewayMode: 'auto', source: 'cli', allowSelection: false, validateModel: false });
    expect(r).toMatchObject({ kind: 'resolved', gateway: 'direct', executableId: 'openai/gpt-9-custom' });
    // Must not have been coerced onto the curated Anthropic direct id.
    expect(r.executableId).not.toBe(opusRoutes.direct);
  });

  // Fast-follow fix (final whole-branch review): when a divergent alias's
  // bridged direct id (dash-form, e.g. anthropic/claude-opus-4-8) misses the
  // catalog and allowSelection kicks in, buildSuggestions used to reconstruct
  // `openrouter/${vendor}/${model}` from that same dash-form descriptor --
  // producing `openrouter/anthropic/claude-opus-4-8`, which never matches
  // OpenRouter's real dot-form catalog id and silently dropped the "try via
  // OpenRouter" suggestion. It must now prefer the bridged gatewayIds.openrouter
  // (dot-form) instead.
  test('opus alias reaching selection_required suggests the dot-form OpenRouter id, not a reconstructed dash-form id (Fix 2)', async () => {
    const { resolveRouteForLaunch } = loadRouteLaunch({
      aliases: { ...ALIASES, opus: opusDefault },
      defaultAliases: { opus: opusDefault },
      apiKeys: { ...ALL_FALSE, anthropic: true, openrouter: true },
      catalogModels: [
        // Another authoritative row in the anthropic/ namespace so the direct
        // dash-form id (opusRoutes.direct) is a genuine catalog MISS -> 'invalid',
        // not 'unknown' (an empty/all-non-authoritative namespace would never
        // reach selection_required at all).
        { id: 'anthropic/claude-sonnet-5', authoritative: true },
        // The real OpenRouter catalog entry: dot-form.
        { id: opusRoutes.openrouter, authoritative: true },
      ],
    });
    const r = await resolveRouteForLaunch({ model: 'opus', gatewayMode: 'auto', source: 'cli', allowSelection: true, validateModel: true });
    expect(r.kind).toBe('selection_required');
    expect(r.suggestions).toContainEqual({ model: opusRoutes.openrouter, gateway: 'openrouter', note: 'same model via OpenRouter' });
    // The buggy reconstruction would have produced this dash-form id instead.
    const reconstructedDashId = `openrouter/anthropic/${opusRoutes.direct.split('/')[1]}`;
    expect(reconstructedDashId).not.toBe(opusRoutes.openrouter); // sanity: fixture actually distinguishes dash vs dot
    expect(r.suggestions.some((s) => s.model === reconstructedDashId)).toBe(false);
  });
});

describe('buildSuggestions', () => {
  test('includes the OpenRouter alternative when an OR key is present and the OR-namespaced id is in the catalog', () => {
    const { buildSuggestions } = loadRouteLaunch();
    const result = buildSuggestions(
      { vendor: 'openai', model: 'gpt-5' },
      { openrouter: true },
      { models: [{ id: 'openrouter/openai/gpt-5' }, { id: 'openai/gpt-5.5' }] }
    );
    expect(result).toContainEqual({ model: 'openrouter/openai/gpt-5', gateway: 'openrouter', note: 'same model via OpenRouter' });
  });

  test('omits the OpenRouter alternative when the OR-namespaced id is not in the catalog, even with a key', () => {
    const { buildSuggestions } = loadRouteLaunch();
    const result = buildSuggestions(
      { vendor: 'openai', model: 'gpt-5' },
      { openrouter: true },
      { models: [{ id: 'openai/gpt-5.5' }] }
    );
    expect(result.some((s) => s.gateway === 'openrouter')).toBe(false);
  });

  test('omits the OpenRouter alternative when no OR key is present, even if the catalog has the id', () => {
    const { buildSuggestions } = loadRouteLaunch();
    const result = buildSuggestions(
      { vendor: 'openai', model: 'gpt-5' },
      { openrouter: false },
      { models: [{ id: 'openrouter/openai/gpt-5' }] }
    );
    expect(result.length).toBe(0);
  });

  test('collects up to 5 same-vendor alternatives, excluding the requested id and openrouter-namespaced rows', () => {
    const { buildSuggestions } = loadRouteLaunch();
    const result = buildSuggestions(
      { vendor: 'openai', model: 'gpt-5' },
      {},
      { models: [
        { id: 'openai/gpt-5' }, // requested id -> excluded
        { id: 'openai/gpt-5.5' },
        { id: 'openai/gpt-4o' },
        { id: 'openai/gpt-4-turbo' },
        { id: 'openai/o3-mini' },
        { id: 'openai/o3' },
        { id: 'openai/gpt-3.5' }, // 6th same-vendor row -> beyond the cap of 5
        { id: 'openrouter/openai/gpt-5.5' }, // different namespace -> excluded
        { id: 'google/gemini-2.5-pro' }, // different vendor -> excluded
      ] }
    );
    expect(result.length).toBe(5);
    expect(result.every((s) => s.gateway === 'direct' && s.model.startsWith('openai/') && s.note === 'openai model')).toBe(true);
    expect(result.some((s) => s.model === 'openai/gpt-5')).toBe(false);
    expect(result.some((s) => s.model === 'openai/gpt-3.5')).toBe(false);
  });

  test('combines the OpenRouter alternative with same-vendor alternatives, capped at 6 total', () => {
    const { buildSuggestions } = loadRouteLaunch();
    const result = buildSuggestions(
      { vendor: 'openai', model: 'gpt-5' },
      { openrouter: true },
      { models: [
        { id: 'openrouter/openai/gpt-5' },
        { id: 'openai/gpt-5.5' },
        { id: 'openai/gpt-4o' },
        { id: 'openai/gpt-4-turbo' },
        { id: 'openai/o3-mini' },
        { id: 'openai/o3' },
        { id: 'openai/gpt-3.5' },
      ] }
    );
    expect(result.length).toBe(6);
    expect(result[0]).toEqual({ model: 'openrouter/openai/gpt-5', gateway: 'openrouter', note: 'same model via OpenRouter' });
  });

  test('returns [] when the descriptor is missing vendor/model', () => {
    const { buildSuggestions } = loadRouteLaunch();
    expect(buildSuggestions({}, {}, { models: [] })).toEqual([]);
    expect(buildSuggestions(undefined, {}, { models: [] })).toEqual([]);
  });

  // Fix 2 (final whole-branch review fast-follow): divergent-vendor descriptors
  // (e.g. Anthropic) carry the DASH-form direct id as `descriptor.model`, so
  // reconstructing `openrouter/<vendor>/<model>` yields the wrong (dash) id.
  // `gatewayIds.openrouter`, when supplied, is the catalog-correct (dot) form
  // and must be preferred.
  test('prefers gatewayIds.openrouter over reconstruction when provided', () => {
    const { buildSuggestions } = loadRouteLaunch();
    const result = buildSuggestions(
      { vendor: 'anthropic', model: 'claude-opus-4-8' }, // dash-form, as bridged for divergent aliases
      { openrouter: true },
      { models: [{ id: 'openrouter/anthropic/claude-opus-4.8' }] }, // real catalog id: dot-form
      { direct: 'anthropic/claude-opus-4-8', openrouter: 'openrouter/anthropic/claude-opus-4.8' }
    );
    expect(result).toContainEqual({ model: 'openrouter/anthropic/claude-opus-4.8', gateway: 'openrouter', note: 'same model via OpenRouter' });
    // The naive reconstruction (openrouter/anthropic/claude-opus-4-8, dash) must not appear.
    expect(result.some((s) => s.model === 'openrouter/anthropic/claude-opus-4-8')).toBe(false);
  });

  test('falls back to reconstruction when gatewayIds is absent (non-alias / non-divergent, unchanged behavior)', () => {
    const { buildSuggestions } = loadRouteLaunch();
    const result = buildSuggestions(
      { vendor: 'openai', model: 'gpt-5' },
      { openrouter: true },
      { models: [{ id: 'openrouter/openai/gpt-5' }] }
      // no 4th arg -> gatewayIds undefined
    );
    expect(result).toContainEqual({ model: 'openrouter/openai/gpt-5', gateway: 'openrouter', note: 'same model via OpenRouter' });
  });
});

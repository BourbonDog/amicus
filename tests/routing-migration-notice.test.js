'use strict';

// One-time per-vendor direct-migration notice (#61 gateway routing
// integration, Task 5.1 — the "visible migration" guarantee). Mirrors the
// jest.doMock style of tests/route-launch.test.js: config/api-key-store/
// auth-json/model-catalog are mocked; gateway-router and model-descriptor are
// NOT mocked — they're pure, so the real routing decisions are exercised.
//
// validateModel:true + a matching authoritative catalog row is used
// throughout so the catalog gate never attaches its own "unvalidated" notice
// (tests/route-launch.test.js's last case establishes this pattern) — that
// keeps `result.notice` assertions here about the migration notice alone.

const ALL_FALSE = { openrouter: false, google: false, openai: false, anthropic: false, deepseek: false };
const DIRECT_CATALOG = [{ id: 'openai/gpt-5.5', authoritative: true }];
const OR_CATALOG = [{ id: 'openrouter/openai/gpt-5.5', authoritative: true }];

function loadRouteLaunch({
  aliases = {},
  apiKeys = ALL_FALSE,
  authKeys = {},
  catalogModels = DIRECT_CATALOG,
  migrationNotified = {},
  markMigrationNotified = jest.fn(),
} = {}) {
  jest.resetModules();
  jest.doMock('../src/utils/config', () => ({
    getEffectiveAliases: () => aliases,
    getRoutingConfig: () => ({ prefer: 'direct', migration_notified: migrationNotified }),
    markMigrationNotified,
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

describe('one-time per-vendor direct-migration notice', () => {
  test('both-key user, auto mode, bare canonical id resolving direct, not-yet-notified -> notice + markMigrationNotified("openai") once', async () => {
    const markMigrationNotified = jest.fn();
    const { resolveRouteForLaunch } = loadRouteLaunch({
      apiKeys: { ...ALL_FALSE, openrouter: true, openai: true },
      markMigrationNotified,
    });
    const r = await resolveRouteForLaunch({
      model: 'openai/gpt-5.5', gatewayMode: 'auto', source: 'cli', allowSelection: false, validateModel: true,
    });
    expect(r).toMatchObject({ kind: 'resolved', gateway: 'direct', executableId: 'openai/gpt-5.5' });
    expect(r.notice).toBe(
      'Routing openai via direct API (previously OpenRouter). ' +
      'Set routing.prefer: "openrouter" (or use --gateway openrouter) to restore.'
    );
    expect(markMigrationNotified).toHaveBeenCalledTimes(1);
    expect(markMigrationNotified).toHaveBeenCalledWith('openai');
  });

  test('already notified for this vendor -> no migration notice, markMigrationNotified not called', async () => {
    const markMigrationNotified = jest.fn();
    const { resolveRouteForLaunch } = loadRouteLaunch({
      apiKeys: { ...ALL_FALSE, openrouter: true, openai: true },
      migrationNotified: { openai: true },
      markMigrationNotified,
    });
    const r = await resolveRouteForLaunch({
      model: 'openai/gpt-5.5', gatewayMode: 'auto', source: 'cli', allowSelection: false, validateModel: true,
    });
    expect(r).toMatchObject({ kind: 'resolved', gateway: 'direct' });
    expect(r.notice).toBeUndefined();
    expect(markMigrationNotified).not.toHaveBeenCalled();
  });

  test('explicit --gateway direct (user chose direct) -> no migration notice', async () => {
    const markMigrationNotified = jest.fn();
    const { resolveRouteForLaunch } = loadRouteLaunch({
      apiKeys: { ...ALL_FALSE, openrouter: true, openai: true },
      markMigrationNotified,
    });
    const r = await resolveRouteForLaunch({
      model: 'openai/gpt-5.5', gatewayMode: 'direct', source: 'cli', allowSelection: false, validateModel: true,
    });
    expect(r).toMatchObject({ kind: 'resolved', gateway: 'direct' });
    expect(r.notice).toBeUndefined();
    expect(markMigrationNotified).not.toHaveBeenCalled();
  });

  test('single-key user (no openrouter key) routing direct -> no migration notice (nothing to migrate from)', async () => {
    const markMigrationNotified = jest.fn();
    const { resolveRouteForLaunch } = loadRouteLaunch({
      apiKeys: { ...ALL_FALSE, openai: true },
      markMigrationNotified,
    });
    const r = await resolveRouteForLaunch({
      model: 'openai/gpt-5.5', gatewayMode: 'auto', source: 'cli', allowSelection: false, validateModel: true,
    });
    expect(r).toMatchObject({ kind: 'resolved', gateway: 'direct' });
    expect(r.notice).toBeUndefined();
    expect(markMigrationNotified).not.toHaveBeenCalled();
  });

  test('explicit openrouter/... literal -> no migration notice', async () => {
    const markMigrationNotified = jest.fn();
    const { resolveRouteForLaunch } = loadRouteLaunch({
      apiKeys: { ...ALL_FALSE, openrouter: true, openai: true },
      catalogModels: OR_CATALOG,
      markMigrationNotified,
    });
    const r = await resolveRouteForLaunch({
      model: 'openrouter/openai/gpt-5.5', gatewayMode: 'auto', source: 'cli', allowSelection: false, validateModel: true,
    });
    expect(r.kind).toBe('resolved');
    // Explicit OR literals always resolve to the openrouter gateway (never
    // 'direct'), so this also confirms the isExplicitOpenRouter guard is
    // never even reached with gateway==='direct' — the notice must not fire.
    expect(r.gateway).toBe('openrouter');
    expect(r.notice).toBeUndefined();
    expect(markMigrationNotified).not.toHaveBeenCalled();
  });
});

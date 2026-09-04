'use strict';

// Load a fresh copy of route-launch with api-key-store and auth-json stubbed,
// mirroring the doMock pattern in tests/model-fetcher-anthropic.test.js.
function loadRouteLaunch({ apiKeys, authKeys }) {
  jest.resetModules();
  jest.doMock('../src/utils/api-key-store', () => ({
    readApiKeys: () => apiKeys,
  }));
  jest.doMock('../src/utils/auth-json', () => ({
    readAuthJsonKeys: () => authKeys,
  }));
  return require('../src/utils/route-launch');
}

afterEach(() => {
  jest.dontMock('../src/utils/api-key-store');
  jest.dontMock('../src/utils/auth-json');
  jest.resetModules();
});

const ALL_FALSE = { openrouter: false, google: false, openai: false, anthropic: false, deepseek: false };

describe('buildLaunchKeys', () => {
  test('a provider present only in auth.json reads true', () => {
    const { buildLaunchKeys } = loadRouteLaunch({
      apiKeys: { ...ALL_FALSE },
      authKeys: { anthropic: 'sk-ant-from-auth-json' },
    });
    const result = buildLaunchKeys();
    expect(result.anthropic).toBe(true);
    expect(result.openrouter).toBe(false);
    expect(result.google).toBe(false);
    expect(result.openai).toBe(false);
    expect(result.deepseek).toBe(false);
  });

  test('a provider present only via env/.env (readApiKeys) reads true', () => {
    const { buildLaunchKeys } = loadRouteLaunch({
      apiKeys: { ...ALL_FALSE, openai: true },
      authKeys: {},
    });
    const result = buildLaunchKeys();
    expect(result.openai).toBe(true);
    expect(result.openrouter).toBe(false);
    expect(result.google).toBe(false);
    expect(result.anthropic).toBe(false);
    expect(result.deepseek).toBe(false);
  });

  test('no key in either source yields all false', () => {
    const { buildLaunchKeys } = loadRouteLaunch({
      apiKeys: { ...ALL_FALSE },
      authKeys: {},
    });
    const result = buildLaunchKeys();
    expect(result).toEqual(ALL_FALSE);
  });

  test('a provider present in both sources still reads true (union, not exclusive)', () => {
    const { buildLaunchKeys } = loadRouteLaunch({
      apiKeys: { ...ALL_FALSE, google: true },
      authKeys: { google: 'gg-key-from-auth-json' },
    });
    const result = buildLaunchKeys();
    expect(result.google).toBe(true);
  });
});

describe('getRouteCatalogInfo', () => {
  function loadWithCatalog(catalogImpl) {
    jest.resetModules();
    jest.doMock('../src/utils/api-key-store', () => ({ readApiKeys: () => ({ ...ALL_FALSE }) }));
    jest.doMock('../src/utils/auth-json', () => ({ readAuthJsonKeys: () => ({}) }));
    jest.doMock('../src/utils/model-catalog', () => ({ getCatalogInfo: catalogImpl }));
    return require('../src/utils/route-launch');
  }

  afterEach(() => {
    jest.dontMock('../src/utils/model-catalog');
  });

  test('returns {models, lastRefreshError} thinned from getCatalogInfo', async () => {
    const models = [{ id: 'anthropic/claude-opus-4-8', name: 'Claude Opus 4.8' }];
    const { getRouteCatalogInfo } = loadWithCatalog(async () => ({
      models,
      fetchedAt: 12345,
      lastRefreshAttempt: null,
      lastRefreshError: null,
    }));
    const info = await getRouteCatalogInfo();
    expect(info).toEqual({ models, lastRefreshError: null });
  });

  test('surfaces a non-null lastRefreshError from the catalog', async () => {
    const { getRouteCatalogInfo } = loadWithCatalog(async () => ({
      models: [],
      fetchedAt: null,
      lastRefreshAttempt: Date.now(),
      lastRefreshError: 'network-error: all providers unreachable',
    }));
    const info = await getRouteCatalogInfo();
    expect(info).toEqual({ models: [], lastRefreshError: 'network-error: all providers unreachable' });
  });

  test('never throws: a rejecting catalog resolves to the catalog-unavailable fallback', async () => {
    const { getRouteCatalogInfo } = loadWithCatalog(async () => { throw new Error('boom'); });
    const info = await getRouteCatalogInfo();
    expect(info).toEqual({ models: [], lastRefreshError: 'catalog-unavailable' });
  });
});

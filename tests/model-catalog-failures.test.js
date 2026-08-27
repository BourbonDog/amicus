'use strict';
/**
 * Namespace-level fetch-failure reporting (issue #209).
 *
 * A provider whose fetch was REJECTED must be distinguishable from one that
 * was never attempted -- `classifyModel` needs that distinction to stop
 * licensing optimistic direct-form synthesis for a namespace that is empty
 * only because its fetch 401'd (issue #208).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('model-catalog: provider failure reporting', () => {
  let dir;
  beforeEach(() => {
    jest.resetModules();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-catfail-'));
    jest.doMock('../src/utils/config', () => ({ getConfigDir: () => dir }));
    jest.doMock('../src/utils/api-key-store', () => ({ readApiKeyValues: () => ({ openrouter: 'k', deepseek: 'sk-bad' }) }));
  });
  afterEach(() => { jest.dontMock('../src/utils/config'); fs.rmSync(dir, { recursive: true, force: true }); });

  function mockFetcher(rows, failures) {
    jest.doMock('../src/utils/model-fetcher', () => ({
      fetchAllModelsDetailed: jest.fn().mockResolvedValue({ rows, failures }),
    }));
  }

  test('getCatalogInfo exposes a provider whose fetch was rejected', async () => {
    mockFetcher(
      [{ id: 'openrouter/deepseek/deepseek-v4-pro', name: 'DS' }],
      [{ provider: 'deepseek', reason: 'http-status', status: 401 }]
    );
    const { getCatalogInfo } = require('../src/utils/model-catalog');
    const info = await getCatalogInfo();
    const ds = (info.providerFailures || []).find(f => f.provider === 'deepseek');
    expect(ds).toBeDefined();
    expect(ds.status).toBe(401);
  });

  test('a failure survives being served from cache (it describes the cached data)', async () => {
    mockFetcher(
      [{ id: 'openrouter/deepseek/deepseek-v4-pro', name: 'DS' }],
      [{ provider: 'deepseek', reason: 'http-status', status: 401 }]
    );
    const { getCatalogInfo } = require('../src/utils/model-catalog');
    await getCatalogInfo();               // cold fetch -> writes cache
    const info = await getCatalogInfo();  // served from fresh cache
    expect((info.providerFailures || []).some(f => f.provider === 'deepseek')).toBe(true);
  });

  test('reports no failures when every provider served', async () => {
    mockFetcher([{ id: 'openrouter/openai/gpt-5.6-terra', name: 'GPT' }], []);
    const { getCatalogInfo } = require('../src/utils/model-catalog');
    const info = await getCatalogInfo();
    expect(info.providerFailures).toEqual([]);
  });
});

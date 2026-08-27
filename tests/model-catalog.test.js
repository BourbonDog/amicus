'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('model-catalog', () => {
  let dir;
  beforeEach(() => {
    jest.resetModules();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-cat-'));
    jest.doMock('../src/utils/config', () => ({ getConfigDir: () => dir }));
    jest.doMock('../src/utils/api-key-store', () => ({ readApiKeyValues: () => ({ openrouter: 'k' }) }));
  });
  afterEach(() => { jest.dontMock('../src/utils/config'); fs.rmSync(dir, { recursive: true, force: true }); });

  test('fetches and writes the cache on a cold miss', async () => {
    jest.doMock('../src/utils/model-fetcher', () => ({
      fetchAllModelsDetailed: jest.fn().mockResolvedValue({ rows: [{ id: 'openrouter/openai/gpt-5.4', name: 'GPT-5.4' }], failures: [] }),
    }));
    const { getCatalog, catalogPath } = require('../src/utils/model-catalog');
    const models = await getCatalog();
    expect(models.some(m => m.id === 'openrouter/openai/gpt-5.4')).toBe(true);
    expect(fs.existsSync(catalogPath())).toBe(true);
  });

  test('serves fresh cache without re-fetching', async () => {
    const fetchAllModelsDetailed = jest.fn().mockResolvedValue({ rows: [{ id: 'openrouter/x', name: 'x' }], failures: [] });
    jest.doMock('../src/utils/model-fetcher', () => ({ fetchAllModelsDetailed }));
    const { getCatalog } = require('../src/utils/model-catalog');
    await getCatalog();
    await getCatalog();
    expect(fetchAllModelsDetailed).toHaveBeenCalledTimes(1);
  });

  test('falls back to stale cache when a refresh returns nothing', async () => {
    const { catalogPath } = require('../src/utils/model-catalog');
    fs.writeFileSync(catalogPath(),
      JSON.stringify({ fetchedAt: 0, models: [{ id: 'openrouter/stale', name: 'stale' }] }));
    jest.doMock('../src/utils/model-fetcher', () => ({ fetchAllModelsDetailed: jest.fn().mockResolvedValue({ rows: [], failures: [] }) }));
    const { getCatalog } = require('../src/utils/model-catalog');
    const models = await getCatalog({ maxAgeMs: -1 }); // force-expire → refresh → empty → stale
    expect(models.some(m => m.id === 'openrouter/stale')).toBe(true);
  });

  test('refetches when the cache file is corrupt JSON', async () => {
    const fetchAllModelsDetailed = jest.fn().mockResolvedValue({ rows: [{ id: 'openrouter/fresh', name: 'fresh' }], failures: [] });
    jest.doMock('../src/utils/model-fetcher', () => ({ fetchAllModelsDetailed }));
    const { getCatalog, catalogPath } = require('../src/utils/model-catalog');
    fs.writeFileSync(catalogPath(), 'not json at all');
    const models = await getCatalog();
    expect(fetchAllModelsDetailed).toHaveBeenCalledTimes(1);
    expect(models.some(m => m.id === 'openrouter/fresh')).toBe(true);
  });
});

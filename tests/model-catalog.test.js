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
      fetchAllModels: jest.fn().mockResolvedValue([{ id: 'openrouter/openai/gpt-5.4', name: 'GPT-5.4' }]),
    }));
    const { getCatalog, catalogPath } = require('../src/utils/model-catalog');
    const models = await getCatalog();
    expect(models.some(m => m.id === 'openrouter/openai/gpt-5.4')).toBe(true);
    expect(fs.existsSync(catalogPath())).toBe(true);
  });

  test('serves fresh cache without re-fetching', async () => {
    const fetchAllModels = jest.fn().mockResolvedValue([{ id: 'openrouter/x', name: 'x' }]);
    jest.doMock('../src/utils/model-fetcher', () => ({ fetchAllModels }));
    const { getCatalog } = require('../src/utils/model-catalog');
    await getCatalog();
    await getCatalog();
    expect(fetchAllModels).toHaveBeenCalledTimes(1);
  });

  test('falls back to stale cache when a refresh returns nothing', async () => {
    const { catalogPath } = require('../src/utils/model-catalog');
    fs.writeFileSync(catalogPath(),
      JSON.stringify({ fetchedAt: 0, models: [{ id: 'openrouter/stale', name: 'stale' }] }));
    jest.doMock('../src/utils/model-fetcher', () => ({ fetchAllModels: jest.fn().mockResolvedValue([]) }));
    const { getCatalog } = require('../src/utils/model-catalog');
    const models = await getCatalog({ maxAgeMs: -1 }); // force-expire → refresh → empty → stale
    expect(models.some(m => m.id === 'openrouter/stale')).toBe(true);
  });
});

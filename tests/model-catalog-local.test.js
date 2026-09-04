'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');

describe('refreshCatalog: localhost-only refresh never clobbers a good OR cache', () => {
  afterEach(() => jest.resetModules());

  /** Seed a fresh temp config dir with a good OpenRouter catalog file. */
  function seedGoodCache() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cat-'));
    const good = {
      schemaVersion: 2,
      fetchedAt: 1700000000000, // fixed, so we can prove it did not change
      models: [
        { id: 'openrouter/deepseek/deepseek-chat', name: 'DeepSeek Chat' },
        { id: 'openrouter/google/gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
      ],
    };
    fs.writeFileSync(path.join(dir, 'model-catalog.json'), JSON.stringify(good, null, 2), { mode: 0o600 });
    return { dir, good };
  }

  test('a localhost-only refresh returns [] AND leaves the good OR cache file byte-identical', async () => {
    jest.resetModules();
    const { dir, good } = seedGoodCache();
    const catalogFile = path.join(dir, 'model-catalog.json');
    // getConfigDir() is the only config export refreshCatalog touches.
    jest.doMock('../src/utils/config', () => ({ getConfigDir: () => dir }));
    jest.doMock('../src/utils/api-key-store', () => ({ readApiKeyValues: () => ({}) }));
    // #218 P3: refreshCatalog enriches ceilings from models.dev; keep the unit suite offline.
    jest.doMock('../src/utils/model-ceilings-modelsdev', () => ({
      enrichCeilings: jest.fn(async () => ({ source: 'models.dev', failure: null, filled: 0, alreadyKnown: 0, unknown: 0, skippedRouters: 0, skippedLocal: 0 })),
    }));
    // The network is offline except loopback: fetchAllModelsDetailed yields ONLY local rows.
    jest.doMock('../src/utils/model-fetcher', () => ({
      fetchAllModelsDetailed: jest.fn().mockResolvedValue({ rows: [
        { id: 'ollama/llama3.3', name: 'llama3.3', local: true },
        { id: 'lmstudio/qwen3-14b', name: 'qwen3-14b', local: true },
      ], failures: [] }),
    }));
    const catalog = require('../src/utils/model-catalog');

    const out = await catalog.refreshCatalog();
    expect(out).toEqual([]); // treated as a failed refresh → stale cache stands

    // THE trap: the good cache file's models + fetchedAt are unchanged.
    const after = JSON.parse(fs.readFileSync(catalogFile, 'utf-8'));
    expect(after.models).toEqual(good.models);   // OR rows survived — never clobbered
    expect(after.fetchedAt).toBe(good.fetchedAt); // not re-stamped by a "successful" write
    // writeRefreshFailure may add outcome fields, but must not remove the good data.
    expect(after.lastRefreshError).toMatch(/floor-only|no network rows/);
  });
});

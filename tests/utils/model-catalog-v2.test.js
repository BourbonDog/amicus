/** F5: cache schema v2 ({schemaVersion:2, fetchedAt, models[enriched]}); v1 reads as stale. */
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('model-catalog schema v2', () => {
  let tmpDir;
  const ROWS = [{ id: 'openrouter/x-ai/grok-4.3', name: 'Grok 4.3', contextLength: 256000,
    pricing: { prompt: '0.000003', completion: '0.000015' } }];

  beforeEach(() => {
    jest.resetModules();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-cat-'));
    process.env.AMICUS_CONFIG_DIR = tmpDir;
  });
  afterEach(() => {
    delete process.env.AMICUS_CONFIG_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function mockFetch(rows) {
    jest.doMock('../../src/utils/model-fetcher', () => ({ fetchAllModels: jest.fn(async () => rows) }));
    jest.doMock('../../src/utils/api-key-store', () => ({ readApiKeyValues: () => ({}) }));
  }

  it('refreshCatalog writes a v2 cache with enriched rows', async () => {
    mockFetch(ROWS);
    const { refreshCatalog, catalogPath } = require('../../src/utils/model-catalog');
    await refreshCatalog();
    const cache = JSON.parse(fs.readFileSync(catalogPath(), 'utf-8'));
    expect(cache.schemaVersion).toBe(2);
    expect(cache.models).toEqual(ROWS);
    expect(typeof cache.fetchedAt).toBe('number');
  });

  it('a v1 cache (no schemaVersion) reads as stale and is refreshed to v2', async () => {
    mockFetch(ROWS);
    const { getCatalog, catalogPath } = require('../../src/utils/model-catalog');
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(catalogPath(), JSON.stringify({
      fetchedAt: Date.now(), models: [{ id: 'openrouter/old', name: 'old' }]
    }));
    const models = await getCatalog();
    expect(models).toEqual(ROWS); // refreshed, not the v1 content
    const cache = JSON.parse(fs.readFileSync(catalogPath(), 'utf-8'));
    expect(cache.schemaVersion).toBe(2);
  });

  it('a fresh v2 cache is served without refetching', async () => {
    mockFetch([{ id: 'openrouter/should-not-appear', name: 'x', contextLength: null, pricing: null }]);
    const { getCatalog, catalogPath } = require('../../src/utils/model-catalog');
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(catalogPath(), JSON.stringify({ schemaVersion: 2, fetchedAt: Date.now(), models: ROWS }));
    expect(await getCatalog()).toEqual(ROWS);
    expect(require('../../src/utils/model-fetcher').fetchAllModels).not.toHaveBeenCalled();
  });

  it('v1 cache still serves as stale fallback when the refresh comes back empty', async () => {
    mockFetch([]);
    const { getCatalog, catalogPath } = require('../../src/utils/model-catalog');
    fs.mkdirSync(tmpDir, { recursive: true });
    const v1rows = [{ id: 'openrouter/old', name: 'old' }];
    fs.writeFileSync(catalogPath(), JSON.stringify({ fetchedAt: Date.now(), models: v1rows }));
    expect(await getCatalog()).toEqual(v1rows); // offline: stale v1 beats nothing
  });

  it('getCatalogInfo returns rows plus fetchedAt', async () => {
    mockFetch(ROWS);
    const { getCatalogInfo } = require('../../src/utils/model-catalog');
    const info = await getCatalogInfo();
    expect(info.models).toEqual(ROWS);
    expect(typeof info.fetchedAt).toBe('number');
  });

  it('writeCache is atomic: no .tmp file remains after refresh', async () => {
    mockFetch(ROWS);
    const { refreshCatalog, catalogPath } = require('../../src/utils/model-catalog');
    await refreshCatalog();
    expect(fs.readdirSync(tmpDir).filter(f => f.includes('.tmp'))).toEqual([]);
    expect(fs.existsSync(catalogPath())).toBe(true);
    expect(JSON.parse(fs.readFileSync(catalogPath(), 'utf-8')).models).toEqual(ROWS);
  });

  it('floor-only refresh (offline) does not clobber an existing cache', async () => {
    const FLOOR = [
      { id: 'anthropic/claude-opus-4-6', name: 'Opus', contextLength: null, pricing: null },
      { id: 'anthropic/claude-sonnet-4-6', name: 'Sonnet', contextLength: null, pricing: null },
    ];
    mockFetch(FLOOR);
    const { refreshCatalog, getCatalog, catalogPath } = require('../../src/utils/model-catalog');
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(catalogPath(), JSON.stringify({ schemaVersion: 2, fetchedAt: Date.now() - 1000, models: ROWS }));
    const refreshed = await refreshCatalog();
    expect(refreshed).toEqual([]); // floor-only = failed refresh per contract
    expect(await getCatalog()).toEqual(ROWS); // good cache stands
  });

  it('floor-only refresh on a fresh machine writes nothing to models/fetchedAt (no prior cache)', async () => {
    mockFetch([{ id: 'anthropic/claude-opus-4-6', name: 'Opus', contextLength: null, pricing: null }]);
    const { refreshCatalog, catalogPath } = require('../../src/utils/model-catalog');
    expect(await refreshCatalog()).toEqual([]);
    // #13: the failure branch now records attempt/error metadata even with
    // no prior cache, so the file exists — but it carries no models/fetchedAt.
    expect(fs.existsSync(catalogPath())).toBe(true);
    const cache = JSON.parse(fs.readFileSync(catalogPath(), 'utf-8'));
    expect(cache.models).toBeUndefined();
    expect(cache.fetchedAt).toBeUndefined();
    expect(typeof cache.lastRefreshAttempt).toBe('number');
    expect(typeof cache.lastRefreshError).toBe('string');
  });

  // #13: refresh-outcome metadata (stale-catalog memo groundwork).
  describe('refresh-outcome metadata (#13)', () => {
    it('a failed refresh (floor-only) records lastRefreshAttempt/lastRefreshError WITHOUT touching models/fetchedAt', async () => {
      const FLOOR = [
        { id: 'anthropic/claude-opus-4-6', name: 'Opus', contextLength: null, pricing: null },
      ];
      mockFetch(FLOOR);
      const { refreshCatalog, catalogPath } = require('../../src/utils/model-catalog');
      fs.mkdirSync(tmpDir, { recursive: true });
      const goodFetchedAt = Date.now() - 1000;
      fs.writeFileSync(catalogPath(), JSON.stringify({ schemaVersion: 2, fetchedAt: goodFetchedAt, models: ROWS }));
      const before = Date.now();
      await refreshCatalog();
      const cache = JSON.parse(fs.readFileSync(catalogPath(), 'utf-8'));
      expect(cache.models).toEqual(ROWS); // untouched
      expect(cache.fetchedAt).toBe(goodFetchedAt); // untouched
      expect(cache.lastRefreshAttempt).toBeGreaterThanOrEqual(before);
      expect(typeof cache.lastRefreshError).toBe('string');
      expect(cache.lastRefreshError.length).toBeGreaterThan(0);
    });

    it('a network failure (no rows at all) records a distinct error class from floor-only', async () => {
      mockFetch([]);
      const { refreshCatalog, catalogPath } = require('../../src/utils/model-catalog');
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(catalogPath(), JSON.stringify({ schemaVersion: 2, fetchedAt: Date.now(), models: ROWS }));
      await refreshCatalog();
      const cache = JSON.parse(fs.readFileSync(catalogPath(), 'utf-8'));
      expect(cache.lastRefreshError).not.toEqual(expect.stringContaining('floor'));
    });

    it('floor-only failure error class mentions the floor/anthropic-only condition', async () => {
      const FLOOR = [{ id: 'anthropic/claude-opus-4-6', name: 'Opus', contextLength: null, pricing: null }];
      mockFetch(FLOOR);
      const { refreshCatalog, catalogPath } = require('../../src/utils/model-catalog');
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(catalogPath(), JSON.stringify({ schemaVersion: 2, fetchedAt: Date.now(), models: ROWS }));
      await refreshCatalog();
      const cache = JSON.parse(fs.readFileSync(catalogPath(), 'utf-8'));
      expect(cache.lastRefreshError.toLowerCase()).toMatch(/floor|network/);
    });

    it('a successful refresh clears lastRefreshAttempt/lastRefreshError from a prior failure', async () => {
      const { catalogPath } = require('../../src/utils/model-catalog');
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(catalogPath(), JSON.stringify({
        schemaVersion: 2, fetchedAt: Date.now() - 5000, models: ROWS,
        lastRefreshAttempt: Date.now() - 1000, lastRefreshError: 'network-error: all providers unreachable',
      }));
      mockFetch(ROWS);
      const { refreshCatalog } = require('../../src/utils/model-catalog');
      await refreshCatalog();
      const cache = JSON.parse(fs.readFileSync(catalogPath(), 'utf-8'));
      expect(cache.lastRefreshAttempt).toBeUndefined();
      expect(cache.lastRefreshError).toBeUndefined();
    });

    it('getCatalogInfo threads lastRefreshAttempt/lastRefreshError from the cache doc', async () => {
      const { catalogPath } = require('../../src/utils/model-catalog');
      fs.mkdirSync(tmpDir, { recursive: true });
      const attempt = Date.now() - 500;
      fs.writeFileSync(catalogPath(), JSON.stringify({
        schemaVersion: 2, fetchedAt: Date.now() - 5000, models: ROWS,
        lastRefreshAttempt: attempt, lastRefreshError: 'network-error: all providers unreachable',
      }));
      mockFetch([]); // getCatalog would refresh if stale; keep it fresh instead
      const { getCatalogInfo } = require('../../src/utils/model-catalog');
      const info = await getCatalogInfo({ maxAgeMs: 24 * 60 * 60 * 1000 });
      expect(info.models).toEqual(ROWS);
      expect(info.lastRefreshAttempt).toBe(attempt);
      expect(info.lastRefreshError).toBe('network-error: all providers unreachable');
    });

    it('getCatalogInfo returns null attempt/error when there has been no failure', async () => {
      mockFetch(ROWS);
      const { getCatalogInfo } = require('../../src/utils/model-catalog');
      const info = await getCatalogInfo();
      expect(info.lastRefreshAttempt).toBeNull();
      expect(info.lastRefreshError).toBeNull();
    });

    it('getCatalogInfo surfaces attempt/error even on a fresh machine with no prior cache (models-less doc)', async () => {
      mockFetch([]); // total network failure, no cache to fall back to
      const { getCatalogInfo } = require('../../src/utils/model-catalog');
      const info = await getCatalogInfo();
      expect(info.models).toEqual([]);
      expect(info.fetchedAt).toBeNull();
      expect(typeof info.lastRefreshAttempt).toBe('number');
      expect(info.lastRefreshError).toBe('network-error: all providers unreachable');
    });
  });
});

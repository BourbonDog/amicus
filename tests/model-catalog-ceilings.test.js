'use strict';
/**
 * #218 P3 — refreshCatalog fills direct-provider ceilings from models.dev.
 *
 * Contract: enrichment runs ONLY on a refresh that passed the floor-only check
 * (a failed refresh is never enriched — "stale cache stands"), on the very row
 * objects that get written, and its outcome is persisted beside the rows and
 * exposed by getCatalogInfo. A failing or throwing enrichment never fails the
 * refresh.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('model-catalog: ceiling enrichment (#218 P3)', () => {
  let dir;
  beforeEach(() => {
    jest.resetModules();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-catceil-'));
    jest.doMock('../src/utils/config', () => ({ getConfigDir: () => dir }));
    jest.doMock('../src/utils/api-key-store', () => ({ readApiKeyValues: () => ({ openrouter: 'k' }) }));
  });
  afterEach(() => { jest.dontMock('../src/utils/config'); fs.rmSync(dir, { recursive: true, force: true }); });

  const OK = { source: 'models.dev', failure: null, filled: 1, alreadyKnown: 2, unknown: 3, skippedRouters: 0, skippedLocal: 0 };

  function mockFetcher(rows) {
    jest.doMock('../src/utils/model-fetcher', () => ({
      fetchAllModelsDetailed: jest.fn().mockResolvedValue({ rows, failures: [] }),
    }));
  }
  function mockEnrich(impl) {
    const enrichCeilings = jest.fn(impl);
    // emptyOutcome comes from the REAL module: refreshCatalog's belt-and-braces
    // catch calls it, and the point of the shared helper is that both sites
    // produce one shape (council #230 C4/D5).
    const { emptyOutcome } = jest.requireActual('../src/utils/model-ceilings-modelsdev');
    jest.doMock('../src/utils/model-ceilings-modelsdev', () => ({ enrichCeilings, emptyOutcome }));
    return enrichCeilings;
  }

  test('enriches the fetched rows in place and persists the outcome', async () => {
    const rows = [{ id: 'openrouter/x', name: 'x' }, { id: 'anthropic/claude-opus-5', name: 'Opus', contextLength: null }];
    mockFetcher(rows);
    const enrich = mockEnrich(async (r) => { r[1].contextLength = 1000000; r[1].maxOutputTokens = 128000; return OK; });
    const { refreshCatalog, getCatalogInfo, readCache } = require('../src/utils/model-catalog');
    const models = await refreshCatalog();
    expect(enrich).toHaveBeenCalledTimes(1);
    expect(enrich.mock.calls[0][0]).toBe(rows);              // same array, not a copy
    expect(models.find(m => m.id === 'anthropic/claude-opus-5')).toMatchObject({ contextLength: 1000000, maxOutputTokens: 128000 });
    expect(readCache().models.find(m => m.id === 'anthropic/claude-opus-5').maxOutputTokens).toBe(128000);
    expect(readCache().ceilingEnrichment).toEqual(OK);
    expect((await getCatalogInfo()).ceilingEnrichment).toEqual(OK);
  });

  test('a floor-only (failed) refresh is never enriched', async () => {
    mockFetcher([{ id: 'anthropic/claude-opus-5', name: 'Opus', authoritative: false }]);
    const enrich = mockEnrich(async () => OK);
    const { refreshCatalog, getCatalogInfo } = require('../src/utils/model-catalog');
    expect(await refreshCatalog()).toEqual([]);
    expect(enrich).not.toHaveBeenCalled();
    expect((await getCatalogInfo({ maxAgeMs: Number.POSITIVE_INFINITY })).ceilingEnrichment).toBeNull();
  });

  test('an unreachable models.dev is recorded and the refresh still succeeds', async () => {
    mockFetcher([{ id: 'openrouter/x', name: 'x' }]);
    const FAIL = { ...OK, filled: 0, alreadyKnown: 0, unknown: 0, failure: { reason: 'timeout', detail: 'no response within 10000ms' } };
    mockEnrich(async () => FAIL);
    const { refreshCatalog, readCache } = require('../src/utils/model-catalog');
    expect((await refreshCatalog()).length).toBe(1);
    expect(readCache().ceilingEnrichment).toEqual(FAIL);
  });

  test('a throwing enrichment is caught, recorded as an exception, and the rows are still written', async () => {
    mockFetcher([{ id: 'openrouter/x', name: 'x' }]);
    mockEnrich(async () => { throw new Error('kaboom'); });
    const { refreshCatalog, readCache } = require('../src/utils/model-catalog');
    expect((await refreshCatalog()).length).toBe(1);
    expect(readCache().ceilingEnrichment).toEqual({
      source: 'models.dev', failure: { reason: 'exception', detail: 'kaboom' },
      filled: 0, alreadyKnown: 0, unknown: 0, skippedRouters: 0, skippedLocal: 0,
    });
  });

  test('getCatalogInfo reports null when the cache predates the field', async () => {
    const { catalogPath, getCatalogInfo, CATALOG_SCHEMA_VERSION } = require('../src/utils/model-catalog');
    fs.writeFileSync(catalogPath(), JSON.stringify({ schemaVersion: CATALOG_SCHEMA_VERSION, fetchedAt: Date.now(), models: [{ id: 'openrouter/old', name: 'old' }] }));
    expect((await getCatalogInfo()).ceilingEnrichment).toBeNull();
  });
});

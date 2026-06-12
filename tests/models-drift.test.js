// tests/models-drift.test.js
'use strict';

const { buildFallbackDriftReport } = require('../src/sidecar/models');

const row = id => ({ id });

describe('buildFallbackDriftReport', () => {
  test('reports families whose pinned openrouter fallback is behind the live pick', () => {
    const catalog = [row('openrouter/google/gemini-9.9-flash')];
    const lines = buildFallbackDriftReport(catalog);
    expect(lines.some(l => l.includes('gemini') && l.includes('openrouter/google/gemini-9.9-flash'))).toBe(true);
  });
  test('silent when fallbacks match the live resolution or catalog is empty', () => {
    expect(buildFallbackDriftReport([])).toEqual([]);
    const { getFamilies } = require('../src/utils/curated-models');
    const current = getFamilies().map(f => row(f.fallback.openrouter));
    expect(buildFallbackDriftReport(current)).toEqual([]);
  });
});

describe('runCheck drift wiring', () => {
  // runCheck emits all output through process.stdout.write (never console.log).
  // We mock the three external dependencies so the test is hermetic:
  //   - getCatalogInfo returns a minimal catalog with a newer gemini id than
  //     the pinned fallback, which causes buildFallbackDriftReport to produce
  //     a drift line.
  //   - collectAliasSources / findStaleAliases return zero stale aliases so we
  //     exercise the "all clean + drift header" branch, not the stale branch.
  beforeEach(() => {
    jest.resetModules();

    // Catalog contains a newer gemini flash than the pinned fallback
    // (openrouter/google/gemini-3.5-flash in curated-models.js), guaranteeing
    // buildFallbackDriftReport produces at least one drift line.
    jest.mock('../src/utils/model-catalog', () => ({
      getCatalogInfo: async () => ({
        models: [{ id: 'openrouter/google/gemini-9.9-flash' }],
        fetchedAt: Date.now(),
      }),
      refreshCatalog: async () => [],
      catalogPath: () => '/mock/path/model-catalog.json',
    }));

    // Zero stale aliases → runCheck reaches the "all clean" + drift branch.
    jest.mock('../src/utils/alias-audit', () => ({
      collectAliasSources: () => [],
      findStaleAliases: () => [],
      suggestReplacements: () => [],
    }));
  });

  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test('console path prints the drift header; --json path does not', async () => {
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    // Re-require after mocks are in place so the mocked modules are used.
    const { handleModels } = require('../src/sidecar/models');

    // --- console (default) path ---
    await handleModels({ _: ['models'], check: true });
    const consoleOutput = writeSpy.mock.calls.map(c => c[0]).join('');
    expect(consoleOutput).toContain('Pinned fallback drift:');

    writeSpy.mockClear();

    // --- --json path ---
    await handleModels({ _: ['models'], check: true, json: true });
    const jsonOutput = writeSpy.mock.calls.map(c => c[0]).join('');
    expect(jsonOutput).not.toContain('Pinned fallback drift:');

    writeSpy.mockRestore();
  });
});

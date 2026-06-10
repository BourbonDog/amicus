/** F5: setup seeds the catalog; --add-alias warns (never blocks) on unknown models. */

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

describe('seedCatalog', () => {
  it('refreshes and reports the count', async () => {
    jest.resetModules();
    const refresh = jest.fn(async () => [{ id: 'openrouter/a/b', name: 'B' }]);
    jest.doMock('../../src/utils/model-catalog', () => ({ refreshCatalog: refresh }));
    const { seedCatalog } = require('../../src/sidecar/setup');
    const lines = [];
    await seedCatalog((s) => lines.push(s));
    expect(refresh).toHaveBeenCalled();
    expect(lines[0]).toBe('Refreshing model catalog...');
    expect(lines.join('\n')).toContain('Model catalog seeded (1 models)');
  });

  it('reports offline gracefully and never throws', async () => {
    jest.resetModules();
    jest.doMock('../../src/utils/model-catalog', () => ({
      refreshCatalog: jest.fn(async () => { throw new Error('net down'); })
    }));
    const { seedCatalog } = require('../../src/sidecar/setup');
    const lines = [];
    await expect(seedCatalog((s) => lines.push(s))).resolves.toBeUndefined();
    expect(lines.join('\n')).toContain('Model catalog unavailable');
  });

  it('reports unavailable when the refresh returns empty (floor-only/offline)', async () => {
    jest.resetModules();
    jest.doMock('../../src/utils/model-catalog', () => ({
      refreshCatalog: jest.fn(async () => [])
    }));
    const { seedCatalog } = require('../../src/sidecar/setup');
    const lines = [];
    await seedCatalog((s) => lines.push(s));
    expect(lines.join('\n')).toContain('Model catalog unavailable');
  });
});

describe('--add-alias catalog warning', () => {
  function runAddAlias({ catalog }) {
    jest.resetModules();
    jest.doMock('../../src/sidecar/setup', () => ({
      addAlias: jest.fn(), runInteractiveSetup: jest.fn(), runApiKeySetup: jest.fn(),
    }));
    jest.doMock('../../src/utils/model-catalog', () => ({
      getCatalog: jest.fn(async () => catalog),
    }));
    jest.doMock('../../src/utils/alias-audit', () => ({
      findStaleAliases: jest.fn((sources, catalog) =>
        catalog.length > 0 && catalog.some(m => m.id.startsWith(sources[0].model.split('/')[0] + '/')) &&
        !catalog.some(m => m.id === sources[0].model) ? sources : []),
      suggestReplacements: jest.fn(() => ['openrouter/x-ai/grok-4.3']),
    }));
    const { handleSetup } = require('../../src/cli-handlers');
    const warnings = [];
    const logs = [];
    const origWarn = console.warn;
    const origLog = console.log;
    console.warn = (s) => warnings.push(String(s));
    console.log = (s) => logs.push(String(s));
    return handleSetup({ 'add-alias': 'grok=openrouter/x-ai/grok-9.9' })
      .finally(() => { console.warn = origWarn; console.log = origLog; })
      .then(() => warnings.join('\n'));
  }

  it('warns when the model is absent from a populated openrouter catalog', async () => {
    const out = await runAddAlias({ catalog: [{ id: 'openrouter/x-ai/grok-4.3', name: 'G' }] });
    expect(out).toContain('not found in the model catalog');
    expect(out).toContain('Did you mean: openrouter/x-ai/grok-4.3');
    expect(out).toContain('amicus models --search');
  });

  it('stays silent when the catalog is empty (cannot check)', async () => {
    const out = await runAddAlias({ catalog: [] });
    expect(out).toBe('');
  });
});

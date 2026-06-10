/** F5: amicus models — list/search/refresh/check with --json and exit codes. */

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

const CATALOG = [
  { id: 'openrouter/x-ai/grok-4.3', name: 'Grok 4.3', contextLength: 256000,
    pricing: { prompt: '0.000003', completion: '0.000015' } },
  { id: 'openrouter/google/gemini-3.1-flash-lite-preview', name: 'Gemini Flash Lite',
    contextLength: 1048576, pricing: null },
];

function loadHandler({ catalog = CATALOG, sources, stale } = {}) {
  jest.resetModules();
  jest.doMock('../../src/utils/model-catalog', () => ({
    getCatalogInfo: jest.fn(async () => ({ models: catalog, fetchedAt: 1718000000000 })),
    refreshCatalog: jest.fn(async () => catalog),
    catalogPath: () => 'C:/fake/model-catalog.json',
  }));
  if (sources || stale) {
    jest.doMock('../../src/utils/alias-audit', () => ({
      collectAliasSources: () => sources || [],
      findStaleAliases: () => stale || [],
      suggestReplacements: () => ['openrouter/x-ai/grok-4.3'],
    }));
  }
  return require('../../src/sidecar/models');
}

function captureStdout(fn) {
  const writes = [];
  const orig = process.stdout.write;
  process.stdout.write = (s) => { writes.push(String(s)); return true; };
  return Promise.resolve(fn()).finally(() => { process.stdout.write = orig; })
    .then(code => ({ code, out: writes.join('') }));
}

describe('amicus models', () => {
  it('default lists the catalog with context and pricing columns', async () => {
    const { handleModels } = loadHandler();
    const { code, out } = await captureStdout(() => handleModels({ _: ['models'] }));
    expect(code).toBe(0);
    expect(out).toContain('openrouter/x-ai/grok-4.3');
    expect(out).toContain('256000');
    expect(out).toContain('3.00');
    expect(out).toContain('(2 models');
  });

  it('--search filters by substring over id+name', async () => {
    const { handleModels } = loadHandler();
    const { code, out } = await captureStdout(() => handleModels({ _: ['models'], search: 'grok' }));
    expect(code).toBe(0);
    expect(out).toContain('grok-4.3');
    expect(out).not.toContain('gemini-3.1');
  });

  it('--json list emits a parseable model-catalog document', async () => {
    const { handleModels } = loadHandler();
    const { code, out } = await captureStdout(() => handleModels({ _: ['models'], json: true }));
    expect(code).toBe(0);
    const doc = JSON.parse(out);
    expect(doc.schemaVersion).toBe(1);
    expect(doc.type).toBe('model-catalog');
    expect(doc.count).toBe(2);
    expect(doc.models[0].id).toBe('openrouter/x-ai/grok-4.3');
  });

  it('--refresh refreshes and reports the count', async () => {
    const { handleModels } = loadHandler();
    const { code, out } = await captureStdout(() => handleModels({ _: ['models'], refresh: true }));
    expect(code).toBe(0);
    expect(out).toContain('Refreshed catalog: 2 models');
  });

  it('--check clean → exit 0', async () => {
    const { handleModels } = loadHandler({ sources: [], stale: [] });
    const { code, out } = await captureStdout(() => handleModels({ _: ['models'], check: true }));
    expect(code).toBe(0);
    expect(out).toContain('All aliases resolve');
  });

  it('--check stale → exit = stale count, prints suggestions + paste-ready fix', async () => {
    const stale = [{ alias: 'grok', model: 'openrouter/x-ai/grok-4.1-fast', source: 'defaults' }];
    const { handleModels } = loadHandler({ sources: stale, stale });
    const { code, out } = await captureStdout(() => handleModels({ _: ['models'], check: true }));
    expect(code).toBe(1);
    expect(out).toContain('STALE: grok -> openrouter/x-ai/grok-4.1-fast (defaults)');
    expect(out).toContain('openrouter/x-ai/grok-4.3');
    expect(out).toContain('amicus setup --add-alias grok=openrouter/x-ai/grok-4.3');
  });

  it('--check --json emits an alias-audit document', async () => {
    const stale = [{ alias: 'grok', model: 'openrouter/x-ai/grok-4.1-fast', source: 'defaults' }];
    const { handleModels } = loadHandler({ sources: stale, stale });
    const { code, out } = await captureStdout(() => handleModels({ _: ['models'], check: true, json: true }));
    expect(code).toBe(1);
    const doc = JSON.parse(out);
    expect(doc.type).toBe('alias-audit');
    expect(doc.staleCount).toBe(1);
    expect(doc.stale[0]).toEqual({
      alias: 'grok', model: 'openrouter/x-ai/grok-4.1-fast', source: 'defaults',
      suggestions: ['openrouter/x-ai/grok-4.3']
    });
  });

  it('--check with empty catalog → cannot check, exit 0', async () => {
    const { handleModels } = loadHandler({ catalog: [] });
    const { code, out } = await captureStdout(() => handleModels({ _: ['models'], check: true }));
    expect(code).toBe(0);
    expect(out).toContain('Catalog unavailable');
  });

  it('exit code caps at 100', async () => {
    const stale = Array.from({ length: 150 }, (_, i) =>
      ({ alias: `a${i}`, model: `openrouter/v/m${i}`, source: 'defaults' }));
    const { handleModels } = loadHandler({ sources: stale, stale });
    const { code } = await captureStdout(() => handleModels({ _: ['models'], check: true }));
    expect(code).toBe(100);
  });

  it('bin routes the models command and lifecycle counts it one-shot', () => {
    const fs = require('fs');
    const path = require('path');
    const binSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'bin', 'amicus.js'), 'utf-8');
    expect(binSrc).toMatch(/case 'models':/);
    const { isOneShotCommand } = require('../../src/utils/lifecycle');
    expect(isOneShotCommand('models')).toBe(true);
  });

  it('usage text documents the models command', () => {
    const { getUsage } = require('../../src/cli');
    const usage = getUsage();
    expect(usage).toContain('models');
    expect(usage).toContain('--refresh');
    expect(usage).toContain('--check');
  });
});

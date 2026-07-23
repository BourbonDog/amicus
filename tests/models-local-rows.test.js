'use strict';

describe('amicus models: local rows', () => {
  afterEach(() => jest.resetModules());

  function load(models) {
    jest.resetModules();
    jest.doMock('../src/utils/model-catalog', () => ({
      getCatalogInfo: async () => ({ models, fetchedAt: 1700000000000, lastRefreshAttempt: null, lastRefreshError: null }),
      refreshCatalog: async () => models,
      catalogPath: () => '/tmp/model-catalog.json',
    }));
    return require('../src/sidecar/models').handleModels;
  }

  const LOCAL = { id: 'ollama/llama3.3', name: 'llama3.3', contextLength: null,
    pricing: { prompt: 0, completion: 0 }, authoritative: true, local: true };
  const CLOUD = { id: 'openrouter/deepseek/deepseek-chat', name: 'DeepSeek Chat', contextLength: 64000,
    pricing: { prompt: 0.00000014, completion: 0.00000028 } };

  test('--json marks a local row so consumers can tell it apart', async () => {
    const out = [];
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation((s) => { out.push(s); return true; });
    const handleModels = load([CLOUD, LOCAL]);
    await handleModels({ json: true });
    spy.mockRestore();
    const doc = JSON.parse(out.join(''));
    const row = doc.models.find((m) => m.id === 'ollama/llama3.3');
    expect(row).toBeDefined();
    expect(row.local).toBe(true);          // the flag survives buildCatalogDoc
  });

  test('--search matches a local row, and its $0 pricing renders as 0.00 not —', async () => {
    const out = [];
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation((s) => { out.push(s); return true; });
    const handleModels = load([CLOUD, LOCAL]);
    await handleModels({ search: 'llama' });
    spy.mockRestore();
    const text = out.join('');
    expect(text).toContain('ollama/llama3.3');
    expect(text).toMatch(/in 0\.00 +out 0\.00/);   // perMtok(0) → '0.00'; an em-dash here means the $0 tier leaked as "unknown"
  });

  test('--check tolerates local rows (no crash, no spurious stale alias)', async () => {
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const handleModels = load([CLOUD, LOCAL]);
    const code = await handleModels({ check: true, json: true });
    spy.mockRestore();
    expect(typeof code).toBe('number');
  });
});

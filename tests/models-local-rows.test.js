'use strict';

describe('amicus models: local rows', () => {
  afterEach(() => jest.resetModules());

  function load(models, { aliasSources } = {}) {
    jest.resetModules();
    jest.doMock('../src/utils/model-catalog', () => ({
      getCatalogInfo: async () => ({ models, fetchedAt: 1700000000000, lastRefreshAttempt: null, lastRefreshError: null }),
      refreshCatalog: async () => models,
      catalogPath: () => '/tmp/model-catalog.json',
    }));
    // Only the --check test below needs a controlled alias fixture; leave
    // alias-audit real (and thus dependent on nothing but its own pure
    // functions) for the --json/--search tests, which never call it.
    if (aliasSources) {
      jest.doMock('../src/utils/alias-audit', () => ({
        ...jest.requireActual('../src/utils/alias-audit'),
        collectAliasSources: () => aliasSources,
      }));
    }
    return require('../src/sidecar/models').handleModels;
  }

  const LOCAL = { id: 'ollama/llama3.3', name: 'llama3.3', contextLength: null,
    pricing: { prompt: 0, completion: 0 }, authoritative: true, local: true };
  const CLOUD = { id: 'openrouter/deepseek/deepseek-chat', name: 'DeepSeek Chat', contextLength: 64000,
    pricing: { prompt: 0.00000014, completion: 0.00000028 } };

  // Fixture for the --check test: both aliases route into the SAME provider
  // namespace ('ollama') the local row lives in. A defect that made local
  // rows invisible to the alias audit (e.g. dropped before the
  // group-by-provider step) would flip BOTH assertions below together --
  // 'llama-alias' would wrongly go stale, and 'ghost-alias' would wrongly
  // vanish as "provider unverifiable" instead of being reported stale.
  const LOCAL_ALIAS_FIXTURE = [
    { alias: 'llama-alias', model: 'ollama/llama3.3', source: 'user-config' },
    { alias: 'ghost-alias', model: 'ollama/mistral-not-installed', source: 'user-config' },
  ];

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
    const out = [];
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation((s) => { out.push(s); return true; });
    const handleModels = load([CLOUD, LOCAL], { aliasSources: LOCAL_ALIAS_FIXTURE });
    const code = await handleModels({ check: true, json: true });
    spy.mockRestore();
    const doc = JSON.parse(out.join(''));
    const staleModels = doc.stale.map((s) => s.model);
    // The name's actual claim: an alias pointing at a local row that IS in
    // the catalog must never be reported stale.
    expect(staleModels).not.toContain('ollama/llama3.3');
    // Same provider, genuinely-absent model -- still caught, which proves
    // the assertion above passes because the row is recognized as live,
    // not because the whole 'ollama' namespace went silently unverifiable.
    expect(staleModels).toContain('ollama/mistral-not-installed');
    expect(doc.staleCount).toBe(1);
    expect(code).toBe(1);
  });
});

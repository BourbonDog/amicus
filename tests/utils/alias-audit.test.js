/** F5: stale-alias audit across defaults + user config + curated routes, with suggestions. */
const {
  collectAliasSources, findStaleAliases, suggestReplacements
} = require('../../src/utils/alias-audit');

const CATALOG = [
  { id: 'openrouter/x-ai/grok-4.3', name: 'Grok 4.3' },
  { id: 'openrouter/x-ai/grok-4', name: 'Grok 4' },
  { id: 'openrouter/x-ai/grok-3-mini', name: 'Grok 3 Mini' },
  { id: 'openrouter/google/gemini-3.1-flash-lite-preview', name: 'Gemini Flash Lite' },
  { id: 'google/gemini-3.1-flash-lite-preview', name: 'Gemini direct' },
];

describe('findStaleAliases', () => {
  it('flags openrouter routes absent from the catalog', () => {
    const sources = [
      { alias: 'grok', model: 'openrouter/x-ai/grok-4.1-fast', source: 'defaults' },
      { alias: 'gemini', model: 'openrouter/google/gemini-3.1-flash-lite-preview', source: 'defaults' },
    ];
    const stale = findStaleAliases(sources, CATALOG);
    expect(stale).toEqual([
      { alias: 'grok', model: 'openrouter/x-ai/grok-4.1-fast', source: 'defaults' }
    ]);
  });

  it('checks direct-provider routes only when that provider has rows (no false stales)', () => {
    const sources = [
      { alias: 'gemini', model: 'google/gemini-old-model', source: 'curated' },
      { alias: 'gpt', model: 'openai/gpt-5.4', source: 'curated' },
    ];
    const stale = findStaleAliases(sources, CATALOG);
    expect(stale.map(s => s.alias)).toEqual(['gemini']);
  });

  it('returns [] when the catalog is empty (cannot check)', () => {
    expect(findStaleAliases([{ alias: 'x', model: 'openrouter/a/b', source: 'defaults' }], [])).toEqual([]);
  });
});

describe('suggestReplacements', () => {
  it('suggests same-vendor candidates, newest-looking first, max 3', () => {
    const s = suggestReplacements('openrouter/x-ai/grok-4.1-fast', CATALOG);
    expect(s).toEqual(['openrouter/x-ai/grok-4.3', 'openrouter/x-ai/grok-4', 'openrouter/x-ai/grok-3-mini']);
  });

  it('is deterministic and returns [] when no same-vendor rows exist', () => {
    expect(suggestReplacements('openrouter/unknown-vendor/m1', CATALOG)).toEqual([]);
  });
});

describe('collectAliasSources', () => {
  it('includes defaults, user config aliases, and curated routes with source tags', () => {
    jest.resetModules();
    jest.doMock('../../src/utils/config', () => ({
      getDefaultAliases: () => ({ grok: 'openrouter/x-ai/grok-4.3' }),
      loadConfig: () => ({ aliases: { mine: 'openrouter/foo/bar' } }),
    }));
    jest.doMock('../../src/utils/curated-models', () => ({
      listCuratedRoutes: () => [{ alias: 'gemini', provider: 'google', model: 'google/g-1' }],
    }));
    const { collectAliasSources: collect } = require('../../src/utils/alias-audit');
    expect(collect()).toEqual([
      { alias: 'grok', model: 'openrouter/x-ai/grok-4.3', source: 'defaults' },
      { alias: 'mine', model: 'openrouter/foo/bar', source: 'user-config' },
      { alias: 'gemini', model: 'google/g-1', source: 'curated-route (google)' },
    ]);
  });
});

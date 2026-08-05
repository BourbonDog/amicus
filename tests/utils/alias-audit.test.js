/** F5: stale-alias audit across defaults + user config + curated routes, with suggestions. */
const {
  findStaleAliases, suggestReplacements
} = require('../../src/utils/alias-audit');

const CATALOG = [
  { id: 'openrouter/x-ai/grok-4.3', name: 'Grok 4.3' },
  { id: 'openrouter/x-ai/grok-4', name: 'Grok 4' },
  { id: 'openrouter/x-ai/grok-3-mini', name: 'Grok 3 Mini' },
  { id: 'openrouter/google/gemini-3.1-flash-lite-preview', name: 'Gemini Flash Lite' },
  { id: 'google/gemini-3.1-flash-lite-preview', name: 'Gemini direct' },
];

describe('findStaleAliases', () => {
  // These fixtures use real alias names (grok, gemini, gpt, deepseek) and none
  // of these tests doMock curated-models, so findStaleAliases's lazy
  // require('./curated-models') resolves the REAL module and its REAL
  // directFormProvenance() output for those aliases — gpt is 'derived' today
  // (grok 'none', gemini/deepseek 'authored'); no fixture combines a
  // derived-provenance alias with a stale source:'defaults' row that is
  // covered or gatewayOnly, so the suppression never engages here. A future
  // gatewayOnly annotation on one of these aliases, or a live row added for
  // one, would change that — re-check this block if such a change breaks it
  // — see the Task 4 review that added this note.
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

  it('suppresses a stale curated-route when the alias resolves live via any source', () => {
    // The default openrouter route is live; the stale direct curated route must be suppressed
    // so that `amicus models --check` reports clean and `--add-alias` actually clears warnings.
    const catalog = [{ id: 'openrouter/deepseek/deepseek-v4-pro' }];
    const sources = [
      { alias: 'deepseek', model: 'openrouter/deepseek/deepseek-v4-pro', source: 'defaults' },
      { alias: 'deepseek', model: 'deepseek/deepseek-chat', source: 'curated-route (deepseek)' },
    ];
    expect(findStaleAliases(sources, catalog)).toEqual([]);
  });

  it('still reports a stale curated-route when no live resolution exists for that alias', () => {
    // Include a deepseek direct row so the deepseek namespace is verifiable.
    const catalog = [
      { id: 'openrouter/deepseek/deepseek-v4-pro' },
      { id: 'deepseek/deepseek-v4-pro' },
    ];
    const sources = [
      { alias: 'deepseek', model: 'deepseek/deepseek-chat', source: 'curated-route (deepseek)' },
    ];
    const stale = findStaleAliases(sources, catalog);
    expect(stale).toHaveLength(1);
    expect(stale[0].source).toBe('curated-route (deepseek)');
  });

  it('returns [] when the catalog is empty (cannot check)', () => {
    expect(findStaleAliases([{ alias: 'x', model: 'openrouter/a/b', source: 'defaults' }], [])).toEqual([]);
  });

  it('ignores malformed catalog rows when building the provider index', () => {
    const cat = [null, { id: 42 }, { id: 'openrouter/x-ai/grok-4.3', name: 'ok' }];
    const sources = [{ alias: 'grok', model: 'openrouter/x-ai/grok-4.1-fast', source: 'defaults' }];
    expect(findStaleAliases(sources, cat)).toHaveLength(1);
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

  it('caps at n (default 3) when more same-vendor candidates exist', () => {
    const wide = [...CATALOG, { id: 'openrouter/x-ai/grok-2', name: 'Grok 2' }];
    expect(suggestReplacements('openrouter/x-ai/grok-4.1-fast', wide)).toHaveLength(3);
  });

  it('breaks equal-prefix ties numerically so grok-10 outranks grok-9', () => {
    const cat = [
      { id: 'openrouter/x-ai/grok-9', name: 'g9' },
      { id: 'openrouter/x-ai/grok-10', name: 'g10' },
      { id: 'openrouter/x-ai/grok-4', name: 'g4' },
    ];
    expect(suggestReplacements('openrouter/x-ai/grok-2', cat))
      .toEqual(['openrouter/x-ai/grok-10', 'openrouter/x-ai/grok-9', 'openrouter/x-ai/grok-4']);
  });

  it('ignores malformed catalog rows instead of throwing', () => {
    const cat = [null, { name: 'no-id' }, { id: 42 }, { id: 'openrouter/x-ai/grok-4.3', name: 'ok' }];
    expect(suggestReplacements('openrouter/x-ai/grok-4.1-fast', cat))
      .toEqual(['openrouter/x-ai/grok-4.3']);
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
      directFormProvenance: () => ({}),
    }));
    const { collectAliasSources: collect } = require('../../src/utils/alias-audit');
    expect(collect()).toEqual([
      { alias: 'grok', model: 'openrouter/x-ai/grok-4.3', source: 'defaults' },
      { alias: 'mine', model: 'openrouter/foo/bar', source: 'user-config' },
      { alias: 'gemini', model: 'google/g-1', source: 'curated-route (google)' },
    ]);
  });

  it('dedupes identical (alias, model) pairs, first source wins', () => {
    jest.resetModules();
    jest.doMock('../../src/utils/config', () => ({
      getDefaultAliases: () => ({ grok: 'openrouter/x-ai/grok-4.3' }),
      loadConfig: () => ({ aliases: { grok: 'openrouter/x-ai/grok-4.3', mine: 'openrouter/foo/bar' } }),
    }));
    jest.doMock('../../src/utils/curated-models', () => ({
      listCuratedRoutes: () => [
        { alias: 'grok', provider: 'openrouter', model: 'openrouter/x-ai/grok-4.3' },
        { alias: 'grok', provider: 'google', model: 'google/grok-direct' },
      ],
      directFormProvenance: () => ({}),
    }));
    const { collectAliasSources: collect } = require('../../src/utils/alias-audit');
    expect(collect()).toEqual([
      { alias: 'grok', model: 'openrouter/x-ai/grok-4.3', source: 'defaults' },
      { alias: 'mine', model: 'openrouter/foo/bar', source: 'user-config' },
      { alias: 'grok', model: 'google/grok-direct', source: 'curated-route (google)' },
    ]);
  });
});

describe("defaults-row suppression via provenance (v4.6.3 PR1, spec D2)", () => {
  const catalog = [
    { id: 'openai/gpt-5.6-sol' },                    // direct ns exists, sol-pro absent
    { id: 'openrouter/openai/gpt-5.6-sol-pro' },     // authored openrouter route LIVE
  ];
  const rows = [
    { alias: 'gpt-pro', model: 'openai/gpt-5.6-sol-pro', source: 'defaults' },
    { alias: 'gpt-pro', model: 'openrouter/openai/gpt-5.6-sol-pro', source: 'curated-route (openrouter)' },
  ];

  // Same doMock/resetModules/re-require idiom as collectAliasSources above,
  // parameterized on the provenance map each case wants findStaleAliases to see.
  function withProvenance(provenance, run) {
    jest.resetModules();
    jest.doMock('../../src/utils/curated-models', () => ({
      listCuratedRoutes: () => [],
      directFormProvenance: () => provenance,
    }));
    const { findStaleAliases: find } = require('../../src/utils/alias-audit');
    run(find);
  }

  test('a defaults row that is the DERIVED direct form is suppressed when the alias is covered live', () => {
    withProvenance({ 'gpt-pro': { directForm: 'derived', gatewayOnly: false } }, find => {
      expect(find(rows, catalog)).toEqual([]);
    });
  });

  test('an AUTHORED defaults row still reports stale — no blanket suppression', () => {
    withProvenance({ 'gpt-pro': { directForm: 'authored', gatewayOnly: false } }, find => {
      expect(find(rows, catalog).map(r => r.source)).toEqual(['defaults']);
    });
  });

  test('derived + NOT covered + NOT gatewayOnly still reports (both routes dead = real staleness)', () => {
    const deadCatalog = [{ id: 'openai/gpt-5.6-sol' }, { id: 'openrouter/openai/gpt-5.6-sol' }];
    withProvenance({ 'gpt-pro': { directForm: 'derived', gatewayOnly: false } }, find => {
      // Exact-shape assertion, not just "something reported": with deadCatalog
      // covered is empty, so the unrelated curated-route row always reports on
      // its own — a length > 0 check alone would stay green even if the
      // covered.has(alias) guard were dropped and every derived defaults row
      // got suppressed (the over-suppression direction, which hides REAL
      // staleness). Pin that the defaults row specifically survives.
      expect(find(rows, deadCatalog).filter(r => r.source === 'defaults')).toHaveLength(1);
    });
  });

  test('gatewayOnly suppresses the defaults row even with no live coverage', () => {
    const deadCatalog = [{ id: 'openai/gpt-5.6-sol' }, { id: 'openrouter/openai/gpt-5.6-sol' }];
    withProvenance({ 'gpt-pro': { directForm: 'derived', gatewayOnly: true } }, find => {
      expect(find(rows, deadCatalog).filter(r => r.source === 'defaults')).toEqual([]);
      // The suppression must not swallow the alias's other rows: the dead
      // openrouter curated-route row still reports (the only-live-route-died
      // signal survives gatewayOnly).
      expect(find(rows, deadCatalog).map(r => r.source)).toEqual(['curated-route (openrouter)']);
    });
  });

  test('user-config rows are NEVER provenance-suppressed (setup --add-alias single-row path)', () => {
    const userRow = [{ alias: 'gpt-pro', model: 'openai/gpt-5.6-sol-pro', source: 'user-config' }];
    withProvenance({ 'gpt-pro': { directForm: 'derived', gatewayOnly: true } }, find => {
      expect(find(userRow, catalog).length).toBe(1);
    });
  });
});

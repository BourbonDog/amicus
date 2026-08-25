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

// B3 (council review of PR 198, issue 195): doctor --fix's repair candidate
// set. None of these tests doMock curated-models, so the lazy
// require('./curated-models') inside findFabricatedAliasRepairs should
// resolve the REAL module and its REAL DIVERGENT_VENDORS (currently just
// 'anthropic') — same idiom findStaleAliases's top describe block documents.
// BUT the 'defaults-row suppression' describe block above leaves a
// jest.doMock'd curated-models stub (no DIVERGENT_VENDORS export) registered
// after its own tests run — a doMock registration outlives jest.resetModules()
// within one file; only jest.unmock() actually clears it. Unmock + reset in
// beforeEach (not at describe-body/collection time — that block's doMock
// calls run during EXECUTION, after collection finishes) so this block's
// tests see the real module regardless of file ordering.
describe('findFabricatedAliasRepairs (B3, council review of PR 198)', () => {
  let findFabricatedAliasRepairs;
  beforeEach(() => {
    jest.unmock('../../src/utils/curated-models');
    jest.resetModules();
    ({ findFabricatedAliasRepairs } = require('../../src/utils/alias-audit'));
  });

  // google's direct namespace is populated + authoritative, but omits the
  // exact fabricated bare id — classifyModel returns 'invalid' for it. The
  // real openrouter row is the twin the pre-fix picker stripped the prefix
  // from — this is the exact 'google/gemma-4-31b-it:free' example from the
  // task brief.
  const FABRICATED_CATALOG = [
    { id: 'google/gemini-3.7-flash', authoritative: true },
    { id: 'google/gemini-2.5-pro', authoritative: true },
    { id: 'openrouter/google/gemma-4-31b-it:free' },
  ];

  it('repairs a bare id that classifies invalid AND has an unambiguous OpenRouter twin', () => {
    const sources = [{ alias: 'google', model: 'google/gemma-4-31b-it:free', source: 'user-config' }];
    expect(findFabricatedAliasRepairs(sources, FABRICATED_CATALOG)).toEqual([
      { alias: 'google', oldId: 'google/gemma-4-31b-it:free', newId: 'openrouter/google/gemma-4-31b-it:free' },
    ]);
  });

  it('never touches an already OpenRouter-prefixed value (not bare)', () => {
    const sources = [
      { alias: 'google', model: 'openrouter/google/gemma-4-31b-it:free', source: 'user-config' },
    ];
    expect(findFabricatedAliasRepairs(sources, FABRICATED_CATALOG)).toEqual([]);
  });

  it('leaves a typo (invalid, no matching catalog twin) untouched — stays a warning, not a guess', () => {
    // "gemna" (typo) never normalizes to match the real "gemma" openrouter row.
    const sources = [{ alias: 'google', model: 'google/gemna-4-31b-it:free', source: 'user-config' }];
    expect(findFabricatedAliasRepairs(sources, FABRICATED_CATALOG)).toEqual([]);
  });

  it('leaves a genuinely retired model (invalid, absent everywhere) untouched', () => {
    const sources = [{ alias: 'google', model: 'google/gemini-1.0-ultra-retired', source: 'user-config' }];
    expect(findFabricatedAliasRepairs(sources, FABRICATED_CATALOG)).toEqual([]);
  });

  it('leaves an ambiguous OpenRouter twin untouched (two rows normalize to the same key)', () => {
    // 'gemma.5-flash' and 'gemma-5-flash' both normalize to 'gemma-5-flash'
    // (normalizeKey unifies '.'/'-') — pairAcrossGateways must omit, not guess.
    const ambiguousCatalog = [
      { id: 'google/gemini-3.7-flash', authoritative: true },
      { id: 'openrouter/google/gemma-5-flash' },
      { id: 'openrouter/google/gemma.5-flash' },
    ];
    const sources = [{ alias: 'google', model: 'google/gemma-5-flash', source: 'user-config' }];
    expect(findFabricatedAliasRepairs(sources, ambiguousCatalog)).toEqual([]);
  });

  it('excludes DIVERGENT_VENDORS (anthropic) — the picker never strips their prefix, so a bare form was never produced by this bug', () => {
    const anthropicCatalog = [
      { id: 'anthropic/claude-opus-4-8', authoritative: true },
      { id: 'openrouter/anthropic/claude-opus-4.9' },
    ];
    const sources = [{ alias: 'anthropic', model: 'anthropic/claude-opus-4.9', source: 'user-config' }];
    expect(findFabricatedAliasRepairs(sources, anthropicCatalog)).toEqual([]);
  });

  it('ignores non-user-config sources — only what is actually persisted to config.aliases can be repaired', () => {
    const sources = [
      { alias: 'google', model: 'google/gemma-4-31b-it:free', source: 'defaults' },
      { alias: 'google', model: 'google/gemma-4-31b-it:free', source: 'curated-route (google)' },
    ];
    expect(findFabricatedAliasRepairs(sources, FABRICATED_CATALOG)).toEqual([]);
  });

  it('a valid bare id (real catalog row) is never "repaired" — nothing to fix', () => {
    const sources = [{ alias: 'google', model: 'google/gemini-3.7-flash', source: 'user-config' }];
    expect(findFabricatedAliasRepairs(sources, FABRICATED_CATALOG)).toEqual([]);
  });

  it('an unverifiable (unknown, no namespace rows) alias is never repaired', () => {
    const sources = [{ alias: 'mystery', model: 'mystery-vendor/some-model', source: 'user-config' }];
    expect(findFabricatedAliasRepairs(sources, FABRICATED_CATALOG)).toEqual([]);
  });

  it('a malformed (no "/") model value is skipped, not thrown on', () => {
    const sources = [{ alias: 'broken', model: 'not-a-vendor-slash-model', source: 'user-config' }];
    expect(findFabricatedAliasRepairs(sources, FABRICATED_CATALOG)).toEqual([]);
  });

  it('returns [] on an empty catalog — no evidence, no repair', () => {
    const sources = [{ alias: 'google', model: 'google/gemma-4-31b-it:free', source: 'user-config' }];
    expect(findFabricatedAliasRepairs(sources, [])).toEqual([]);
  });

  // Rule 4's sharpest case: the catalog is NOT literally empty (another
  // vendor has authoritative rows), but THIS vendor's direct namespace has
  // zero rows at all -- classifyModel returns 'unknown', not 'invalid' --
  // while an OpenRouter twin DOES exist for it. 'unknown' must never
  // authorise a write, even with a real twin sitting right there.
  it('never repairs an "unknown" (unresolved direct namespace) alias, even when an OpenRouter twin exists', () => {
    const unknownNamespaceCatalog = [
      { id: 'openrouter/google/gemma-4-31b-it:free' }, // the real twin
      { id: 'anthropic/claude-opus-4-8', authoritative: true }, // catalog isn't empty; google's direct ns just was never fetched
    ];
    const sources = [{ alias: 'google', model: 'google/gemma-4-31b-it:free', source: 'user-config' }];
    expect(findFabricatedAliasRepairs(sources, unknownNamespaceCatalog)).toEqual([]);
  });
});

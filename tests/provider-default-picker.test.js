// tests/provider-default-picker.test.js
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const { buildProviderDefaultChoices, applyProviderDefault } = require('../src/utils/provider-default-picker');
const { classifyModel } = require('../src/utils/model-classification');

/**
 * Fixture: anthropic direct rows (haiku/sonnet/opus + one direct-only,
 * unpriced snapshot) + their OpenRouter twins (priced). Mirrors the
 * dash-direct / dot-openrouter convention from gateway-route-catalog.test.js.
 */
const anthropicCatalog = [
  { id: 'anthropic/claude-haiku-4-5', name: 'Claude Haiku 4.5', contextLength: 200000, pricing: null },
  { id: 'openrouter/anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5', contextLength: 200000,
    pricing: { prompt: '0.0000008', completion: '0.000004' } },
  { id: 'anthropic/claude-sonnet-5', name: 'Claude Sonnet 5', contextLength: 200000, pricing: null },
  { id: 'openrouter/anthropic/claude-sonnet-5', name: 'Claude Sonnet 5', contextLength: 200000,
    pricing: { prompt: '0.000003', completion: '0.000015' } },
  { id: 'anthropic/claude-opus-4-8', name: 'Claude Opus 4.8', contextLength: 200000, pricing: null },
  { id: 'openrouter/anthropic/claude-opus-4.8', name: 'Claude Opus 4.8', contextLength: 200000,
    pricing: { prompt: '0.000015', completion: '0.000075' } },
  // Direct-only snapshot, no OpenRouter twin at all -> must stay unpriced.
  { id: 'anthropic/claude-sonnet-4-6', name: 'Claude Sonnet 4.6', contextLength: 200000, pricing: null },
];

describe('buildProviderDefaultChoices — anthropic (dedupe + pricing + tier preselect)', () => {
  test('dedupes across gateways: opus appears exactly once, id is the direct dash form', () => {
    const { rows } = buildProviderDefaultChoices('anthropic', { catalog: anthropicCatalog, tier: 'balanced' });
    const opusRows = rows.filter(r => r.id.includes('opus'));
    expect(opusRows).toHaveLength(1);
    expect(opusRows[0].id).toBe('anthropic/claude-opus-4-8');
  });

  test('every logical model appears once (4 distinct models, not 7 catalog rows)', () => {
    const { rows } = buildProviderDefaultChoices('anthropic', { catalog: anthropicCatalog, tier: 'balanced' });
    expect(rows).toHaveLength(4);
    const ids = rows.map(r => r.id).sort();
    expect(ids).toEqual([
      'anthropic/claude-haiku-4-5',
      'anthropic/claude-opus-4-8',
      'anthropic/claude-sonnet-4-6',
      'anthropic/claude-sonnet-5',
    ]);
  });

  test('pricePerMInput is pulled from the OpenRouter twin as a raw number ($/M input)', () => {
    const { rows } = buildProviderDefaultChoices('anthropic', { catalog: anthropicCatalog, tier: 'balanced' });
    const opus = rows.find(r => r.id === 'anthropic/claude-opus-4-8');
    const sonnet = rows.find(r => r.id === 'anthropic/claude-sonnet-5');
    const haiku = rows.find(r => r.id === 'anthropic/claude-haiku-4-5');
    expect(opus.pricePerMInput).toBe(15);
    expect(sonnet.pricePerMInput).toBe(3);
    expect(haiku.pricePerMInput).toBeCloseTo(0.8);
  });

  test('a row with no OpenRouter twin at all is still listed, pricePerMInput: null', () => {
    const { rows } = buildProviderDefaultChoices('anthropic', { catalog: anthropicCatalog, tier: 'balanced' });
    const snapshot = rows.find(r => r.id === 'anthropic/claude-sonnet-4-6');
    expect(snapshot).toBeDefined();
    expect(snapshot.pricePerMInput).toBeNull();
  });

  test('preselectedId is the balanced tier -> direct sonnet id, isPreselected set on exactly that row', () => {
    const { preselectedId, rows } = buildProviderDefaultChoices('anthropic', { catalog: anthropicCatalog, tier: 'balanced' });
    expect(preselectedId).toBe('anthropic/claude-sonnet-5');
    const preselectedRows = rows.filter(r => r.isPreselected);
    expect(preselectedRows).toHaveLength(1);
    expect(preselectedRows[0].id).toBe('anthropic/claude-sonnet-5');
  });

  test('rows are sorted: preselected first, then price ascending, nulls last', () => {
    const { rows } = buildProviderDefaultChoices('anthropic', { catalog: anthropicCatalog, tier: 'balanced' });
    expect(rows.map(r => r.id)).toEqual([
      'anthropic/claude-sonnet-5',     // preselected (balanced), goes first regardless of price
      'anthropic/claude-haiku-4-5',    // 0.8
      'anthropic/claude-opus-4-8',     // 15
      'anthropic/claude-sonnet-4-6',   // null, last
    ]);
  });

  test('economy tier preselects the direct haiku id', () => {
    const { preselectedId } = buildProviderDefaultChoices('anthropic', { catalog: anthropicCatalog, tier: 'economy' });
    expect(preselectedId).toBe('anthropic/claude-haiku-4-5');
  });

  test('frontier tier preselects the direct opus id', () => {
    const { preselectedId } = buildProviderDefaultChoices('anthropic', { catalog: anthropicCatalog, tier: 'frontier' });
    expect(preselectedId).toBe('anthropic/claude-opus-4-8');
  });
});

describe('buildProviderDefaultChoices — resolveTier-null fallback (unknown vendor, no TIERS entry)', () => {
  const catalog = [
    { id: 'testvendor/model-a', name: 'Model A', contextLength: 1000, pricing: null },
    { id: 'openrouter/testvendor/model-a', name: 'Model A', contextLength: 1000, pricing: { prompt: '0.000002' } }, // $2/M
    { id: 'testvendor/model-b', name: 'Model B', contextLength: 1000, pricing: null },
    { id: 'openrouter/testvendor/model-b', name: 'Model B', contextLength: 1000, pricing: { prompt: '0.0000005' } }, // $0.5/M
    { id: 'testvendor/model-c', name: 'Model C', contextLength: 1000, pricing: null },
    { id: 'openrouter/testvendor/model-c', name: 'Model C', contextLength: 1000, pricing: { prompt: '0.000009' } }, // $9/M
  ];

  test('falls back to the cheapest priced row when resolveTier returns null', () => {
    const { preselectedId, rows } = buildProviderDefaultChoices('testvendor', { catalog, tier: 'balanced' });
    expect(preselectedId).toBe('testvendor/model-b');
    const preselectedRows = rows.filter(r => r.isPreselected);
    expect(preselectedRows).toHaveLength(1);
    expect(preselectedRows[0].id).toBe('testvendor/model-b');
    expect(rows[0].id).toBe('testvendor/model-b'); // preselected sorts first
  });

  test('falls back to the first row when resolveTier returns null and nothing is priced', () => {
    const unpriced = [
      { id: 'testvendor/model-a', name: 'Model A', contextLength: 1000, pricing: null },
      { id: 'testvendor/model-b', name: 'Model B', contextLength: 1000, pricing: null },
    ];
    const { preselectedId, rows } = buildProviderDefaultChoices('testvendor', { catalog: unpriced, tier: 'balanced' });
    expect(preselectedId).toBe('testvendor/model-a');
    expect(rows.filter(r => r.isPreselected)).toHaveLength(1);
  });
});

describe('buildProviderDefaultChoices — anthropic divergent-vendor id fabrication guard (regression)', () => {
  // anthropic is a DIVERGENT_VENDOR (curated-models.js): OpenRouter uses dot
  // versions (claude-opus-4.8) but the direct Anthropic API uses
  // dashes/dates (claude-opus-4-8). Stripping 'openrouter/' off an
  // OpenRouter-only id would fabricate a non-direct-callable dot-form id.

  const orOnlyAnthropicCatalog = [
    // Fixture models an OpenRouter-only entry with NO direct twin at all. (fable
    // WAS the live example until 2026-08-05, when its direct route was authored —
    // the shape stays worth pinning even with no current curated example.)
    { id: 'openrouter/anthropic/claude-fable-5', name: 'Claude Fable 5', contextLength: 200000,
      pricing: { prompt: '0.000002', completion: '0.00001' } },
  ];

  test('OR-only anthropic model keeps the OpenRouter-prefixed id -- never fabricates a dot-form direct id', () => {
    const { preselectedId, rows } = buildProviderDefaultChoices('anthropic', { catalog: orOnlyAnthropicCatalog, tier: 'balanced' });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('openrouter/anthropic/claude-fable-5');
    expect(rows.some(r => r.id === 'anthropic/claude-fable-5')).toBe(false); // fabricated dot-form id must never appear
    expect(preselectedId).toBe('openrouter/anthropic/claude-fable-5'); // not dropped from preselection either
  });

  const ambiguousHaikuCatalog = [
    // Bare alias and a dated pinned snapshot both normalize (per
    // gateway-route-catalog.js) to the same key -> pairAcrossGateways
    // reports the direct side as ambiguous and omits it. Both must still
    // survive as their own real, direct-callable rows.
    { id: 'anthropic/claude-haiku-4-5', name: 'Claude Haiku 4.5', contextLength: 200000, pricing: null },
    { id: 'anthropic/claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5 (pinned)', contextLength: 200000, pricing: null },
    { id: 'openrouter/anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5', contextLength: 200000,
      pricing: { prompt: '0.0000008', completion: '0.000004' } },
  ];

  test('ambiguous bare+dated direct ids are both preserved, never collapsed into a fabricated dot-form id', () => {
    const { preselectedId, rows } = buildProviderDefaultChoices('anthropic', { catalog: ambiguousHaikuCatalog, tier: 'economy' });
    const ids = rows.map(r => r.id);
    expect(ids).toContain('anthropic/claude-haiku-4-5');
    expect(ids).toContain('anthropic/claude-haiku-4-5-20251001');
    expect(ids).not.toContain('anthropic/claude-haiku-4.5'); // fabricated dot-form id must never appear
    // preselectedId must be one of the row ids as actually built, never the fabricated id.
    expect(ids).toContain(preselectedId);
  });

  test('never-fabricate guarantee: every returned row id is verbatim present in the input catalog, for anthropic', () => {
    const fixtures = [anthropicCatalog, orOnlyAnthropicCatalog, ambiguousHaikuCatalog];
    for (const catalog of fixtures) {
      const catalogIds = catalog.map(r => r.id);
      const { rows } = buildProviderDefaultChoices('anthropic', { catalog, tier: 'balanced' });
      for (const row of rows) {
        expect(catalogIds.includes(row.id)).toBe(true);
      }
    }
  });
});

describe('buildProviderDefaultChoices — non-divergent vendor bare-id fabrication guard (issue 195)', () => {
  // Mirrors the anthropic guard above, but for a NON-divergent vendor whose
  // direct namespace IS populated with authoritative rows -- unlike
  // anthropic (where every OR-only id is protected by DIVERGENT_VENDORS)
  // and unlike deepseek (whose direct namespace is empty, below), google's
  // bare-form-eligible ids used to be synthesized unconditionally even when
  // the vendor's OWN direct namespace proved the bare id didn't exist.
  const googlePopulatedNamespaceCatalog = [
    // Populated, authoritative direct rows -- pairAcrossGateways resolves
    // these as real direct twins for their own OpenRouter rows.
    { id: 'google/gemini-3.7-flash', name: 'Gemini 3.7 Flash', contextLength: 1000000, pricing: null },
    { id: 'openrouter/google/gemini-3.7-flash', name: 'Gemini 3.7 Flash', contextLength: 1000000,
      pricing: { prompt: '0.0000003' } },
    { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextLength: 1000000, pricing: null },
    { id: 'openrouter/google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextLength: 1000000,
      pricing: { prompt: '0.0000125' } },
    // OR-only row, NO direct twin -- e.g. a free/batch variant Google's
    // direct API doesn't serve. Issue 195's exact shape: naive stripping
    // produces 'google/gemma-4-31b-it:free', an id no catalog row carries.
    { id: 'openrouter/google/gemma-4-31b-it:free', name: 'Gemma 4 31B IT (free)', contextLength: 8192,
      pricing: { prompt: '0' } },
  ];

  test('OR-only row with a populated direct namespace keeps the OpenRouter-prefixed id -- never fabricates an unlisted bare id', () => {
    const { rows } = buildProviderDefaultChoices('google', { catalog: googlePopulatedNamespaceCatalog, tier: 'balanced' });
    const ids = rows.map(r => r.id);
    expect(ids).toContain('openrouter/google/gemma-4-31b-it:free');
    expect(ids).not.toContain('google/gemma-4-31b-it:free'); // fabricated id must never appear
  });

  test('a row WITH a real direct twin still collapses onto its bare id (fix does not disable the happy path)', () => {
    const { rows } = buildProviderDefaultChoices('google', { catalog: googlePopulatedNamespaceCatalog, tier: 'balanced' });
    const ids = rows.map(r => r.id);
    expect(ids).toContain('google/gemini-3.7-flash');
    expect(ids).toContain('google/gemini-2.5-pro');
  });

  test('empty direct namespace (deepseek-shaped): bare form is still synthesized -- current behavior must be preserved', () => {
    const emptyDirectNamespaceCatalog = [
      { id: 'openrouter/deepseek/deepseek-v3.2', name: 'DeepSeek V3.2', contextLength: 128000,
        pricing: { prompt: '0.00000026' } },
      { id: 'openrouter/deepseek/deepseek-r1', name: 'DeepSeek R1', contextLength: 128000,
        pricing: { prompt: '0.0000007' } },
    ];
    const { rows } = buildProviderDefaultChoices('deepseek', { catalog: emptyDirectNamespaceCatalog, tier: 'balanced' });
    const ids = rows.map(r => r.id);
    expect(ids).toContain('deepseek/deepseek-v3.2');
    expect(ids).toContain('deepseek/deepseek-r1');
  });

  test('issue 195: a tier-resolved OR-only id (populated direct namespace) preselects its OWN row, not a cheaper decoy (canonicalizeResolved regression)', () => {
    // Only row matching google's 'economy' tier pattern (^gemini-[\d.]+-flash-lite)
    // is the OR-only row, priced ABOVE the direct 'flash' row below -- so a
    // broken canonicalizeResolved (unconditional strip -> id absent from
    // `rows` -> defensive fallback) provably lands on the WRONG (cheaper) row
    // instead of coincidentally matching by price.
    const catalog = [
      { id: 'google/gemini-3.7-flash', name: 'Gemini 3.7 Flash', contextLength: 1000000, pricing: null },
      { id: 'openrouter/google/gemini-3.7-flash', name: 'Gemini 3.7 Flash', contextLength: 1000000,
        pricing: { prompt: '0.0000003' } }, // cheapest -- the wrong-fallback trap
      { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextLength: 1000000, pricing: null },
      { id: 'openrouter/google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextLength: 1000000,
        pricing: { prompt: '0.0000125' } },
      { id: 'openrouter/google/gemini-2.5-flash-lite:batch', name: 'Gemini 2.5 Flash Lite (batch)',
        contextLength: 1000000, pricing: { prompt: '0.000002' } },
    ];
    const { preselectedId, rows } = buildProviderDefaultChoices('google', { catalog, tier: 'economy' });
    expect(preselectedId).toBe('openrouter/google/gemini-2.5-flash-lite:batch');
    const preselectedRows = rows.filter(r => r.isPreselected);
    expect(preselectedRows).toHaveLength(1);
    expect(preselectedRows[0].id).toBe('openrouter/google/gemini-2.5-flash-lite:batch');
  });

  test('invariant: every row buildProviderDefaultChoices returns classifies non-invalid at its own implied gateway, across all four direct vendors', () => {
    // The property issue 195 is actually about: a row id this module hands
    // back must never be something catalogGate/classifyModel would reject
    // outright once the user holds that vendor's key.
    const fixtures = [
      { vendor: 'google', catalog: googlePopulatedNamespaceCatalog },
      { vendor: 'deepseek', catalog: [
        { id: 'openrouter/deepseek/deepseek-v3.2', name: 'DeepSeek V3.2', contextLength: 128000,
          pricing: { prompt: '0.00000026' } },
      ] },
      { vendor: 'anthropic', catalog: anthropicCatalog },
      { vendor: 'anthropic', catalog: [
        // OR-only, no direct twin -- anthropic is DIVERGENT_VENDORS, so this
        // must classify 'unknown' or 'valid' via the openrouter namespace,
        // never 'invalid' via a fabricated direct one.
        { id: 'openrouter/anthropic/claude-fable-5', name: 'Claude Fable 5', contextLength: 200000,
          pricing: { prompt: '0.000002', completion: '0.00001' } },
      ] },
      { vendor: 'openai', catalog: [
        { id: 'openai/gpt-5.6-terra', name: 'GPT 5.6 Terra', contextLength: 400000, pricing: null },
        { id: 'openrouter/openai/gpt-5.6-terra', name: 'GPT 5.6 Terra', contextLength: 400000,
          pricing: { prompt: '0.000001' } },
        { id: 'openrouter/openai/gpt-3.5-turbo-0613', name: 'GPT-3.5 Turbo (0613)', contextLength: 4096,
          pricing: { prompt: '0.0000015' } }, // OR-only, populated authoritative direct namespace above
      ] },
    ];
    for (const { vendor, catalog } of fixtures) {
      const { rows } = buildProviderDefaultChoices(vendor, { catalog, tier: 'balanced' });
      for (const row of rows) {
        const gateway = row.id.startsWith('openrouter/') ? 'openrouter' : 'direct';
        expect(classifyModel(row.id, gateway, { models: catalog })).not.toBe('invalid');
      }
    }
  });
});

describe('buildProviderDefaultChoices — degenerate input, must not crash', () => {
  test('absent catalog for the vendor -> empty rows, null preselectedId', () => {
    expect(buildProviderDefaultChoices('anthropic', {})).toEqual({ preselectedId: null, rows: [] });
  });

  test('empty catalog array -> empty rows, null preselectedId', () => {
    expect(buildProviderDefaultChoices('anthropic', { catalog: [] })).toEqual({ preselectedId: null, rows: [] });
  });

  test('no options object at all -> empty rows, null preselectedId', () => {
    expect(buildProviderDefaultChoices('anthropic')).toEqual({ preselectedId: null, rows: [] });
  });

  test('vendor with zero matching rows in a non-empty catalog -> empty rows, null preselectedId', () => {
    expect(buildProviderDefaultChoices('nope', { catalog: anthropicCatalog, tier: 'balanced' }))
      .toEqual({ preselectedId: null, rows: [] });
  });

  test('degenerate vendor (non-string / empty) -> empty rows, does not throw', () => {
    expect(buildProviderDefaultChoices(undefined, { catalog: anthropicCatalog })).toEqual({ preselectedId: null, rows: [] });
    expect(buildProviderDefaultChoices('', { catalog: anthropicCatalog })).toEqual({ preselectedId: null, rows: [] });
  });
});

describe('applyProviderDefault — read-modify-write (vendor alias + seed default)', () => {
  let tempDir;
  let originalEnv;
  let loadConfig;
  let saveConfig;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-config-test-'));
    originalEnv = { ...process.env };
    process.env.AMICUS_CONFIG_DIR = tempDir;
    ({ loadConfig, saveConfig } = require('../src/utils/config'));
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('empty config: sets aliases.anthropic AND seeds config.default, returns setAsDefault:true', () => {
    const result = applyProviderDefault('anthropic', 'anthropic/claude-sonnet-5');
    expect(result).toEqual({ alias: 'anthropic', setAsDefault: true });

    const cfg = loadConfig();
    expect(cfg.aliases.anthropic).toBe('anthropic/claude-sonnet-5');
    expect(cfg.default).toBe('anthropic');
  });

  test('existing default is never clobbered: second call sets only aliases.anthropic, setAsDefault:false', () => {
    saveConfig({ default: 'gpt', aliases: { gpt: 'openai/gpt-5.5' } });

    const result = applyProviderDefault('anthropic', 'anthropic/claude-sonnet-5');
    expect(result).toEqual({ alias: 'anthropic', setAsDefault: false });

    const cfg = loadConfig();
    expect(cfg.default).toBe('gpt');
    expect(cfg.aliases.anthropic).toBe('anthropic/claude-sonnet-5');
  });

  test('existing unrelated aliases are preserved', () => {
    saveConfig({ default: 'gpt', aliases: { gpt: 'openai/gpt-5.5', deepseek: 'deepseek/deepseek-v4-pro' } });

    applyProviderDefault('anthropic', 'anthropic/claude-sonnet-5');

    const cfg = loadConfig();
    expect(cfg.aliases.gpt).toBe('openai/gpt-5.5');
    expect(cfg.aliases.deepseek).toBe('deepseek/deepseek-v4-pro');
    expect(cfg.aliases.anthropic).toBe('anthropic/claude-sonnet-5');
  });

  test('divergent OR-only vendor (anthropic): chosenId stored VERBATIM, never stripped to a fabricated dot-form id', () => {
    const result = applyProviderDefault('anthropic', 'openrouter/anthropic/claude-fable-5');
    expect(result).toEqual({ alias: 'anthropic', setAsDefault: true });

    const cfg = loadConfig();
    expect(cfg.aliases.anthropic).toBe('openrouter/anthropic/claude-fable-5');
    expect(cfg.aliases.anthropic).not.toBe('anthropic/claude-fable-5');
  });

  test('non-divergent vendor (openai): chosenId is canonicalized to the bare direct-first form, given a catalog that PROVES it (F1)', () => {
    // F1 (council review of PR 198): applyProviderDefault now requires positive
    // evidence (classifyModel === 'valid') to strip, not merely "not disproven" --
    // so this happy-path test must supply a catalog whose direct namespace
    // actually carries the bare id, matching what buildProviderDefaultChoices
    // would really have offered alongside this chosenId.
    const catalog = [
      { id: 'openai/gpt-5.5', name: 'GPT 5.5', contextLength: 400000, pricing: null },
      { id: 'openrouter/openai/gpt-5.5', name: 'GPT 5.5', contextLength: 400000, pricing: { prompt: '0.000001' } },
    ];
    const result = applyProviderDefault('openai', 'openrouter/openai/gpt-5.5', { catalog });
    expect(result).toEqual({ alias: 'openai', setAsDefault: true });

    const cfg = loadConfig();
    expect(cfg.aliases.openai).toBe('openai/gpt-5.5');
  });

  test('seedDefaultIfAbsent:false never sets config.default, even when absent', () => {
    const result = applyProviderDefault('anthropic', 'anthropic/claude-sonnet-5', { seedDefaultIfAbsent: false });
    expect(result).toEqual({ alias: 'anthropic', setAsDefault: false });

    const cfg = loadConfig();
    expect(cfg.default).toBeUndefined();
    expect(cfg.aliases.anthropic).toBe('anthropic/claude-sonnet-5');
  });

  test('whitespace-only existing default is treated as absent and gets seeded', () => {
    saveConfig({ default: '   ', aliases: {} });

    const result = applyProviderDefault('anthropic', 'anthropic/claude-sonnet-5');
    expect(result).toEqual({ alias: 'anthropic', setAsDefault: true });

    const cfg = loadConfig();
    expect(cfg.default).toBe('anthropic');
  });
});

describe('applyProviderDefault — does not re-strip a preserved OpenRouter prefix (issue 195 regression)', () => {
  // buildProviderDefaultChoices only ever hands a non-divergent vendor an
  // OpenRouter-prefixed chosenId when directFormIfSafe (list-building)
  // already proved the bare form invalid, OR when the catalog it built from
  // is empty/absent and never even got a chance to try -- applyProviderDefault
  // (persistence) must not undo either case by deriving the bare form on
  // anything less than positive evidence (`directFormIfProven`, F1: council
  // review of PR 198) when it persists the choice.
  let tempDir;
  let originalEnv;
  let loadConfig;

  const googlePopulatedNamespaceCatalog = [
    { id: 'google/gemini-3.7-flash', name: 'Gemini 3.7 Flash', contextLength: 1000000, pricing: null },
    { id: 'openrouter/google/gemini-3.7-flash', name: 'Gemini 3.7 Flash', contextLength: 1000000,
      pricing: { prompt: '0.0000003' } },
    { id: 'openrouter/google/gemma-4-31b-it:free', name: 'Gemma 4 31B IT (free)', contextLength: 8192,
      pricing: { prompt: '0' } },
  ];

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-config-test-'));
    originalEnv = { ...process.env };
    process.env.AMICUS_CONFIG_DIR = tempDir;
    ({ loadConfig } = require('../src/utils/config'));
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('with catalog: a chosenId the picker kept OpenRouter-prefixed is stored VERBATIM, not re-stripped to the fabricated bare id', () => {
    const result = applyProviderDefault('google', 'openrouter/google/gemma-4-31b-it:free', {
      catalog: googlePopulatedNamespaceCatalog,
    });
    expect(result).toEqual({ alias: 'google', setAsDefault: true });

    const cfg = loadConfig();
    expect(cfg.aliases.google).toBe('openrouter/google/gemma-4-31b-it:free');
    expect(cfg.aliases.google).not.toBe('google/gemma-4-31b-it:free'); // the fabricated id must never be persisted
  });

  test('with catalog: a chosenId WITH a real direct twin still canonicalizes to the bare form (happy path unaffected)', () => {
    const result = applyProviderDefault('google', 'openrouter/google/gemini-3.7-flash', {
      catalog: googlePopulatedNamespaceCatalog,
    });
    expect(result).toEqual({ alias: 'google', setAsDefault: true });

    const cfg = loadConfig();
    expect(cfg.aliases.google).toBe('google/gemini-3.7-flash');
  });

  // F1 (major, council review of PR 198): this used to fall back to the
  // pre-195 unconditional strip, which SILENTLY REINTRODUCED the exact bug
  // issue 195 fixed on every catalog fetch failure (measured: a live catalog
  // correctly keeps this chosenId OpenRouter-prefixed; an empty one used to
  // fabricate 'google/gemma-4-31b-it:free', which classifies 'invalid'
  // against the real catalog). No catalog is NO evidence, not proof of
  // absence -- chosenId must be preserved exactly as given, the same as the
  // "with catalog, proven invalid" case above.
  test('without catalog: chosenId is preserved VERBATIM, not fabricated (F1 -- empty catalog is no evidence)', () => {
    const result = applyProviderDefault('google', 'openrouter/google/gemma-4-31b-it:free');
    expect(result).toEqual({ alias: 'google', setAsDefault: true });

    const cfg = loadConfig();
    expect(cfg.aliases.google).toBe('openrouter/google/gemma-4-31b-it:free');
    expect(cfg.aliases.google).not.toBe('google/gemma-4-31b-it:free'); // the fabricated id must never be persisted
  });

  test('empty catalog array (explicit): same as omitted -- chosenId is preserved verbatim', () => {
    const result = applyProviderDefault('google', 'openrouter/google/gemma-4-31b-it:free', { catalog: [] });
    expect(result).toEqual({ alias: 'google', setAsDefault: true });

    const cfg = loadConfig();
    expect(cfg.aliases.google).toBe('openrouter/google/gemma-4-31b-it:free');
  });
});

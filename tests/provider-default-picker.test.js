// tests/provider-default-picker.test.js
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const { buildProviderDefaultChoices, applyProviderDefault } = require('../src/utils/provider-default-picker');

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
    // Mirrors the real 'fable' cardless entry (curated-models.js): an
    // OpenRouter-only model with NO direct twin at all.
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

  test('non-divergent vendor (openai): chosenId is canonicalized to the bare direct-first form', () => {
    const result = applyProviderDefault('openai', 'openrouter/openai/gpt-5.5');
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

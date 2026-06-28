'use strict';
const { isFreeModel, listFreeModels, suggestFreeCouncil, PINNED_FREE_MODELS } =
  require('../src/utils/free-models');

const CATALOG = [
  { id: 'openrouter/deepseek/deepseek-r1:free', name: 'DeepSeek R1 (free)', pricing: { prompt: '0', completion: '0' } },
  { id: 'openrouter/deepseek/deepseek-chat-v3:free', name: 'DeepSeek Chat (free)', pricing: { prompt: '0', completion: '0' } },
  { id: 'openrouter/google/gemini-2.0-flash-exp:free', name: 'Gemini Flash (free)', pricing: { prompt: '0', completion: '0' } },
  { id: 'openrouter/qwen/qwen3-coder:free', name: 'Qwen Coder (free)', pricing: null },
  { id: 'openrouter/anthropic/claude-opus-4.8', name: 'Claude Opus', pricing: { prompt: '0.000015', completion: '0.000075' } },
  { id: 'openrouter/some/zero-but-paid', name: 'Per-request charged', pricing: { prompt: '0', completion: '0' } }, // NOT :free
  { id: 'google/gemini-3.5-flash', name: 'Direct Gemini', pricing: null }, // not openrouter ns
];

describe('isFreeModel', () => {
  it('is true only for openrouter ids ending in :free', () => {
    expect(isFreeModel({ id: 'openrouter/deepseek/deepseek-r1:free' })).toBe(true);
    expect(isFreeModel({ id: 'google/gemini-3.5-flash:free' })).toBe(false); // wrong namespace
    expect(isFreeModel({ id: 'openrouter/anthropic/claude-opus-4.8' })).toBe(false);
  });
  it('does NOT treat a zero-price non-:free row as free (avoids per-request mislabel)', () => {
    expect(isFreeModel({ id: 'openrouter/some/zero-but-paid', pricing: { prompt: '0', completion: '0' } })).toBe(false);
  });
  it('tolerates missing/odd rows', () => {
    expect(isFreeModel(null)).toBe(false);
    expect(isFreeModel({})).toBe(false);
  });
});

describe('listFreeModels', () => {
  it('returns only free rows, sorted by vendor then id', () => {
    const out = listFreeModels(CATALOG).map(r => r.id);
    expect(out).toEqual([
      'openrouter/deepseek/deepseek-chat-v3:free',
      'openrouter/deepseek/deepseek-r1:free',
      'openrouter/google/gemini-2.0-flash-exp:free',
      'openrouter/qwen/qwen3-coder:free',
    ]);
  });
  it('returns [] for an empty/garbage catalog', () => {
    expect(listFreeModels([])).toEqual([]);
    expect(listFreeModels(null)).toEqual([]);
  });
});

describe('suggestFreeCouncil', () => {
  it('picks at most n, one per distinct vendor', () => {
    const out = suggestFreeCouncil(CATALOG, 3).map(r => r.id);
    expect(out).toHaveLength(3);
    const vendors = out.map(id => id.split('/')[1]);
    expect(new Set(vendors).size).toBe(3); // deepseek, google, qwen — no two from one vendor
  });
  it('caps at the number of distinct vendors when fewer than n', () => {
    const small = [CATALOG[0], CATALOG[1]]; // both deepseek
    expect(suggestFreeCouncil(small, 3)).toHaveLength(1);
  });
});

describe('PINNED_FREE_MODELS', () => {
  it('is a non-empty list of openrouter :free ids (offline fallback)', () => {
    expect(PINNED_FREE_MODELS.length).toBeGreaterThan(0);
    PINNED_FREE_MODELS.forEach(id => {
      expect(id.startsWith('openrouter/')).toBe(true);
      expect(id.endsWith(':free')).toBe(true);
    });
  });
});

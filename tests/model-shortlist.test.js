'use strict';

const { buildModelShortlist, SHORTLIST_LIMIT } = require('../src/utils/model-shortlist');

function row(id, promptPrice, name) {
  return {
    id,
    name: name || id.split('/').pop(),
    contextLength: 128000,
    pricing: promptPrice === null ? null : { prompt: String(promptPrice / 1e6) },
  };
}

// Nine DeepSeek models so the 8-row limit actually splits.
const CATALOG = [
  row('openrouter/deepseek/deepseek-v4-pro', 0.52),
  row('openrouter/deepseek/deepseek-v4-flash', 0.06),
  row('openrouter/deepseek/deepseek-chat', 0.26),
  row('openrouter/deepseek/deepseek-r1', 0.70),
  row('openrouter/deepseek/deepseek-v3.2', 0.26),
  row('openrouter/deepseek/deepseek-v3.2-exp', 0.27),
  row('openrouter/deepseek/deepseek-chat-v3-0324', 0.25),
  row('openrouter/deepseek/deepseek-v3.1-terminus', 0.27),
  row('openrouter/deepseek/deepseek-r1-distill-llama-70b', 0.80),
];

describe('buildModelShortlist', () => {
  test('honours the caller-supplied recommendedId over the tier preselect', () => {
    const out = buildModelShortlist('deepseek', {
      catalog: CATALOG,
      recommendedId: 'deepseek/deepseek-v4-pro',
    });
    expect(out.recommendedId).toBe('deepseek/deepseek-v4-pro');
    expect(out.suggested[0].id).toBe('deepseek/deepseek-v4-pro');
    expect(out.suggested[0].isRecommended).toBe(true);
  });

  test('splits at the limit and reports the true total', () => {
    const out = buildModelShortlist('deepseek', {
      catalog: CATALOG,
      recommendedId: 'deepseek/deepseek-v4-pro',
    });
    expect(SHORTLIST_LIMIT).toBe(8);
    expect(out.suggested).toHaveLength(8);
    expect(out.rest).toHaveLength(1);
    expect(out.total).toBe(9);
  });

  test('every model appears exactly once across suggested + rest', () => {
    const out = buildModelShortlist('deepseek', {
      catalog: CATALOG,
      recommendedId: 'deepseek/deepseek-v4-pro',
    });
    const ids = out.suggested.concat(out.rest).map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('deepseek/deepseek-r1');
  });

  test('after the recommended row, ordering is price-ascending', () => {
    const out = buildModelShortlist('deepseek', {
      catalog: CATALOG,
      recommendedId: 'deepseek/deepseek-v4-pro',
    });
    const prices = out.suggested.slice(1).map(r => r.pricePerMInput);
    const sorted = prices.slice().sort((a, b) => a - b);
    expect(prices).toEqual(sorted);
  });

  test('falls back to the picker preselect when recommendedId matches no row', () => {
    const out = buildModelShortlist('deepseek', {
      catalog: CATALOG,
      recommendedId: 'deepseek/does-not-exist',
    });
    expect(out.recommendedId).not.toBeNull();
    expect(out.suggested[0].isRecommended).toBe(true);
    expect(out.suggested.concat(out.rest).map(r => r.id))
      .toContain(out.recommendedId);
  });

  test('annotates both route forms so an explicit OpenRouter pick is expressible', () => {
    const out = buildModelShortlist('deepseek', {
      catalog: CATALOG,
      recommendedId: 'deepseek/deepseek-v4-pro',
    });
    const r1 = out.suggested.concat(out.rest).find(r => r.id === 'deepseek/deepseek-r1');
    expect(r1.openrouterId).toBe('openrouter/deepseek/deepseek-r1');
  });

  test('empty or unknown vendor degrades to an empty shortlist, never throws', () => {
    expect(buildModelShortlist('deepseek', { catalog: [] }))
      .toEqual({ recommendedId: null, suggested: [], rest: [], total: 0 });
    expect(buildModelShortlist('', { catalog: CATALOG }).total).toBe(0);
  });
});

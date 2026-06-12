// tests/quick-picks.test.js
'use strict';

const { compareIdsDesc, pickCurrent, resolveQuickPicks, toLiveSeedAliases } =
  require('../src/utils/quick-picks');

const row = id => ({ id, name: id, contextLength: 1, pricing: { prompt: '0' } });

describe('compareIdsDesc', () => {
  test('newer numeric version wins even when older is stable and newer is preview', () => {
    const ids = ['google/gemini-2.5-pro', 'google/gemini-3.1-pro-preview'];
    expect(ids.sort(compareIdsDesc)[0]).toBe('google/gemini-3.1-pro-preview');
  });
  test('within the same version the unmarked id beats its -preview variant', () => {
    const ids = ['google/gemini-3.5-flash-preview', 'google/gemini-3.5-flash'];
    expect(ids.sort(compareIdsDesc)[0]).toBe('google/gemini-3.5-flash');
  });
});

describe('pickCurrent', () => {
  const catalog = [
    row('openrouter/google/gemini-3.5-flash'),
    row('openrouter/google/gemini-3.5-flash-preview'),
    row('openrouter/google/gemini-3.1-flash-lite'),   // lite ≠ flash-class
    row('openrouter/google/gemini-3.1-flash-image'),  // image ≠ flash-class
    row('openrouter/google/gemini-2.5-flash'),
    row('google/gemini-3.5-flash'),
  ];
  const flash = /^gemini-[\d.]+-flash(-preview|-exp|-latest)?$/;

  test('resolves the newest matching id in the openrouter namespace', () => {
    expect(pickCurrent(catalog, 'openrouter/', 'google', flash))
      .toBe('openrouter/google/gemini-3.5-flash');
  });
  test('resolves the direct namespace independently', () => {
    expect(pickCurrent(catalog, '', 'google', flash)).toBe('google/gemini-3.5-flash');
  });
  test('returns null when nothing matches', () => {
    expect(pickCurrent(catalog, '', 'openai', /^gpt-[\d.]+$/)).toBeNull();
    expect(pickCurrent([], 'openrouter/', 'google', flash)).toBeNull();
    expect(pickCurrent(null, 'openrouter/', 'google', flash)).toBeNull();
  });
});

describe('resolveQuickPicks', () => {
  test('live rows carry source live and catalog-resolved routes', () => {
    const catalog = [
      row('openrouter/google/gemini-9.9-flash'),
      row('google/gemini-9.8-flash'),
    ];
    const gemini = resolveQuickPicks(catalog).find(r => r.alias === 'gemini');
    expect(gemini.source).toBe('live');
    expect(gemini.routes.openrouter).toBe('openrouter/google/gemini-9.9-flash');
    expect(gemini.routes.google).toBe('google/gemini-9.8-flash');
  });
  test('empty catalog falls back to pinned routes, source fallback', () => {
    const picks = resolveQuickPicks([]);
    expect(picks).toHaveLength(5);
    const deepseek = picks.find(r => r.alias === 'deepseek');
    expect(deepseek.source).toBe('fallback');
    expect(deepseek.routes.openrouter).toBe('openrouter/deepseek/deepseek-v4-pro');
    expect(deepseek.routes.deepseek).toBe('deepseek/deepseek-chat');
  });
  test('unresolvable direct namespace uses the pinned direct fallback', () => {
    const catalog = [row('openrouter/deepseek/deepseek-v9-pro')];
    const deepseek = resolveQuickPicks(catalog).find(r => r.alias === 'deepseek');
    expect(deepseek.source).toBe('live');
    expect(deepseek.routes.openrouter).toBe('openrouter/deepseek/deepseek-v9-pro');
    expect(deepseek.routes.deepseek).toBe('deepseek/deepseek-chat');
  });
});

describe('toLiveSeedAliases', () => {
  test('overlays live family openrouter routes on the static defaults', () => {
    const seeds = toLiveSeedAliases([row('openrouter/google/gemini-9.9-flash')]);
    expect(seeds.gemini).toBe('openrouter/google/gemini-9.9-flash');
    expect(seeds.qwen).toBe('openrouter/qwen/qwen3.7-max'); // cardless stays pinned
  });
  test('null/empty catalog returns the static defaults unchanged', () => {
    const { toDefaultAliases } = require('../src/utils/curated-models');
    expect(toLiveSeedAliases(null)).toEqual(toDefaultAliases());
  });
});

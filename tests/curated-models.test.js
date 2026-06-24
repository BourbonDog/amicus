// tests/curated-models.test.js
'use strict';

const {
  getFamilies, toDefaultAliases, listCuratedRoutes
} = require('../src/utils/curated-models');

describe('curated-models v2 (families)', () => {
  test('getFamilies returns the five wizard families with required fields', () => {
    const fams = getFamilies();
    // Order is load-bearing: it is the wizard's display order.
    expect(fams.map(f => f.alias)).toEqual(['gemini', 'gemini-pro', 'gpt', 'opus', 'deepseek']);
    for (const f of fams) {
      expect(typeof f.label).toBe('string');
      expect(typeof f.blurb).toBe('string');
      expect(typeof f.vendorPath).toBe('string');
      expect(f.idPattern instanceof RegExp).toBe(true);
      expect(Array.isArray(f.directProviders)).toBe(true);
      expect(typeof f.fallback.openrouter).toBe('string');
    }
  });

  test('getFamilies returns fresh copies (no shared mutable state)', () => {
    const a = getFamilies();
    a[0].fallback.openrouter = 'mutated';
    expect(getFamilies()[0].fallback.openrouter).not.toBe('mutated');
  });

  test('toDefaultAliases stays static and covers families + cardless', () => {
    const defaults = toDefaultAliases();
    expect(defaults.gemini).toBe('openrouter/google/gemini-3.5-flash');
    expect(defaults.opus).toBe('openrouter/anthropic/claude-opus-4.8');
    expect(defaults.deepseek).toBe('openrouter/deepseek/deepseek-v4-pro');
    expect(defaults.qwen).toBe('openrouter/qwen/qwen3.7-max');
    expect(defaults.kimi).toBe('openrouter/moonshotai/kimi-k2.6');
  });

  test('listCuratedRoutes flattens family fallbacks and cardless routes', () => {
    const routes = listCuratedRoutes();
    expect(routes).toContainEqual(
      { alias: 'deepseek', provider: 'deepseek', model: 'deepseek/deepseek-v4-pro' });
    expect(routes).toContainEqual(
      { alias: 'gemini', provider: 'openrouter', model: 'openrouter/google/gemini-3.5-flash' });
  });

  test('family openrouter fallbacks match their own idPattern (self-consistency)', () => {
    for (const f of getFamilies()) {
      const or = f.fallback.openrouter;
      const ns = `openrouter/${f.vendorPath}/`;
      expect(or.startsWith(ns)).toBe(true);
      // Direct fallbacks may be intentionally different from the openrouter pin;
      // only the openrouter pin must be a member of its own family.
      expect(f.idPattern.test(or.slice(ns.length))).toBe(true);
    }
  });

  test('config.getDefaultAliases() derives from this module (anti-drift)', () => {
    const { getDefaultAliases } = require('../src/utils/config');
    expect(getDefaultAliases()).toEqual(toDefaultAliases());
  });

  test('readline quick-picks derive from getFamilies (anti-drift)', () => {
    // resolveQuickPicks(catalog) drives the readline Step 2 picker;
    // family aliases must appear in the same order as getFamilies().
    const { resolveQuickPicks } = require('../src/utils/quick-picks');
    const picks = resolveQuickPicks([]);
    expect(picks.map(p => p.alias)).toEqual(getFamilies().map(f => f.alias));
    for (const p of picks) {
      expect(typeof p.label).toBe('string');
      expect(typeof p.blurb).toBe('string');
    }
  });
});

// tests/council-presets.test.js
'use strict';

const {
  BUDGET_ALIASES,
  FRONTIER_ALIASES,
  resolveBuiltinCouncil,
  listBuiltinCouncilNames,
} = require('../src/utils/council-presets');
const { toDefaultAliases } = require('../src/utils/curated-models');
const { PINNED_FREE_MODELS } = require('../src/utils/free-models');

describe('council-presets', () => {
  test('listBuiltinCouncilNames returns free, budget, frontier', () => {
    expect(listBuiltinCouncilNames()).toEqual(['free', 'budget', 'frontier']);
  });

  test('BUDGET_ALIASES and FRONTIER_ALIASES each have >=2 members, all present in DEFAULT_ALIASES', () => {
    const defaults = toDefaultAliases();
    expect(BUDGET_ALIASES.length).toBeGreaterThanOrEqual(2);
    expect(FRONTIER_ALIASES.length).toBeGreaterThanOrEqual(2);
    for (const alias of [...BUDGET_ALIASES, ...FRONTIER_ALIASES]) {
      expect(defaults[alias]).toBeDefined();
    }
  });

  test('budget and frontier aliases are distinct vendor families (no repeated vendor)', () => {
    const defaults = toDefaultAliases();
    const vendorOf = alias => defaults[alias].split('/')[1];
    const budgetVendors = BUDGET_ALIASES.map(vendorOf);
    const frontierVendors = FRONTIER_ALIASES.map(vendorOf);
    expect(new Set(budgetVendors).size).toBe(budgetVendors.length);
    expect(new Set(frontierVendors).size).toBe(frontierVendors.length);
  });

  test('budget and frontier are disjoint alias sets', () => {
    const overlap = BUDGET_ALIASES.filter(a => FRONTIER_ALIASES.includes(a));
    expect(overlap).toEqual([]);
  });

  test('resolveBuiltinCouncil returns null for a non-built-in name', () => {
    expect(resolveBuiltinCouncil('ghost', [])).toBeNull();
    expect(resolveBuiltinCouncil('my-custom-council', [])).toBeNull();
  });

  test('resolveBuiltinCouncil("budget") returns the static budget aliases', () => {
    expect(resolveBuiltinCouncil('budget', [])).toEqual(BUDGET_ALIASES);
  });

  test('resolveBuiltinCouncil("frontier") returns the static frontier aliases', () => {
    expect(resolveBuiltinCouncil('frontier', [])).toEqual(FRONTIER_ALIASES);
  });

  test('resolveBuiltinCouncil("free") uses suggestFreeCouncil ids when the catalog has :free rows', () => {
    const catalog = [
      { id: 'openrouter/deepseek/deepseek-r1:free' },
      { id: 'openrouter/google/gemini-2.0-flash-exp:free' },
      { id: 'openrouter/qwen/qwen3-coder:free' },
    ];
    const members = resolveBuiltinCouncil('free', catalog);
    expect(members).toEqual([
      'openrouter/deepseek/deepseek-r1:free',
      'openrouter/google/gemini-2.0-flash-exp:free',
      'openrouter/qwen/qwen3-coder:free',
    ]);
  });

  test('resolveBuiltinCouncil("free") falls back to PINNED_FREE_MODELS when the catalog has no free rows', () => {
    expect(resolveBuiltinCouncil('free', [])).toEqual(PINNED_FREE_MODELS);
    expect(resolveBuiltinCouncil('free', [{ id: 'openrouter/x/y' }])).toEqual(PINNED_FREE_MODELS);
  });

  test('resolveBuiltinCouncil("free") defaults catalog to [] when omitted', () => {
    expect(resolveBuiltinCouncil('free')).toEqual(PINNED_FREE_MODELS);
  });
});

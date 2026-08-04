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
    // Direct-capable vendors (Task 8.1a) resolve to the BARE canonical id so
    // the gateway router can route direct-first; gateway-only vendors keep
    // their openrouter/ prefix since OpenRouter is their only route.
    expect(defaults.gemini).toBe('google/gemini-3.6-flash');
    expect(defaults.opus).toBe('anthropic/claude-opus-4-8');
    expect(defaults.deepseek).toBe('deepseek/deepseek-v4-pro');
    expect(defaults.qwen).toBe('openrouter/qwen/qwen3.7-max');
    expect(defaults.kimi).toBe('openrouter/moonshotai/kimi-k2.6');
  });

  test('toDefaultAliases: direct-capable vendors resolve to their AUTHORED direct form, gateway-only vendors keep openrouter/', () => {
    const defaults = toDefaultAliases();
    // Direct-capable (openai/google/deepseek) — bare, policy-routed. These
    // vendors use identical ids on both gateways, so the bare form is derived.
    expect(defaults.gpt).toBe('openai/gpt-5.6-terra');
    expect(defaults['gpt-pro']).toBe('openai/gpt-5.5-pro');
    expect(defaults.codex).toBe('openai/gpt-5.3-codex');
    expect(defaults.gemini).toBe('google/gemini-3.6-flash');
    expect(defaults['gemini-pro']).toBe('google/gemini-3.1-pro-preview');
    expect(defaults.deepseek).toBe('deepseek/deepseek-v4-pro');
    // Anthropic is a DIVERGENT vendor: its direct-API ids differ from
    // OpenRouter's, so the pinned default is the authored `anthropic:` route
    // verbatim (dash form) — never the openrouter route with the prefix
    // stripped, which would emit ids the direct API rejects.
    expect(defaults.claude).toBe('anthropic/claude-sonnet-5');
    expect(defaults.sonnet).toBe('anthropic/claude-sonnet-5');
    expect(defaults.haiku).toBe('anthropic/claude-haiku-4-5-20251001');
    expect(defaults.opus).toBe('anthropic/claude-opus-4-8');
    // fable is divergent AND has no authored `anthropic:` route (OpenRouter-only
    // today), so it keeps its OpenRouter route rather than inventing a direct id.
    expect(defaults.fable).toBe('openrouter/anthropic/claude-fable-5');
    // Gateway-only vendors (no direct integration) — unchanged openrouter/ route.
    expect(defaults.grok).toBe('openrouter/x-ai/grok-4.3');
    expect(defaults.qwen).toBe('openrouter/qwen/qwen3.7-max');
    expect(defaults['qwen-coder']).toBe('openrouter/qwen/qwen3-coder-next');
    expect(defaults['qwen-flash']).toBe('openrouter/qwen/qwen3.6-flash');
    expect(defaults.glm).toBe('openrouter/z-ai/glm-5.1');
    expect(defaults.mistral).toBe('openrouter/mistralai/mistral-medium-3-5');
    expect(defaults.devstral).toBe('openrouter/mistralai/devstral-2512');
    expect(defaults.minimax).toBe('openrouter/minimax/minimax-m2.7');
    expect(defaults.kimi).toBe('openrouter/moonshotai/kimi-k2.6');
    expect(defaults.seed).toBe('openrouter/bytedance-seed/seed-2.0-lite');
  });

  test('listCuratedRoutes flattens family fallbacks and cardless routes', () => {
    const routes = listCuratedRoutes();
    expect(routes).toContainEqual(
      { alias: 'deepseek', provider: 'deepseek', model: 'deepseek/deepseek-v4-pro' });
    expect(routes).toContainEqual(
      { alias: 'gemini', provider: 'openrouter', model: 'openrouter/google/gemini-3.6-flash' });
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

// Owner-reported: OpenAI renamed the 5.6 flagship into tier variants — sol
// (premium), terra (mid), luna (economy) — each with a -pro sibling, plus the
// unrelated gpt-5.3-codex family. Owner ruling: `gpt` tracks the TERRA tier.
describe('gpt family idPattern — terra tier (5.6 rename)', () => {
  const gptFamily = () => getFamilies().find(f => f.alias === 'gpt');

  test('matches the terra id and still matches bare numeric ids (within-family fallback)', () => {
    const { idPattern } = gptFamily();
    expect(idPattern.test('gpt-5.6-terra')).toBe(true);
    expect(idPattern.test('gpt-5.5')).toBe(true);
  });

  test('never matches -terra-pro, -sol, -luna, or the separate -codex family', () => {
    const { idPattern } = gptFamily();
    expect(idPattern.test('gpt-5.6-terra-pro')).toBe(false);
    expect(idPattern.test('gpt-5.6-sol')).toBe(false);
    expect(idPattern.test('gpt-5.6-luna')).toBe(false);
    expect(idPattern.test('gpt-5.3-codex')).toBe(false);
  });

  test('fallback pins the terra tier', () => {
    expect(gptFamily().fallback.openrouter).toBe('openrouter/openai/gpt-5.6-terra');
  });
});

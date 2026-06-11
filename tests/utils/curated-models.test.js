/**
 * Curated Models Tests — the anti-drift property.
 * All three consumer lists (config DEFAULT_ALIASES, wizard cards, readline
 * choices) must derive from this one module.
 */
const {
  getCuratedModels, toDefaultAliases, listCuratedRoutes
} = require('../../src/utils/curated-models');

// Pinned expectation: the exact alias map shipped before F5 (config.js@80f060d).
// If a model is deliberately re-pointed, update HERE and only here.
const EXPECTED_ALIASES = {
  'gemini': 'openrouter/google/gemini-3.1-flash-lite-preview',
  'gemini-pro': 'openrouter/google/gemini-3.1-pro-preview',
  'gpt': 'openrouter/openai/gpt-5.4',
  'gpt-pro': 'openrouter/openai/gpt-5.4-pro',
  'codex': 'openrouter/openai/gpt-5.3-codex',
  'claude': 'openrouter/anthropic/claude-sonnet-4.6',
  'sonnet': 'openrouter/anthropic/claude-sonnet-4.6',
  'opus': 'openrouter/anthropic/claude-opus-4.6',
  'haiku': 'openrouter/anthropic/claude-haiku-4.5',
  'deepseek': 'openrouter/deepseek/deepseek-v3.2',
  'qwen': 'openrouter/qwen/qwen3.5-397b-a17b',
  'qwen-coder': 'openrouter/qwen/qwen3-coder-next',
  'qwen-flash': 'openrouter/qwen/qwen3.5-flash-02-23',
  'mistral': 'openrouter/mistralai/mistral-large-2512',
  'devstral': 'openrouter/mistralai/devstral-2512',
  'glm': 'openrouter/z-ai/glm-5',
  'minimax': 'openrouter/minimax/minimax-m2.5',
  'grok': 'openrouter/x-ai/grok-4.3',
  'kimi': 'openrouter/moonshotai/kimi-k2.5',
  'seed': 'openrouter/bytedance-seed/seed-2.0-mini',
};

describe('curated-models', () => {
  it('toDefaultAliases reproduces the shipped alias map exactly', () => {
    expect(toDefaultAliases()).toEqual(EXPECTED_ALIASES);
  });

  it('getCuratedModels returns only card entries, each with label, blurb and routes', () => {
    const cards = getCuratedModels();
    expect(cards.map(c => c.alias)).toEqual(['gemini', 'gemini-pro', 'gpt', 'opus', 'deepseek']);
    for (const c of cards) {
      expect(typeof c.label).toBe('string');
      expect(typeof c.blurb).toBe('string');
      expect(c.routes.openrouter).toBe(EXPECTED_ALIASES[c.alias]);
    }
  });

  it('every card route id carries its provider prefix', () => {
    for (const c of getCuratedModels()) {
      for (const [provider, id] of Object.entries(c.routes)) {
        const expectedPrefix = `${provider}/`;
        expect(id.startsWith(expectedPrefix)).toBe(true);
      }
    }
  });

  it('listCuratedRoutes flattens every route of every entry (cards + cardless)', () => {
    const routes = listCuratedRoutes();
    // 10 card routes (5 dual-route cards) + 15 cardless = 25; a
    // derivation that drops the direct routes must fail here (Task 4 depends on them).
    expect(routes).toHaveLength(25);
    expect(routes).toContainEqual(
      { alias: 'opus', provider: 'anthropic', model: 'anthropic/claude-opus-4-6' }
    );
    const aliases = new Set(routes.map(r => r.alias));
    expect(aliases.size).toBe(20);
    expect(routes).toContainEqual(
      { alias: 'grok', provider: 'openrouter', model: 'openrouter/x-ai/grok-4.3' }
    );
    for (const r of routes) {
      expect(typeof r.provider).toBe('string');
      expect(typeof r.model).toBe('string');
    }
  });

  it('config.getDefaultAliases() derives from this module (anti-drift)', () => {
    const { getDefaultAliases } = require('../../src/utils/config');
    expect(getDefaultAliases()).toEqual(toDefaultAliases());
  });

  it('wizard MODEL_CHOICES derive from this module (anti-drift)', () => {
    const { MODEL_CHOICES } = require('../../electron/setup-ui-model');
    expect(MODEL_CHOICES.map(m => m.alias)).toEqual(getCuratedModels().map(c => c.alias));
    for (const mc of MODEL_CHOICES) {
      const curated = getCuratedModels().find(c => c.alias === mc.alias);
      expect(mc.routes).toEqual(curated.routes);
      expect(mc.label).toBe(`${curated.label} — ${curated.blurb}`);
    }
  });

  it('readline MODEL_CHOICES derive from this module (anti-drift)', () => {
    const { MODEL_CHOICES } = require('../../src/sidecar/setup');
    expect(MODEL_CHOICES.map(m => m.alias)).toEqual(getCuratedModels().map(c => c.alias));
    MODEL_CHOICES.forEach((mc, i) => {
      expect(mc.number).toBe(i + 1);
      const curated = getCuratedModels()[i];
      expect(mc.label).toBe(`${curated.label} (${curated.blurb})`);
    });
  });
});

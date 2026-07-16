// tests/model-tiers.test.js
'use strict';

const { TIERS, resolveTier } = require('../src/utils/model-tiers');
const { toDefaultAliases } = require('../src/utils/curated-models');

const row = id => ({ id, name: id, contextLength: 1, pricing: { prompt: '0' } });

describe('TIERS table', () => {
  test('every direct-capable vendor defines economy/balanced/frontier regexes', () => {
    for (const vendor of ['anthropic', 'openai', 'google', 'deepseek']) {
      expect(TIERS[vendor].economy).toBeInstanceOf(RegExp);
      expect(TIERS[vendor].balanced).toBeInstanceOf(RegExp);
      expect(TIERS[vendor].frontier).toBeInstanceOf(RegExp);
    }
  });

  test('anthropic regexes match haiku/sonnet/opus segments only', () => {
    expect(TIERS.anthropic.economy.test('claude-haiku-4-5')).toBe(true);
    expect(TIERS.anthropic.economy.test('claude-sonnet-5')).toBe(false);
    expect(TIERS.anthropic.balanced.test('claude-sonnet-5')).toBe(true);
    expect(TIERS.anthropic.frontier.test('claude-opus-4-8')).toBe(true);
    expect(TIERS.anthropic.frontier.test('claude-sonnet-5')).toBe(false);
  });

  test('openai regexes distinguish base vs -mini vs -pro', () => {
    expect(TIERS.openai.economy.test('gpt-5.5-mini')).toBe(true);
    expect(TIERS.openai.economy.test('gpt-5.5')).toBe(false);
    expect(TIERS.openai.balanced.test('gpt-5.5')).toBe(true);
    expect(TIERS.openai.balanced.test('gpt-5.5-mini')).toBe(false);
    expect(TIERS.openai.balanced.test('gpt-5.5-pro')).toBe(false);
    expect(TIERS.openai.frontier.test('gpt-5.5-pro')).toBe(true);
  });

  test('deepseek economy and balanced share the base pattern; frontier requires -pro', () => {
    expect(TIERS.deepseek.economy.test('deepseek-v4')).toBe(true);
    expect(TIERS.deepseek.balanced.test('deepseek-v4')).toBe(true);
    expect(TIERS.deepseek.frontier.test('deepseek-v4')).toBe(false);
    expect(TIERS.deepseek.frontier.test('deepseek-v4-pro')).toBe(true);
  });

  test('google balanced excludes -flash-lite (anchored so it does not cross-match economy)', () => {
    expect(TIERS.google.balanced.test('gemini-3.5-flash')).toBe(true);
    expect(TIERS.google.balanced.test('gemini-3.5-flash-preview')).toBe(true);
    expect(TIERS.google.balanced.test('gemini-3.5-flash-latest')).toBe(true);
    expect(TIERS.google.balanced.test('gemini-3.5-flash-lite')).toBe(false);
    expect(TIERS.google.economy.test('gemini-3.5-flash-lite')).toBe(true);
  });
});

describe('resolveTier — anthropic (direct + OpenRouter twins)', () => {
  const catalog = [
    row('anthropic/claude-haiku-4-5'),
    row('openrouter/anthropic/claude-haiku-4-5'),
    row('anthropic/claude-sonnet-5'),
    row('openrouter/anthropic/claude-sonnet-5'),
    row('anthropic/claude-opus-4-8'),
    row('openrouter/anthropic/claude-opus-4-8'),
  ];

  test('economy resolves to the DIRECT haiku id, not its OpenRouter twin', () => {
    expect(resolveTier('anthropic', 'economy', catalog)).toBe('anthropic/claude-haiku-4-5');
  });
  test('balanced resolves to the direct sonnet id', () => {
    expect(resolveTier('anthropic', 'balanced', catalog)).toBe('anthropic/claude-sonnet-5');
  });
  test('frontier resolves to the direct opus id', () => {
    expect(resolveTier('anthropic', 'frontier', catalog)).toBe('anthropic/claude-opus-4-8');
  });
  test('picks the newest version when multiple generations are present', () => {
    const multi = [
      row('anthropic/claude-haiku-3-0'),
      row('openrouter/anthropic/claude-haiku-3-0'),
      ...catalog,
    ];
    expect(resolveTier('anthropic', 'economy', multi)).toBe('anthropic/claude-haiku-4-5');
  });
  test('falls back to the OpenRouter id when no direct-namespace row exists', () => {
    const orOnly = [row('openrouter/anthropic/claude-sonnet-5')];
    expect(resolveTier('anthropic', 'balanced', orOnly)).toBe('openrouter/anthropic/claude-sonnet-5');
  });
});

describe('resolveTier — openai (base vs -mini vs -pro)', () => {
  const catalog = [row('openai/gpt-5.5'), row('openai/gpt-5.5-mini'), row('openai/gpt-5.5-pro')];

  test('economy -> -mini', () => {
    expect(resolveTier('openai', 'economy', catalog)).toBe('openai/gpt-5.5-mini');
  });
  test('balanced -> base (anchored regex excludes -mini/-pro)', () => {
    expect(resolveTier('openai', 'balanced', catalog)).toBe('openai/gpt-5.5');
  });
  test('frontier -> -pro', () => {
    expect(resolveTier('openai', 'frontier', catalog)).toBe('openai/gpt-5.5-pro');
  });
});

describe('resolveTier — google (balanced vs economy do not collapse when both exist)', () => {
  const catalog = [
    row('google/gemini-3.5-flash'),
    row('openrouter/google/gemini-3.5-flash'),
    row('google/gemini-3.5-flash-lite'),
    row('openrouter/google/gemini-3.5-flash-lite'),
  ];

  test('balanced resolves to the plain -flash id, not -flash-lite', () => {
    expect(resolveTier('google', 'balanced', catalog)).toBe('google/gemini-3.5-flash');
  });
  test('economy resolves to the -flash-lite id', () => {
    expect(resolveTier('google', 'economy', catalog)).toBe('google/gemini-3.5-flash-lite');
  });
  test('balanced and economy resolve to different ids', () => {
    expect(resolveTier('google', 'balanced', catalog)).not.toBe(resolveTier('google', 'economy', catalog));
  });
});

describe('resolveTier — nearest-tier fallback when a tier has no match', () => {
  test('deepseek economy falls back to frontier when only -pro is in the catalog', () => {
    const catalog = [row('deepseek/deepseek-v4-pro'), row('openrouter/deepseek/deepseek-v4-pro')];
    expect(resolveTier('deepseek', 'economy', catalog)).toBe('deepseek/deepseek-v4-pro');
  });
  test('google frontier falls back to balanced when no -pro model is in the catalog', () => {
    const catalog = [row('google/gemini-3.5-flash'), row('openrouter/google/gemini-3.5-flash')];
    expect(resolveTier('google', 'frontier', catalog)).toBe('google/gemini-3.5-flash');
  });
});

describe('resolveTier — vendor unknown or absent from the catalog', () => {
  test('unknown vendor returns null even if matching rows happen to be present', () => {
    expect(resolveTier('not-a-real-vendor', 'balanced', [row('not-a-real-vendor/model-1')])).toBeNull();
  });
  test('known vendor with zero rows in the catalog returns null (no fallback possible)', () => {
    expect(resolveTier('anthropic', 'balanced', [])).toBeNull();
    expect(resolveTier('deepseek', 'economy', [row('openai/gpt-5.5')])).toBeNull();
  });
  test('degenerate vendor input returns null instead of throwing', () => {
    expect(resolveTier(undefined, 'balanced', [])).toBeNull();
    expect(resolveTier('', 'balanced', [])).toBeNull();
  });
});

describe('resolveTier — gateway-only vendors delegate to the curated flagship', () => {
  test('x-ai (grok) resolves to the curated flagship for every tier, ignoring the catalog', () => {
    const flagship = toDefaultAliases().grok;
    const catalog = [row('openrouter/x-ai/grok-9.9')]; // present, but NOT the pinned flagship
    expect(resolveTier('x-ai', 'economy', catalog)).toBe(flagship);
    expect(resolveTier('x-ai', 'balanced', catalog)).toBe(flagship);
    expect(resolveTier('x-ai', 'frontier', catalog)).toBe(flagship);
    expect(resolveTier('x-ai', 'economy', [])).toBe(flagship);
  });
  test('qwen resolves to its curated flagship, deduped across qwen/qwen-coder/qwen-flash aliases', () => {
    expect(resolveTier('qwen', 'balanced', [])).toBe(toDefaultAliases().qwen);
  });
  test('other gateway-only vendors (z-ai, mistralai, minimax, moonshotai, bytedance-seed) resolve too', () => {
    expect(resolveTier('z-ai', 'economy', [])).toBe(toDefaultAliases().glm);
    expect(resolveTier('mistralai', 'frontier', [])).toBe(toDefaultAliases().mistral);
    expect(resolveTier('minimax', 'balanced', [])).toBe(toDefaultAliases().minimax);
    expect(resolveTier('moonshotai', 'economy', [])).toBe(toDefaultAliases().kimi);
    expect(resolveTier('bytedance-seed', 'frontier', [])).toBe(toDefaultAliases().seed);
  });
  test('an invalid tier still returns null for a gateway-only vendor (validation is not skipped)', () => {
    expect(resolveTier('x-ai', 'not-a-tier', [])).toBeNull();
  });
});

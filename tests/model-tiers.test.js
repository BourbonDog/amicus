// tests/model-tiers.test.js
'use strict';

const { TIERS, resolveTier } = require('../src/utils/model-tiers');
const { toDefaultAliases } = require('../src/utils/curated-models');

const row = id => ({ id, name: id, contextLength: 1, pricing: { prompt: '0' } });

// A tier's value is a regex OR an ordered regex list (first match wins).
const matchesAny = (patterns, id) => [].concat(patterns).some(r => r.test(id));

describe('TIERS table', () => {
  test('every direct-capable vendor defines economy/balanced/frontier patterns (regex or ordered list)', () => {
    for (const vendor of ['anthropic', 'openai', 'google', 'deepseek']) {
      for (const tier of ['economy', 'balanced', 'frontier']) {
        const patterns = [].concat(TIERS[vendor][tier]);
        expect(patterns.length).toBeGreaterThan(0);
        for (const p of patterns) { expect(p).toBeInstanceOf(RegExp); }
      }
    }
  });

  test('anthropic regexes match haiku/sonnet/opus segments only', () => {
    expect(TIERS.anthropic.economy.test('claude-haiku-4-5')).toBe(true);
    expect(TIERS.anthropic.economy.test('claude-sonnet-5')).toBe(false);
    expect(TIERS.anthropic.balanced.test('claude-sonnet-5')).toBe(true);
    expect(TIERS.anthropic.frontier.test('claude-opus-4-8')).toBe(true);
    expect(TIERS.anthropic.frontier.test('claude-sonnet-5')).toBe(false);
  });

  // Owner ruling 2026-08-04: OpenAI's 5.6 line ships named tiers only — luna
  // ($0.10/$0.60 per Mtok in/out), terra ($1/$6), sol ($5/$30), each with a
  // -pro sibling priced at its base tier. economy→luna, balanced→terra,
  // frontier→sol; each tier accepts its -pro sibling and then the 5.5-era
  // naming as ordered fallbacks so neither sunset silently kills resolution.
  test('openai economy matches luna, its -pro sibling, and legacy -mini only', () => {
    expect(matchesAny(TIERS.openai.economy, 'gpt-5.6-luna')).toBe(true);
    expect(matchesAny(TIERS.openai.economy, 'gpt-5.6-luna-pro')).toBe(true);
    expect(matchesAny(TIERS.openai.economy, 'gpt-5.4-mini')).toBe(true);
    expect(matchesAny(TIERS.openai.economy, 'gpt-5.5')).toBe(false);
    expect(matchesAny(TIERS.openai.economy, 'gpt-5.6-terra')).toBe(false);
  });

  test('openai balanced matches terra, bare flagship ids, and terra-pro; never sol/-mini/-pro/codex', () => {
    expect(matchesAny(TIERS.openai.balanced, 'gpt-5.6-terra')).toBe(true);
    expect(matchesAny(TIERS.openai.balanced, 'gpt-5.5')).toBe(true);
    expect(matchesAny(TIERS.openai.balanced, 'gpt-5.6-terra-pro')).toBe(true);
    expect(matchesAny(TIERS.openai.balanced, 'gpt-5.6-sol')).toBe(false);
    expect(matchesAny(TIERS.openai.balanced, 'gpt-5.4-mini')).toBe(false);
    expect(matchesAny(TIERS.openai.balanced, 'gpt-5.5-pro')).toBe(false);
    expect(matchesAny(TIERS.openai.balanced, 'gpt-5.3-codex')).toBe(false);
  });

  test('openai frontier matches sol, sol-pro, and the legacy numeric -pro only', () => {
    expect(matchesAny(TIERS.openai.frontier, 'gpt-5.6-sol')).toBe(true);
    expect(matchesAny(TIERS.openai.frontier, 'gpt-5.6-sol-pro')).toBe(true);
    expect(matchesAny(TIERS.openai.frontier, 'gpt-5.5-pro')).toBe(true);
    expect(matchesAny(TIERS.openai.frontier, 'gpt-5.6-terra')).toBe(false);
    expect(matchesAny(TIERS.openai.frontier, 'gpt-5.5')).toBe(false);
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

describe('resolveTier — openai (5.6 named tiers: luna/terra/sol)', () => {
  // Mirrors the live catalog 2026-08-04: the full 5.6 tier set plus the
  // still-served 5.5 line and the last -mini generation.
  const catalog = [
    row('openai/gpt-5.5'), row('openai/gpt-5.5-pro'), row('openai/gpt-5.4-mini'),
    row('openai/gpt-5.6-luna'), row('openai/gpt-5.6-luna-pro'),
    row('openai/gpt-5.6-terra'), row('openai/gpt-5.6-terra-pro'),
    row('openai/gpt-5.6-sol'), row('openai/gpt-5.6-sol-pro'),
  ];

  test('economy -> luna, not the legacy -mini and not the -pro sibling', () => {
    expect(resolveTier('openai', 'economy', catalog)).toBe('openai/gpt-5.6-luna');
  });
  test('balanced -> terra base, preferred over its same-price -pro sibling despite id sort order', () => {
    expect(resolveTier('openai', 'balanced', catalog)).toBe('openai/gpt-5.6-terra');
  });
  test('frontier -> sol, not the legacy gpt-5.5-pro premium', () => {
    expect(resolveTier('openai', 'frontier', catalog)).toBe('openai/gpt-5.6-sol');
  });
  test('base tier delisted -> the -pro sibling steps in ahead of legacy naming', () => {
    const proOnly = [
      row('openai/gpt-5.4-mini'), row('openai/gpt-5.6-luna-pro'), row('openai/gpt-5.6-sol-pro'),
    ];
    expect(resolveTier('openai', 'economy', proOnly)).toBe('openai/gpt-5.6-luna-pro');
    expect(resolveTier('openai', 'frontier', proOnly)).toBe('openai/gpt-5.6-sol-pro');
  });
  test('balanced keeps the family bare-id fallback ahead of terra-pro (same pattern as the gpt family)', () => {
    const noTerra = [row('openai/gpt-5.5'), row('openai/gpt-5.6-terra-pro')];
    expect(resolveTier('openai', 'balanced', noTerra)).toBe('openai/gpt-5.5');
  });
  test('stale pre-5.6 catalog still resolves every tier via the legacy patterns', () => {
    const legacy = [row('openai/gpt-5.5'), row('openai/gpt-5.5-pro'), row('openai/gpt-5.4-mini')];
    expect(resolveTier('openai', 'economy', legacy)).toBe('openai/gpt-5.4-mini');
    expect(resolveTier('openai', 'balanced', legacy)).toBe('openai/gpt-5.5');
    expect(resolveTier('openai', 'frontier', legacy)).toBe('openai/gpt-5.5-pro');
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

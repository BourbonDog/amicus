const reg = require('../src/utils/provider-registry');

describe('provider-registry', () => {
  test('PROVIDERS covers exactly the five known providers', () => {
    expect(reg.PROVIDERS.map(p => p.id).sort())
      .toEqual(['anthropic', 'deepseek', 'google', 'openai', 'openrouter']);
  });

  test('openrouter is the gateway, not a direct provider', () => {
    expect(reg.getProvider('openrouter').gateway).toBe(true);
    expect(reg.getProvider('openrouter').direct).toBe(false);
    expect(reg.isDirectProvider('openrouter')).toBe(false);
    expect(reg.listDirectProviders().sort())
      .toEqual(['anthropic', 'deepseek', 'google', 'openai']);
  });

  test('derived PROVIDER_ENV_MAP matches the historical literal exactly', () => {
    expect(reg.PROVIDER_ENV_MAP).toEqual({
      openrouter: 'OPENROUTER_API_KEY',
      google: 'GOOGLE_GENERATIVE_AI_API_KEY',
      openai: 'OPENAI_API_KEY',
      anthropic: 'ANTHROPIC_API_KEY',
      deepseek: 'DEEPSEEK_API_KEY',
    });
  });

  test('derived PROVIDER_KEY_MAP preserves the distinct key display names', () => {
    expect(reg.PROVIDER_KEY_MAP.google).toEqual({ key: 'GOOGLE_GENERATIVE_AI_API_KEY', name: 'Google Gemini' });
    expect(reg.PROVIDER_KEY_MAP.openrouter).toEqual({ key: 'OPENROUTER_API_KEY', name: 'OpenRouter' });
  });

  test('derived PROVIDER_FAMILY_NAMES preserves grouping names (Google, not Google Gemini)', () => {
    expect(reg.PROVIDER_FAMILY_NAMES).toEqual({
      openrouter: 'OpenRouter', google: 'Google', openai: 'OpenAI',
      anthropic: 'Anthropic', deepseek: 'DeepSeek',
    });
  });

  test('KNOWN_PROVIDERS is the id list', () => {
    expect(reg.KNOWN_PROVIDERS.sort())
      .toEqual(['anthropic', 'deepseek', 'google', 'openai', 'openrouter']);
  });
});

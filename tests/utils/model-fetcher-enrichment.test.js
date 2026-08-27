/**
 * F5: OpenRouter fetch works keyless (public endpoint) and normalizers
 * return enriched rows {id, name, contextLength, pricing}.
 */
const {
  PROVIDER_FETCH_CONFIG, ANTHROPIC_MODELS
} = require('../../src/utils/model-fetcher');

describe('keyless OpenRouter', () => {
  it('openrouter authHeader omits Authorization when no key is given', () => {
    expect(PROVIDER_FETCH_CONFIG.openrouter.authHeader('')).toEqual({});
    expect(PROVIDER_FETCH_CONFIG.openrouter.authHeader(null)).toEqual({});
  });

  it('openrouter authHeader includes bearer when a key is given', () => {
    expect(PROVIDER_FETCH_CONFIG.openrouter.authHeader('sk-x'))
      .toEqual({ 'Authorization': 'Bearer sk-x' });
  });

  it('providersToFetch always includes openrouter even with no keys', () => {
    const { providersToFetch } = require('../../src/utils/model-fetcher');
    expect(providersToFetch({}).sort()).toEqual(['anthropic', 'openrouter']);
    expect(providersToFetch({ google: 'g-key' }).sort())
      .toEqual(['anthropic', 'google', 'openrouter']);
  });
});

describe('enriched normalizers', () => {
  it('openrouter normalize maps context_length and pricing, nulls when absent', () => {
    const body = JSON.stringify({ data: [
      { id: 'x-ai/grok-4.3', name: 'Grok 4.3', context_length: 256000,
        pricing: { prompt: '0.000003', completion: '0.000015' } },
      { id: 'tiny/no-meta' }
    ] });
    const rows = PROVIDER_FETCH_CONFIG.openrouter.normalize(body);
    expect(rows[0]).toEqual({
      id: 'openrouter/x-ai/grok-4.3', name: 'Grok 4.3', contextLength: 256000,
      pricing: { prompt: '0.000003', completion: '0.000015' },
      maxOutputTokens: null   // #218: absent top_provider -> null, never a guess
    });
    expect(rows[1]).toEqual({
      id: 'openrouter/tiny/no-meta', name: 'tiny/no-meta',
      contextLength: null, pricing: null, maxOutputTokens: null
    });
  });

  it('#218: openrouter normalize lifts top_provider.max_completion_tokens', () => {
    const body = JSON.stringify({ data: [
      { id: 'moonshotai/kimi-k3', name: 'Kimi K3', context_length: 1048576,
        top_provider: { context_length: 1048576, max_completion_tokens: 943718 } },
      // top_provider present but WITHOUT the field (6 of 417 live rows look
      // like this) -> null, so computeModelLimit refuses to emit a limit
      // rather than clamping against a guessed ceiling.
      { id: 'odd/no-ceiling', top_provider: { context_length: 8192 } }
    ] });
    const rows = PROVIDER_FETCH_CONFIG.openrouter.normalize(body);
    expect(rows[0].maxOutputTokens).toBe(943718);
    expect(rows[1].maxOutputTokens).toBeNull();
  });

  it('google normalize maps inputTokenLimit to contextLength, pricing null', () => {
    const body = JSON.stringify({ models: [
      { name: 'models/gemini-3.1-pro-preview', displayName: 'Gemini 3.1 Pro', inputTokenLimit: 2000000 }
    ] });
    const rows = PROVIDER_FETCH_CONFIG.google.normalize(body);
    expect(rows[0]).toEqual({
      id: 'google/gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro',
      contextLength: 2000000, pricing: null
    });
  });

  it('openai normalize and anthropic hardcoded rows carry null metadata', () => {
    const rows = PROVIDER_FETCH_CONFIG.openai.normalize(JSON.stringify({ data: [{ id: 'gpt-5.4' }] }));
    expect(rows[0]).toEqual({ id: 'openai/gpt-5.4', name: 'gpt-5.4', contextLength: null, pricing: null });
    for (const m of ANTHROPIC_MODELS) {
      expect(m.contextLength).toBeNull();
      expect(m.pricing).toBeNull();
    }
  });
});

const { resolveRoute } = require('../src/utils/gateway-router');
const { parseDescriptor } = require('../src/utils/model-descriptor');

const NO_KEYS = { openrouter: false, google: false, openai: false, anthropic: false, deepseek: false };
const cat = (ids) => ({ models: ids.map(id => ({ id })), lastRefreshError: null });
const EMPTY = { models: [], lastRefreshError: null };

function req(raw, over = {}) {
  const aliases = {};
  return {
    descriptor: parseDescriptor(raw, { aliases }),
    source: 'cli', gatewayMode: 'auto', allowSelection: false, validateModel: true,
    keys: { ...NO_KEYS }, catalogInfo: EMPTY, ...over,
  };
}

describe('resolveRoute — explicit intents', () => {
  test('openrouter/ literal + --gateway direct => conflict error', () => {
    const r = resolveRoute(req('openrouter/openai/gpt-5.5', { gatewayMode: 'direct', keys: { ...NO_KEYS, openrouter: true, openai: true } }));
    expect(r).toMatchObject({ kind: 'error', reason: 'gateway_conflict' });
  });

  test('openrouter/ literal with no OR key => no_openrouter_key', () => {
    const r = resolveRoute(req('openrouter/openai/gpt-5.5'));
    expect(r).toMatchObject({ kind: 'error', reason: 'no_openrouter_key' });
  });

  test('openrouter/ literal with OR key => resolved via openrouter (unknown catalog allowed)', () => {
    const r = resolveRoute(req('openrouter/openai/gpt-5.5', { keys: { ...NO_KEYS, openrouter: true } }));
    expect(r).toMatchObject({ kind: 'resolved', gateway: 'openrouter', executableId: 'openrouter/openai/gpt-5.5' });
  });
});

describe('resolveRoute — gateway-only vendors', () => {
  test('x-ai under --gateway direct => no_direct_integration', () => {
    const r = resolveRoute(req('x-ai/grok-4.3', { gatewayMode: 'direct', keys: { ...NO_KEYS, openrouter: true } }));
    expect(r).toMatchObject({ kind: 'error', reason: 'no_direct_integration' });
  });
  test('x-ai under auto with OR key => openrouter', () => {
    const r = resolveRoute(req('x-ai/grok-4.3', { keys: { ...NO_KEYS, openrouter: true } }));
    expect(r).toMatchObject({ kind: 'resolved', gateway: 'openrouter' });
  });
});

describe('resolveRoute — direct-first (auto)', () => {
  test('direct key present + model valid => direct', () => {
    const r = resolveRoute(req('openai/gpt-5.5', { keys: { ...NO_KEYS, openai: true }, catalogInfo: cat(['openai/gpt-5.5']) }));
    expect(r).toMatchObject({ kind: 'resolved', gateway: 'direct', executableId: 'openai/gpt-5.5' });
  });
  test('direct key present + catalog unknown => direct with unverified notice', () => {
    const r = resolveRoute(req('openai/gpt-5.5', { keys: { ...NO_KEYS, openai: true }, catalogInfo: EMPTY }));
    expect(r).toMatchObject({ kind: 'resolved', gateway: 'direct' });
    expect(r.notice).toMatch(/unverified|not.*validate/i);
  });
  test('no direct key, OR key present => openrouter fallback', () => {
    const r = resolveRoute(req('openai/gpt-5.5', { keys: { ...NO_KEYS, openrouter: true } }));
    expect(r).toMatchObject({ kind: 'resolved', gateway: 'openrouter' });
  });
  test('no keys at all => no_key_for_vendor', () => {
    const r = resolveRoute(req('openai/gpt-5.5'));
    expect(r).toMatchObject({ kind: 'error', reason: 'no_key_for_vendor' });
  });
  test('direct key present + model invalid + allowSelection => selection_required', () => {
    const r = resolveRoute(req('openai/gpt-9', { allowSelection: true, keys: { ...NO_KEYS, openai: true }, catalogInfo: cat(['openai/gpt-5.5']) }));
    expect(r).toMatchObject({ kind: 'selection_required' });
  });
  test('direct key present + model invalid + no selection => model_not_found', () => {
    const r = resolveRoute(req('openai/gpt-9', { keys: { ...NO_KEYS, openai: true }, catalogInfo: cat(['openai/gpt-5.5']) }));
    expect(r).toMatchObject({ kind: 'error', reason: 'model_not_found' });
  });
});

describe('resolveRoute — explicit modes', () => {
  test('--gateway openrouter with no OR key => no_openrouter_key', () => {
    const r = resolveRoute(req('openai/gpt-5.5', { gatewayMode: 'openrouter', keys: { ...NO_KEYS, openai: true } }));
    expect(r).toMatchObject({ kind: 'error', reason: 'no_openrouter_key' });
  });
  test('--gateway direct with no direct key => no_direct_key', () => {
    const r = resolveRoute(req('openai/gpt-5.5', { gatewayMode: 'direct', keys: { ...NO_KEYS, openrouter: true } }));
    expect(r).toMatchObject({ kind: 'error', reason: 'no_direct_key' });
  });
  test('validateModel:false skips the catalog check (invalid model still routes)', () => {
    const r = resolveRoute(req('openai/gpt-9', { validateModel: false, keys: { ...NO_KEYS, openai: true }, catalogInfo: cat(['openai/gpt-5.5']) }));
    expect(r).toMatchObject({ kind: 'resolved', gateway: 'direct' });
  });
});

describe('resolveRoute — per-gateway ids (req.gatewayIds, Task 2)', () => {
  const GW = { direct: 'anthropic/claude-opus-4-8', openrouter: 'openrouter/anthropic/claude-opus-4.8' };

  test('direct route emits the direct-native id (dashes), not the descriptor dots', () => {
    const r = resolveRoute(req('anthropic/claude-opus-4.8', {
      gatewayIds: GW, keys: { ...NO_KEYS, anthropic: true }, catalogInfo: cat(['anthropic/claude-opus-4-8']) }));
    expect(r).toMatchObject({ kind: 'resolved', gateway: 'direct', executableId: 'anthropic/claude-opus-4-8' });
  });

  test('OR fallback emits the OR-native id (dots)', () => {
    const r = resolveRoute(req('anthropic/claude-opus-4.8', {
      gatewayIds: GW, keys: { ...NO_KEYS, openrouter: true }, catalogInfo: cat(['openrouter/anthropic/claude-opus-4.8']) }));
    expect(r).toMatchObject({ kind: 'resolved', gateway: 'openrouter', executableId: 'openrouter/anthropic/claude-opus-4.8' });
  });

  test('auto + direct key but model NOT on direct (fable) falls back to OR', () => {
    const r = resolveRoute(req('anthropic/claude-fable-5', {
      gatewayIds: { openrouter: 'openrouter/anthropic/claude-fable-5' }, // no direct form
      keys: { ...NO_KEYS, anthropic: true, openrouter: true },
      catalogInfo: cat(['openrouter/anthropic/claude-fable-5']) }));
    expect(r).toMatchObject({ kind: 'resolved', gateway: 'openrouter', executableId: 'openrouter/anthropic/claude-fable-5' });
  });

  test('--gateway direct for a direct-unavailable model errors', () => {
    const r = resolveRoute(req('anthropic/claude-fable-5', { gatewayMode: 'direct',
      gatewayIds: { openrouter: 'openrouter/anthropic/claude-fable-5' }, keys: { ...NO_KEYS, anthropic: true } }));
    expect(r).toMatchObject({ kind: 'error', reason: 'direct_unavailable' });
  });

  test('--gateway openrouter for an openrouter-unavailable model errors', () => {
    const r = resolveRoute(req('anthropic/claude-opus-4.8', { gatewayMode: 'openrouter',
      gatewayIds: { direct: 'anthropic/claude-opus-4-8' }, keys: { ...NO_KEYS, openrouter: true } }));
    expect(r).toMatchObject({ kind: 'error', reason: 'openrouter_unavailable' });
  });

  test('no gatewayIds → unchanged behavior (executableFor construction)', () => {
    const r = resolveRoute(req('openai/gpt-5.5', { keys: { ...NO_KEYS, openai: true }, catalogInfo: cat(['openai/gpt-5.5']) }));
    expect(r).toMatchObject({ kind: 'resolved', gateway: 'direct', executableId: 'openai/gpt-5.5' });
  });
});

describe('resolveRoute — non-canonical descriptor inputs', () => {
  test('string canonical id resolves like the equivalent parsed descriptor', () => {
    const r = resolveRoute({
      descriptor: 'openai/gpt-5.5', source: 'cli', gatewayMode: 'auto', allowSelection: false,
      validateModel: true, keys: { ...NO_KEYS, openai: true }, catalogInfo: cat(['openai/gpt-5.5']),
    });
    expect(r).toMatchObject({ kind: 'resolved', gateway: 'direct', executableId: 'openai/gpt-5.5' });
  });

  test('string OpenRouter-literal id resolves via openrouter', () => {
    const r = resolveRoute({
      descriptor: 'openrouter/openai/gpt-5.5', source: 'cli', gatewayMode: 'auto', allowSelection: false,
      validateModel: true, keys: { ...NO_KEYS, openrouter: true }, catalogInfo: EMPTY,
    });
    expect(r).toMatchObject({ kind: 'resolved', gateway: 'openrouter' });
  });

  test('alias-kind descriptor is rejected as invalid_descriptor, not garbage-resolved', () => {
    const aliasDescriptor = parseDescriptor('gpt', { aliases: { gpt: 'openrouter/openai/gpt-5.5' } });
    const r = resolveRoute(req('placeholder', { descriptor: aliasDescriptor, keys: { ...NO_KEYS, openrouter: true, openai: true } }));
    expect(r).toMatchObject({ kind: 'error', reason: 'invalid_descriptor' });
    expect(r.kind).not.toBe('resolved');
    expect(r.executableId).toBeUndefined();
    expect(JSON.stringify(r)).not.toMatch(/undefined/);
  });

  test('null descriptor is rejected as invalid_descriptor without throwing', () => {
    let r;
    expect(() => { r = resolveRoute(req('placeholder', { descriptor: null })); }).not.toThrow();
    expect(r).toMatchObject({ kind: 'error', reason: 'invalid_descriptor' });
  });
});

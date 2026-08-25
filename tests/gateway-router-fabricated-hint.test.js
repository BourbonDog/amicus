/**
 * B2 (v4.9 W1, ruling V16): self-diagnosing hint on the bare-id model_not_found.
 * A bare `<vendor>/<model>` id that classifies invalid on the direct gateway
 * while its `openrouter/<id>` twin is catalog-confirmed is exactly doctor's
 * repairable fabricated-alias class (alias-audit.js findFabricatedAliasRepairs)
 * — the routeError should point at `amicus doctor --fix` instead of a bare
 * model_not_found. Reason and shape stay unchanged; hint only.
 */
const { resolveRoute } = require('../src/utils/gateway-router');
const { parseDescriptor } = require('../src/utils/model-descriptor');

const NO_KEYS = { openrouter: false, google: false, openai: false, anthropic: false, deepseek: false };
const cat = (ids) => ({ models: ids.map(id => ({ id })), lastRefreshError: null });

function req(raw, over = {}) {
  const aliases = {};
  return {
    descriptor: parseDescriptor(raw, { aliases }),
    source: 'cli', gatewayMode: 'auto', allowSelection: false, validateModel: true,
    keys: { ...NO_KEYS }, catalogInfo: { models: [], lastRefreshError: null }, ...over,
  };
}

describe('resolveRoute — fabricated bare-id hint (B2/V16)', () => {
  test('bare id invalid on direct with a catalog-confirmed openrouter/ twin => model_not_found with doctor --fix hint', () => {
    const r = resolveRoute(req('deepseek/deepseek-x', {
      keys: { ...NO_KEYS, deepseek: true },
      catalogInfo: cat(['deepseek/deepseek-chat', 'openrouter/deepseek/deepseek-x']),
    }));
    expect(r).toMatchObject({ kind: 'error', reason: 'model_not_found', preferredGateway: 'direct' });
    expect(r.hint).toMatch(/doctor --fix/);
  });

  test('control: bare id whose openrouter/ twin is ALSO invalid keeps the default (absent) hint', () => {
    const r = resolveRoute(req('deepseek/deepseek-x', {
      keys: { ...NO_KEYS, deepseek: true },
      catalogInfo: cat(['deepseek/deepseek-chat', 'openrouter/deepseek/deepseek-chat']),
    }));
    expect(r).toMatchObject({ kind: 'error', reason: 'model_not_found', preferredGateway: 'direct' });
    expect(r.hint).toBeUndefined();
  });
});

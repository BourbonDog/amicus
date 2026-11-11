// tests/curated-models-gateway-routes.test.js
'use strict';

const { toGatewayRoutes } = require('../src/utils/curated-models');
const r = toGatewayRoutes();

test('Anthropic divergent aliases carry BOTH gateway-native ids', () => {
  // Every shipped Anthropic pin now has DIVERGENT forms (dot on OpenRouter,
  // dash direct); both are AUTHORED, never derived. The shape where the two
  // forms coincide (claude-opus-5) is kept covered by the frozen b803a2a
  // fixture in tests/utils/same-model.test.js, since the live table no longer
  // carries one.
  expect(r.opus).toEqual({ direct: 'anthropic/claude-opus-5-5', openrouter: 'openrouter/anthropic/claude-opus-5.5' });
  expect(r.haiku).toEqual({ direct: 'anthropic/claude-haiku-5-5', openrouter: 'openrouter/anthropic/claude-haiku-5.5' });
});
test('sonnet and claude share one divergent pair', () => {
  const pair = { direct: 'anthropic/claude-sonnet-5-5', openrouter: 'openrouter/anthropic/claude-sonnet-5.5' };
  expect(r.sonnet).toEqual(pair);
  expect(r.claude).toEqual(pair);
});
test('fable carries BOTH gateway forms (direct route authored 2026-08-05, ruling R2)', () => {
  expect(r.fable).toEqual({
    direct: 'anthropic/claude-fable-5-2',
    openrouter: 'openrouter/anthropic/claude-fable-5.2',
  });
});
test('direct-capable non-divergent vendor derives both forms', () => {
  expect(r.gpt).toEqual({ direct: 'openai/gpt-6.1-terra', openrouter: 'openrouter/openai/gpt-6.1-terra' });
});
test('gateway-only vendor is openrouter-only', () => {
  expect(r.grok).toEqual({ openrouter: 'openrouter/x-ai/grok-4.20' });
});

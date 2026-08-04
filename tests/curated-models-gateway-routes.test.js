// tests/curated-models-gateway-routes.test.js
'use strict';

const { toGatewayRoutes } = require('../src/utils/curated-models');
const r = toGatewayRoutes();

test('Anthropic divergent aliases carry BOTH gateway-native ids', () => {
  // opus-5's two forms coincide (no dotted version segment), but the direct
  // form is still AUTHORED, never derived — haiku keeps the dot/dash guard.
  expect(r.opus).toEqual({ direct: 'anthropic/claude-opus-5', openrouter: 'openrouter/anthropic/claude-opus-5' });
  expect(r.haiku).toEqual({ direct: 'anthropic/claude-haiku-4-5-20251001', openrouter: 'openrouter/anthropic/claude-haiku-4.5' });
});
test('non-divergent Anthropic (sonnet-5) has matching forms', () => {
  expect(r.sonnet).toEqual({ direct: 'anthropic/claude-sonnet-5', openrouter: 'openrouter/anthropic/claude-sonnet-5' });
});
test('fable is OpenRouter-only today (no direct form)', () => {
  expect(r.fable).toEqual({ openrouter: 'openrouter/anthropic/claude-fable-5' });
  expect(r.fable.direct).toBeUndefined();
});
test('direct-capable non-divergent vendor derives both forms', () => {
  expect(r.gpt).toEqual({ direct: 'openai/gpt-5.6-terra', openrouter: 'openrouter/openai/gpt-5.6-terra' });
});
test('gateway-only vendor is openrouter-only', () => {
  expect(r.grok).toEqual({ openrouter: 'openrouter/x-ai/grok-4.3' });
});

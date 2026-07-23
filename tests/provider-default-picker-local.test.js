'use strict';

const { pricePerMInputFrom } = require('../src/utils/provider-default-picker');

test('pricePerMInputFrom falls back to a local row own pricing ($0)', () => {
  // A local catalog row carries its own pricing (no OR twin).
  const localRow = { id: 'ollama/llama3.3', pricing: { prompt: 0, completion: 0 }, local: true };
  expect(pricePerMInputFrom(localRow)).toBe(0);
});

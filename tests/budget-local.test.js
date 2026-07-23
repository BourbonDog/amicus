'use strict';

const { checkBudget } = require('../src/sidecar/budget');

test('a $0-priced local leg counts as priced (not unpriced)', () => {
  const r = checkBudget(
    [{ modelInput: 'ollama', model: 'ollama/llama3.3', pricing: { prompt: 0, completion: 0 } }],
    { maxCost: 5, promptChars: 400 });
  expect(r.ok).toBe(true);
  expect(r.breakdown.unpricedCount).toBe(0);
  expect(r.breakdown.legs[0].priced).toBe(true);
  expect(r.breakdown.legs[0].estCost).toBe(0);
});

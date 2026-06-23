'use strict';
const { sumPerMessageUsage } = require('../src/utils/pricing');

// runHeadless aggregates msg.info.tokens/msg.info.cost from assistant messages
// into a Map keyed by message id; this pins the aggregation contract the poll
// loop relies on (the loop wiring itself is covered by the e2e smoke in Task 6).
describe('headless usage aggregation contract', () => {
  it('a single assistant message snapshot resolves to its totals', () => {
    const map = new Map();
    // simulate two polls of the SAME message (streamed growth → latest wins)
    map.set('asst_1', { tokens: { input: 10, output: 1, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0.0001 });
    map.set('asst_1', { tokens: { input: 10, output: 40, reasoning: 5, cache: { read: 2, write: 0 } }, cost: 0.0006 });
    const t = sumPerMessageUsage(map);
    expect(t.tokens).toEqual({ input: 10, output: 40, reasoning: 5, cacheRead: 2, cacheWrite: 0 });
    expect(t.costReported).toBeCloseTo(0.0006, 6);
  });
});

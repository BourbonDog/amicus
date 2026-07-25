'use strict';

const { enrichLegUsage, markLive, rollupWaveUsage } = require('../../src/observe/live-doc');

describe('enrichLegUsage (read-time cost resolution, spec 4.3)', () => {
  test('resolves cost from raw progress usage', () => {
    const leg = { taskId: 'w1-1', model: 'openrouter/x/y', status: 'running' };
    const out = enrichLegUsage(leg, { tokens: { input: 100, output: 50 }, costReported: 0.02 });
    expect(out.usage.tokens.input).toBe(100);
    expect(out.usage.cost.amount).toBe(0.02);       // reported cost wins
    expect(out.usage.cost.source).toBe('reported');
  });

  test('no progress usage -> no usage key (renderer shows dash)', () => {
    const leg = { taskId: 'w1-2', model: 'gpt', status: 'running' };
    expect('usage' in enrichLegUsage(leg, undefined)).toBe(false);
  });
});

describe('markLive', () => {
  test('stamps view:live on a running doc', () => {
    expect(markLive({ status: 'running' }).view).toBe('live');
  });
  test('leaves a terminal doc unmarked', () => {
    expect('view' in markLive({ status: 'complete' })).toBe(false);
  });
});

describe('rollupWaveUsage', () => {
  test('sums enriched leg usage into a wave cost', () => {
    const legs = [
      enrichLegUsage({ model: 'gpt', status: 'running' }, { tokens: { input: 10, output: 5 }, costReported: 0.1 }),
      enrichLegUsage({ model: 'qwen', status: 'running' }, { tokens: { input: 20, output: 8 }, costReported: 0.2 }),
    ];
    const r = rollupWaveUsage(legs);
    expect(r.cost.amount).toBeCloseTo(0.3, 5);
    expect(r.tokens.input).toBe(30);
  });
});

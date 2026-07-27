'use strict';

const { enrichLegUsage, markLive, rollupWaveUsage, TERMINAL } = require('../../src/observe/live-doc');

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
  // ⚠️ v4.4.1 A1: 'timed-out' is what resolveTerminalState actually writes into a session's
  // metadata.json, and amicus_status stamps metadata.status straight onto the composed doc. It
  // was absent from TERMINAL, so a finished single-session doc kept being marked live.
  test("leaves a 'timed-out' doc unmarked too — it is finished (A1)", () => {
    expect('view' in markLive({ status: 'timed-out' })).toBe(false);
  });
});

describe('TERMINAL (the observability layer\'s single terminal set)', () => {
  // ⚠️ v4.4.1 A1. Both spellings are real and neither may be dropped:
  //   'timeout'   — src/utils/result-schema.js:23 statusFromResult (leg / wave doc / --json)
  //   'timed-out' — src/sidecar/session-finalize.js:21 resolveTerminalState (metadata.json,
  //                 and since LC-3 progress.json's terminal stage)
  // Two byte-identical mirrors exist (src/workspace/run-detail.js:26,
  // electron/workspace-ui/live-model.js:14), pinned by tests/workspace/live-normalize.test.js
  // and tests/workspace/live-model.test.js. This is the source of truth.
  test('carries BOTH timeout spellings', () => {
    expect(TERMINAL.has('timeout')).toBe(true);
    expect(TERMINAL.has('timed-out')).toBe(true);
  });
  test('is exactly the eight terminal names, in order', () => {
    expect(Array.from(TERMINAL)).toEqual(
      ['complete', 'partial', 'error', 'crashed', 'aborted', 'timeout', 'timed-out', 'idle-timeout']
    );
  });
  test('does not swallow the live states', () => {
    ['running', 'unknown', 'receiving', 'pending'].forEach((s) => expect(TERMINAL.has(s)).toBe(false));
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

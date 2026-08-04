// tests/sidecar/models-probe.test.js
'use strict';

/**
 * src/sidecar/models-probe.js — the `models --check --live` probe tier (spec
 * §6, D5). All deps are injected (house DI pattern, see
 * council/run-launch.js's `fanoutFn`), so these tests never touch the real
 * fanout transport or real config — every `runFanout`/`collectAliasSources`
 * below is a plain jest.fn() the test controls directly.
 *
 * Leg fixtures use the REAL buildRunResult field names (status/error/usage.
 * cost.amount — see src/utils/result-schema.js + src/utils/pricing.js's
 * resolveUsage), not invented ones, so a field-name typo in the production
 * code would fail these tests instead of passing against a fictional shape.
 */

const { probeStoredAliases, PROBE_WINDOW_MS, PROBE_PROMPT } = require('../../src/sidecar/models-probe');

/** Minimal buildRunResult-shaped leg (result-schema.js). `cost` omitted -> no `usage` key at all,
 * mirroring an unpriced/never-ran leg — production code must still resolve that to `cost: null`. */
const mkLeg = ({ model, status, error = null, cost }) => ({
  taskId: `leg-${model}`, model, modelInput: model, status, error,
  ...(cost !== undefined ? { usage: { tokens: {}, cost: { amount: cost, currency: 'USD', source: 'reported' } } } : {}),
});

const mkStored = (alias, model) => ({ alias, model, source: 'user-config' });

describe('probeStoredAliases', () => {
  test('empty stored-alias set short-circuits WITHOUT calling runFanout (no spend on an empty probe)', async () => {
    // Non-empty collectAliasSources() overall — defaults + a curated route —
    // but ZERO user-config rows. Must still short-circuit: scope is stored
    // aliases only (Global Constraints), not "any alias exists".
    const collectAliasSources = jest.fn(() => [
      { alias: 'gemini', model: 'google/gemini-3.6-flash', source: 'defaults' },
      { alias: 'grok', model: 'x-ai/grok-4.1-fast', source: 'curated-route (xai)' },
    ]);
    const runFanout = jest.fn();

    const result = await probeStoredAliases({}, { runFanout, collectAliasSources });

    expect(result).toEqual({ results: [], waveId: null });
    expect(runFanout).not.toHaveBeenCalled();
  });

  test('only user-config rows are sent to the wave — defaults/curated-route rows are out of scope (spec §6)', async () => {
    const collectAliasSources = jest.fn(() => [
      { alias: 'gemini', model: 'google/gemini-3.6-flash', source: 'defaults' },
      { alias: 'mine', model: 'openrouter/mistral/x', source: 'user-config' },
      { alias: 'grok', model: 'x-ai/grok-4.1-fast', source: 'curated-route (xai)' },
    ]);
    const runFanout = jest.fn(async () => ({
      wave: { waveId: 'w4', legs: [mkLeg({ model: 'openrouter/mistral/x', status: 'complete' })] },
      exitCode: 0,
    }));

    const { results } = await probeStoredAliases({}, { runFanout, collectAliasSources });

    expect(runFanout).toHaveBeenCalledTimes(1);
    expect(runFanout.mock.calls[0][0].models).toBe('openrouter/mistral/x');
    expect(results).toHaveLength(1);
    expect(results[0].alias).toBe('mine');
  });

  test('sends exactly one quiet wave with the pinned probe options', async () => {
    const collectAliasSources = jest.fn(() => [mkStored('gemini', 'google/gemini-3.1-flash-lite-preview')]);
    const runFanout = jest.fn(async () => ({
      wave: { waveId: 'w1', legs: [mkLeg({ model: 'google/gemini-3.1-flash-lite-preview', status: 'complete' })] },
      exitCode: 0,
    }));

    await probeStoredAliases({ project: '/proj' }, { runFanout, collectAliasSources });

    expect(runFanout).toHaveBeenCalledTimes(1);
    const opts = runFanout.mock.calls[0][0];
    // runFanout's `models` is the comma-separated STRING the CLI --models flag
    // takes (validateFanoutModels -> parseModelsList splits it back apart) —
    // NOT an array. council/run-launch.js's launchWave does the identical
    // `.join(',')` for the same reason; an array here would parse to [] and
    // fail the whole wave with BAD_ARGS.
    expect(opts.models).toBe('google/gemini-3.1-flash-lite-preview');
    expect(opts.prompt).toBe(PROBE_PROMPT);
    expect(opts.prompt).toBe('Reply with exactly: OK');
    expect(opts.quiet).toBe(true);
    expect(opts.noOutputBackstopMs).toBe(PROBE_WINDOW_MS);
    expect(opts.noOutputBackstopMs).toBe(30000);
    expect(opts.timeout).toBe(2);
    expect(opts.project).toBe('/proj');
  });

  test('classifies complete -> served, a NO_OUTPUT_BACKSTOP error -> accepted-but-silent, any other error -> error', async () => {
    const stored = [
      mkStored('gemini', 'google/gemini-3.1-flash-lite-preview'),
      mkStored('grok', 'x-ai/grok-4.1-fast'),
      mkStored('deepseek', 'deepseek/deepseek-chat'),
    ];
    const backstopError = 'NO_OUTPUT_BACKSTOP: model produced no output, reasoning, or tool calls in '
      + '30s — likely a listed-but-not-serving model or a dead endpoint';
    const routingError = 'Error: 404 model not found';
    const legs = [
      mkLeg({ model: stored[0].model, status: 'complete', cost: 0.0021 }),
      mkLeg({ model: stored[1].model, status: 'error', error: backstopError }),
      mkLeg({ model: stored[2].model, status: 'error', error: routingError }),
    ];
    const runFanout = jest.fn(async () => ({ wave: { waveId: 'w2', legs }, exitCode: 1 }));
    const collectAliasSources = jest.fn(() => stored);

    const { results, waveId } = await probeStoredAliases({}, { runFanout, collectAliasSources });

    expect(waveId).toBe('w2');
    expect(results).toEqual([
      { alias: 'gemini', target: stored[0].model, outcome: 'served', detail: null, cost: 0.0021 },
      { alias: 'grok', target: stored[1].model, outcome: 'accepted-but-silent', detail: backstopError, cost: null },
      { alias: 'deepseek', target: stored[2].model, outcome: 'error', detail: routingError, cost: null },
    ]);
  });

  test('maps legs back to aliases by ARRAY ORDER, not by matching model id (two stored aliases, one shared target)', async () => {
    // Both aliases point at the SAME model — a same-model/leg lookup would
    // misassign both to whichever leg it found first. Only a positional zip
    // (deriveLegIds assigns legs 1:1 in --models order, fanout.js) gets this
    // right — this is the exact assumption the brief calls out to pin.
    const stored = [
      mkStored('primary', 'openrouter/x-ai/grok-4.1-fast'),
      mkStored('backup', 'openrouter/x-ai/grok-4.1-fast'),
    ];
    const legs = [
      mkLeg({ model: stored[0].model, status: 'complete' }),
      mkLeg({ model: stored[1].model, status: 'error', error: 'Error: 401 unauthorized' }),
    ];
    const runFanout = jest.fn(async () => ({ wave: { waveId: 'w3', legs }, exitCode: 2 }));
    const collectAliasSources = jest.fn(() => stored);

    const { results } = await probeStoredAliases({}, { runFanout, collectAliasSources });

    expect(results[0]).toEqual({ alias: 'primary', target: stored[0].model, outcome: 'served', detail: null, cost: null });
    expect(results[1]).toEqual({
      alias: 'backup', target: stored[1].model, outcome: 'error', detail: 'Error: 401 unauthorized', cost: null,
    });
  });
});

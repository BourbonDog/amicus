'use strict';

/**
 * Issue #218 wiring: buildProviderModels emits a per-model `limit` descriptor
 * ONLY when an output budget is configured AND the catalog knows both numbers.
 *
 * The headline property under test is the NON-regression one: with no budget
 * configured, every model is still registered as `{}` — byte-identical to
 * pre-#218 behaviour. The knob ships wired but off.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('#218 buildProviderModels output limit', () => {
  const origConfigDir = process.env.AMICUS_CONFIG_DIR;
  let dir;

  afterEach(() => {
    jest.resetModules();
    if (origConfigDir === undefined) { delete process.env.AMICUS_CONFIG_DIR; }
    else { process.env.AMICUS_CONFIG_DIR = origConfigDir; }
    if (dir) { fs.rmSync(dir, { recursive: true, force: true }); dir = undefined; }
  });

  const CATALOG = [
    { id: 'openrouter/moonshotai/kimi-k3', contextLength: 1048576, maxOutputTokens: 943718 },
    { id: 'openrouter/tiny/small-model', contextLength: 8192, maxOutputTokens: 4096 },
    { id: 'openrouter/old/no-ceiling', contextLength: 131072, maxOutputTokens: null },
  ];

  /** @param {object} cfg written to config.json  @param {Array} catalog cache rows */
  function load(cfg, catalog = CATALOG) {
    jest.resetModules();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bpm-limit-'));
    process.env.AMICUS_CONFIG_DIR = dir;
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg), { mode: 0o600 });
    jest.doMock('../src/utils/curated-models', () => ({
      toDefaultAliases: () => ({}),
      toGatewayRoutes: () => ({}),
    }));
    jest.doMock('../src/utils/model-catalog', () => ({
      readCache: () => ({ models: catalog }),
      DEFAULT_MAX_AGE_MS: 86400000,
    }));
    return require('../src/utils/config');
  }

  const aliases = {
    kimi: 'openrouter/moonshotai/kimi-k3',
    tiny: 'openrouter/tiny/small-model',
    old: 'openrouter/old/no-ceiling',
  };

  test('NO budget configured → every model is `{}` (pre-#218 behaviour, byte-identical)', () => {
    const config = load({ aliases });
    const p = config.buildProviderModels([]);
    expect(p.openrouter.models['moonshotai/kimi-k3']).toEqual({});
    expect(p.openrouter.models['tiny/small-model']).toEqual({});
    expect(p.openrouter.models['old/no-ceiling']).toEqual({});
  });

  test('budget configured → emits limit with BOTH context and output', () => {
    const config = load({ aliases, outputBudget: 8000 });
    const m = config.buildProviderModels([]).openrouter.models['moonshotai/kimi-k3'];
    expect(m.limit).toEqual({ context: 1048576, output: 8000 });
    // Rule 2: a limit without context is a fatal ConfigInvalidError.
    expect(m.limit.context).toBeGreaterThan(0);
  });

  test('a model whose real ceiling is below the budget keeps its own ceiling', () => {
    const config = load({ aliases, outputBudget: 8000 });
    const m = config.buildProviderModels([]).openrouter.models['tiny/small-model'];
    expect(m.limit).toEqual({ context: 8192, output: 4096 });
  });

  test('a model with no known ceiling stays `{}` — never a partial limit', () => {
    const config = load({ aliases, outputBudget: 8000 });
    expect(config.buildProviderModels([]).openrouter.models['old/no-ceiling']).toEqual({});
  });

  test('a model absent from the catalog stays `{}`', () => {
    const config = load({ aliases: { ghost: 'openrouter/nobody/unknown' }, outputBudget: 8000 });
    expect(config.buildProviderModels([]).openrouter.models['nobody/unknown']).toEqual({});
  });

  // Council #230 A1 held DIRECT anthropic out of clamping until descriptor x
  // thinking-budget was measured. PR 2 measured it (probe rows K1/K2/K3/K4/K9/
  // K10, BACKLOG "v4.9.4 records"): the descriptor lowers the reservation on
  // that route (K1: 8000), a thinking variant's budget is added on top (K2:
  // 8000 + 16000 = 24000) and the sum is clamped to the model's real ceiling
  // (K3/K4/K10: 64000 for haiku). No budget can push a thinking leg over the
  // ceiling, so the hold-out is lifted and direct anthropic clamps like any
  // other route. Named mutant "ANTHROPICHELDOUT": re-add
  //   if (fullModel.startsWith('anthropic/')) { providers[providerID].models[modelID] = {}; return; }
  // to addRoute and the FIRST test below fails.
  const HAIKU = [
    { id: 'anthropic/claude-haiku-4-5', contextLength: 200000, maxOutputTokens: 64000 },
    { id: 'openrouter/anthropic/claude-haiku-4-5', contextLength: 200000, maxOutputTokens: 64000 },
  ];

  test('a DIRECT anthropic route gets the same limit as any other clamped route (hold-out lifted)', () => {
    const config = load({ aliases: { haiku: 'anthropic/claude-haiku-4-5' }, outputBudget: 8000 }, HAIKU);
    expect(config.buildProviderModels([]).anthropic.models['claude-haiku-4-5'])
      .toEqual({ limit: { context: 200000, output: 8000 } });
  });

  test('the openrouter/anthropic mirror of that same model gets the same limit', () => {
    const config = load({ aliases: { haiku: 'anthropic/claude-haiku-4-5' }, outputBudget: 8000 }, HAIKU);
    const m = config.buildProviderModels([]).openrouter.models['anthropic/claude-haiku-4-5'];
    expect(m.limit).toEqual({ context: 200000, output: 8000 });
  });

  // PR 2: values above the engine's 32000 default are LIVE — the descriptor
  // carries min(budget, ceiling) and startServer raises the engine side with
  // the flag (probe K6: 100000 reached the wire). The descriptor's own
  // arithmetic is what this pins; the flag is pinned in
  // tests/opencode-client-output-flag.test.js.
  test('a budget above the engine default is emitted as min(budget, ceiling), not capped at 32000', () => {
    const config = load({ aliases, outputBudget: 100000 });
    const p = config.buildProviderModels([]);
    expect(p.openrouter.models['moonshotai/kimi-k3'].limit).toEqual({ context: 1048576, output: 100000 });
    expect(p.openrouter.models['tiny/small-model'].limit).toEqual({ context: 8192, output: 4096 });
  });

  test('an unreadable/empty catalog degrades to `{}` and never throws', () => {
    const config = load({ aliases, outputBudget: 8000 }, null);
    let p;
    expect(() => { p = config.buildProviderModels([]); }).not.toThrow();
    expect(p.openrouter.models['moonshotai/kimi-k3']).toEqual({});
  });

  test.each([0, -1, 'lots', null, true])(
    'a malformed budget (%p) is ignored → `{}`', (bad) => {
      const config = load({ aliases, outputBudget: bad });
      expect(config.buildProviderModels([]).openrouter.models['moonshotai/kimi-k3']).toEqual({});
    });

  test('getOutputBudget reads the knob and rejects junk', () => {
    expect(load({ outputBudget: 8000 }).getOutputBudget()).toBe(8000);
    expect(load({ outputBudget: 'nope' }).getOutputBudget()).toBeNull();
    expect(load({}).getOutputBudget()).toBeNull();
  });
});

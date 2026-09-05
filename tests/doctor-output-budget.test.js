'use strict';

/**
 * #218 PR 2 — the 'output-budget' doctor row.
 *
 * Verifiable voice: every message states what the check READ (the stored
 * value, the ambient flag, the catalog) and what the probe measured about it
 * (BACKLOG "v4.9.4 records": D1/D2 silent fallback, K5/K12 engine-side clamp,
 * J2/K13 raw pass-through). The one thing it must never do is print a healthy
 * row for a value the engine will silently ignore.
 */

const { evaluateOutputBudget } = require('../src/utils/doctor-output-budget-check');

const CATALOG = {
  models: [
    { id: 'openrouter/moonshotai/kimi-k3', contextLength: 1048576, maxOutputTokens: 943718 },
    { id: 'openrouter/z-ai/glm-5.3', contextLength: 131072, maxOutputTokens: 131072 },
    { id: 'anthropic/claude-haiku-4-5', contextLength: 200000, maxOutputTokens: 64000 },
    { id: 'openrouter/old/no-ceiling', contextLength: 131072, maxOutputTokens: null },
  ],
};
const ALIASES = [
  { alias: 'kimi', model: 'openrouter/moonshotai/kimi-k3', source: 'defaults' },
  { alias: 'glm', model: 'openrouter/z-ai/glm-5.3', source: 'defaults' },
  { alias: 'haiku', model: 'anthropic/claude-haiku-4-5', source: 'defaults' },
  { alias: 'old', model: 'openrouter/old/no-ceiling', source: 'user-config' },
  { alias: 'ghost', model: 'openrouter/nobody/unknown', source: 'user-config' },
  // the same model under two aliases counts ONCE
  { alias: 'kimi2', model: 'openrouter/moonshotai/kimi-k3', source: 'user-config' },
];

function deps(over = {}) {
  return {
    readOutputBudgetRaw: () => undefined,
    readCache: () => CATALOG,
    collectAliasSources: () => ALIASES,
    getConfigDir: () => '/cfg',
    env: {},
    ...over,
  };
}

describe('evaluateOutputBudget — nothing configured', () => {
  test('unset, no ambient flag -> ok, names the engine default', () => {
    const row = evaluateOutputBudget(deps());
    expect(row).toMatchObject({ id: 'output-budget', name: 'Output budget', status: 'ok', hint: null });
    expect(row.message).toBe('not set — the engine default (32000 per leg) applies');
  });

  test('unset, ambient flag valid -> ok, says the ambient value raises the default', () => {
    const row = evaluateOutputBudget(deps({ env: { OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX: '64000' } }));
    expect(row.status).toBe('ok');
    expect(row.message).toContain('OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX=64000');
    expect(row.message).toContain('raises the engine default to 64000 per leg');
  });

  test.each(['64000abc', '0', '-5', ''])(
    'unset, ambient flag %p malformed -> WARN: the engine falls back to 32000 silently (D1/D2)', (v) => {
      const row = evaluateOutputBudget(deps({ env: { OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX: v } }));
      // Named mutant "AMBIENTUNCHECKED": treat any ambient string as valid — status ok.
      expect(row.status).toBe('warn');
      expect(row.message).toContain('not a positive integer');
      expect(row.message).toContain('silently falls back to 32000');
      expect(row.hint).toContain('OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX');
    });
});

describe('evaluateOutputBudget — a budget is configured', () => {
  test.each([0, -1, 'lots', '8000', true, 0.5])(
    'malformed %p -> WARN, value echoed, hint names the config file', (bad) => {
      const row = evaluateOutputBudget(deps({ readOutputBudgetRaw: () => bad }));
      expect(row.status).toBe('warn');
      expect(row.message).toContain(JSON.stringify(bad));
      expect(row.message).toContain('not a positive integer');
      expect(row.hint).toContain('/cfg/config.json');
    });

  test('valid, no catalog cache -> WARN with the refresh hint; still says what the flag does', () => {
    const row = evaluateOutputBudget(deps({ readOutputBudgetRaw: () => 8000, readCache: () => null }));
    expect(row.status).toBe('warn');
    expect(row.message).toContain('8000 per leg');
    expect(row.message).toContain('no catalog cache');
    expect(row.message).toContain('an unknown model receives 8000 as-is');
    expect(row.hint).toBe('amicus models --refresh');
  });

  test('valid, at or below the engine default, some routes unclamped -> ok (the engine clamps what it knows)', () => {
    const row = evaluateOutputBudget(deps({ readOutputBudgetRaw: () => 8000 }));
    expect(row.status).toBe('ok');
    expect(row.message).toContain('8000 per leg');
    // 5 distinct models: kimi, glm, haiku clamp; old (no ceiling) + ghost (absent) do not.
    expect(row.message).toContain('3 of 5 alias routes clamped to a catalog ceiling');
    expect(row.message).toContain('2 without a catalog ceiling (openrouter/old/no-ceiling, openrouter/nobody/unknown)');
    expect(row.hint).toBeNull();
  });

  test('valid, ABOVE the engine default, some routes unclamped -> WARN: an unknown model gets it raw (J2/K13)', () => {
    const row = evaluateOutputBudget(deps({ readOutputBudgetRaw: () => 40000 }));
    // Named mutant "NODEFAULTGATE": drop the `budget > ENGINE_DEFAULT_OUTPUT_TOKENS`
    // condition — the previous test turns warn; keep both.
    expect(row.status).toBe('warn');
    expect(row.message).toContain('40000 per leg');
    expect(row.message).toContain('an unknown model receives 40000 as-is');
    expect(row.hint).toContain('amicus models --refresh');
  });

  test('every route clamped -> ok, no caveat', () => {
    const only = ALIASES.filter((a) => ['kimi', 'haiku'].includes(a.alias));
    const row = evaluateOutputBudget(deps({ readOutputBudgetRaw: () => 40000, collectAliasSources: () => only }));
    expect(row.status).toBe('ok');
    expect(row.message).toBe('40000 per leg; 2 of 2 alias routes clamped to a catalog ceiling');
  });

  test('a reservation of at least half a route\'s context window -> WARN naming the route and the numbers', () => {
    const only = ALIASES.filter((a) => ['kimi', 'glm'].includes(a.alias));
    const row = evaluateOutputBudget(deps({ readOutputBudgetRaw: () => 100000, collectAliasSources: () => only }));
    // glm: min(100000, 131072) = 100000 of 131072 (76%); kimi: 100000 of 1048576 (fine).
    expect(row.status).toBe('warn');
    expect(row.message).toContain('reserves at least half the context window of openrouter/z-ai/glm-5.3 (100000 of 131072)');
    expect(row.message).not.toContain('kimi-k3 (');
    expect(row.hint).toContain('lower outputBudget');
  });

  test('exactly half counts as at least half', () => {
    const only = [{ alias: 'half', model: 'openrouter/x/half', source: 'defaults' }];
    const cache = { models: [{ id: 'openrouter/x/half', contextLength: 20000, maxOutputTokens: 20000 }] };
    const row = evaluateOutputBudget(deps({ readOutputBudgetRaw: () => 10000, collectAliasSources: () => only, readCache: () => cache }));
    expect(row.status).toBe('warn');
    expect(row.message).toContain('(10000 of 20000)');
  });

  test('long lists are shortened to three names plus a count', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ alias: `g${i}`, model: `openrouter/ghost/m${i}`, source: 'user-config' }));
    const row = evaluateOutputBudget(deps({ readOutputBudgetRaw: () => 8000, collectAliasSources: () => many }));
    expect(row.message).toContain('(openrouter/ghost/m0, openrouter/ghost/m1, openrouter/ghost/m2, +2 more)');
  });

  test('an ambient flag alongside a configured budget is reported as overridden for amicus-started engines', () => {
    const row = evaluateOutputBudget(deps({
      readOutputBudgetRaw: () => 8000,
      env: { OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX: '64000' },
    }));
    expect(row.message).toContain('OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX=64000 in this environment is overridden by outputBudget for engines amicus starts');
  });

  test('falls through to process.env only when no env is injected', () => {
    const had = Object.prototype.hasOwnProperty.call(process.env, 'OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX');
    const saved = process.env.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX;
    process.env.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX = '64000';
    try {
      const d = deps(); delete d.env;
      expect(evaluateOutputBudget(d).message).toContain('=64000');
    } finally {
      if (had) { process.env.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX = saved; } else { delete process.env.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX; }
    }
  });
});

// Registration — hermetic, same rationale as tests/doctor-base-url.test.js:
// runDoctorChecks computes the FULL list, so every dep must be pinned.
const { makeBaseDeps } = require('./helpers/doctor-base-deps');

describe('doctor registration', () => {
  test('runDoctorChecks carries the output-budget row, healthy on the base fixture, placed after aliases', async () => {
    const { runDoctorChecks } = require('../src/cli-handlers-doctor');
    const rows = await runDoctorChecks(makeBaseDeps());
    const ids = rows.map((r) => r.id);
    expect(ids).toContain('output-budget');
    expect(ids.indexOf('output-budget')).toBe(ids.indexOf('aliases') + 1);
    expect(rows.find((r) => r.id === 'output-budget').status).toBe('ok');
  });

  test('a thrown dep becomes an error row, never a crash', async () => {
    const { runDoctorChecks } = require('../src/cli-handlers-doctor');
    const rows = await runDoctorChecks(makeBaseDeps({ readOutputBudgetRaw: () => { throw new Error('boom'); } }));
    expect(rows.find((r) => r.id === 'output-budget')).toMatchObject({ status: 'error', message: 'boom' });
  });
});

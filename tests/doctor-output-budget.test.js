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

  test('unset, ambient flag a plain integer -> ok, says what OUTPUT_TOKEN_MAX becomes and what each leg then reserves', () => {
    const row = evaluateOutputBudget(deps({ env: { OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX: '64000' } }));
    expect(row.status).toBe('ok');
    expect(row.message).toBe("not set — OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX=64000 in this environment sets the engine's OUTPUT_TOKEN_MAX to 64000 (its default is 32000): each leg reserves min(64000, the ceiling the engine's catalog knows for it), and 64000 as-is on a model it does not know");
  });

  test('unset, ambient flag BELOW the default -> ok, still "sets", never "raises"', () => {
    const row = evaluateOutputBudget(deps({ env: { OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX: '8000' } }));
    expect(row.status).toBe('ok');
    expect(row.message).toContain("sets the engine's OUTPUT_TOKEN_MAX to 8000");
    expect(row.message).not.toContain('raises');
  });

  // Named mutant "AMBIENTUNCHECKED": replace the /^\d+$/ gate + positiveCount
  // with `Number(ambient) || 1` — every row below turns ok.
  test.each(['64000abc', '0', '-5', '', ' 64000 ', '1e5', '0x10', '64000.7'])(
    'unset, ambient flag %p not a plain positive integer -> WARN: unmeasured form, engine falls back silently (D1/D2)', (v) => {
      const row = evaluateOutputBudget(deps({ env: { OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX: v } }));
      expect(row.status).toBe('warn');
      expect(row.message).toContain('not a plain positive integer — the only form measured to be honoured (probe D1/D2: 64000abc and 0 fell back to 32000 silently); this form is unmeasured');
      expect(row.hint).toBe('unset OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX, or set it to a plain positive integer');
    });
});

describe('evaluateOutputBudget — a budget is configured', () => {
  test.each([0, -1, 'lots', '8000', true, 0.5])(
    'malformed %p, no ambient -> WARN, value echoed, engine default named, hint names the config file', (bad) => {
      const row = evaluateOutputBudget(deps({ readOutputBudgetRaw: () => bad }));
      expect(row.status).toBe('warn');
      expect(row.message).toContain(JSON.stringify(bad));
      expect(row.message).toContain('not a positive integer — ignored; the engine default (32000 per leg) applies');
      expect(row.hint).toContain('/cfg/config.json');
    });

  test('malformed budget with a VALID ambient flag -> WARN that names the ambient value as what governs', () => {
    const row = evaluateOutputBudget(deps({ readOutputBudgetRaw: () => 0, env: { OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX: '64000' } }));
    // A malformed budget sets no flag, so the ambient 64000 reaches the spawn.
    expect(row.status).toBe('warn');
    expect(row.message).toBe("0 is not a positive integer — ignored; OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX=64000 in this environment governs engines amicus starts (OUTPUT_TOKEN_MAX 64000: each leg reserves min(64000, the ceiling the engine's catalog knows for it))");
  });

  test('malformed budget with a MALFORMED ambient flag -> WARN naming both, default applies', () => {
    const row = evaluateOutputBudget(deps({ readOutputBudgetRaw: () => 'lots', env: { OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX: '64000abc' } }));
    expect(row.status).toBe('warn');
    expect(row.message).toContain('"lots" is not a positive integer — ignored; the engine default (32000 per leg) applies (OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX=64000abc in this environment is not a plain positive integer');
  });

  // Named mutant "NOCACHEALWAYSWARN": make the no-cache branch warn regardless
  // of the budget — the first test below fails.
  test('valid at/below the default, no catalog cache -> ok: the flag alone can only lower (K12)', () => {
    const row = evaluateOutputBudget(deps({ readOutputBudgetRaw: () => 8000, readCache: () => null }));
    expect(row.status).toBe('ok');
    expect(row.message).toBe('budget 8000 — each leg reserves min(8000, its ceiling where one is known); no catalog cache, so no route has a known ceiling here (the engine clamps routes its own catalog knows; an unknown model receives 8000 as-is)');
    expect(row.hint).toBeNull();
  });

  test('valid ABOVE the default, no catalog cache -> WARN with the refresh hint', () => {
    const row = evaluateOutputBudget(deps({ readOutputBudgetRaw: () => 40000, readCache: () => null }));
    expect(row.status).toBe('warn');
    expect(row.message).toContain('budget 40000 — each leg reserves min(40000, its ceiling where one is known); no catalog cache');
    expect(row.hint).toBe('amicus models --refresh');
  });

  test('valid, at or below the engine default, some routes without a ceiling -> ok (the engine clamps what it knows)', () => {
    const row = evaluateOutputBudget(deps({ readOutputBudgetRaw: () => 8000 }));
    expect(row.status).toBe('ok');
    expect(row.message).toContain('budget 8000 — each leg reserves min(8000, its ceiling where one is known)');
    // 5 distinct models: kimi, glm, haiku have a ceiling; old (null ceiling) + ghost (absent) do not.
    expect(row.message).toContain('3 of 5 alias routes have a known catalog ceiling');
    expect(row.message).toContain('2 without one (openrouter/old/no-ceiling, openrouter/nobody/unknown)');
    expect(row.message).not.toContain('clamped');
    expect(row.hint).toBeNull();
  });

  test('valid, ABOVE the engine default, some routes without a ceiling -> WARN: an unknown model gets it raw (J2/K13)', () => {
    const row = evaluateOutputBudget(deps({ readOutputBudgetRaw: () => 40000 }));
    // Named mutant "NODEFAULTGATE": drop the `aboveDefault` condition on the
    // unclamped-routes warn — the previous test turns warn; keep both.
    expect(row.status).toBe('warn');
    expect(row.message).toContain('budget 40000 —');
    expect(row.message).toContain('an unknown model receives 40000 as-is');
    expect(row.hint).toContain('amicus models --refresh');
  });

  test('every route has a ceiling -> ok, no caveat', () => {
    const only = ALIASES.filter((a) => ['kimi', 'haiku'].includes(a.alias));
    const row = evaluateOutputBudget(deps({ readOutputBudgetRaw: () => 40000, collectAliasSources: () => only }));
    expect(row.status).toBe('ok');
    expect(row.message).toBe('budget 40000 — each leg reserves min(40000, its ceiling where one is known); 2 of 2 alias routes have a known catalog ceiling');
  });

  test('a reservation of at least half a route\'s context window -> WARN naming the route and the numbers', () => {
    const only = ALIASES.filter((a) => ['kimi', 'glm'].includes(a.alias));
    const row = evaluateOutputBudget(deps({ readOutputBudgetRaw: () => 100000, collectAliasSources: () => only }));
    // glm: min(100000, 131072) = 100000 of 131072 (76%); kimi: 100000 of 1048576 (fine).
    expect(row.status).toBe('warn');
    expect(row.message).toContain('reserves at least half the context window of openrouter/z-ai/glm-5.3 (100000 of 131072)');
    expect(row.message).not.toContain('kimi-k3 (');
    expect(row.hint).toBe('lower outputBudget — input plus the reservation must fit the context window');
  });

  test('exactly half counts as at least half', () => {
    const only = [{ alias: 'half', model: 'openrouter/x/half', source: 'defaults' }];
    const cache = { models: [{ id: 'openrouter/x/half', contextLength: 20000, maxOutputTokens: 20000 }] };
    const row = evaluateOutputBudget(deps({ readOutputBudgetRaw: () => 10000, collectAliasSources: () => only, readCache: () => cache }));
    expect(row.status).toBe('warn');
    expect(row.message).toContain('(10000 of 20000)');
  });

  test('both warns at once -> the starvation hint leads and the refresh hint follows', () => {
    const only = ALIASES.filter((a) => ['glm', 'ghost'].includes(a.alias));
    const row = evaluateOutputBudget(deps({ readOutputBudgetRaw: () => 100000, collectAliasSources: () => only }));
    expect(row.status).toBe('warn');
    expect(row.hint).toBe('lower outputBudget — input plus the reservation must fit the context window; amicus models --refresh  (a budget above the engine default reaches an unknown model unclamped)');
  });

  test('long lists are shortened to three names plus a count', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ alias: `g${i}`, model: `openrouter/ghost/m${i}`, source: 'user-config' }));
    const row = evaluateOutputBudget(deps({ readOutputBudgetRaw: () => 8000, collectAliasSources: () => many }));
    expect(row.message).toContain('(openrouter/ghost/m0, openrouter/ghost/m1, openrouter/ghost/m2, +2 more)');
  });

  test('an alias row without a string model is ignored, never printed as "undefined"', () => {
    const odd = [{ alias: 'kimi', model: 'openrouter/moonshotai/kimi-k3', source: 'defaults' }, { alias: 'junk', model: undefined, source: 'user-config' }, null];
    const row = evaluateOutputBudget(deps({ readOutputBudgetRaw: () => 8000, collectAliasSources: () => odd }));
    expect(row.message).toBe('budget 8000 — each leg reserves min(8000, its ceiling where one is known); 1 of 1 alias routes have a known catalog ceiling');
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

'use strict';

/**
 * #218 PR 4: the effort lever's decision. Every expectation here is a probe row:
 * declared -> sent (F2, M1); undeclared on a known model -> refused (F3, M7 would
 * be silent); unknown model -> sent unverified after a bounded wait (M0 vs M12);
 * the direct-Anthropic `enabled` + budgetTokens shape over the budget -> refused
 * with the numbers M2 measured; adaptive / effort shapes -> no fit check (M10b,
 * M1, M15, M16).
 */

const {
  VARIANT_LEVELS, VariantRefusedError, readModelDeclaration, checkVariant, formatUnverifiedVariantNote,
} = require('../../src/utils/engine-variants');

const KIMI = { known: true, variants: { low: { reasoning: { effort: 'low' } }, high: { reasoning: { effort: 'high' } }, max: { reasoning: { effort: 'max' } } }, ceiling: 943718, waitedMs: 0 };
const HAIKU = { known: true, variants: { high: { thinking: { type: 'enabled', budgetTokens: 16000 } }, max: { thinking: { type: 'enabled', budgetTokens: 31999 } } }, ceiling: 64000, waitedMs: 0 };
const SONNET = { known: true, variants: { high: { thinking: { type: 'adaptive', display: 'summarized' }, effort: 'high' } }, ceiling: 128000, waitedMs: 0 };
const GPT4O = { known: true, variants: {}, ceiling: 16384, waitedMs: 0 };
const UNKNOWN = { known: false, variants: {}, ceiling: null, waitedMs: 5000 };

describe('VARIANT_LEVELS', () => {
  it('is the seven levels the curated routes declare between them (M0)', () => {
    expect(VARIANT_LEVELS).toEqual(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
  });
});

describe('checkVariant — declared', () => {
  it('sends a declared level, verified (F2/M1)', () => {
    expect(checkVariant({ variant: 'low', model: 'openrouter/moonshotai/kimi-k3', declaration: KIMI, outputBudget: null }))
      .toEqual({ ok: true, verified: true, entry: KIMI.variants.low });
  });
  it('sends a declared level beside a budget when the entry carries no thinking budget (M1)', () => {
    expect(checkVariant({ variant: 'low', model: 'openrouter/moonshotai/kimi-k3', declaration: KIMI, outputBudget: 8000 }).ok).toBe(true);
  });
  it('sends an adaptive-thinking level beside a budget (M10b)', () => {
    expect(checkVariant({ variant: 'high', model: 'anthropic/claude-sonnet-5', declaration: SONNET, outputBudget: 8000 }).ok).toBe(true);
  });
});

describe('checkVariant — undeclared on a known model', () => {
  it('refuses and names the declared set (F3)', () => {
    const v = checkVariant({ variant: 'medium', model: 'openrouter/moonshotai/kimi-k3', declaration: KIMI, outputBudget: null });
    expect(v.ok).toBe(false);
    expect(v.code).toBe('VARIANT_UNDECLARED');
    expect(v.reason).toBe("VARIANT_UNDECLARED: openrouter/moonshotai/kimi-k3 does not declare a 'medium' variant — the engine's catalogue lists low, high, max for it (/config/providers); an undeclared variant is a silent no-op on the wire (probe F3/M7), so nothing was sent. Pick one of the listed levels, or omit --thinking to run at the provider's own default effort");
  });
  it('refuses on a known model that declares no variants at all (M0: gpt-4o)', () => {
    const v = checkVariant({ variant: 'high', model: 'openai/gpt-4o', declaration: GPT4O, outputBudget: null });
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("the engine's catalogue lists no variants at all for it");
  });
  it('does not read an inherited property as a declaration', () => {
    // Named mutant "PROTOLOOKUP": `variants[variant] !== undefined` instead of hasOwnProperty — 'constructor' is then "declared".
    const v = checkVariant({ variant: 'constructor', model: 'openrouter/moonshotai/kimi-k3', declaration: KIMI, outputBudget: null });
    expect(v.ok).toBe(false);
  });
});

describe('checkVariant — the direct-Anthropic enabled + budgetTokens shape beside a budget', () => {
  it('refuses with the reservation M2 measured (24000 + 16000 = 40000)', () => {
    const v = checkVariant({ variant: 'high', model: 'anthropic/claude-haiku-4-5', declaration: HAIKU, outputBudget: 24000 });
    expect(v.ok).toBe(false);
    expect(v.code).toBe('VARIANT_OVER_BUDGET');
    expect(v.reason).toBe("VARIANT_OVER_BUDGET: the 'high' variant on anthropic/claude-haiku-4-5 carries a 16000-token thinking budget that the engine adds ON TOP of the reservation on this route (probe M2: 24000 + 16000 = 40000; K2), so with outputBudget 24000 this leg would reserve 40000 (24000 + 16000) — 16000 over the budget; nothing was sent. Raise outputBudget to at least 64000 (the sum is then clamped to the ceiling, K4), route the model through OpenRouter (its OpenRouter row carries the thinking budget inside the reservation, M9), or use an adaptive-thinking model such as claude-sonnet-5 (M10b)");
  });
  it('says so when the sum is clamped to the ceiling (K3-shaped: 48000 + 31999 > 64000)', () => {
    const v = checkVariant({ variant: 'max', model: 'anthropic/claude-haiku-4-5', declaration: HAIKU, outputBudget: 48000 });
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("would reserve 64000 (48000 + 31999, clamped to the model's 64000 ceiling) — 16000 over the budget");
  });
  it('sends when the budget is at or above the ceiling — the sum is clamped to it (K4)', () => {
    // Named mutant "ALWAYSREFUSE": drop the `budget < ceiling` conjunct.
    expect(checkVariant({ variant: 'max', model: 'anthropic/claude-haiku-4-5', declaration: HAIKU, outputBudget: 64000 }).ok).toBe(true);
    expect(checkVariant({ variant: 'max', model: 'anthropic/claude-haiku-4-5', declaration: HAIKU, outputBudget: 100000 }).ok).toBe(true);
  });
  it('sends with no budget (the engine adds on its own, H3/H4) and with an unknown budget', () => {
    // Named mutant "FITWITHOUTBUDGET": treat a null budget as 32000.
    expect(checkVariant({ variant: 'high', model: 'anthropic/claude-haiku-4-5', declaration: HAIKU, outputBudget: null }).ok).toBe(true);
    expect(checkVariant({ variant: 'high', model: 'anthropic/claude-haiku-4-5', declaration: HAIKU }).ok).toBe(true);
  });
  it('keys on the SHAPE, not the provider id — the same entry on another provider is refused the same way', () => {
    // Named mutant "ANTHROPICONLY": add `model.startsWith('anthropic/') &&` to the fit condition.
    const v = checkVariant({ variant: 'high', model: 'someproxy/claude-haiku-4-5', declaration: HAIKU, outputBudget: 24000 });
    expect(v.ok).toBe(false);
    expect(v.code).toBe('VARIANT_OVER_BUDGET');
  });
  it('ignores a non-positive or non-numeric budgetTokens', () => {
    const d = { ...HAIKU, variants: { high: { thinking: { type: 'enabled', budgetTokens: 0 } } } };
    expect(checkVariant({ variant: 'high', model: 'anthropic/claude-haiku-4-5', declaration: d, outputBudget: 8000 }).ok).toBe(true);
  });
});

describe('checkVariant — the model the catalogue does not know', () => {
  it('sends unverified (M0 cold read; M7 is the silent outcome amicus cannot see)', () => {
    // Named mutant "UNKNOWNREFUSED": refuse an unknown model as undeclared.
    expect(checkVariant({ variant: 'medium', model: 'openrouter/qwen/qwen3.8-max-0902', declaration: UNKNOWN, outputBudget: null }))
      .toEqual({ ok: true, verified: false });
  });
  it('formats the unverified note with the wait and the rows', () => {
    expect(formatUnverifiedVariantNote({ model: 'openrouter/qwen/qwen3.8-max-0902', variant: 'medium', waitedMs: 5003 })).toBe(
      "the engine's catalogue did not know openrouter/qwen/qwen3.8-max-0902 within 5003 ms (limit.context 0, no variants declared), so 'medium' was sent unverified: it applies only if the engine learns the model before it builds the request (its startup models.dev refresh — probe M12 saw qwen3.8-max-0902 known within 36 ms on one run and unknown at the first read on another, M0) and is a silent no-op otherwise (M7)");
  });
});

describe('VariantRefusedError', () => {
  it('carries the name headless keys on and the code', () => {
    const e = new VariantRefusedError('VARIANT_UNDECLARED', 'why');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('VariantRefusedError');
    expect(e.code).toBe('VARIANT_UNDECLARED');
    expect(e.message).toBe('why');
  });
});

describe('readModelDeclaration', () => {
  /** A fake SDK client whose /config/providers answers change per call. */
  const clientOf = (answers) => {
    let i = 0;
    return { config: { providers: jest.fn(async () => ({ data: { providers: answers[Math.min(i++, answers.length - 1)] } })) } };
  };
  const KNOWN = [{ id: 'openrouter', models: { 'moonshotai/kimi-k3': { limit: { context: 1048576, output: 943718 }, variants: KIMI.variants } } }];
  const COLD = [{ id: 'openrouter', models: { 'moonshotai/kimi-k3': { limit: { context: 0, output: 0 }, variants: {} } } }];

  it('reads a known model once (no wait)', async () => {
    const client = clientOf([KNOWN]);
    const d = await readModelDeclaration(client, 'openrouter/moonshotai/kimi-k3', { waitMs: 1000, pollMs: 1, sleep: async () => {} });
    expect(d.known).toBe(true);
    expect(d.ceiling).toBe(943718);
    expect(Object.keys(d.variants)).toEqual(['low', 'high', 'max']);
    expect(client.config.providers).toHaveBeenCalledTimes(1);
  });
  it('waits for the startup refresh: unknown on the first read, known on the third (M0 -> M12)', async () => {
    // Named mutant "NOWAIT": return the first read whatever it says — `known` is false and providers() was called once.
    const client = clientOf([COLD, COLD, KNOWN]);
    const d = await readModelDeclaration(client, 'openrouter/moonshotai/kimi-k3', { waitMs: 1000, pollMs: 1, sleep: async () => {} });
    expect(d.known).toBe(true);
    expect(client.config.providers).toHaveBeenCalledTimes(3);
  });
  it('gives up at the deadline and reports the wait', async () => {
    let now = 0;
    const client = clientOf([COLD]);
    const d = await readModelDeclaration(client, 'openrouter/moonshotai/kimi-k3', { waitMs: 50, pollMs: 10, sleep: async () => { now += 10; }, now: () => now });
    expect(d.known).toBe(false);
    expect(d.variants).toEqual({});
    expect(d.ceiling).toBeNull();
    expect(d.waitedMs).toBeGreaterThanOrEqual(50);
  });
  it('a model or provider missing from the dump is unknown, not a throw', async () => {
    const client = clientOf([[{ id: 'anthropic', models: {} }]]);
    const d = await readModelDeclaration(client, 'openrouter/moonshotai/kimi-k3', { waitMs: 0 });
    expect(d).toMatchObject({ known: false, variants: {}, ceiling: null });
  });
  it('splits the id at the FIRST slash so an OpenRouter vendor path stays whole', async () => {
    // Named mutant "LASTSLASH": split at lastIndexOf('/') — the model id becomes 'kimi-k3' and is never found.
    const client = clientOf([KNOWN]);
    const d = await readModelDeclaration(client, 'openrouter/moonshotai/kimi-k3', { waitMs: 0 });
    expect(d.known).toBe(true);
  });
});

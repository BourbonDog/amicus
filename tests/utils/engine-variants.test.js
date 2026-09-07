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

// The two row shapes `/config/providers` returns, copied from the measurement
// (record M23, engine 1.18.15) rather than written from memory. Amicus writes
// exactly ONE cell into a model's entry — `limit`, at src/utils/config.js:406 —
// and the dump echoes it back (M3); the echo overwrites `limit` and NOTHING
// else, so the display cells still say whose row it is.
// `configOnlyRow` MUST keep `toolcall: true` and `status: 'active'`: those are
// populated on a row only the config registers, and pinning them is what kills
// the "TOOLCALLDISJUNCT" mutant.
const configOnlyRow = (id, limit) => ({ id, providerID: 'x', name: id, family: '', release_date: '', cost: { input: 0, output: 0, cache: { read: 0, write: 0 } }, capabilities: { temperature: false, reasoning: false, attachment: false, toolcall: true }, limit, variants: {}, status: 'active', options: {}, headers: {} });
const engineRow = (over) => ({ name: 'Claude Haiku 4.5', family: 'claude-haiku', release_date: '2025-10-15', cost: { input: 1, output: 5, cache: { read: 0.1, write: 1.25 } }, capabilities: { temperature: true, reasoning: true, attachment: true, toolcall: true }, status: 'active', options: {}, headers: {}, variants: {}, ...over });
/** A fake SDK client whose /config/providers answers change per call. */
const clientOf = (answers) => {
  let i = 0;
  return { config: { providers: jest.fn(async () => ({ data: { providers: answers[Math.min(i++, answers.length - 1)] } })) } };
};
const NO_CATALOG = { readCache: () => null };

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
  it('refuses on a known model that declares no variants at all, with its OWN reason (M0: gpt-4o)', () => {
    // Named mutant "EMPTYSETSILENT": drop the `names.length === 0` split and let the listed-set
    // wording ("the engine's catalogue lists no variants at all for it") serve both branches.
    const v = checkVariant({ variant: 'high', model: 'openai/gpt-4o', declaration: GPT4O, outputBudget: null });
    expect(v.ok).toBe(false);
    expect(v.code).toBe('VARIANT_UNDECLARED');
    expect(v.reason).toBe("VARIANT_UNDECLARED: openai/gpt-4o declares no variants at all, so 'high' is not among them — the row the engine returned for it (/config/providers, the engine's merged view of its own catalogue and your opencode config) carries catalogue-style metadata (a display name, family, release date, pricing or capabilities), so it reads as a declaration and not an unfinished read; an undeclared variant is a silent no-op on the wire (probe F3/M7), so nothing was sent. Omit --thinking to run at the provider's own default effort, or pick a route whose row declares levels (a gateway mirror of the same model sometimes does). Setting an outputBudget does not change this verdict (council #235 r3, C1/B1); on a first engine start the bundled catalogue can declare a smaller set than the live one, so the same level can be accepted on the next run");
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
    expect(v.reason).toBe("VARIANT_OVER_BUDGET: the 'high' variant on anthropic/claude-haiku-4-5 carries a 16000-token thinking budget that the engine adds ON TOP of the reservation on this route (probe M2: 24000 + 16000 = 40000; K2), so with outputBudget 24000 this leg would reserve 40000 (24000 + 16000) — 16000 over the budget; nothing was sent. Raise outputBudget to at least 64000 (the sum is then clamped to the ceiling, K4), route the model through OpenRouter (a variant leaves the reservation at the budget there — M1: 8000 stayed 8000 under 'low'; M9: 32000 with 'high' on both of the engine's catalogues), or use an adaptive-thinking model such as claude-sonnet-5 (M10b)");
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

describe('checkVariant — whose ceiling the OVER_BUDGET remedy names (council #235 r2, B1)', () => {
  it("splits the remedy when the ceiling came from amicus's own catalog: refresh first, because the engine's real ceiling may be higher (M3)", () => {
    // Named mutant "REMEDYALWAYSCATALOG": return the catalog wording unconditionally — the
    // engine-sourced case below then names `models --refresh` for a number the dump proved.
    const v = checkVariant({ variant: 'high', model: 'anthropic/claude-haiku-4-5', declaration: { ...HAIKU, ceilingFrom: 'catalog' }, outputBudget: 24000 });
    expect(v.code).toBe('VARIANT_OVER_BUDGET');
    expect(v.reason).toContain("Raise outputBudget to at least 64000 — the ceiling amicus's own catalog carries for this model");
    expect(v.reason).toContain('prefer `amicus models --refresh` first');
    expect(v.reason).not.toContain('(the sum is then clamped to the ceiling, K4)');
    // the rest of the reason is untouched in both branches
    expect(v.reason).toContain('would reserve 40000 (24000 + 16000) — 16000 over the budget');
    expect(v.reason).toContain('route the model through OpenRouter');
  });
  it("keeps the plain remedy when the dump WAS the engine's ceiling — a bare descriptor (K5/K12)", () => {
    const v = checkVariant({ variant: 'high', model: 'anthropic/claude-haiku-4-5', declaration: { ...HAIKU, ceilingFrom: 'engine' }, outputBudget: 24000 });
    expect(v.reason).toContain('Raise outputBudget to at least 64000 (the sum is then clamped to the ceiling, K4)');
    expect(v.reason).not.toContain('models --refresh');
  });
});

describe('checkVariant — an additive shape with no ceiling anyone declared (council #235 r4, C7)', () => {
  // Reachable: a model the user declares in their OWN opencode.json with a `variants` block
  // carrying the direct-Anthropic `enabled + budgetTokens` shape and no `limit`, which amicus's
  // catalog has no row for either. `budget + N` with N >= 1 always exceeds the budget, so an
  // unknown ceiling is "no clamp anyone declared", not "no risk" — PR 4's rule R4 says such a row
  // must refuse loudly rather than overshoot silently. Named mutant "NULLCEILINGSENDS"
  // (src/utils/engine-variants.js): restore the `ceiling !== null` conjunct in the fit — every
  // test below sends {ok: true, verified: true} again.
  const NOCEILING = { known: true, variants: { high: { thinking: { type: 'enabled', budgetTokens: 16000 } } }, ceiling: null, ceilingFrom: 'engine', waitedMs: 0 };

  it('refuses with the unclamped sum, and names the missing ceiling instead of a bigger budget', () => {
    const v = checkVariant({ variant: 'high', model: 'anthropic/my-haiku', declaration: NOCEILING, outputBudget: 24000 });
    expect(v.ok).toBe(false);
    expect(v.code).toBe('VARIANT_OVER_BUDGET');
    expect(v.reason).toContain('would reserve 40000 (24000 + 16000, with no ceiling declared anywhere to clamp it) — 16000 over the budget');
    expect(v.reason).toContain('Declare a `limit` for this model in your opencode config');
    expect(v.reason).toContain('or clear outputBudget');
    // the one thing this remedy must never say: raise the budget to a ceiling that does not exist
    expect(v.reason).not.toMatch(/Raise outputBudget to at least/);
    expect(v.reason).not.toMatch(/null|undefined|NaN/);
    // council #235 r4 wave 5 repair, two more ways this one remedy misleads. (1) A declared
    // `limit.output` is a DESCRIPTOR, not a clamp on the sum: K9 measured `limit.output 40000` +
    // `max` reserving 63999, and K3/K4/K10 record the sum clamped at the model's REAL ceiling
    // "regardless of what the descriptor or the flag said". Named mutant "DECLAREDLIMITCLAMPS":
    // restore "an `output` ceiling there is what clamps the sum (K3/K10)". (2) The obvious value
    // to declare — the budget itself — makes `budget < ceiling` FALSE, so the fit falls silent and
    // the same 40000 leg sends verified; only `budget - N` fits (M17), and the remedy has to say
    // so. Named mutant "REMEDYWITHOUTFIT": drop the `at most` clause.
    expect(v.reason).not.toContain('is what clamps the sum');
    expect(v.reason).toContain('at most 8000');
    expect(v.reason).toContain("only the model's real ceiling does that (K3/K9/K10)");
    expect(v.reason).toContain('silences this fit while the leg still reserves 16000 over the budget');
  });

  it('says no `output` value fits when the thinking budget alone exceeds the whole budget', () => {
    const v = checkVariant({ variant: 'high', model: 'anthropic/my-haiku', declaration: NOCEILING, outputBudget: 8000 });
    expect(v.reason).toContain('would reserve 24000 (8000 + 16000, with no ceiling declared anywhere to clamp it) — 16000 over the budget');
    expect(v.reason).toContain('no value fits');
    expect(v.reason).not.toMatch(/at most (0|-\d+)/);
  });

  it('leaves the shapes a null ceiling never endangered alone: no budget, and an entry with no thinking budget', () => {
    expect(checkVariant({ variant: 'high', model: 'anthropic/my-haiku', declaration: NOCEILING, outputBudget: null }).ok).toBe(true);
    const effortOnly = { ...NOCEILING, variants: { high: { reasoning: { effort: 'high' } } } };
    expect(checkVariant({ variant: 'high', model: 'openrouter/moonshotai/kimi-k3', declaration: effortOnly, outputBudget: 24000 }))
      .toEqual({ ok: true, verified: true, entry: effortOnly.variants.high });
  });

  it('end to end: an engine row that declares the level and carries no limit at all is refused, not sent verified', async () => {
    const ROW = [{ id: 'anthropic', models: { 'my-haiku': { name: 'My Haiku', variants: { high: { thinking: { type: 'enabled', budgetTokens: 16000 } } } } } }];
    const d = await readModelDeclaration(clientOf([ROW]), 'anthropic/my-haiku', { waitMs: 0, ...NO_CATALOG });
    expect(d).toMatchObject({ known: true, limitOutput: null, ceiling: null, ceilingFrom: 'engine' });
    expect(checkVariant({ variant: 'high', model: 'anthropic/my-haiku', declaration: d, outputBudget: 24000 }).code).toBe('VARIANT_OVER_BUDGET');
  });
});

describe('checkVariant — engine-sourced text in a message (council #235 r2, B4)', () => {
  it('defangs the declared-variant enumeration: control characters and fence/tag characters never reach the reason', () => {
    // Named mutant "RAWENGINETEXT": drop `defang` — the ESC and the backtick survive into the reason.
    const poisoned = { known: true, ceiling: null, waitedMs: 0, variants: { 'lo\u001bw': {}, '`high`': {}, '<max>': {} } };
    const v = checkVariant({ variant: 'medium', model: 'openrouter/moonshotai/kimi-k3', declaration: poisoned, outputBudget: null });
    expect(v.code).toBe('VARIANT_UNDECLARED');
    // eslint-disable-next-line no-control-regex
    expect(v.reason).not.toMatch(/[\u0000-\u001F\u007F`<>]/);
    expect(v.reason).toContain("the engine's catalogue lists low, high, max for it");
  });
  it('defangs the unreadable string the note carries (an engine/transport error message)', () => {
    const note = formatUnverifiedVariantNote({ model: 'openrouter/moonshotai/kimi-k3', variant: 'low', waitedMs: 0, unreadable: 'read threw: <script>\u0007 `oops`' });
    // eslint-disable-next-line no-control-regex
    expect(note).not.toMatch(/[\u0000-\u001F\u007F`<>]/);
    expect(note).toContain('could not be read (read threw: script oops; one read, no wait)');
  });
});

describe('checkVariant — the model the catalogue does not know', () => {
  it('sends unverified (M0 cold read; M7 is the silent outcome amicus cannot see)', () => {
    // Named mutant "UNKNOWNREFUSED": refuse an unknown model as undeclared.
    expect(checkVariant({ variant: 'medium', model: 'openrouter/qwen/qwen3.8-max-0902', declaration: UNKNOWN, outputBudget: null }))
      .toEqual({ ok: true, verified: false });
  });
  it('formats the unverified note with the wait and what the row actually carried', () => {
    // council #235 r3 (C1/B1): the old parenthetical said "limit.context 0", which is FALSE for
    // the population that reaches this note under a budget — amicus's descriptor puts a positive
    // context there (M3). The note names the row's provenance instead (M23).
    expect(formatUnverifiedVariantNote({ model: 'openrouter/qwen/qwen3.8-max-0902', variant: 'medium', waitedMs: 5003 })).toBe(
      "the engine's catalogue did not know openrouter/qwen/qwen3.8-max-0902 within 5003 ms (its /config/providers entry carries nothing but the descriptor amicus registered, or the model is absent from the dump), so 'medium' was sent unverified: it applies only if the engine learns the model before it builds the request (its startup models.dev refresh — probe M12 saw qwen3.8-max-0902 known on the first poll of a warm engine, 36 ms on one run, and unknown at the first read of a cold one, M0) and is a silent no-op otherwise (M7)");
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
  const ECHO_COLD = [{ id: 'openrouter', models: { 'qwen/qwen3.8-max-0902': configOnlyRow('qwen/qwen3.8-max-0902', { context: 1000000, output: 24000 }) } }];
  const KNOWN = [{ id: 'openrouter', models: { 'moonshotai/kimi-k3': { limit: { context: 1048576, output: 943718 }, variants: KIMI.variants } } }];
  const COLD = [{ id: 'openrouter', models: { 'moonshotai/kimi-k3': { limit: { context: 0, output: 0 }, variants: {} } } }];

  it('reads a known model once (no wait)', async () => {
    const client = clientOf([KNOWN]);
    const d = await readModelDeclaration(client, 'openrouter/moonshotai/kimi-k3', { waitMs: 1000, pollMs: 1, sleep: async () => {}, ...NO_CATALOG });
    expect(d.known).toBe(true);
    expect(d.limitOutput).toBe(943718);
    expect(d.ceiling).toBe(943718);
    expect(Object.keys(d.variants)).toEqual(['low', 'high', 'max']);
    expect(client.config.providers).toHaveBeenCalledTimes(1);
  });
  it('waits for the startup refresh: unknown on the first read, known on the third (M0 -> M12)', async () => {
    // Named mutant "NOWAIT": return the first read whatever it says — `known` is false and providers() was called once.
    const client = clientOf([COLD, COLD, KNOWN]);
    const d = await readModelDeclaration(client, 'openrouter/moonshotai/kimi-k3', { waitMs: 1000, pollMs: 1, sleep: async () => {}, ...NO_CATALOG });
    expect(d.known).toBe(true);
    expect(client.config.providers).toHaveBeenCalledTimes(3);
  });
  it('gives up at the deadline and reports the wait', async () => {
    let now = 0;
    const client = clientOf([COLD]);
    const d = await readModelDeclaration(client, 'openrouter/moonshotai/kimi-k3', { waitMs: 50, pollMs: 10, sleep: async () => { now += 10; }, now: () => now, ...NO_CATALOG });
    expect(d.known).toBe(false);
    expect(d.variants).toEqual({});
    expect(d.ceiling).toBeNull();
    // council #235 r4 (A2/C4): the wait ends INSIDE its bound now — the last read starts at 40 ms,
    // the only point with a full poll interval left, and none is started at 50.
    expect(d.waitedMs).toBe(40);
    expect(d.waitedMs).toBeLessThanOrEqual(50);
  });
  it('a model or provider missing from the dump is unknown, not a throw', async () => {
    const client = clientOf([[{ id: 'anthropic', models: {} }]]);
    const d = await readModelDeclaration(client, 'openrouter/moonshotai/kimi-k3', { waitMs: 0, ...NO_CATALOG });
    expect(d).toMatchObject({ known: false, variants: {}, limitOutput: null, ceiling: null });
  });
  it('splits the id at the FIRST slash so an OpenRouter vendor path stays whole', async () => {
    // Named mutant "LASTSLASH": split at lastIndexOf('/') — the model id becomes 'kimi-k3' and is never found.
    const client = clientOf([KNOWN]);
    const d = await readModelDeclaration(client, 'openrouter/moonshotai/kimi-k3', { waitMs: 0, ...NO_CATALOG });
    expect(d.known).toBe(true);
  });
  it("judges the fit against the catalog's ceiling when the dump echoes a budget-derived descriptor (M3)", async () => {
    // Named mutant "ECHOEDCEILING": `ceiling: d.limitOutput` unconditionally — reads 24000 here.
    const ECHO = [{ id: 'anthropic', models: { 'claude-haiku-4-5': { limit: { context: 200000, output: 24000 }, variants: HAIKU.variants } } }];
    const client = clientOf([ECHO]);
    const d = await readModelDeclaration(client, 'anthropic/claude-haiku-4-5', {
      waitMs: 0, readCache: () => ({ models: [{ id: 'anthropic/claude-haiku-4-5', contextLength: 200000, maxOutputTokens: 64000 }] }),
    });
    expect(d.limitOutput).toBe(24000);
    expect(d.ceiling).toBe(64000);
    expect(checkVariant({ variant: 'high', model: 'anthropic/claude-haiku-4-5', declaration: d, outputBudget: 24000 }).code).toBe('VARIANT_OVER_BUDGET');
  });
  it("uses the dump's own value when the catalog does not know the model — a bare descriptor is the engine's ceiling (K5/K12)", async () => {
    const BARE = [{ id: 'anthropic', models: { 'claude-haiku-4-5': { limit: { context: 200000, output: 64000 }, variants: HAIKU.variants } } }];
    const d = await readModelDeclaration(clientOf([BARE]), 'anthropic/claude-haiku-4-5', {
      waitMs: 0, readCache: () => ({ models: [{ id: 'openrouter/moonshotai/kimi-k3', contextLength: 1048576, maxOutputTokens: 943718 }] }),
    });
    expect(d.ceiling).toBe(64000);
  });
  it('an explicit catalogCeiling seam wins; a throwing or absent catalog falls back to the dump', async () => {
    const BARE = [{ id: 'anthropic', models: { 'claude-haiku-4-5': { limit: { context: 200000, output: 64000 }, variants: HAIKU.variants } } }];
    expect((await readModelDeclaration(clientOf([BARE]), 'anthropic/claude-haiku-4-5', { waitMs: 0, catalogCeiling: 100000 })).ceiling).toBe(100000);
    expect((await readModelDeclaration(clientOf([BARE]), 'anthropic/claude-haiku-4-5', { waitMs: 0, catalogCeiling: null })).ceiling).toBe(64000);
    expect((await readModelDeclaration(clientOf([BARE]), 'anthropic/claude-haiku-4-5', { waitMs: 0, readCache: () => { throw new Error('corrupt'); } })).ceiling).toBe(64000);
  });
  it('keeps polling while the row is nothing but the descriptor amicus wrote (M23)', async () => {
    // Named mutant "CONFIGONLYKNOWN": read `known` off the echoed `limit` again — providers() is called once and `variants` is {}.
    const WARM = [{ id: 'openrouter', models: { 'qwen/qwen3.8-max-0902': { limit: { context: 1000000, output: 131072 }, variants: { low: { reasoning: { effort: 'low' } } } } } }];
    const client = clientOf([ECHO_COLD, ECHO_COLD, WARM]);
    const d = await readModelDeclaration(client, 'openrouter/qwen/qwen3.8-max-0902', { waitMs: 1000, pollMs: 1, sleep: async () => {}, catalogCeiling: 131072 });
    expect(client.config.providers).toHaveBeenCalledTimes(3);
    expect(d.known).toBe(true);
    expect(Object.keys(d.variants)).toEqual(['low']);
  });
  it('a non-2xx /config/providers is UNREADABLE — one read, no wait, and the note says so (EP-3)', async () => {
    // Named mutant "UNREADABLEISCOLD": treat the error tuple as an empty provider list — providers() is polled to the deadline and `unreadable` is null.
    const client = { config: { providers: jest.fn(async () => ({ error: { name: 'Internal' }, response: { status: 500 } })) } };
    let now = 0;
    const d = await readModelDeclaration(client, 'openrouter/moonshotai/kimi-k3', { waitMs: 5000, pollMs: 250, sleep: async () => { now += 250; }, now: () => now, ...NO_CATALOG });
    expect(client.config.providers).toHaveBeenCalledTimes(1);
    expect(d).toMatchObject({ known: false, unreadable: 'HTTP 500' });
    expect(checkVariant({ variant: 'medium', model: 'openrouter/moonshotai/kimi-k3', declaration: d, outputBudget: null })).toEqual({ ok: true, verified: false });
    expect(formatUnverifiedVariantNote({ model: 'openrouter/moonshotai/kimi-k3', variant: 'medium', waitedMs: d.waitedMs, unreadable: d.unreadable }))
      .toMatch(/^the engine's \/config\/providers could not be read \(HTTP 500; one read, no wait\), so 'medium' was sent unverified: /);
  });
  it('a THROWN /config/providers read is unreadable — one read, no wait, the level sent unverified (council #235 r1 C1/D1/A2)', async () => {
    // Named mutant "THROWNREADFAILS": drop the try/catch — readModelDeclaration rejects with ECONNRESET.
    const client = { config: { providers: jest.fn(async () => { throw new Error('ECONNRESET'); }) } };
    const d = await readModelDeclaration(client, 'openrouter/moonshotai/kimi-k3', { waitMs: 5000, pollMs: 250, sleep: async () => {}, ...NO_CATALOG });
    expect(client.config.providers).toHaveBeenCalledTimes(1);
    expect(d).toMatchObject({ known: false, unreadable: 'read threw: ECONNRESET' });
    expect(checkVariant({ variant: 'low', model: 'openrouter/moonshotai/kimi-k3', declaration: d, outputBudget: null })).toEqual({ ok: true, verified: false });
  });
  it('a dump without a providers array is unreadable too (a reshaped response), while an empty list is a readable "unknown"', async () => {
    const reshaped = await readModelDeclaration({ config: { providers: jest.fn(async () => ({ data: [] })) } }, 'openrouter/moonshotai/kimi-k3', { waitMs: 0, ...NO_CATALOG });
    expect(reshaped.unreadable).toBe('no providers array in the response');
    const empty = await readModelDeclaration(clientOf([[]]), 'openrouter/moonshotai/kimi-k3', { waitMs: 0, ...NO_CATALOG });
    expect(empty).toMatchObject({ known: false, unreadable: null });
  });
  it('bounds ONE read: a catalogue endpoint that accepts and never answers is unreadable, not a 306 s hang (council #235 r2, A1)', async () => {
    // Named mutant "UNBOUNDEDREAD": drop `{ signal: readSignal }` from the providers() call —
    // the fake then never settles and this test dies on jest's own 4 s timeout instead of
    // resolving, exactly as the real transport ran to undici's ~306 s default.
    const providers = jest.fn((o) => new Promise((_resolve, reject) => {
      if (o && o.signal) { o.signal.addEventListener('abort', () => reject(o.signal.reason)); }
    }));
    const started = Date.now();
    const d = await readModelDeclaration({ config: { providers } }, 'openrouter/moonshotai/kimi-k3', {
      waitMs: 5000, pollMs: 250, sleep: async () => {}, readTimeoutMs: 25, ...NO_CATALOG,
    });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(2000);
    expect(providers).toHaveBeenCalledTimes(1); // unreadable ends the loop: one read, no wait
    expect(d.known).toBe(false);
    expect(d.unreadable).toBe('read threw: The operation was aborted due to timeout');
    expect(d.waitedMs).toBeLessThanOrEqual(5000);
  }, 4000);
  it('says whose ceiling it returned so the OVER_BUDGET remedy can tell them apart (council #235 r2, B1)', async () => {
    // Named mutant "CEILINGPROVENANCE": drop `ceilingFrom` from the return — checkVariant then
    // reads undefined on both shapes and every remedy falls to the engine wording.
    const ECHO = [{ id: 'anthropic', models: { 'claude-haiku-4-5': { limit: { context: 200000, output: 24000 }, variants: HAIKU.variants } } }];
    const echoed = await readModelDeclaration(clientOf([ECHO]), 'anthropic/claude-haiku-4-5', {
      waitMs: 0, readCache: () => ({ models: [{ id: 'anthropic/claude-haiku-4-5', contextLength: 200000, maxOutputTokens: 64000 }] }),
    });
    expect(echoed).toMatchObject({ ceiling: 64000, ceilingFrom: 'catalog' });
    expect(checkVariant({ variant: 'high', model: 'anthropic/claude-haiku-4-5', declaration: echoed, outputBudget: 24000 }).reason)
      .toContain('prefer `amicus models --refresh` first');
    const BARE = [{ id: 'anthropic', models: { 'claude-haiku-4-5': { limit: { context: 200000, output: 64000 }, variants: HAIKU.variants } } }];
    const bare = await readModelDeclaration(clientOf([BARE]), 'anthropic/claude-haiku-4-5', { waitMs: 0, ...NO_CATALOG });
    expect(bare).toMatchObject({ ceiling: 64000, ceilingFrom: 'engine' });
    expect(checkVariant({ variant: 'high', model: 'anthropic/claude-haiku-4-5', declaration: bare, outputBudget: 24000 }).reason)
      .toContain('Raise outputBudget to at least 64000 (the sum is then clamped to the ceiling, K4)');
  });
  it('stops polling when the caller abandons the wait (EP-2)', async () => {
    // Named mutant "IGNORESIGNAL": drop the `signal.aborted` clause — providers() is called 3 times.
    const signal = { aborted: false };
    const client = clientOf([COLD, COLD, KNOWN]);
    const d = await readModelDeclaration(client, 'openrouter/moonshotai/kimi-k3', { waitMs: 1000, pollMs: 1, sleep: async () => { signal.aborted = true; }, signal, ...NO_CATALOG });
    // 2, not 1: the seam sets `aborted` DURING the sleep, so the poll it was already
    // committed to still lands; the loop then exits instead of running to the deadline.
    expect(client.config.providers).toHaveBeenCalledTimes(2);
    expect(d.known).toBe(false);
  });
  it('reads the ceiling through the real model-catalog module when no seam is passed (parked minor m1)', async () => {
    // Named mutant "UNSEAMEDRENAME": `require('./model-catalog').readCatalog` in catalogCeilingFor — the test reads 24000.
    const ECHO = [{ id: 'anthropic', models: { 'claude-haiku-4-5': { limit: { context: 200000, output: 24000 }, variants: HAIKU.variants } } }];
    let pending;
    try {
      jest.isolateModules(() => {
        jest.doMock('../../src/utils/model-catalog', () => ({
          readCache: () => ({ models: [{ id: 'anthropic/claude-haiku-4-5', contextLength: 200000, maxOutputTokens: 64000 }] }),
        }));
        const isolated = require('../../src/utils/engine-variants');
        pending = isolated.readModelDeclaration(clientOf([ECHO]), 'anthropic/claude-haiku-4-5', { waitMs: 0 });
      });
      const d = await pending;
      expect(d.limitOutput).toBe(24000);
      expect(d.ceiling).toBe(64000);
    } finally {
      jest.dontMock('../../src/utils/model-catalog');
    }
  });
});

describe('readModelDeclaration — the wait keeps the bound it advertises (council #235 r4, A2/C4)', () => {
  // The bound is the WHOLE wait, not the number of reads. `DECLARATION_WAIT_MS` used to be checked
  // BEFORE the sleep+read pair that follows it, and the in-loop read always got the FULL
  // `readTimeoutMs`, so the true worst case was `waitMs + pollMs + readTimeoutMs` — 7.5 s on the
  // shipped 5000/500/2000, MEASURED at 7,361 ms against an endpoint answering in 1.9 s, against
  // docs that say "bounded at five seconds" (and a leg died at 6,007 ms with nothing sent under an
  // `AMICUS_NO_OUTPUT_BACKSTOP_MS=6000` docs/configuration.md presents as safely above the wait).
  const COLD = [{ id: 'openrouter', models: { 'moonshotai/kimi-k3': { limit: { context: 0, output: 0 }, variants: {} } } }];

  it('starts no read without a poll interval left, so an instant endpoint ends INSIDE waitMs', async () => {
    // Named mutant "UNCLAMPEDPOLL" (src/utils/engine-variants.js): restore the plain
    // `now() - start < waitMs` condition with an unclamped in-loop read — the loop then sleeps at
    // now=40 and reads a SIXTH time, and the wait lands ON the deadline instead of inside it.
    let now = 0;
    const client = clientOf([COLD]);
    const d = await readModelDeclaration(client, 'openrouter/moonshotai/kimi-k3', {
      waitMs: 50, pollMs: 10, sleep: async () => { now += 10; }, now: () => now, ...NO_CATALOG,
    });
    expect(d.known).toBe(false);
    expect(client.config.providers).toHaveBeenCalledTimes(5); // reads at 0, 10, 20, 30, 40 — never at 40 + 10
    expect(d.waitedMs).toBe(40);
  });

  it('gives a slow-but-answering endpoint only the budget that is LEFT, so the whole wait fits inside waitMs', async () => {
    // The A2/C4 case end to end, on real timers and scaled down (800 ms reads, a 1000 ms wait,
    // 100 ms polls — the shape of 1.9 s reads on the shipped 5000/500/2000). New: read (800) ->
    // 200 ms left > one poll -> sleep (900) -> 100 ms left -> the read gets 100 ms, not 2000, and
    // the wait ends at ~1000. Mutant "UNCLAMPEDPOLL": read (800) -> 800 < 1000 -> sleep (900) ->
    // a FULL second read (1700) — the overrun this fix removes.
    const LATENCY = 800;
    const providers = jest.fn((o) => new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve({ data: { providers: COLD } }), LATENCY);
      if (o && o.signal) { o.signal.addEventListener('abort', () => { clearTimeout(t); reject(o.signal.reason); }); }
    }));
    const started = Date.now();
    const d = await readModelDeclaration({ config: { providers } }, 'openrouter/moonshotai/kimi-k3', { waitMs: 1000, pollMs: 100, ...NO_CATALOG });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(1250);
    expect(d.waitedMs).toBeLessThan(1250);
    expect(d.known).toBe(false);
    // council #235 r4 wave 5 repair: the last read is cut short by the wait's OWN remainder, and
    // that is not evidence the endpoint could not be read — this endpoint answered every read it
    // was given time for. Reporting it `unreadable` routes the leg to the note that says
    // "/config/providers could not be read (...; one read, no wait)" after several reads and a
    // full wait, on an engine answering inside the 36-285 ms M12 measured. The cold-catalogue
    // outcome is the true one here. Named mutant "BUDGETABORTUNREADABLE": drop the `left <
    // readTimeout` suppression in the loop and this comes back as `read threw: ... aborted`.
    expect(d.unreadable).toBeNull();
  }, 10000);

  it('an in-loop read given its FULL deadline and failing is still unreadable (the suppression is scoped to what the wait truncated)', async () => {
    // The guard on the repair above: only a read the WAIT truncated is suppressed. A read that got
    // every millisecond of its own deadline and still failed is a real read failure and must reach
    // the note. Mutant "SUPPRESSALLINLOOP": drop the `left < readTimeout` conjunct — this goes null.
    let call = 0;
    const providers = jest.fn((o) => new Promise((resolve, reject) => {
      if (++call === 1) { resolve({ data: { providers: COLD } }); return; }
      if (o && o.signal) { o.signal.addEventListener('abort', () => reject(o.signal.reason)); }
    }));
    const d = await readModelDeclaration({ config: { providers } }, 'openrouter/moonshotai/kimi-k3', {
      waitMs: 5000, pollMs: 10, readTimeoutMs: 40, ...NO_CATALOG,
    });
    expect(providers).toHaveBeenCalledTimes(2);
    expect(d.unreadable).toBe('read threw: The operation was aborted due to timeout');
  }, 10000);

  it('the never-answering endpoint still ends on the FIRST read, unreadable (council #235 r2 A1, unchanged)', async () => {
    const providers = jest.fn((o) => new Promise((_resolve, reject) => {
      if (o && o.signal) { o.signal.addEventListener('abort', () => reject(o.signal.reason)); }
    }));
    const d = await readModelDeclaration({ config: { providers } }, 'openrouter/moonshotai/kimi-k3', {
      waitMs: 5000, pollMs: 250, sleep: async () => {}, readTimeoutMs: 25, ...NO_CATALOG,
    });
    expect(providers).toHaveBeenCalledTimes(1);
    expect(d.unreadable).toBe('read threw: The operation was aborted due to timeout');
  }, 4000);
});

describe('readModelDeclaration — whose row is it (council #235 r3, C1/B1)', () => {
  // SEAM DISCIPLINE (named mutant "SEAMLESSFACTS"): every test below passes an explicit
  // `catalogCeiling` or the `NO_CATALOG` readCache seam. `catalogCeilingFor` still runs when
  // neither is given and would read this machine's real ~/.config/amicus/model-catalog.json —
  // green here, red on a runner that has a different one.
  const AT = (models) => [{ id: 'anthropic', models }];
  const OPENAI = (row) => [{ id: 'openai', models: { 'gpt-4o': row } }];

  it('an engine row is known on the FIRST read and the wait never runs', async () => {
    const client = clientOf([AT({ 'claude-haiku-4-5': engineRow({ limit: { context: 200000, output: 24000 }, variants: HAIKU.variants }) })]);
    const d = await readModelDeclaration(client, 'anthropic/claude-haiku-4-5', { waitMs: 1000, pollMs: 1, sleep: async () => {}, catalogCeiling: 64000 });
    expect(d.known).toBe(true);
    expect(client.config.providers).toHaveBeenCalledTimes(1);
    expect('ambiguous' in d).toBe(false);
  });

  it('a row that is nothing but the descriptor amicus wrote is UNKNOWN and waits, budget in force (M23 vs EP-1)', async () => {
    // Named mutants "LIMITISKNOWN" (`known: positiveCount(limit.context) !== null` again in
    // readDeclarationOnce) and "ECHOSOURCED" (add `limit` as a ninth engineSourced disjunct):
    // either reads this row as the engine's own declaration, so the wait never runs and the
    // level is REFUSED instead of sent unverified — the blocker, inverted.
    let now = 0;
    const client = clientOf([[{ id: 'openrouter', models: { 'qwen/qwen3.8-max-0902': configOnlyRow('qwen/qwen3.8-max-0902', { context: 1000000, output: 24000 }) } }]]);
    const d = await readModelDeclaration(client, 'openrouter/qwen/qwen3.8-max-0902', {
      catalogCeiling: 131072, waitMs: 50, pollMs: 10, sleep: async () => { now += 10; }, now: () => now,
    });
    expect(d.known).toBe(false);
    expect(d.waitedMs).toBeGreaterThan(0); // it WAITED; council #235 r4 (A2/C4) ends that wait inside the 50 ms bound, not on it
    expect(d.waitedMs).toBeLessThanOrEqual(50);
    expect(client.config.providers.mock.calls.length).toBeGreaterThan(1);
    expect('ambiguous' in d).toBe(false);
    expect(checkVariant({ variant: 'low', model: 'openrouter/qwen/qwen3.8-max-0902', declaration: d, outputBudget: 24000 })).toEqual({ ok: true, verified: false });
    expect(formatUnverifiedVariantNote({ model: 'openrouter/qwen/qwen3.8-max-0902', variant: 'low', waitedMs: d.waitedMs }))
      .toContain('did not know openrouter/qwen/qwen3.8-max-0902 within');
  });

  it.each([
    ['release_date', { release_date: '2024-05-13' }],
    ['family', { family: 'gpt' }],
    ['a display name that is not the id', { name: 'GPT-4o' }],
    ['cost.input', { cost: { input: 2.5, output: 0, cache: { read: 0, write: 0 } } }],
    ['capabilities.reasoning', { capabilities: { temperature: false, reasoning: true, attachment: false, toolcall: true } }],
  ])('one engine cell is enough, with variants {}: %s', async (_label, cell) => {
    // Named mutant "ONEDISJUNCT": shrink the OR to any single cell — every other row here reads unknown.
    const row = { ...configOnlyRow('gpt-4o', { context: 128000, output: 16384 }), ...cell };
    const d = await readModelDeclaration(clientOf([OPENAI(row)]), 'openai/gpt-4o', { waitMs: 0, catalogCeiling: 16384 });
    expect(d.known).toBe(true);
    expect(d.variants).toEqual({});
  });

  it('a config-only row is NOT engine-sourced by its universal cells', async () => {
    // Named mutant "TOOLCALLDISJUNCT": add `caps.toolcall === true` (or `status`, `id`, `providerID`,
    // `api`, `options`, `headers`, `capabilities.input.text`) as a disjunct — this row reads known,
    // and every model the engine has not learned yet is then falsely REFUSED.
    const row = {
      ...configOnlyRow('gpt-4o', { context: 128000, output: 16384 }),
      api: { npm: '@ai-sdk/openai' },
      capabilities: { temperature: false, reasoning: false, attachment: false, toolcall: true, input: { text: true }, output: { text: true } },
    };
    const d = await readModelDeclaration(clientOf([OPENAI(row)]), 'openai/gpt-4o', { waitMs: 0, catalogCeiling: 16384 });
    expect(d.known).toBe(false);
  });

  it('a fractional price is engine evidence', async () => {
    // Named mutant "COSTVIAPOSITIVECOUNT": read cost through positiveCount, which FLOORS 0.05 to 0.
    const row = { ...configOnlyRow('m', { context: 1000, output: 1000 }), cost: { input: 0.05, output: 0, cache: { read: 0, write: 0 } } };
    const d = await readModelDeclaration(clientOf([AT({ m: row })]), 'anthropic/m', { waitMs: 0, catalogCeiling: 1000 });
    expect(d.known).toBe(true);
  });

  it('the config-only shape stays unknown with NO budget too (a bare {} descriptor reads 0/0)', async () => {
    let now = 0;
    const client = clientOf([[{ id: 'openrouter', models: { 'moonshotai/kimi-k3': configOnlyRow('moonshotai/kimi-k3', { context: 0, output: 0 }) } }]]);
    const d = await readModelDeclaration(client, 'openrouter/moonshotai/kimi-k3', {
      waitMs: 50, pollMs: 10, sleep: async () => { now += 10; }, now: () => now, ...NO_CATALOG,
    });
    expect(d.known).toBe(false);
    expect(client.config.providers.mock.calls.length).toBeGreaterThan(1);
  });

  it('the empty-set refusal states what was OBSERVED, not what the predicate intends', async () => {
    // Named mutant "MESSAGEOVERCLAIMS": restore Design 1's wording, which asserts the row "carries
    // its catalogue's own name, family, release date and prices" — `engineSourced` is an OR, and
    // this row (name === id, cost 0) is engine-sourced through `release_date` alone.
    const row = { ...configOnlyRow('gpt-4o', { context: 128000, output: 16384 }), release_date: '2024-05-13' };
    const d = await readModelDeclaration(clientOf([OPENAI(row)]), 'openai/gpt-4o', { waitMs: 0, catalogCeiling: 16384 });
    const v = checkVariant({ variant: 'high', model: 'openai/gpt-4o', declaration: d, outputBudget: null });
    expect(v.code).toBe('VARIANT_UNDECLARED');
    expect(v.reason).toContain('declares no variants at all');
    // council #235 r4 (C3), the message only: `/config/providers` serves the MERGED
    // config-and-catalogue view, so a user who declares name/release_date/cost/reasoning in their
    // own opencode.json satisfies `engineSourced` without the engine's catalogue knowing the model
    // (a config `reasoning: true` even makes the engine synthesize a full `variants` map). The
    // VERDICT stays — a merged view that declares no variants makes the send a no-op either way —
    // but the sentence stops asserting a provenance the dump cannot prove. Named mutant
    // "CATALOGUEPROVENANCE": restore "carries cells only the engine's own catalogue fills".
    expect(v.reason).toContain('carries catalogue-style metadata (a display name, family, release date, pricing or capabilities)');
    expect(v.reason).toContain("the engine's merged view of its own catalogue and your opencode config");
    expect(v.reason).not.toMatch(/only the engine's own catalogue fills/);
    expect(v.reason).toContain('Setting an outputBudget does not change this verdict');
    expect(v.reason).not.toMatch(/name, family, release date and prices/);
    // council #235 r3 wave 4 repair. Three further ways this one string can overclaim or
    // under-inform, each with its own mutant:
    // "NAMECELLUNNAMED" — drop 'display name' from the enumeration. `engineSourced` accepts
    //   `filled(m.name) && m.name !== modelID` as evidence, so a row engine-sourced ONLY by its
    //   display name would be refused by a sentence naming four cells it does not carry.
    // "MESSAGEDROPSLEVEL" — drop the level. docs/troubleshooting.md promises the reason names
    //   the level, and on a fanout the model alone does not say which `--thinking` died.
    // "MIRROROFTEN" — restore "often does". Measured on a live dump during the wave-4 review:
    //   2 of 196 variant-less engine rows had a same-model row elsewhere that declares levels,
    //   and the mirrors of this message's own headline case (openrouter/openai/gpt-4o-2024-08-06)
    //   and of every shipped State-K alias declare nothing either. "often" is not measured.
    expect(v.reason).toContain("declares no variants at all, so 'high' is not among them");
    expect(v.reason).toContain('display name');
    expect(v.reason).toMatch(/a gateway mirror of the same model sometimes does/);
    expect(v.reason).not.toMatch(/often does/);
  });

  describe('the budget invariant (council #235 r3, C1)', () => {
    // Named mutants "BUDGETLOOSENS" (any change that makes a verdict weaker when a budget is added)
    // and "BUDGETGATE" (reintroduce a `budgetInForce` / `couldBeEcho` gate into the wait): the
    // table below moves. Scored verified-send 0 < unverified-send 1 < refuse 2.
    const HAIKU_ROW = engineRow({ limit: { context: 200000, output: 24000 }, variants: { high: { thinking: { type: 'enabled', budgetTokens: 16000 } } } });
    const GPT4O_ROW = engineRow({ name: 'GPT-4o', family: 'gpt', release_date: '2024-05-13', cost: { input: 2.5, output: 10, cache: { read: 0, write: 0 } }, limit: { context: 128000, output: 16384 }, variants: {} });
    const UNREADABLE = { unreadableShape: true };
    const SHAPES = [
      ['an unreadable dump', UNREADABLE, 64000],
      ['a config-only row with no descriptor (0/0)', configOnlyRow('m', { context: 0, output: 0 }), null],
      ["a config-only row carrying amicus's descriptor", configOnlyRow('m', { context: 200000, output: 24000 }), 64000],
      ['an engine row declaring the level', HAIKU_ROW, 64000],
      ['an engine row declaring no variants', GPT4O_ROW, 16384],
      ['an engine row amicus has no catalog row for', GPT4O_ROW, null],
    ];
    const score = async (row, catalogCeiling, outputBudget) => {
      let now = 0;
      const client = row === UNREADABLE
        ? { config: { providers: jest.fn(async () => ({ error: { name: 'Internal' }, response: { status: 500 } })) } }
        : clientOf([AT({ m: row })]);
      const d = await readModelDeclaration(client, 'anthropic/m', {
        catalogCeiling, waitMs: 30, pollMs: 10, sleep: async () => { now += 10; }, now: () => now,
      });
      const v = checkVariant({ variant: 'high', model: 'anthropic/m', declaration: d, outputBudget });
      return v.ok ? (v.verified ? 0 : 1) : 2;
    };

    it('a budget never LOOSENS the verdict, and changes it only on the enabled+budgetTokens shape', async () => {
      const table = [];
      for (const [label, row, ceiling] of SHAPES) {
        const unbudgeted = await score(row, ceiling, null);
        const budgeted = await score(row, ceiling, 24000);
        table.push([label, unbudgeted, budgeted]);
        expect(budgeted).toBeGreaterThanOrEqual(unbudgeted);
      }
      // EQUAL on the five shapes whose entry carries no `thinking: {type: 'enabled'}`; the haiku
      // row is the one axis where a budget legitimately refuses (VARIANT_OVER_BUDGET) — monotone
      // stricter, and correct.
      expect(table).toEqual([
        ['an unreadable dump', 1, 1],
        ['a config-only row with no descriptor (0/0)', 1, 1],
        ["a config-only row carrying amicus's descriptor", 1, 1],
        ['an engine row declaring the level', 0, 2],
        ['an engine row declaring no variants', 2, 2],
        ['an engine row amicus has no catalog row for', 2, 2],
      ]);
    });
  });
});

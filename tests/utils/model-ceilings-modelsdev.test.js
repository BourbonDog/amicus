'use strict';
/**
 * #218 P3 — direct-provider ceilings from models.dev.
 *
 * Rules under test (approved design 2026-09-04): the provider's own value wins
 * and models.dev fills a contextLength/maxOutputTokens only where the provider
 * gave no usable positive integer (null, 0, negative or malformed); zero/absent
 * models.dev limits
 * are never written; openrouter/openrouter/* routers and local rows are
 * skipped; the fill is in place so `authoritative`/`local` flags ride through;
 * the fetch failure vocabulary is http-get's.
 */
const {
  MODELS_DEV_URL, MODELS_DEV_TIMEOUT_MS, limitsFromModelsDev, fillCeilings, enrichCeilings
} = require('../../src/utils/model-ceilings-modelsdev');

const API = {
  anthropic: { models: {
    'claude-opus-5': { limit: { context: 1000000, output: 128000 } },
    'claude-haiku-4-5-20251001': { limit: { context: 200000, output: 64000 } },
  } },
  openai: { models: {
    'gpt-5-nano': { limit: { context: 400000, input: 272000, output: 128000 } },
    'gpt-image-2': { limit: { context: 0, output: 0 } },
  } },
  google: { models: { 'gemini-3.7-flash': { limit: { context: 1048576, output: 65536 } } } },
  deepseek: { models: { 'deepseek-v4-pro': { limit: { context: 1000000, output: 384000 } } } },
  openrouter: { models: {
    'moonshotai/kimi-k3': { limit: { context: 1048576, output: 943718 } },
    'z-ai/glm-5.3': { limit: { context: 262144, output: 262144 } },
    'openrouter/auto': { limit: { context: 2000000, output: 2000000 } },
    'no/limits': {},
  } },
  someothervendor: { models: { 'x': { limit: { context: 1, output: 1 } } } },
};

describe('limitsFromModelsDev', () => {
  it('keys by amicus catalog id with the vendor prefix, two-slash openrouter ids included', () => {
    const m = limitsFromModelsDev(API);
    expect(m.get('anthropic/claude-opus-5')).toEqual({ context: 1000000, output: 128000 });
    expect(m.get('openrouter/moonshotai/kimi-k3')).toEqual({ context: 1048576, output: 943718 });
    expect(m.get('google/gemini-3.7-flash')).toEqual({ context: 1048576, output: 65536 });
    expect(m.get('deepseek/deepseek-v4-pro')).toEqual({ context: 1000000, output: 384000 });
  });

  it('drops zero/absent limits and vendors amicus does not catalog', () => {
    const m = limitsFromModelsDev(API);
    expect(m.has('openai/gpt-image-2')).toBe(false);
    expect(m.has('openrouter/no/limits')).toBe(false);
    expect(m.has('someothervendor/x')).toBe(false);
  });

  it('tolerates a non-object document', () => {
    expect(limitsFromModelsDev(null).size).toBe(0);
    expect(limitsFromModelsDev('<html>').size).toBe(0);
    expect(limitsFromModelsDev({ anthropic: {} }).size).toBe(0);
  });
});

describe('fillCeilings', () => {
  const limits = () => limitsFromModelsDev(API);

  it('fills only fields the provider left empty or unusable, in place, and stamps limitSource', () => {
    const row = { id: 'anthropic/claude-opus-5', name: 'Opus', contextLength: null, pricing: null, authoritative: false };
    const rows = [row];
    const counts = fillCeilings(rows, limits());
    expect(rows[0]).toBe(row);
    expect(row).toEqual({ id: 'anthropic/claude-opus-5', name: 'Opus', contextLength: 1000000, maxOutputTokens: 128000, pricing: null, authoritative: false, limitSource: 'models.dev' });
    expect(counts).toEqual({ filled: 1, alreadyKnown: 0, unknown: 0, skippedRouters: 0, skippedLocal: 0 });
  });

  it("the provider's own value wins over models.dev (24 openrouter rows disagree live)", () => {
    const row = { id: 'openrouter/z-ai/glm-5.3', contextLength: 262144, maxOutputTokens: 131072 };
    const counts = fillCeilings([row], limits());
    expect(row.maxOutputTokens).toBe(131072);
    expect(row.limitSource).toBeUndefined();
    expect(counts.alreadyKnown).toBe(1);
  });

  // Council #230 A1: the rule is `positiveCount(...) === null`, not a bare
  // `row.X === null`.
  // A 0 or a negative provider value is unusable and IS filled — the contract
  // wording is "no usable positive integer", not "null".
  it('fills a 0 / negative provider value, because neither is a usable positive integer', () => {
    const row = { id: 'anthropic/claude-opus-5', contextLength: 0, maxOutputTokens: -5 };
    const counts = fillCeilings([row], limits());
    expect(row).toMatchObject({ contextLength: 1000000, maxOutputTokens: 128000, limitSource: 'models.dev' });
    expect(counts).toEqual({ filled: 1, alreadyKnown: 0, unknown: 0, skippedRouters: 0, skippedLocal: 0 });
  });

  it('fills the one missing field when the other is known', () => {
    const row = { id: 'google/gemini-3.7-flash', contextLength: 1048576, maxOutputTokens: null };
    fillCeilings([row], limits());
    expect(row).toMatchObject({ contextLength: 1048576, maxOutputTokens: 65536, limitSource: 'models.dev' });
  });

  it('skips openrouter/openrouter/* routers and local rows, counts unknown ids', () => {
    const rows = [
      { id: 'openrouter/openrouter/auto', contextLength: null, maxOutputTokens: null },
      { id: 'ollama/llama3', contextLength: null, local: true },
      { id: 'openai/gpt-4-0613', contextLength: null },
    ];
    const counts = fillCeilings(rows, limits());
    expect(rows[0].maxOutputTokens).toBeNull();
    expect(rows[1].contextLength).toBeNull();
    expect(rows[2].contextLength).toBeNull();
    expect(counts).toEqual({ filled: 0, alreadyKnown: 0, unknown: 1, skippedRouters: 1, skippedLocal: 1 });
  });

  it('ignores malformed rows', () => {
    expect(() => fillCeilings([null, {}, { id: 42 }], limits())).not.toThrow();
  });
});

describe('enrichCeilings', () => {
  it('fetches models.dev with a 10 s timeout and an amicus User-Agent, then fills', async () => {
    const getJson = jest.fn(async () => ({ ok: true, json: API }));
    const rows = [{ id: 'deepseek/deepseek-v4-pro', contextLength: null }];
    const out = await enrichCeilings(rows, { getJson });
    expect(getJson).toHaveBeenCalledWith(MODELS_DEV_URL, {
      timeoutMs: MODELS_DEV_TIMEOUT_MS,
      headers: { 'User-Agent': expect.stringMatching(/^amicus\/\d+\.\d+\.\d+/) },
    });
    expect(MODELS_DEV_URL).toBe('https://models.dev/api.json');
    expect(MODELS_DEV_TIMEOUT_MS).toBe(10000);
    expect(rows[0]).toMatchObject({ contextLength: 1000000, maxOutputTokens: 384000 });
    expect(out).toEqual({ source: 'models.dev', failure: null, filled: 1, alreadyKnown: 0, unknown: 0, skippedRouters: 0, skippedLocal: 0 });
  });

  it('leaves rows untouched and reports the failure when models.dev is unreachable', async () => {
    const getJson = jest.fn(async () => ({ ok: false, failure: { reason: 'timeout', detail: 'no response within 10000ms' } }));
    const rows = [{ id: 'anthropic/claude-opus-5', contextLength: null }];
    const out = await enrichCeilings(rows, { getJson });
    expect(rows[0]).toEqual({ id: 'anthropic/claude-opus-5', contextLength: null });
    expect(out).toEqual({ source: 'models.dev', failure: { reason: 'timeout', detail: 'no response within 10000ms' }, filled: 0, alreadyKnown: 0, unknown: 0, skippedRouters: 0, skippedLocal: 0 });
  });

  // Council #230 C1: a 200 that PARSES but carries nothing usable used to be
  // persisted as a successful enrichment with every row `unknown` — the rows
  // silently kept no ceiling and `Ceilings:` claimed a clean run.
  it('treats a 200 with no recognised vendor limits as a bad-shape failure and leaves rows untouched', async () => {
    const getJson = jest.fn(async () => ({ ok: true, json: { error: 'nope' } }));
    const row = { id: 'anthropic/claude-opus-5', contextLength: null, maxOutputTokens: null };
    const out = await enrichCeilings([row], { getJson });
    expect(row).toEqual({ id: 'anthropic/claude-opus-5', contextLength: null, maxOutputTokens: null });
    expect(out).toEqual({
      source: 'models.dev',
      failure: { reason: 'bad-shape', detail: 'no recognised vendor limits in api.json' },
      filled: 0, alreadyKnown: 0, unknown: 0, skippedRouters: 0, skippedLocal: 0,
    });
  });

  it('never rejects, even when the fetch throws', async () => {
    const getJson = jest.fn(async () => { throw new Error('boom'); });
    const out = await enrichCeilings([{ id: 'anthropic/claude-opus-5', contextLength: null }], { getJson });
    expect(out.failure).toEqual({ reason: 'exception', detail: 'boom' });
    expect(out.filled).toBe(0);
  });
});

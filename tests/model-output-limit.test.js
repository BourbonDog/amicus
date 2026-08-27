'use strict';

/**
 * Issue #218 — per-model output limit.
 *
 * WHAT WAS MEASURED (against the pinned opencode 1.18.15 binary, and live
 * `/config/providers` probes — see the issue thread):
 *
 *   function Hy($,Z=MY){return Math.min($.limit.output,Z)||Z}   // MY = 32000
 *
 * so `maxOutputTokens = Math.min(model.limit.output, 32000)`. Three consequences
 * drive every rule below, and each one is a trap that looks harmless:
 *
 *   1. Feeding the model's REAL ceiling is arithmetically INERT. kimi-k3's true
 *      ceiling is 943,718; Math.min(943718, 32000) is still 32000. Only a value
 *      BELOW 32000 changes the outbound request. (The issue's headline remedy
 *      does nothing — this is the correction that reframed the fix.)
 *   2. `limit.context` is MANDATORY whenever `limit` is present. Emitting
 *      `{limit:{output:N}}` alone is a hard ConfigInvalidError that poisons the
 *      ENTIRE config for the server's lifetime — not a per-model degrade.
 *   3. `output: 0` falls back to 32000 via the `|| Z`. Never emit it.
 *
 * Policy for this change: the knob is OPT-IN and there is NO default change.
 * With no budget configured we emit `{}` — byte-identical to today's behaviour.
 */

const {
  buildLimitLookup,
  computeModelLimit,
  normalizeOutputBudget,
} = require('../src/utils/model-output-limit');

const KIMI = { contextLength: 1048576, maxOutputTokens: 943718 };
const SMALL = { contextLength: 8192, maxOutputTokens: 4096 };

describe('#218 normalizeOutputBudget', () => {
  it('accepts a positive integer', () => {
    expect(normalizeOutputBudget(8000)).toBe(8000);
  });

  it.each([undefined, null, 0, -1, NaN, Infinity, '8000', {}, true])(
    'rejects %p → null (no limit emitted, today\'s behaviour)', (v) => {
      expect(normalizeOutputBudget(v)).toBeNull();
    });

  it('floors a fractional budget rather than emitting a non-integer', () => {
    expect(normalizeOutputBudget(8000.7)).toBe(8000);
  });
});

describe('#218 computeModelLimit', () => {
  it('returns null when no budget is configured — the opt-in default', () => {
    expect(computeModelLimit(KIMI, null)).toBeNull();
  });

  it('clamps the budget to the model ceiling and emits BOTH fields', () => {
    expect(computeModelLimit(KIMI, 8000)).toEqual({ context: 1048576, output: 8000 });
  });

  it('a model whose real ceiling is BELOW the budget keeps its own ceiling', () => {
    // Without this, a blanket budget would send an over-ceiling max_tokens to
    // a small model that is correct today via opencode's own Math.min.
    expect(computeModelLimit(SMALL, 8000)).toEqual({ context: 8192, output: 4096 });
  });

  it('never emits output: 0 — it would fall back to 32000 via `|| Z`', () => {
    const r = computeModelLimit({ contextLength: 8192, maxOutputTokens: 0 }, 8000);
    expect(r).toBeNull();
  });

  it('never emits a limit without context — that is a fatal ConfigInvalidError', () => {
    for (const ctx of [null, undefined, 0, -5, NaN]) {
      expect(computeModelLimit({ contextLength: ctx, maxOutputTokens: 943718 }, 8000)).toBeNull();
    }
  });

  it('returns null when the ceiling is unknown (pre-#218 catalog rows)', () => {
    expect(computeModelLimit({ contextLength: 1048576, maxOutputTokens: null }, 8000)).toBeNull();
    expect(computeModelLimit({ contextLength: 1048576 }, 8000)).toBeNull();
  });

  it('returns null for a missing row entirely', () => {
    expect(computeModelLimit(undefined, 8000)).toBeNull();
    expect(computeModelLimit(null, 8000)).toBeNull();
  });

  it('a budget at or above 32000 is emitted but is INERT — documented, not silently dropped', () => {
    // Math.min(min(943718, 40000), 32000) === 32000. We still emit, because
    // limit.context also re-enables compaction for a model models.dev
    // does not know (context 0 disables it).
    expect(computeModelLimit(KIMI, 40000)).toEqual({ context: 1048576, output: 40000 });
  });
});

describe('#218 buildLimitLookup', () => {
  const CATALOG = [
    { id: 'openrouter/moonshotai/kimi-k3', contextLength: 1048576, maxOutputTokens: 943718 },
    { id: 'openrouter/z-ai/glm-5.2', contextLength: 262144, maxOutputTokens: 262144 },
    { id: 'anthropic/claude-sonnet-5', contextLength: null, maxOutputTokens: null },
  ];

  it('indexes catalog rows by their full route id', () => {
    const m = buildLimitLookup(CATALOG);
    expect(m.get('openrouter/moonshotai/kimi-k3')).toEqual(
      { contextLength: 1048576, maxOutputTokens: 943718 });
  });

  it('survives a missing, empty, or malformed catalog', () => {
    for (const bad of [null, undefined, [], 'nope', {}, [null, 3, { noId: 1 }]]) {
      expect(() => buildLimitLookup(bad)).not.toThrow();
    }
    expect(buildLimitLookup(null).size).toBe(0);
  });

  it('a row with no usable numbers still indexes — computeModelLimit rejects it later', () => {
    const m = buildLimitLookup(CATALOG);
    expect(computeModelLimit(m.get('anthropic/claude-sonnet-5'), 8000)).toBeNull();
  });

  it('has no prototype-chain holes — a model named like an Object member is safe', () => {
    const m = buildLimitLookup([{ id: 'constructor', contextLength: 10, maxOutputTokens: 10 }]);
    expect(m.get('toString')).toBeUndefined();
    expect(m.get('constructor')).toEqual({ contextLength: 10, maxOutputTokens: 10 });
  });
});

// ---------------------------------------------------------------------------
// Council review of PR #221, finding C2 (raised by `gpt`, Confirmed).
// ---------------------------------------------------------------------------
describe('#218 C2: a fractional budget below 1 must be rejected, not floored to 0', () => {
  // normalizeOutputBudget floored BEFORE testing positivity, so 0.5 became 0 —
  // violating its own "positive integer, or null" contract. Worse downstream:
  // computeModelLimit's `Math.max(1, ...)` guard — added to stop `output: 0`
  // reaching opencode — laundered that bogus 0 into a bogus `output: 1`, i.e. a
  // ONE-TOKEN reservation on every leg. A hardening masking the very input it
  // was supposed to reject. Floor first, then test positivity.
  it.each([0.5, 0.9, 0.001])('normalizeOutputBudget(%p) -> null', (v) => {
    expect(normalizeOutputBudget(v)).toBeNull();
  });

  it('still floors a fraction that survives flooring', () => {
    expect(normalizeOutputBudget(1.4)).toBe(1);
    expect(normalizeOutputBudget(8000.7)).toBe(8000);
  });

  it('computeModelLimit emits NOTHING for a sub-1 budget — never a 1-token reservation', () => {
    expect(computeModelLimit({ contextLength: 10, maxOutputTokens: 10 }, 0.5)).toBeNull();
  });

  it('the Math.max(1) guard is no longer load-bearing: both inputs are >= 1 by then', () => {
    // Pins the property directly rather than trusting the guard: for every
    // budget that survives normalization, output is the honest clamp.
    for (const b of [1, 2, 4096, 8000, 40000]) {
      const r = computeModelLimit({ contextLength: 8192, maxOutputTokens: 4096 }, b);
      expect(r.output).toBe(Math.min(4096, b));
    }
  });
});

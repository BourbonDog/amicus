/**
 * @module model-output-limit
 * Issue #218 — the per-model `limit` descriptor amicus hands opencode.
 *
 * THE PROBLEM: every council leg reserved `max_tokens: 32000` regardless of the
 * model's real ceiling. OpenRouter validates that RESERVATION against remaining
 * credit BEFORE serving, so legs died in 2.2s with zero tokens and a literal
 * "You requested up to 32000 tokens, but can only afford 354". amicus never set
 * the value — `buildProviderModels` registered every model as `{}`, leaving
 * opencode's own default to govern.
 *
 * WHERE 32000 COMES FROM (measured, in the pinned 1.18.15 binary, not inferred):
 *
 *     var MY=32000
 *     function Hy($,Z=MY){return Math.min($.limit.output,Z)||Z}
 *
 * i.e. `ProviderTransform.maxOutputTokens(model) = Math.min(model.limit.output,
 * OUTPUT_TOKEN_MAX)`. Three consequences, each a trap:
 *
 *   1. Supplying the model's REAL ceiling is ARITHMETICALLY INERT. kimi-k3's
 *      true ceiling is 943,718 and Math.min(943718, 32000) is still 32000. Only
 *      a value BELOW 32000 changes the outbound request. The issue's headline
 *      framing ("a 32,000 reservation against a 943,718 ceiling is arbitrary")
 *      reads as though feeding the real ceiling would help. It would not.
 *   2. `limit.context` is MANDATORY whenever `limit` is present. A `limit` with
 *      only `output` is a hard ConfigInvalidError — and it poisons the ENTIRE
 *      config for the server's lifetime, not just that model. Measured against
 *      a live `opencode serve` + GET /config/providers.
 *   3. `output: 0` is swallowed by the `|| Z` and falls back to 32000.
 *
 * WHAT THIS DOES NOT FIX. #218 conflates two modes that pull in OPPOSITE
 * directions on this one knob. Mode 1 (credit rejection) needs the reservation
 * LOWERED — that is what this module enables. Mode 2 (a leg spending its whole
 * allowance on reasoning and emitting 0-2 output tokens) would need it RAISED,
 * which the descriptor cannot do at all because of the Math.min; its real cause
 * is reasoning effort, a knob amicus already owns (`sidecar/fanout.js` →
 * `body.reasoning`). Lowering the budget makes those legs fail faster and
 * cheaper. It does not make them produce output. No claim is made that it does.
 *
 * POLICY: opt-in, no default change. With no configured budget every model is
 * still registered as `{}` — byte-identical to pre-#218 behaviour.
 */

'use strict';

/**
 * A usable positive, finite INTEGER count. Rejects strings, booleans, NaN,
 * Infinity, and anything that floors to zero.
 *
 * ⚠️ Order matters, and getting it wrong was council finding C2 on PR #221.
 * Testing `v > 0` BEFORE flooring let 0.5 through and returned `Math.floor(0.5)`
 * === 0 — breaking this function's own "positive integer, or null" contract.
 * Downstream that was worse than a bad number: computeModelLimit's
 * `Math.max(1, ...)` guard, which exists to stop `output: 0` reaching opencode,
 * laundered the bogus 0 into a bogus `output: 1` — a ONE-TOKEN reservation on
 * every leg. A hardening masking the very input it was meant to reject. Floor
 * first, then test positivity, so a sub-1 value is rejected outright.
 */
function positiveCount(v) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) { return null; }
  const n = Math.floor(v);
  return n > 0 ? n : null;
}

/**
 * Coerce a configured output budget to a usable integer, or null.
 * null means "emit no limit" — the opt-in default, and today's behaviour.
 * @param {*} v raw `config.outputBudget`
 * @returns {number|null}
 */
function normalizeOutputBudget(v) {
  // `typeof true === 'boolean'` and `'8000'` is a string: both rejected. A
  // config knob is only honoured when it is unambiguously a number.
  return positiveCount(v);
}

/**
 * Index catalog rows by full route id for O(1) lookup during route walking.
 * A Map (not an object) so a model id colliding with an Object.prototype member
 * — 'constructor', 'toString' — cannot resolve to an inherited function. Same
 * discipline as the `__proto__: null` alias table in config.js.
 * @param {Array<{id:string, contextLength:?number, maxOutputTokens:?number}>} models
 * @returns {Map<string, {contextLength:?number, maxOutputTokens:?number}>}
 */
function buildLimitLookup(models) {
  const out = new Map();
  if (!Array.isArray(models)) { return out; }
  for (const m of models) {
    if (!m || typeof m !== 'object' || typeof m.id !== 'string') { continue; }
    out.set(m.id, {
      contextLength: m.contextLength ?? null,
      maxOutputTokens: m.maxOutputTokens ?? null,
    });
  }
  return out;
}

/**
 * The `limit` descriptor for one model, or null when it must not be emitted.
 *
 * Returns null — meaning "register as `{}`, exactly as before" — whenever any
 * input is missing or unusable. That is deliberate: a partial descriptor is not
 * a partial improvement here, it is a fatal config error (rule 2 above).
 *
 * @param {?{contextLength:?number, maxOutputTokens:?number}} row catalog row
 * @param {?number} budget normalized output budget
 * @returns {?{context:number, output:number}}
 */
function computeModelLimit(row, budget) {
  const want = positiveCount(budget);
  if (want === null || !row || typeof row !== 'object') { return null; }

  const context = positiveCount(row.contextLength);
  const ceiling = positiveCount(row.maxOutputTokens);
  // Both or neither. Without a known ceiling a blanket budget would REGRESS a
  // small model: an 8000 budget against a real 4096 ceiling sends an
  // over-ceiling max_tokens, where today opencode's own Math.min keeps it
  // correct. The ceiling is a hard requirement for clamping, not a nicety.
  if (context === null || ceiling === null) { return null; }

  return { context, output: Math.max(1, Math.min(ceiling, want)) };
}

module.exports = { normalizeOutputBudget, buildLimitLookup, computeModelLimit, positiveCount };

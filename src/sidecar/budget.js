// src/sidecar/budget.js
'use strict';

/**
 * @module budget
 * Pre-flight spend gate (WS-2 #10). Two guards:
 *  - HARD per-$/Mtok threshold (on by default): refuses a model whose catalog
 *    price-per-Mtok exceeds the cap. Structural o3-pro / opus-fast guard; no
 *    output length guess needed.
 *  - SOFT total-$ ceiling (opt-in via --max-cost): refuses when the summed
 *    per-leg ESTIMATE exceeds the ceiling. Estimate, not guaranteed.
 * Unpriced legs (direct providers, pricing:null) are surfaced, never $0.
 */

// Tuned against the live catalog at implementation time (observed 2026-06-23):
//   opus (claude-opus-4.8)  ~$25/Mtok out  (allowed)
//   o3                      ~$8/Mtok out   (allowed)
//   o3-pro                  ~$80/Mtok out  (blocked)
//   gemini-pro              ~$12/Mtok out  (allowed)
//   deepseek-v4-pro         ~$0.87/Mtok out (allowed)
// Setting 60 blocks o3-pro (80) while allowing the normal council bench.
const DEFAULT_MAX_COST_PER_MTOK = 60;

// Rough output budget for the soft ceiling estimate (output length is unknown
// pre-flight). Deliberately conservative; the ceiling is labeled "estimate".
const ASSUMED_OUTPUT_TOKENS = 4000;

function perMtok(perToken) { return perToken * 1e6; }

/**
 * @param {Array<{modelInput,model,pricing:{prompt,completion}|null}>} legs
 * @param {{maxCostPerMtok?,maxCost?,promptChars?,assumedOutputTokens?}} [opts]
 */
function checkBudget(legs, opts = {}) {
  const cap = (typeof opts.maxCostPerMtok === 'number' && opts.maxCostPerMtok > 0)
    ? opts.maxCostPerMtok : DEFAULT_MAX_COST_PER_MTOK;
  const inTok = Math.ceil((opts.promptChars || 0) / 4);
  const outTok = opts.assumedOutputTokens || ASSUMED_OUTPUT_TOKENS;
  const offending = [];
  const breakdownLegs = [];
  let totalEstCost = 0;
  let unpricedCount = 0;

  for (const leg of legs) {
    if (!leg.pricing) {
      breakdownLegs.push({ modelInput: leg.modelInput, model: leg.model, priced: false, perMtok: null, estCost: null });
      unpricedCount++;
      continue;
    }
    const pm = Math.max(perMtok(leg.pricing.prompt), perMtok(leg.pricing.completion));
    const estCost = leg.pricing.prompt * inTok + leg.pricing.completion * outTok;
    totalEstCost += estCost;
    const overThreshold = pm > cap;
    breakdownLegs.push({ modelInput: leg.modelInput, model: leg.model, priced: true, perMtok: pm, estCost, overThreshold });
    if (overThreshold) {
      offending.push({ modelInput: leg.modelInput, model: leg.model, perMtok: pm,
        reason: `$${pm.toFixed(2)}/Mtok exceeds the $${cap.toFixed(2)}/Mtok cap` });
    }
  }

  const overCeiling = (typeof opts.maxCost === 'number' && opts.maxCost > 0) ? totalEstCost > opts.maxCost : false;
  const ok = offending.length === 0 && !overCeiling;
  return { ok, offending, overCeiling, breakdown: { legs: breakdownLegs, totalEstCost, unpricedCount, maxCostPerMtok: cap, maxCost: opts.maxCost || null } };
}

/**
 * Human-readable refusal text (also used as the error envelope `hint`).
 * @param {object} result checkBudget's return value
 * @param {{kind:'cli'|'mcp'}} [surface] where the text will be read. Remedies are
 *   surface-specific: the MCP tool surface has no --flags, and (since v4.7 PR6's
 *   gate hoist) no per-call override at all. Defaults to 'cli' so the two CLI
 *   callers stay byte-identical.
 */
function formatBudgetError(result, surface = { kind: 'cli' }) {
  const lines = [];
  const isMcp = surface && surface.kind === 'mcp';
  if (result.offending.length > 0) {
    lines.push('Budget gate: model(s) over the per-$/Mtok threshold:');
    for (const o of result.offending) { lines.push(`  - ${o.modelInput} (${o.model}): ${o.reason}`); }
  }
  if (result.overCeiling) {
    // On MCP the ceiling can come from EITHER a pack's `maxCost` option or the
    // config, and the pack wins (mcp-server.js's fwd.maxCost ?? cfg.maxCost).
    // Naming only one of them would send the caller to edit the loser — the very
    // "remedy that cannot work" class this surface split exists to end.
    lines.push(`Budget gate: estimated total $${result.breakdown.totalEstCost.toFixed(4)} exceeds ${isMcp ? 'the effective maxCost' : '--max-cost'} $${result.breakdown.maxCost.toFixed(4)} (estimate, not guaranteed).`);
  }
  if (result.breakdown.unpricedCount > 0) {
    lines.push(`(${result.breakdown.unpricedCount} unpriced leg(s) — direct provider; cost unknown, not included in the estimate.)`);
  }
  // offending and overCeiling are independent (unrelated inputs — see module
  // header), and either or both may have fired since formatBudgetError is only
  // called when !ok. Only name a remedy that actually clears every branch that
  // fired; when both fired, raising just one lever will not clear the run.
  const hasOffending = result.offending.length > 0;
  const hasCeiling = result.overCeiling;
  if (isMcp) {
    if (hasOffending && hasCeiling) {
      lines.push("Override: raise maxCostPerMtok in the amicus config AND the effective maxCost (the pack's `maxCost` option if this run used a pack, otherwise the config's), or choose a cheaper model — raising just one will not clear this run.");
    } else if (hasOffending) {
      lines.push('Override: raise maxCostPerMtok in the amicus config, or choose a cheaper model.');
    } else {
      lines.push("Override: raise the effective maxCost — the pack's `maxCost` option if this run used a pack, otherwise the config's — or choose a cheaper model.");
    }
  } else {
    if (hasOffending && hasCeiling) {
      lines.push('Override: --no-cost-gate to disable both guards (e.g. an intentional o3 run) — raising just one of maxCostPerMtok or --max-cost will not clear this run.');
    } else if (hasOffending) {
      lines.push('Override: --no-cost-gate to disable both guards (e.g. an intentional o3 run), or raise maxCostPerMtok in config.');
    } else {
      lines.push('Override: --max-cost <$> to raise the ceiling, or --no-cost-gate to disable both guards (e.g. an intentional o3 run).');
    }
  }
  return lines.join('\n');
}

module.exports = { checkBudget, formatBudgetError, DEFAULT_MAX_COST_PER_MTOK, ASSUMED_OUTPUT_TOKENS };

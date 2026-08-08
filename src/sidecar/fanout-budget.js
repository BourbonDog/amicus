// src/sidecar/fanout-budget.js
'use strict';

/**
 * @module sidecar/fanout-budget
 * runFanout's pre-flight spend gate (§1b), extracted from src/sidecar/fanout.js —
 * which sits three lines under the 300-line size gate and had no room for the
 * v4.4 reservation seam. Behaviour of the extracted half is unchanged; the
 * reservation is the only addition.
 *
 * WHY THE RESERVATION EXISTS (v4.4 cost-council finding 1). `checkBudget`
 * compares the wave's pre-flight ESTIMATE against a `maxCost` NUMBER that the
 * caller read at some earlier moment. The council driver launches Stage-1's seat
 * wave and critic wave concurrently under a single `Promise.all`, and each
 * launcher read `remainingBudget()` before EITHER wave's legs had been recorded
 * — so both observed the full, unreduced allowance and both could pass a ceiling
 * that only one of them fits under. The read is not the claim.
 *
 * `options.reserveBudget(estimate) -> boolean` closes that: it is a SYNCHRONOUS
 * read-and-claim against the allowance not already claimed by a sibling wave
 * that is mid-launch. Being synchronous is the whole guarantee — the event loop
 * cannot interleave two callers inside it, so the second caller necessarily sees
 * the first caller's claim. See src/council/run-budget.js for the ledger.
 *
 * It is OPT-IN: every non-council caller (the `amicus fanout` CLI, `amicus run`)
 * omits it and gets the byte-identical pre-v4.4 gate.
 */

/**
 * @param {Array<{modelInput,model,pricing}>} okLegs legs that actually routed
 * @param {object} options runFanout options (maxCost, maxCostPerMtok, noCostGate,
 *   promptMeta/prompt, and the optional `reserveBudget` claim function)
 * @returns {{ok:true, estimate?:number}|{ok:false, message:string, hint:string}}
 */
function preflightBudget(okLegs, options) {
  // `--no-cost-gate` is a WHOLE-RUN opt-out of BOTH guards (an intentional
  // o3-class council), so it must also skip the reservation — otherwise the
  // council would still serialize its allowance for a ceiling it has disowned.
  if (options.noCostGate) { return { ok: true }; }

  const { checkBudget, formatBudgetError } = require('./budget');
  const { loadConfig } = require('../utils/config');
  const cfg = loadConfig() || {};
  const maxCostPerMtok = options.maxCostPerMtok !== undefined ? options.maxCostPerMtok : cfg.maxCostPerMtok;
  const promptChars = (options.promptMeta && options.promptMeta.chars)
    || (options.prompt ? options.prompt.length : 0);
  const maxCost = options.maxCost !== null && options.maxCost !== undefined ? options.maxCost : cfg.maxCost;

  const budget = checkBudget(okLegs, { maxCostPerMtok, maxCost, promptChars });
  if (!budget.ok) {
    return { ok: false, message: 'Error: budget gate refused the wave', hint: formatBudgetError(budget) };
  }

  // Claim AFTER the hard per-$/Mtok threshold has passed: a wave that is going
  // to be refused for an over-priced model must not consume allowance on its
  // way out and starve a sibling that would have fit.
  const estimate = budget.breakdown.totalEstCost;
  if (typeof options.reserveBudget === 'function' && !options.reserveBudget(estimate)) {
    return {
      ok: false,
      message: 'Error: budget gate refused the wave',
      hint: `Budget gate: estimated total $${estimate.toFixed(4)} does not fit the --max-cost `
        + 'allowance still unclaimed by concurrently launching waves (estimate, not guaranteed).\n'
        + 'The run continues with the waves that did launch.',
    };
  }
  return { ok: true, estimate };
}

module.exports = { preflightBudget };

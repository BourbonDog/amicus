// src/sidecar/fanout-validate.js
'use strict';

/**
 * @module fanout-validate
 * Fan-out --models parsing + per-leg gateway routing. Split out of fanout.js
 * (#61 Task 7.3) to keep both files under the 300-line size gate — this
 * module owns everything about turning a raw --models string into resolved
 * (or per-leg-failed) legs; fanout.js owns running the wave itself.
 */

/** Default max legs per wave (env-overridable). */
const DEFAULT_MAX_LEGS = 10;

/**
 * Split a --models value into trimmed, non-empty entries (duplicates allowed).
 * @param {string|boolean|undefined} modelsArg
 * @returns {string[]}
 */
function parseModelsList(modelsArg) {
  if (typeof modelsArg !== 'string') { return []; }
  return modelsArg.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Resolve + gate every requested model through the gateway router (#61 Task
 * 7.3), one leg at a time. Unlike the pre-#61 fail-fast validator, an
 * individual leg's routing failure does NOT abort the whole wave: it comes
 * back with `ok:false` and the router's RouteResult attached, so runFanout
 * can synthesize a failed leg document (buildRoutingFailureLeg) while sibling
 * legs still launch normally. Only whole-list problems — an empty list or
 * exceeding the leg-count cap — remain wave-level fatal and are returned as
 * a top-level `{error, code}` (nothing to route yet at that point).
 * @param {string} modelsArg - Raw --models value
 * @param {{noValidateModel?: boolean, gatewayMode?: string}} [opts]
 * @returns {Promise<{legs: Array<{modelInput: string, ok: boolean, model?: string,
 *   pricing?: object, gateway?: string, provenance?: object, routeResult?: object}>}
 *   | {error: string, code: string}>}
 */
async function validateFanoutModels(modelsArg, opts = {}) {
  const raw = parseModelsList(modelsArg);
  if (raw.length === 0) {
    return { error: 'Error: --models requires a comma-separated list (e.g. gemini,gpt,deepseek)', code: 'BAD_ARGS' };
  }
  // Invalid or non-positive AMICUS_FANOUT_MAX_LEGS (0, negative, garbage) falls back to the default.
  const envCap = Number(process.env.AMICUS_FANOUT_MAX_LEGS);
  const maxLegs = (Number.isInteger(envCap) && envCap > 0) ? envCap : DEFAULT_MAX_LEGS;
  if (raw.length > maxLegs) {
    return { error: `Error: --models exceeds the fan-out cap of ${maxLegs} legs (set AMICUS_FANOUT_MAX_LEGS to raise)`, code: 'BAD_ARGS' };
  }

  const { resolveRouteForLaunch } = require('../utils/route-launch');
  const { lookupPricing } = require('../utils/pricing');
  const validateModel = !opts.noValidateModel;
  const gatewayMode = opts.gatewayMode || 'auto';
  const legs = [];
  for (const modelInput of raw) {
    const routeResult = await resolveRouteForLaunch({
      model: modelInput, gatewayMode, source: 'cli', allowSelection: false, validateModel,
    });
    if (routeResult.kind === 'resolved') {
      legs.push({
        modelInput, ok: true, model: routeResult.executableId,
        pricing: lookupPricing(routeResult.executableId),
        gateway: routeResult.gateway, provenance: routeResult.provenance,
      });
    } else {
      // 'error' (headless: allowSelection false, so the router never hands
      // back 'selection_required' here — see gateway-router.js's catalogGate).
      legs.push({ modelInput, ok: false, routeResult });
    }
  }
  return { legs };
}

module.exports = { parseModelsList, DEFAULT_MAX_LEGS, validateFanoutModels };

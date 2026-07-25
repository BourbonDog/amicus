// src/sidecar/fanout-validate.js
'use strict';

const { logger } = require('../utils/logger');

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
 * @param {{noValidateModel?: boolean, gatewayMode?: string, fallback?: object,
 *   catalog?: Array}} [opts] `fallback`/`catalog` (v4.3 Task 18, spec §6.2) are
 *   additive: when `fallback.enabled`, every resolved primary's chain
 *   candidates are pre-resolved so the shared server can register them (see
 *   `serverModels` below); omitted/disabled callers are unaffected.
 * @returns {Promise<{legs: Array<{modelInput: string, ok: boolean, model?: string,
 *   pricing?: object, gateway?: string, provenance?: object, routeResult?: object}>,
 *   serverModels?: string[]}
 *   | {error: string, code: string}>} `serverModels` (additive) is the UNION of
 *   every resolved primary + its fallback-chain candidates' executable ids —
 *   present only when `opts.fallback.enabled`; the caller falls back to
 *   `okLegs.map(l => l.model)` when absent (unchanged today).
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
        // FIX 2 (#61 whole-branch review): resolveRouteForLaunch already
        // burned the one-shot migration_notified flag for this vendor when it
        // built routeResult — carry the notice out so runFanout can surface
        // it on the wave doc (fanout had no other path to show it).
        notice: routeResult.notice || null,
      });
    } else {
      // 'error' (headless: allowSelection false, so the router never hands
      // back 'selection_required' here — see gateway-router.js's catalogGate).
      legs.push({ modelInput, ok: false, routeResult });
    }
  }

  // v4.3 Task 18 (spec §6.2 sole-input invariant): when fallback substitution
  // is enabled, pre-resolve every resolved primary's chain candidates and
  // register the UNION of primary + candidate executable ids on the shared
  // server — a substitute that never runs must still be an allowed model if
  // one IS selected mid-wave. An unresolvable candidate is DROPPED (logged),
  // never a wave failure: registration is config, not spend.
  let serverModels;
  if (opts.fallback && opts.fallback.enabled) {
    const { deriveChain } = require('./fallback-chains');
    const ids = new Set(legs.filter(l => l.ok).map(l => l.model));
    for (const leg of legs) {
      if (!leg.ok) { continue; }
      const chain = deriveChain(leg.model, { config: { chains: opts.fallback.chains }, catalog: opts.catalog });
      for (const candidate of chain) {
        let route;
        try {
          route = await resolveRouteForLaunch({ model: candidate, gatewayMode, source: 'fallback', allowSelection: false, validateModel });
        } catch { route = { kind: 'error' }; }
        if (route.kind === 'resolved') {
          ids.add(route.executableId);
        } else {
          logger.warn('Fallback chain candidate failed to route — dropped from server registration', { primary: leg.model, candidate });
        }
      }
    }
    serverModels = [...ids];
  }
  return { legs, serverModels };
}

module.exports = { parseModelsList, DEFAULT_MAX_LEGS, validateFanoutModels };

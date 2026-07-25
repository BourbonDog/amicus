// src/sidecar/fallback-chains.js
'use strict';

/**
 * @module fallback-chains
 * Opt-in cheaper-model fallback chains (spec 6.2, resolved Q2). Default OFF;
 * per-run --fallback/--no-fallback overrides config. Explicit chains win;
 * otherwise a default chain is DERIVED from model-tiers by walking DOWN the
 * failed model's vendor tiers (frontier -> balanced -> economy), keeping only
 * entries CHEAPER than the failed model. Gateway-only + unknown vendors get
 * no default chain (the leg fails as today). Chain entries may be aliases or
 * full ids, including openrouter/... (so "same model, other gateway" is
 * expressible).
 */

const { resolveTier, TIER_ORDER } = require('../utils/model-tiers');

const DEFAULT_MAX_SUBSTITUTIONS = 2;

/** Merge user config `fallbacks` with the per-run flag (flag wins). */
function resolveFallbackConfig({ flagFallback, config } = {}) {
  const fb = (config && config.fallbacks) || {};
  let enabled = fb.enabled === true;
  if (flagFallback === true) { enabled = true; }
  if (flagFallback === false) { enabled = false; }
  return {
    enabled,
    maxSubstitutions: Number.isInteger(fb.maxSubstitutions) ? fb.maxSubstitutions : DEFAULT_MAX_SUBSTITUTIONS,
    chains: fb.chains || {},
  };
}

/** Vendor segment for tier lookup; a bare alias returns itself (config key). */
function vendorOf(model) {
  let id = String(model || '');
  if (id.startsWith('openrouter/')) { id = id.slice('openrouter/'.length); }
  const slash = id.indexOf('/');
  return slash > 0 ? id.slice(0, slash) : id;
}

/** Explicit chain, else the tier-walk default. A substitute must be cheaper. */
function deriveChain(model, { config, catalog } = {}) {
  const chains = (config && config.chains) || {};
  // explicit chain keyed by the bare alias OR the vendor
  const key = chains[model] ? model : (chains[vendorOf(model)] ? vendorOf(model) : null);
  if (key) { return chains[key].slice(); }

  // tier-walk default: frontier -> balanced -> economy (most -> least capable)
  const vendor = vendorOf(model);
  const ordered = [];
  for (const tier of [...TIER_ORDER].reverse()) {
    const id = resolveTier(vendor, tier, catalog || []);
    if (id && !ordered.includes(id)) { ordered.push(id); } // do NOT drop the failed model here
  }
  // Keep only tiers CHEAPER than the failed model (strictly after its position
  // in the most->least-capable ladder). This drops the failed model AND
  // everything more capable — a substitute must be cheaper (spec 6.2). If the
  // failed model is not a current tier pick (e.g. a slightly-stale id), fall
  // back to the full vendor ladder minus the exact model (best-effort;
  // bounded misclassification cost).
  const failedIdx = ordered.indexOf(model);
  return failedIdx === -1 ? ordered.filter((id) => id !== model) : ordered.slice(failedIdx + 1);
}

module.exports = { resolveFallbackConfig, deriveChain, vendorOf, DEFAULT_MAX_SUBSTITUTIONS };

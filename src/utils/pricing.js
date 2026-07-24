// src/utils/pricing.js
'use strict';

/**
 * @module pricing
 * Token aggregation + cached-pricing lookup + layered cost resolution (WS-2 #2).
 * Cost is resolved in layers and ALWAYS tagged with its source so it can never
 * be mistaken for an authoritative figure it isn't:
 *   reported  — OpenCode billed cost (msg.info.cost > 0)
 *   estimated — tokens × cached catalog pricing
 *   unknown   — neither available (e.g. a direct provider with pricing:null)
 */

function emptyUsageTotals() {
  return { tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, costReported: 0 };
}

/**
 * Sum per-message usage. The poll loop re-reads ALL messages each poll, so the
 * caller stores the latest snapshot per message id in a Map; summing the Map's
 * values avoids double-counting streamed growth.
 * @param {Map<string,{tokens?:object, cost?:number}>} map
 */
function sumPerMessageUsage(map) {
  const totals = emptyUsageTotals();
  for (const v of map.values()) {
    const t = v && v.tokens ? v.tokens : {};
    totals.tokens.input += t.input || 0;
    totals.tokens.output += t.output || 0;
    totals.tokens.reasoning += t.reasoning || 0;
    totals.tokens.cacheRead += (t.cache && t.cache.read) || 0;
    totals.tokens.cacheWrite += (t.cache && t.cache.write) || 0;
    if (typeof v.cost === 'number') { totals.costReported += v.cost; }
  }
  return totals;
}

/** Sync, non-refreshing cached-pricing lookup by full route id. @returns {{prompt,completion}|null} */
function lookupPricing(modelId) {
  if (!modelId) { return null; }
  let cache;
  try { cache = require('./model-catalog').readCache(); } catch { cache = null; }
  const rows = (cache && Array.isArray(cache.models)) ? cache.models : [];
  const row = rows.find(m => m && m.id === modelId);
  if (row && row.pricing) {
    const prompt = Number(row.pricing.prompt);
    const completion = Number(row.pricing.completion);
    if (Number.isFinite(prompt) && Number.isFinite(completion) && prompt >= 0 && completion >= 0) {
      return { prompt, completion };
    }
  }
  // v4.2 §4.5: local vendor with no catalog row → the provider's configured pricing (default zeros).
  try {
    const vendor = modelId.split('/')[0];
    const { isLocalProvider, getLocalProviders } = require('./local-providers');
    if (isLocalProvider(vendor)) {
      const entry = getLocalProviders()[vendor];
      const p = (entry && entry.pricing) || { prompt: 0, completion: 0 };
      return { prompt: Number(p.prompt) || 0, completion: Number(p.completion) || 0 };
    }
  } catch { /* fall through */ }
  return null;
}

/** @returns {{amount:number|null, currency:'USD', source:'reported'|'estimated'|'unknown'}} */
function resolveLegCost({ reportedCost, tokens, pricing }) {
  if (typeof reportedCost === 'number' && reportedCost > 0) {
    return { amount: reportedCost, currency: 'USD', source: 'reported' };
  }
  if (pricing && tokens) {
    const est = (tokens.input || 0) * pricing.prompt + (tokens.output || 0) * pricing.completion;
    // v4.2 §4.5: a genuine $0 estimate is a REAL priced tier (not unknown/null).
    if (est >= 0) { return { amount: est, currency: 'USD', source: 'estimated' }; }
  }
  return { amount: null, currency: 'USD', source: 'unknown' };
}

/** Resolve a single run/leg's final usage block from raw totals + the model id. */
function resolveUsage({ model, usageTotals }) {
  const totals = usageTotals || emptyUsageTotals();
  const cost = resolveLegCost({ reportedCost: totals.costReported, tokens: totals.tokens, pricing: lookupPricing(model) });
  return { tokens: totals.tokens, cost };
}

/** Aggregate leg usage into a wave-level usage block. Legs without usage count as unpriced. */
function sumWaveUsage(legs) {
  const tokens = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
  let amount = 0; let anyAmount = false;
  let reportedLegs = 0, estimatedLegs = 0, unpricedLegs = 0;
  for (const leg of legs) {
    const u = leg && leg.usage;
    if (!u || !u.cost) { unpricedLegs++; continue; }
    for (const k of Object.keys(tokens)) { tokens[k] += (u.tokens && u.tokens[k]) || 0; }
    if (typeof u.cost.amount === 'number') { amount += u.cost.amount; anyAmount = true; }
    if (u.cost.source === 'reported') { reportedLegs++; }
    else if (u.cost.source === 'estimated') { estimatedLegs++; }
    else { unpricedLegs++; }
  }
  let source;
  if (reportedLegs > 0 && estimatedLegs === 0 && unpricedLegs === 0) { source = 'reported'; }
  else if (estimatedLegs > 0 && reportedLegs === 0 && unpricedLegs === 0) { source = 'estimated'; }
  else if (reportedLegs === 0 && estimatedLegs === 0) { source = 'unknown'; }
  else { source = 'mixed'; }
  return { tokens, cost: { amount: anyAmount ? amount : null, currency: 'USD', source, reportedLegs, estimatedLegs, unpricedLegs } };
}

/**
 * Render a resolved cost object for humans. Never invents precision: a null
 * amount is '—' (or '?' when the source is explicitly 'unknown'); estimated /
 * mixed costs are marked with '~' so they can't be read as authoritative.
 * @param {{amount:number|null, source:string}|null|undefined} cost
 * @returns {string}
 */
function formatCost(cost) {
  if (!cost || cost.amount === null || cost.amount === undefined) {
    return cost && cost.source === 'unknown' ? '?' : '—';
  }
  const dollars = cost.amount < 1 ? `$${cost.amount.toFixed(4)}` : `$${cost.amount.toFixed(2)}`;
  return (cost.source === 'estimated' || cost.source === 'mixed') ? `~${dollars}` : dollars;
}

module.exports = { emptyUsageTotals, sumPerMessageUsage, lookupPricing, resolveLegCost, resolveUsage, sumWaveUsage, formatCost };

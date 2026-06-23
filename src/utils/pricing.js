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
  try { cache = require('./model-catalog').readCache(); } catch { return null; }
  if (!cache || !Array.isArray(cache.models)) { return null; }
  const row = cache.models.find(m => m && m.id === modelId);
  if (!row || !row.pricing) { return null; }
  const prompt = Number(row.pricing.prompt);
  const completion = Number(row.pricing.completion);
  if (!Number.isFinite(prompt) || !Number.isFinite(completion) || prompt < 0 || completion < 0) { return null; }
  return { prompt, completion };
}

/** @returns {{amount:number|null, currency:'USD', source:'reported'|'estimated'|'unknown'}} */
function resolveLegCost({ reportedCost, tokens, pricing }) {
  if (typeof reportedCost === 'number' && reportedCost > 0) {
    return { amount: reportedCost, currency: 'USD', source: 'reported' };
  }
  if (pricing && tokens) {
    const est = (tokens.input || 0) * pricing.prompt + (tokens.output || 0) * pricing.completion;
    if (est > 0) { return { amount: est, currency: 'USD', source: 'estimated' }; }
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

module.exports = { emptyUsageTotals, sumPerMessageUsage, lookupPricing, resolveLegCost, resolveUsage, sumWaveUsage };

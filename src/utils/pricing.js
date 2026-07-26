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

/**
 * Did we actually OBSERVE any token usage for this leg? (v4.4 B2)
 *
 * This is the predicate that separates "the provider billed us for a $0 tier"
 * from "we never saw a usage payload at all" — a distinction the old
 * `pricing && tokens` guard could not make, because it only inspected the
 * PRICE. Accepts both the normalized totals shape (cacheRead/cacheWrite, as
 * produced by sumPerMessageUsage) and OpenCode's raw per-message shape
 * (`cache: {read, write}`), so callers holding either can ask one question.
 * @param {object|null|undefined} tokens
 * @returns {boolean}
 */
function hasObservedTokens(tokens) {
  if (!tokens || typeof tokens !== 'object') { return false; }
  const cache = tokens.cache && typeof tokens.cache === 'object' ? tokens.cache : {};
  const cacheRead = tokens.cacheRead || cache.read || 0;
  const cacheWrite = tokens.cacheWrite || cache.write || 0;
  return (tokens.input || 0) > 0 || (tokens.output || 0) > 0
    || (tokens.reasoning || 0) > 0 || cacheRead > 0 || cacheWrite > 0;
}

/** @returns {{amount:number|null, currency:'USD', source:'reported'|'estimated'|'unknown'}} */
function resolveLegCost({ reportedCost, tokens, pricing }) {
  if (typeof reportedCost === 'number' && reportedCost > 0) {
    return { amount: reportedCost, currency: 'USD', source: 'reported' };
  }
  // v4.4 B2: an all-zero token total is an ABSENCE OF OBSERVATION, not a $0
  // bill. Pricing it as `0 × catalog = estimated $0` asserts "this seat was
  // free" — a claim we cannot support, and one that silently under-counted the
  // --max-cost ceiling on real paid runs (diagnosis §0: council-wsgate02 spent
  // $0.9859 against a $0.75 ceiling while spent() believed $0.3720).
  // The v4.2 §4.5 free-local-tier carve-out is DELIBERATELY preserved: a local
  // Ollama/LM Studio seat legitimately costs $0 but still reports tokens, so
  // hasObservedTokens() is true for it and it still resolves to `estimated $0`.
  // Only a leg where we observed no tokens at all falls through to `unknown`.
  if (pricing && hasObservedTokens(tokens)) {
    const est = (tokens.input || 0) * pricing.prompt + (tokens.output || 0) * pricing.completion;
    if (est >= 0) { return { amount: est, currency: 'USD', source: 'estimated' }; }
  }
  return { amount: null, currency: 'USD', source: 'unknown' };
}

/**
 * Resolve a single run/leg's final usage block from raw totals + the model id.
 *
 * @param {object} opts
 * @param {string} opts.model full route id
 * @param {object} opts.usageTotals sumPerMessageUsage output
 * @param {boolean} [opts.subtreeUnknown] v4.4 Task 2 — this leg made a SUBAGENT
 *   (`task`) tool call, so it has spend in a CHILD OpenCode session that is billed
 *   separately, is NOT rolled into the parent session's cost, and that amicus
 *   never enumerates. The leg's OWN cost may be perfectly `reported`; what is
 *   unknown is its SUBTREE. Kept as a distinct concept from an unpriced leg
 *   (which means "we observed no tokens at all") because they are different
 *   statements and a reader must be able to tell them apart. Set only when true
 *   so an ordinary leg's usage block stays byte-identical.
 */
function resolveUsage({ model, usageTotals, subtreeUnknown }) {
  const totals = usageTotals || emptyUsageTotals();
  const cost = resolveLegCost({ reportedCost: totals.costReported, tokens: totals.tokens, pricing: lookupPricing(model) });
  return subtreeUnknown
    ? { tokens: totals.tokens, cost, subtreeUnknown: true }
    : { tokens: totals.tokens, cost };
}

/**
 * Aggregate leg usage into a wave-level usage block. Legs without usage count as
 * unpriced; legs carrying `subtreeUnknown` are counted separately in
 * `subtreeUnknownLegs` — a fully-priced wave can still have an incomplete total.
 */
function sumWaveUsage(legs) {
  const tokens = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
  let amount = 0; let anyAmount = false;
  let reportedLegs = 0, estimatedLegs = 0, unpricedLegs = 0, subtreeUnknownLegs = 0;
  for (const leg of legs) {
    const u = leg && leg.usage;
    if (u && u.subtreeUnknown) { subtreeUnknownLegs++; }
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
  return { tokens, cost: { amount: anyAmount ? amount : null, currency: 'USD', source, reportedLegs, estimatedLegs, unpricedLegs, subtreeUnknownLegs } };
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

module.exports = { emptyUsageTotals, sumPerMessageUsage, lookupPricing, hasObservedTokens,
  resolveLegCost, resolveUsage, sumWaveUsage, formatCost };

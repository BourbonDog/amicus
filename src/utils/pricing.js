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
 * Did we actually OBSERVE tokens THIS MODULE'S ESTIMATE CAN PRICE? (v4.4 B2,
 * narrowed by v4.4.1 CA-7)
 *
 * This is the predicate that separates "the provider billed us for a $0 tier"
 * from "we never saw a usage payload at all" — a distinction the old
 * `pricing && tokens` guard could not make, because it only inspected the
 * PRICE. It reads the normalized totals shape (input/output, as produced by
 * sumPerMessageUsage) and OpenCode's raw per-message shape alike, because both
 * carry `input`/`output` at the top level.
 *
 * ⚠️ CA-7: deliberately narrower than "did we see any token count at all". The
 * estimate in resolveLegCost prices input/output ONLY, so accepting
 * cacheRead/cacheWrite — and `reasoning`, which this predicate also used to
 * accept and which the estimate likewise never prices — let a leg observed with
 * none of input/output pass the observation gate and resolve to `estimated $0`:
 * the same false-zero class the v4.4 observed-tokens fix exists to kill, in the
 * one corner its predicate did not cover. Such a leg is now `unknown`, which is
 * true, rather than free, which is not. Pricing cache or reasoning tokens
 * properly needs catalog fields that may not exist; when they do, widen this and
 * the estimate together, never one alone.
 *
 * Live-validated 2026-07-26: a real local leg reports `input: 25953, output: 3`,
 * so the shipped v4.2 free-local `$0` promise (a local seat costs nothing but
 * still reports real input/output) is untouched — tests/pricing-local.test.js
 * is the standing guard on that.
 * @param {object|null|undefined} tokens
 * @returns {boolean}
 */
function hasObservedTokens(tokens) {
  if (!tokens || typeof tokens !== 'object') { return false; }
  return (tokens.input || 0) > 0 || (tokens.output || 0) > 0;
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
  // v4.4.1 CA-7: a leg with no input/output falls through to `unknown` even when
  // it reported cache or reasoning tokens — those are real observations, but not
  // ones THIS estimate can turn into a price, so calling the result $0 would be
  // the same fabrication one corner over. See hasObservedTokens above.
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
 *   (`task`) tool call whose CHILD OpenCode session is billed separately, is NOT
 *   rolled into the parent session's cost, and could NOT be enumerated (or could
 *   only be walked in part). The leg's OWN cost may be perfectly `reported`; what
 *   is unknown is its SUBTREE. Kept as a distinct concept from an unpriced leg
 *   (which means "we observed no tokens at all") because they are different
 *   statements and a reader must be able to tell them apart. Set only when true
 *   so an ordinary leg's usage block stays byte-identical.
 * @param {{sessions: number, tokens: object, costReported: number}} [opts.subtree]
 *   v4.4.1 CA-1 — the child sessions that WERE enumerated and priced
 *   (src/sidecar/child-sessions.js). Attached beside the leg's own cost rather
 *   than folded into it: `cost` keeps meaning "this leg's own session", which is
 *   what every existing reader already assumes, and the subtree is a separate
 *   measurement that the wave rollup adds on top. Folding them together would
 *   also let a measured child amount launder an UNKNOWN parent into a
 *   `reported`-looking number — `council-wsgate02/wsgate02-s1-3` is exactly that
 *   shape (own cost unknown, child session $0.471046).
 */
function resolveUsage({ model, usageTotals, subtreeUnknown, subtree }) {
  const totals = usageTotals || emptyUsageTotals();
  const cost = resolveLegCost({ reportedCost: totals.costReported, tokens: totals.tokens, pricing: lookupPricing(model) });
  const usage = { tokens: totals.tokens, cost };
  if (subtree && subtree.sessions > 0) {
    const amount = subtree.costReported;
    usage.subtree = {
      sessions: subtree.sessions,
      tokens: subtree.tokens || emptyUsageTotals().tokens,
      // A child session's price comes from OpenCode's own billing, never from a
      // catalog estimate (the SDK's Session record carries no model id, so an
      // estimate would be a guess). Children that exist but reported nothing are
      // `unknown` — the B2 rule one level down, and never a $0 claim.
      cost: amount > 0
        ? { amount, currency: 'USD', source: 'reported' }
        : { amount: null, currency: 'USD', source: 'unknown' },
    };
  }
  if (subtreeUnknown) { usage.subtreeUnknown = true; }
  return usage;
}

/**
 * Aggregate leg usage into a wave-level usage block. Legs without usage count as
 * unpriced; legs carrying `subtreeUnknown` are counted separately in
 * `subtreeUnknownLegs` — a fully-priced wave can still have an incomplete total.
 *
 * v4.4.1 CA-1: a leg's enumerated CHILD-session spend (`usage.subtree`) is added
 * to the wave total here, and reported separately as `subtreeCost` /
 * `subtreeSessions` so a reader can always see how much of the total came from
 * subagents. It is added INDEPENDENTLY of whether the leg's own cost resolved —
 * they are two different measurements, and dropping a measured child amount
 * because its parent is unknown would be a second under-report on top of the
 * one this whole change exists to close.
 */
function sumWaveUsage(legs) {
  const tokens = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
  let amount = 0; let anyAmount = false;
  let reportedLegs = 0, estimatedLegs = 0, unpricedLegs = 0, subtreeUnknownLegs = 0;
  let subtreeCost = 0, subtreeSessions = 0;
  for (const leg of legs) {
    const u = leg && leg.usage;
    if (u && u.subtreeUnknown) { subtreeUnknownLegs++; }
    const st = u && u.subtree;
    if (st && st.cost && typeof st.cost.amount === 'number') {
      amount += st.cost.amount; anyAmount = true;
      subtreeCost += st.cost.amount; subtreeSessions += st.sessions || 0;
    }
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
  return { tokens, cost: { amount: anyAmount ? amount : null, currency: 'USD', source,
    reportedLegs, estimatedLegs, unpricedLegs, subtreeUnknownLegs, subtreeCost, subtreeSessions } };
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

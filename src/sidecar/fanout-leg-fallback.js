// src/sidecar/fanout-leg-fallback.js
'use strict';

/**
 * @module fanout-leg-fallback
 * Cheaper-model fallback substitution (spec 6.2), split out of fanout-leg.js
 * to keep both files ≤300 lines (mirrors the fanout.js/fanout-validate.js
 * split). Owns the substitution loop + its two bookkeeping helpers.
 * `runSingleAttempt` is lazy-required from ./fanout-leg (function-scoped, to
 * avoid a load-time circular require — fanout-leg.js requires this module for
 * its thin runLeg wrapper).
 */

const fs = require('fs');
const { logger } = require('../utils/logger');
const { classifyLegError, isRetryable } = require('../utils/error-classify');
const { deriveChain } = require('./fallback-chains');

/**
 * Append ONE attributed ledger row for a single attempt (spec 6.2/7.1). At
 * `attempt:0` this is byte-identical to today's pre-fallback appendSpend row
 * (same fields, sourced from `leg.attempt`/`leg.substitutedFor`/
 * `leg.retryOfWaveId`, all undefined -> omitted for a plain leg). A
 * substitution (`attempt` param > 0, the LOOP's attempt index) overrides
 * `row.attempt`/`row.substitutedFor` with the substitution's own values.
 * Best-effort — never throws, never affects the leg. `deps.spendDir` (tests)
 * routes the write to a scratch dir; production leaves it undefined.
 */
function recordAttemptSpend({ doc, leg, currentModel, legId, waveId, project, attempt, originalModel, routeGateway }, deps = {}) {
  const usage = doc && doc.usage;
  if (!usage) { return; }
  try {
    const { appendSpend } = deps.spendLedger || require('../utils/spend-ledger');
    // Resolved legs carry the router's gateway on `leg.gateway` (attempt 0);
    // a substitution carries the substitute's resolved gateway on
    // `routeGateway` (threaded in by the loop, incl. v4.2 'local').
    const gateway = routeGateway || (leg && leg.gateway) ||
      (String(currentModel).startsWith('openrouter/') ? 'openrouter' : 'direct');
    const row = {
      taskId: legId, waveId, model: currentModel, mode: 'leg', usage,
      op: 'leg', status: doc.status, gateway,
      councilRunId: leg && leg.councilRunId, councilName: leg && leg.councilName,
      project, attempt: leg && leg.attempt, substitutedFor: leg && leg.substitutedFor,
      retryOfWaveId: leg && leg.retryOfWaveId,
    };
    if (attempt > 0) { row.attempt = attempt; row.substitutedFor = originalModel; }
    appendSpend(row, deps.spendDir ? { dir: deps.spendDir } : undefined);
  } catch { /* best-effort */ }
}

/** Add up a list of token blocks, key by key. */
function foldTokens(blocks) {
  const tokens = {};
  for (const t of blocks) {
    for (const [k, v] of Object.entries(t || {})) { tokens[k] = (tokens[k] || 0) + (v || 0); }
  }
  return tokens;
}

/**
 * Add up a list of resolved cost objects, tagging source 'mixed' when they
 * differ — matching formatCost's `~` behavior so a summed cost never reads as
 * authoritative. `none` is returned when not one of them carried a number,
 * because a sum of nothing is not $0.
 */
function foldCosts(costs, none) {
  let amount = 0;
  let anyCost = false;
  const sources = new Set();
  for (const c of costs) {
    if (c && typeof c.amount === 'number') {
      amount += c.amount;
      anyCost = true;
      if (c.source) { sources.add(c.source); }
    }
  }
  if (!anyCost) { return none; }
  return { amount, currency: 'USD',
    source: sources.size > 1 ? 'mixed' : (sources.values().next().value || 'reported') };
}

/**
 * Fold a leg's attempts[] into ONE usage block. A single-attempt leg returns that
 * attempt's usage verbatim (no behavior change for non-fallback legs).
 *
 * ⚠️ v4.4.1 A1. This used to `return { tokens, cost }` — silently DISCARDING every
 * other key resolveUsage puts on a usage block. The casualty was `subtreeUnknown`:
 * a leg that fell back to a substitute AND left an unattributable subagent subtree
 * lost the flag here, `sumWaveUsage` never counted it in `subtreeUnknownLegs`, and
 * run.json reported `costExact: true` for a total that was not — precisely the lie
 * `costExact` exists to prevent, and reachable only on the fallback path. So the
 * fold now starts from a merge of every attempt's usage and overwrites only the
 * keys it has a real opinion about; anything added to the block later survives by
 * default instead of being dropped by omission.
 *
 * HOW EACH KIND OF KEY FOLDS, and why:
 *  - `tokens` / `cost` — SUMMED. They are per-attempt measurements of one leg's
 *    total consumption; every attempt really was billed.
 *  - `subtreeUnknown` — OR'd. It is a claim about EXACTNESS, not a quantity: if
 *    even one attempt left a subtree it could not account for, the leg's total is
 *    a floor, and that stays true no matter how exact the other attempts were.
 *    Any other fold (last-wins, or requiring every attempt to agree) would let a
 *    later clean attempt erase an earlier attempt's admitted gap.
 *  - `subtree` — SUMMED, not last-wins. Two attempts can each have walked and
 *    PRICED child sessions, and both spent real money; keeping only the last one's
 *    measurement would re-open the same under-report one level down, which
 *    sumWaveUsage's CA-1 docblock explicitly refuses to make.
 *  - anything else — last attempt wins, which is what the merge already does.
 */
function sumAttemptUsage(attempts) {
  const withUsage = (attempts || []).filter(a => a.usage && a.usage.tokens);
  if (withUsage.length === 0) { return null; }
  if (withUsage.length === 1) { return withUsage[0].usage; }
  const usages = withUsage.map(a => a.usage);
  const out = Object.assign({}, ...usages);
  out.tokens = foldTokens(usages.map(u => u.tokens));
  out.cost = foldCosts(usages.map(u => u.cost), null);
  const subtrees = usages.map(u => u.subtree).filter(Boolean);
  if (subtrees.length > 0) {
    out.subtree = {
      sessions: subtrees.reduce((n, s) => n + (s.sessions || 0), 0),
      tokens: foldTokens(subtrees.map(s => s.tokens)),
      cost: foldCosts(subtrees.map(s => s.cost), { amount: null, currency: 'USD', source: 'unknown' }),
    };
  }
  if (usages.some(u => u.subtreeUnknown)) { out.subtreeUnknown = true; }
  return out;
}

/**
 * Per-$/Mtok hard-cap check for ONE fallback substitute candidate (spec
 * §6.2). Minimal inline version of budget.js's checkBudget threshold, applied
 * to a single model instead of a leg list. Unpriced (direct-provider,
 * pricing:null) candidates are never treated as over-cap — unknown cost is
 * not exceeded cost.
 */
function isOverBudgetSubstitute(modelId, maxCostPerMtok) {
  const { lookupPricing } = require('../utils/pricing');
  const { DEFAULT_MAX_COST_PER_MTOK } = require('./budget');
  const pricing = lookupPricing(modelId);
  if (!pricing) { return false; }
  const cap = (typeof maxCostPerMtok === 'number' && maxCostPerMtok > 0) ? maxCostPerMtok : DEFAULT_MAX_COST_PER_MTOK;
  return Math.max(pricing.prompt * 1e6, pricing.completion * 1e6) > cap;
}

/**
 * runLeg with opt-in cheaper-model substitution (spec 6.2). Runs the primary;
 * on a classified rate-limit/overload failure with chain + budget remaining,
 * substitutes the next chain model in the SAME leg dir under the SAME legId
 * (conversation appends; metadata.model tracks the current model, modelInput
 * stays the original). Best-effort bookkeeping (attempts/events/ledger) never
 * fails the leg.
 */
async function runLegWithFallback(args, deps = {}) {
  const { leg, legId, waveId, project, fallback, catalog } = args;
  const runOnce = deps.runOnce || ((a) => require('./fanout-leg').runSingleAttempt(a, deps));
  const resolveRoute = deps.resolveRoute ||
    ((r) => require('../utils/route-launch').resolveRouteForLaunch(r));
  const { getSessionDir } = require('../session-manager');
  const { appendEvent } = require('../observe/events');
  const waveDir = getSessionDir(project, waveId);
  // In production the wave dir already exists (fanout.js creates it before
  // any leg launches); this is a defensive no-op there and only matters for
  // a direct/unit-test caller of runLegWithFallback. appendEvent itself never
  // creates directories (spec: best-effort, no side effects beyond the file).
  try { fs.mkdirSync(waveDir, { recursive: true, mode: 0o700 }); } catch { /* best-effort */ }

  const chain = deriveChain(leg.model, { config: { chains: fallback.chains }, catalog });
  const attempts = [];
  let currentModel = leg.model;
  let currentGateway = leg.gateway;
  let reasonClass = null;
  let attempt = 0;    // count of actual runs beyond the primary (bounded by maxSubstitutions)
  let chainIdx = 0;    // chain cursor: candidates tried OR skipped-for-budget, monotonic
  let last;

  for (;;) {
    const startedAt = new Date().toISOString();
    // `model` is threaded BOTH at the top level (test/injected runOnce fakes
    // destructure it directly, e.g. `async ({ model }) => ...`) and nested
    // under `leg.model` (the real runSingleAttempt only reads the latter).
    last = await runOnce({ ...args, leg: { ...leg, model: currentModel }, model: currentModel,
      attempt, substitutedFor: attempt > 0 ? leg.model : undefined });
    attempts.push({ model: currentModel, status: last.status, usage: last.usage || null,
      startedAt, completedAt: new Date().toISOString(), reason: last.reason || last.error || null });

    // record this attempt's spend (one row per attempt — spec 6.2)
    recordAttemptSpend({ doc: last, leg, currentModel, legId, waveId, project, attempt,
      originalModel: leg.model, routeGateway: currentGateway }, deps);

    if (last.status === 'complete') { break; }
    // runSingleAttempt exposes the failure text on both `.reason` (its own
    // alias) and `.error` (the buildRunResult field); an injected runOnce may
    // set only one — read either.
    const cls = classifyLegError(last.reason || last.error);
    if (!fallback.enabled || !isRetryable(cls) || attempt >= fallback.maxSubstitutions || chainIdx >= chain.length) { break; }

    // Walk the chain forward from chainIdx: an over-cap candidate is skipped
    // (spec §6.2 per-$/Mtok guard) and the walk tries the NEXT entry; a
    // route-resolution failure stops the whole loop outright (spec 8).
    let substituteId = null;
    let acceptedGateway = null;
    let routeFailed = false;
    while (chainIdx < chain.length) {
      const next = chain[chainIdx];
      chainIdx += 1;
      let route;
      try { route = await resolveRoute({ model: next, gatewayMode: undefined, source: 'fallback', allowSelection: false, validateModel: false }); }
      catch { route = { kind: 'error' }; }
      // RouteResult is keyed by `.kind` ('resolved'|'selection_required'|'error') — no `.ok` field.
      if (!route || route.kind !== 'resolved') { routeFailed = true; break; }
      const candidateId = route.executableId || route.model || next;
      if (isOverBudgetSubstitute(candidateId, args.maxCostPerMtok)) {
        logger.warn('Fallback substitute over the per-$/Mtok cap — trying the next chain entry', { legId, candidate: candidateId });
        continue;
      }
      substituteId = candidateId;
      acceptedGateway = route.gateway;
      break;
    }
    if (routeFailed || !substituteId) { break; }

    reasonClass = cls;
    appendEvent(waveDir, { event: 'leg-fallback', id: waveId, legId,
      fromModel: currentModel, toModel: substituteId, reason: cls, attempt: attempt + 1 });
    currentModel = substituteId;
    currentGateway = acceptedGateway;
    attempt += 1;
  }

  const finalUsage = sumAttemptUsage(attempts);
  const doc = { ...last, legId, model: currentModel, modelInput: leg.modelInput, usage: finalUsage, attempts };
  if (attempt > 0) { doc.fallback = { from: leg.model, reason: reasonClass, attempts: attempt }; }
  return doc;
}

module.exports = { runLegWithFallback, recordAttemptSpend, sumAttemptUsage };

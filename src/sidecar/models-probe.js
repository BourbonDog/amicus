// src/sidecar/models-probe.js
'use strict';

/**
 * @module models-probe
 * v4.6.2 PR3 (spec §6, D5): `models --check --live` probe tier. Presence in
 * the catalog is not proof of service — a stored alias can point at a model
 * id the catalog still lists but the provider no longer actually serves (the
 * v4.6.1 `gemini` incident: stored `google/gemini-3.1-flash-lite-preview`,
 * catalog-live, silently dead). This module is the check that would have
 * caught it: probe every STORED alias with one ordinary engine leg — real
 * session dir, real spend-ledger row (D5) — on a single quiet fanout wave,
 * and classify each leg served / accepted-but-silent / error.
 *
 * Never called without `--live`; the spend gate lives in the CLI layer
 * (src/sidecar/models.js), not here — this module always spends when called.
 */

/** Probe backstop override (spec D5) — a fixed constant, NOT env-configurable;
 * the env knob (AMICUS_NO_OUTPUT_BACKSTOP_MS) stays the ordinary 120s leg default. */
const PROBE_WINDOW_MS = 30000;

/** Fixed tiny prompt — a probe leg only needs to prove the model answers at all. */
const PROBE_PROMPT = 'Reply with exactly: OK';

/**
 * Classify one leg run-document (buildRunResult shape, src/utils/result-
 * schema.js) per the plan's Global Constraints classification contract.
 * Precedence matters: 'complete' wins outright; otherwise a NO_OUTPUT_
 * BACKSTOP error (PR2's silent-leg detector, armed here at PROBE_WINDOW_MS
 * instead of its 120s default) is the one specific error shape that means
 * "the model accepted the request and never produced a token" rather than an
 * ordinary routing/auth/timeout failure.
 * @param {{status?:string, error?:string|null}} leg
 * @returns {'served'|'accepted-but-silent'|'error'}
 */
function classifyLeg(leg) {
  if (leg.status === 'complete') { return 'served'; }
  if (typeof leg.error === 'string' && /^NO_OUTPUT_BACKSTOP:/.test(leg.error)) { return 'accepted-but-silent'; }
  return 'error';
}

/**
 * Stored (user-config) aliases only — the `--live` probe's scope (spec §6):
 * defaults/curated-route rows follow the catalog by construction and have no
 * "was it actually served" question for a live probe to answer. Exported so
 * the CLI's cap pre-check (models.js) and this module share one predicate.
 * @param {Array<{source:string}>} sources collectAliasSources() output
 * @returns {Array<{alias:string,model:string,source:string}>}
 */
function selectStoredAliases(sources) {
  return sources.filter(s => s.source === 'user-config');
}

/**
 * Probe every STORED alias with one ordinary engine leg (real session dirs,
 * real spend rows — D5) on one quiet fanout wave. Returns per-alias outcomes;
 * never called without --live (the spend gate lives in the CLI layer).
 * @param {{project?:string}} opts
 * @param {{runFanout?:Function, collectAliasSources?:Function}} [deps]
 * @returns {Promise<{results:Array<{alias:string,target:string,outcome:'served'|'accepted-but-silent'|'error',detail:string|null,cost:number|null}>, waveId:string|null}>}
 */
async function probeStoredAliases(opts = {}, deps = {}) {
  const collectAliasSources = deps.collectAliasSources || require('../utils/alias-audit').collectAliasSources;
  const runFanout = deps.runFanout || require('./fanout').runFanout;

  const stored = selectStoredAliases(collectAliasSources());
  if (stored.length === 0) { return { results: [], waveId: null }; }

  // runFanout's `models` is the same comma-separated STRING the CLI --models
  // flag takes (validateFanoutModels -> parseModelsList splits it back apart)
  // — NOT an array; see council/run-launch.js's launchWave for the identical
  // `.join(',')` seam. An array here would parse to [] and fail the whole
  // wave with BAD_ARGS.
  const { wave } = await runFanout({
    models: stored.map(s => s.model).join(','),
    prompt: PROBE_PROMPT,
    quiet: true,
    noOutputBackstopMs: PROBE_WINDOW_MS,
    timeout: 2, // minutes — the overall ceiling behind the backstop
    project: opts.project,
  });

  // Positional zip, not a model-id lookup: deriveLegIds (fanout.js) assigns
  // legs 1:1 in --models order, and two stored aliases may legitimately share
  // one target model, so a leg's own identity can't disambiguate which alias
  // it answers for — only its index can.
  const legs = (wave && wave.legs) || [];
  const results = stored.map((s, i) => {
    const leg = legs[i] || {};
    const outcome = classifyLeg(leg);
    const cost = (leg.usage && leg.usage.cost && typeof leg.usage.cost.amount === 'number')
      ? leg.usage.cost.amount
      : null;
    return {
      alias: s.alias,
      target: s.model,
      outcome,
      detail: outcome === 'served' ? null : (leg.error || null),
      cost,
    };
  });

  return { results, waveId: (wave && wave.waveId) || null };
}

module.exports = { probeStoredAliases, selectStoredAliases, PROBE_WINDOW_MS, PROBE_PROMPT };

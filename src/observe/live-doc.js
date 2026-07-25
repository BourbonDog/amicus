// src/observe/live-doc.js
'use strict';

/**
 * @module observe/live-doc
 * Surface C (spec 4.3): the composed live doc is the amicus_status rollup with
 * an additive `view:'live'` marker + per-leg usage. This module owns the WAVE +
 * single-session composed shape. (DE-ROT: the COUNCIL composed doc is built in
 * src/mcp-council-awareness.js:buildCouncilStatusPayload, NOT here — Task 9 Step 5
 * marks it live + adds per-stage usage there.) Cost is resolved at READ time from progress.json's raw
 * usage (spec 4.1) so pricing stays current; cost-by-seat NEVER touches a
 * ledger (A8). The `type` is deliberately NOT renamed (resolved Q8) — `view`
 * disambiguates live composed docs from terminal wave.json/run.json.
 */

const { resolveUsage, sumWaveUsage } = require('../utils/pricing');

const TERMINAL = new Set(['complete', 'partial', 'error', 'crashed', 'aborted', 'timeout', 'idle-timeout']);

/** Attach read-time-resolved usage to a leg from its raw progress usage. */
function enrichLegUsage(leg, progressUsage) {
  if (!progressUsage || !progressUsage.tokens) { return leg; }
  const resolved = resolveUsage({ model: leg.model, usageTotals: progressUsage });
  return { ...leg, usage: { tokens: resolved.tokens, cost: resolved.cost } };
}

/** Stamp view:'live' on a non-terminal composed doc; no-op when terminal. */
function markLive(doc) {
  if (doc && !TERMINAL.has(doc.status)) { doc.view = 'live'; }
  return doc;
}

/** Sum enriched leg usage into a wave-level {tokens, cost} rollup. */
function rollupWaveUsage(legs) {
  return sumWaveUsage((legs || []).map((l) => ({ usage: l.usage })));
}

module.exports = { enrichLegUsage, markLive, rollupWaveUsage, TERMINAL };

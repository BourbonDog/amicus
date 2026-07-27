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

// ⚠️ v4.4.1 A1: 'timeout' AND 'timed-out' — the codebase genuinely has two spellings for one
// state, written by two different producers, and this set has to cover both.
//   'timeout'   — src/utils/result-schema.js:23 statusFromResult, i.e. the LEG/wave-document and
//                 `--json` run-document vocabulary. Correct, still emitted, stays.
//   'timed-out' — src/sidecar/session-finalize.js:21 resolveTerminalState, i.e. what actually
//                 lands in a session's metadata.json `status` and (since LC-3) progress.json's
//                 terminal stage. It was MISSING here, and this set is the one every observability
//                 reader consults, so three real consequences followed: `amicus watch <taskId>` on
//                 a timed-out single session never exited (watch-render.js:138 polls until
//                 TERMINAL.has(doc.status), and amicus_status stamps metadata.status straight onto
//                 the doc — mcp-server.js:687); a timed-out leg skipped the "prefer metadata.usage
//                 over the stale progress.json snapshot" branch in council-legs.js:162 and reported
//                 an under-counted cost; and markLive kept stamping view:'live' on a finished
//                 single-session doc.
// NOTE this is deliberately NOT the same list as src/utils/result-schema.js:13 TERMINAL_STATUSES
// (the leg set, no 'partial'). Two mirrors of THIS list exist — src/workspace/run-detail.js:26 and
// electron/workspace-ui/live-model.js:14 — byte-identical, held by drift pins. Edit all three.
const TERMINAL = new Set(['complete', 'partial', 'error', 'crashed', 'aborted', 'timeout', 'timed-out', 'idle-timeout']);

/**
 * Attach read-time-resolved usage to a leg from its raw progress usage.
 *
 * v4.4.1 CA-1: the terminal progress record carries the leg's enumerated CHILD
 * (subagent) session spend as `usage.subtree` / `usage.subtreeUnknown`
 * (src/headless.js). Those must be forwarded, not dropped: the live workspace
 * and `amicus watch` read progress.json directly, so silently keeping only
 * {tokens, cost} here would make the GUI's cost-by-seat and its wave rollup
 * disagree with run.json by exactly the child-session amount — reintroducing
 * the under-report one surface down from where it was fixed.
 */
function enrichLegUsage(leg, progressUsage) {
  if (!progressUsage || !progressUsage.tokens) { return leg; }
  const resolved = resolveUsage({
    model: leg.model,
    usageTotals: progressUsage,
    subtree: progressUsage.subtree,
    subtreeUnknown: progressUsage.subtreeUnknown,
  });
  const usage = { tokens: resolved.tokens, cost: resolved.cost };
  if (resolved.subtree) { usage.subtree = resolved.subtree; }
  if (resolved.subtreeUnknown) { usage.subtreeUnknown = true; }
  return { ...leg, usage };
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

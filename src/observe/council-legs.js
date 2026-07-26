// src/observe/council-legs.js
'use strict';

/**
 * @module observe/council-legs
 * Per-leg row builder for the composed council live doc
 * (buildCouncilStatusPayload in src/mcp-council-awareness.js). Split out of
 * that file to stay under the 300-line gate (DE-ROT Task 0.5, closes F01:
 * `usageLegs` was computed then discarded — no `legs[]` ever reached the
 * payload, so the live Seats panel had no data source).
 *
 * One row per leg id, built UNCONDITIONALLY: unlike the usage rollup (gated
 * on `enriched.usage` in buildCouncilStatusPayload), a live seats panel needs
 * just-started legs — the ones with no usage yet — just as much as priced
 * ones. Field names mirror the wave branch (src/mcp-server.js:592-608) so
 * live-normalize.js (Task 14) has one vocabulary to map, not two.
 *
 * `modelInput` + `role` (F36/F34 correction): a live leg's `model` is the
 * RESOLVED executable id (metadata.model), never the council ALIAS that
 * run.json's bench/chair/critic/lenses and roleFor's rule are keyed on — so
 * deriving role from `model` is a silent no-op (Role column permanently
 * em-dash) and blind mode's labelOf(alias) lookup never matches (real model
 * id leaks). The alias IS on disk per-leg, though: every council leg goes
 * through src/sidecar/fanout-leg.js's runSingleAttempt, which calls
 * `writeLegPatch(legDir, { parentWave, modelInput })` synchronously,
 * immediately after leg creation (fanout-leg.js:101) — well before any
 * status poll could reasonably observe it missing. So this module reads
 * `modelInput` straight off the leg's own metadata.json, no run.json join
 * needed for the alias itself.
 */

const fs = require('fs');
const path = require('path');
const { readProgress, isStalled } = require('../sidecar/progress');
const { enrichLegUsage } = require('./live-doc');
const { roleFor } = require('../council/run-stages');

/**
 * A leg's council role. The chair stage is the one case alias identity
 * cannot resolve: run-chair.js's fallback chain (ch1/ch2 = run.chair's own
 * alias, ch3 = a DIFFERENT ledger-promoted alias, ch4 = whichever succeeded)
 * means a chair leg's modelInput does not reliably equal run.json's `chair`
 * field while the chain is still in flight (that field is only checkpointed
 * once the WHOLE chain resolves, src/council/run-chair.js:122) — so alias
 * matching would miss ch3/ch4 mid-run. The stage that owns the leg is the
 * authoritative signal instead (plan's F34 correction: "derive role from the
 * stage that owns the leg"). Every other stage (stage1/stage2/debate-*)
 * reuses roleFor (src/council/run-stages.js) keyed on modelInput — a
 * model's seat/critic/lens identity is stable whether it's reviewing
 * (stage1) or judging (stage2), and a repair/debate leg relaunches the SAME
 * alias as its origin leg, so the identity carries through unchanged.
 * @returns {string|null} null when modelInput is unknown (truthful — never a guess)
 */
function legRole({ bench, critic, lenses, stageName, modelInput }) {
  if (!modelInput) { return null; }
  if (stageName === 'chair') { return 'chair'; }
  return roleFor({ models: bench, critic, lenses }, modelInput);
}

/**
 * One composed row for a leg, plus the ms-since-activity behind its `stalled`
 * flag (or null when not stalled/not yet measurable) so the caller can roll
 * several legs' staleness into one run-level summary without re-parsing
 * `lastActivityAt` back into a timestamp.
 * @param {string} project
 * @param {string} legId
 * @param {{bench: string[], critic: string|null, lenses: string[]|null, stageName: string}} runCtx
 * @returns {{row: object, stalledMs: number|null}}
 */
function buildLegRow(project, legId, runCtx) {
  const { getSessionDir } = require('../session-manager');
  const legDir = getSessionDir(project, legId);
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(path.join(legDir, 'metadata.json'), 'utf-8')); }
  catch { /* leg metadata not written yet — just-started leg */ }
  // Truthful null, never metadata.model as a fallback: showing the resolved
  // id where the alias was expected is exactly the F36 bug (blind mode would
  // leak the real model id instead of degrading to an em-dash).
  const modelInput = meta.modelInput || null;
  const row = {
    taskId: legId, model: meta.model || null, status: meta.status || 'unknown',
    modelInput, role: legRole({ ...runCtx, modelInput }),
  };
  let stalledMs = null;
  try {
    const p = readProgress(legDir);
    row.messages = p.messages;
    row.stage = p.stage;
    row.latestPreview = p.latestPreview;
    row.lastActivityAt = p.lastActivityAt;
    row.stalled = row.status === 'running' && isStalled(p.lastActivityMs);
    if (row.stalled) { stalledMs = p.lastActivityMs; }
    // N3: enrichLegUsage returns the bare leg (no `usage` key) when progress
    // carries no usage yet — merge only when present so we never put an
    // undefined key on the row.
    const enriched = enrichLegUsage(row, p.usage);
    if (enriched.usage) { row.usage = enriched.usage; }
  } catch { /* no progress.json yet, OR enrichLegUsage threw pricing it (e.g. an unknown
    model) — both land here indistinguishably and leave base fields only; mirrors the
    pre-existing wave branch's same all-or-nothing catch (deliberate, not a gap to close) */ }
  return { row, stalledMs };
}

/**
 * Rows for every leg id, plus a run-level stall rollup. A council run fans
 * legs across several parallel sub-waves at once (seat wave, chair chain,
 * lens/critic solos), so — unlike the single-leg wave branch, which only
 * ever flags its own row — a run-level banner needs one worst-case summary
 * rather than making the caller inspect every row.
 * @param {string} project
 * @param {string[]} legIds
 * @param {{bench: string[], critic: string|null, lenses: string[]|null, stageName: string}} runCtx
 *   run.json's alias-valued fields (bench/critic/lenses) + the active stage's
 *   name, threaded through to legRole — this module never reads run.json itself.
 * @returns {{rows: object[], stalled?: true, stalledForSeconds?: number}}
 */
function buildLegRows(project, legIds, runCtx) {
  const rows = [];
  let worstMs = null;
  for (const legId of legIds) {
    const { row, stalledMs } = buildLegRow(project, legId, runCtx);
    rows.push(row);
    if (stalledMs !== null && (worstMs === null || stalledMs > worstMs)) { worstMs = stalledMs; }
  }
  const out = { rows };
  if (worstMs !== null) { out.stalled = true; out.stalledForSeconds = Math.floor(worstMs / 1000); }
  return out;
}

module.exports = { buildLegRows };

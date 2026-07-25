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
 * live-normalize.js (Task 14) has one vocabulary to map, not two. `role` is
 * deliberately NOT emitted here: it is a council-only concept (roleFor in
 * src/council/run-stages.js, folded into tally.json post-run) that F34
 * assigns to the front-end normalize layer to derive from run.json's
 * bench/chair/critic/lenses — this module stays a plain leg-status reader.
 */

const fs = require('fs');
const path = require('path');
const { readProgress, isStalled } = require('../sidecar/progress');
const { enrichLegUsage } = require('./live-doc');

/**
 * One composed row for a leg, plus the ms-since-activity behind its `stalled`
 * flag (or null when not stalled/not yet measurable) so the caller can roll
 * several legs' staleness into one run-level summary without re-parsing
 * `lastActivityAt` back into a timestamp.
 * @returns {{row: object, stalledMs: number|null}}
 */
function buildLegRow(project, legId) {
  const { getSessionDir } = require('../session-manager');
  const legDir = getSessionDir(project, legId);
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(path.join(legDir, 'metadata.json'), 'utf-8')); }
  catch { /* leg metadata not written yet — just-started leg */ }
  const row = { taskId: legId, model: meta.model || null, status: meta.status || 'unknown' };
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
  } catch { /* no progress.json yet — leave base fields only */ }
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
 * @returns {{rows: object[], stalled?: true, stalledForSeconds?: number}}
 */
function buildLegRows(project, legIds) {
  const rows = [];
  let worstMs = null;
  for (const legId of legIds) {
    const { row, stalledMs } = buildLegRow(project, legId);
    rows.push(row);
    if (stalledMs !== null && (worstMs === null || stalledMs > worstMs)) { worstMs = stalledMs; }
  }
  const out = { rows };
  if (worstMs !== null) { out.stalled = true; out.stalledForSeconds = Math.floor(worstMs / 1000); }
  return out;
}

module.exports = { buildLegRows };

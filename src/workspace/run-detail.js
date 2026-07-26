/**
 * Council Workspace — run detail: defensive parse of run.json / tally.json /
 * verdict.json + the derived view models the renderer paints (v4.4 §4.5
 * workspace:get-run, §5.2, §9). Malformed JSON yields {parseError, rawPath}
 * per document — one bad file never blanks the whole run (spec §9 row 1).
 * Read-only (§6.2).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { formatCost } = require('../utils/pricing');
const { readPointer } = require('./run-scan');
const { buildNamePairs } = require('./blind-mode');
const { buildMatrixModel } = require('./matrix-model');
const { artifactAllowlist } = require('./artifact-guard');
const { isRealpathContained } = require('./path-fence');

/**
 * Shared terminal-status list (also mirrored renderer-side in live-model.js).
 * ⚠️ DE-ROT (F26): deliberate HAND-COPY of src/observe/live-doc.js:18 `TERMINAL`,
 * names and order byte-identical. Do NOT require() it — Task 3 is Phase 1
 * ("zero v4.3") and live-doc.js is v4.3. Not to be confused with the shipped
 * src/utils/result-schema.js:13 TERMINAL_STATUSES, which is the LEG set (no 'partial').
 */
const TERMINAL_STATUSES = ['complete', 'partial', 'error', 'crashed', 'aborted', 'timeout', 'idle-timeout'];

/** Friendly labels for known v4.0 stage names; unknown names pass through raw
 *  — the graceful-when-present rule (spec §5.2). */
// ⚠️ PRE-FLIGHT (P1): this table was a DIFFERENT 7-key table whose keys and values both
// disagreed with Task 12's renderer mirror — while Task 12 Step 1 pins them with
// `expect(STAGE_LABELS).toEqual(rd.STAGE_LABELS)` (deep equality, guaranteed red). It also
// carried `repairs` and `debate`, two names DE-ROT F10 proved the engine NEVER writes.
// Task 12's table is now the single source and is reproduced here byte-for-byte. If you edit
// one, edit both — the drift pin is the only thing keeping them honest.
const STAGE_LABELS = {
  stage1: 'Stage 1 — independent review',
  stage2: 'Stage 2 — peer cross-review',
  'debate-defense': 'Debate — defense',
  'debate-revote': 'Debate — re-vote',
  'tally-provisional': 'Tally (provisional)',
  tally: 'Tally',
  'tally-final': 'Tally (final)',
  chair: 'Chair synthesis',
  verdict: 'Verdict',
};

function readDoc(runDir, name) {
  const rawPath = path.join(runDir, name);
  if (!fs.existsSync(rawPath)) { return null; }
  try { return JSON.parse(fs.readFileSync(rawPath, 'utf-8')); }
  catch (err) { return { parseError: err.message, rawPath }; }
}

function stageRail(run) {
  const stages = Array.isArray(run.stages) ? run.stages : [];
  return stages.filter((s) => s && typeof s === 'object').map((s) => ({
    name: s.name,
    label: STAGE_LABELS[s.name] || String(s.name),
    status: s.status || 'pending',
    startedAt: s.startedAt || null,
    completedAt: s.completedAt || null,
  }));
}

function costPanel(run, tally) {
  const stats = tally && Array.isArray(tally.runStats) ? tally.runStats : [];
  const rows = stats.map((r) => ({
    model: r.model,
    role: r.role || (r.wasChair ? 'chair' : 'seat'),
    status: r.status || 'unknown',
    durationMs: r.durationMs === undefined ? null : r.durationMs,
    costDisplay: formatCost(r.usage && r.usage.cost),
  }));
  const cost = run.usage && run.usage.cost ? run.usage.cost : null;
  // v4.4 §8: the run total must not read as exact when any seat is unpriced.
  // `run.usage.unknownLegs` is the v4.4 field src/council/run.js stamps; a run
  // written before that (or by any other producer) still carries the count inside
  // sumWaveUsage's `cost.unpricedLegs`, so read that as the fallback rather than
  // silently claiming exactness for every historical run on disk.
  const unknownLegs = run.usage && typeof run.usage.unknownLegs === 'number'
    ? run.usage.unknownLegs
    : ((cost && cost.unpricedLegs) || 0);
  // v4.4 Task 2: a leg whose own cost is `reported` can STILL leave the run total
  // short — a subagent's child session is billed separately and never enumerated
  // (`council-wsgate01`: 7/7 legs reported, $0.0215 short, 100% one child session).
  const subtreeUnknownLegs = run.usage && typeof run.usage.subtreeUnknownLegs === 'number'
    ? run.usage.subtreeUnknownLegs
    : ((cost && cost.subtreeUnknownLegs) || 0);
  const total = formatCost(cost);
  const suffixes = [];
  if (unknownLegs > 0) { suffixes.push(`${unknownLegs} unknown`); }
  if (subtreeUnknownLegs > 0) { suffixes.push(`${subtreeUnknownLegs} subagent subtree`); }
  return {
    rows,
    totalDisplay: suffixes.length > 0 ? `${total} + ${suffixes.join(' + ')}` : total,
    costAmount: cost && typeof cost.amount === 'number' ? cost.amount : null,
    // The gauge's guard (workspace-render.js renderGauge): false means "the
    // percentage below is a LOWER BOUND", so it must render indeterminate.
    // PREFER the producer's own flag when run.json carries it — recomputing it
    // from `unknownLegs` alone would silently re-assert exactness for a run whose
    // writer already determined the total is incomplete for a different reason.
    costExact: run.usage && typeof run.usage.costExact === 'boolean'
      ? run.usage.costExact
      : (unknownLegs === 0 && subtreeUnknownLegs === 0),
    unknownLegs,
    subtreeUnknownLegs,
    maxCost: run.options && typeof run.options.maxCost === 'number' ? run.options.maxCost : null,
  };
}

// ⚠️ PRE-FLIGHT (P3): F04's correction is implemented here rather than left as prose.
// VERIFIED on shipped main (Task 0): `finalize(exitCode, error)` writes `error: error || null`
// (src/council/run.js:98-100), and `return finalize(degraded.value ? 2 : 0)` (:293) is the ONLY
// exit-2 path — it passes NO error. Every error-bearing call is `finalize(1, …)`. So on a
// `status:'partial'` run — precisely the run this panel exists to explain — `run.error` is
// GUARANTEED null, and the old one-line formula rendered "undefined: undefined".
// Name the stage instead. Stage status is a closed set (DE-ROT F19): running / complete /
// skipped / error, and `run-chair.js:114` writes 'error' for a chair that failed after retry +
// fallback promotion, 'skipped' (:89) for one the cost ceiling skipped.
function degradedReason(run) {
  // exit-1 path: the engine wrote a structured {code, message}.
  if (run.error && run.error.code) { return `${run.error.code}: ${run.error.message}`; }
  const stages = Array.isArray(run.stages) ? run.stages : [];
  const failed = stages.find((s) => s && s.status === 'error');
  if (failed) { return `${STAGE_LABELS[failed.name] || failed.name} stage failed`; }
  const skipped = stages.find((s) => s && s.status === 'skipped');
  if (skipped) { return `${STAGE_LABELS[skipped.name] || skipped.name} stage was skipped (cost ceiling)`; }
  return null;
}

function verdictPanel(run, verdict) {
  const reason = degradedReason(run);
  if (!verdict || verdict.parseError) {
    return { present: false, overallVerdict: null, tierCounts: null, streetCred: [], decisions: [], reason };
  }
  return {
    present: true,
    overallVerdict: verdict.overallVerdict === undefined ? null : verdict.overallVerdict,
    tierCounts: verdict.tierCounts || null,
    streetCred: Array.isArray(verdict.streetCred) ? verdict.streetCred : [],
    decisions: (Array.isArray(verdict.findings) ? verdict.findings : [])
      .filter((f) => f && f.decision)
      .map((f) => ({ id: f.id, decision: f.decision, applied: f.applied === true })),
    reason,
  };
}

/**
 * @param {string} project
 * @param {string} runId (with or without the council- prefix)
 * @returns {object} RunDetail (see plan Shared contracts)
 */
function getRunDetail(project, runId) {
  const ptr = readPointer(project, runId);
  if (ptr.error) { return { runId: ptr.runId, error: ptr.error }; }
  const runDir = ptr.runDir;

  // Outer containment fence (third council-review pass): readPointer's shipped
  // implementation (src/council/run-state.js:133-139) validates the pointer file's
  // {runId, runDir} JSON only for truthiness, so a tampered or stale pointer can point
  // runDir anywhere on disk. Mirrors src/workspace/artifact-guard.js's readRunArtifact
  // outer fence and electron/ipc-workspace.js's workspace:open-report fence — same
  // isRealpathContained helper (src/workspace/path-fence.js), same check. Own
  // distinguishable error string: getRunDetail's other error shapes ('run.json missing',
  // the readPointer-sourced messages) are asserted by name in several suites and must
  // not collide with this one. Checked BEFORE any read reaches the filesystem, unlike
  // readRunArtifact (which reads run.json first) — getRunDetail has no allowlist-shaped
  // reason to read anything from an escaping runDir at all.
  let realProject, realRunDir;
  try { realProject = fs.realpathSync(project); }
  catch (err) { return { runId: ptr.runId, runDir, error: `project unreadable: ${err.message}` }; }
  try { realRunDir = fs.realpathSync(runDir); }
  catch (err) { return { runId: ptr.runId, runDir, error: `run dir unreadable: ${err.message}` }; }
  if (!isRealpathContained(realProject, realRunDir)) {
    return { runId: ptr.runId, runDir, error: 'run directory escapes project' };
  }

  const run = readDoc(runDir, 'run.json');
  if (!run) { return { runId: ptr.runId, runDir, error: 'run.json missing' }; }
  const tally = readDoc(runDir, 'tally.json');
  const verdict = readDoc(runDir, 'verdict.json');

  let derived = null;
  // Computed once, outside the `!run.parseError` guard's block so both the derived model
  // (artifactCollisions) and the artifacts presence map below reuse the same call.
  const artifactNames = run.parseError ? [] : artifactAllowlist(run);
  if (!run.parseError) {
    const labelMap = run.labelMap && typeof run.labelMap === 'object' ? run.labelMap : {};
    const tallyOk = tally && !tally.parseError ? tally : null;
    derived = {
      schemaSupported: run.schemaVersion === 2,
      names: buildNamePairs(labelMap),
      stageRail: stageRail(run),
      // ⚠️ DE-ROT (F07): 3-arg signature — tierOverride + post-override tier live in verdict.json.
      matrix: tallyOk ? buildMatrixModel(tallyOk, labelMap, verdict && !verdict.parseError ? verdict : null) : null,
      cost: costPanel(run, tallyOk),
      verdictPanel: verdictPanel(run, verdict),
      // ⚠️ R4 COUNCIL REVIEW (fourth live paid council, major, unanimous): two distinct bench
      // entries that sanitize to the same artifact name (artifact-guard.js's
      // artifactAllowlist) is a run-integrity defect — this run directory cannot hold both
      // models' review/judge files under distinct names, so drillIntoJudge's artifact lookup
      // would otherwise silently misattribute prose. Surfaced here (rather than only inside
      // the low-level allowlist helper) so the renderer can warn the user directly.
      artifactCollisions: artifactNames.collisions || [],
    };
  }

  const artifacts = {};
  const names = artifactNames;
  for (const name of [...names, 'report.html', 'run.json', 'tally.json', 'verdict.json']) {
    try {
      const st = fs.statSync(path.join(runDir, name));
      artifacts[name] = { present: true, bytes: st.size };
    } catch {
      artifacts[name] = { present: false, bytes: 0 };
    }
  }

  return { runId: ptr.runId, runDir, run, tally, verdict, artifacts, derived };
}

module.exports = { getRunDetail, costPanel, TERMINAL_STATUSES, STAGE_LABELS };

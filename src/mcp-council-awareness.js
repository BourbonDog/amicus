// src/mcp-council-awareness.js
'use strict';

/**
 * @module mcp-council-awareness
 * The council-awareness helpers behind amicus_status / amicus_list /
 * amicus_abort: they resolve a council runId through the sessions-dir pointer
 * file and read the run directory directly, so the generic session handlers do
 * not need to know anything about council run layout.
 *
 * Split out of mcp-council-run.js, which owns the amicus_council_run handler;
 * that file re-exports these so existing require paths keep working.
 */

const fs = require('fs');
const path = require('path');
const runState = require('./council/run-state');
// The pointer-containment fence. Lives in a dependency-free leaf module
// (src/utils/path-fence.js) precisely so any surface can require it —
// requiring it here adds no cycle and keeps ONE implementation of the check
// shared with the v4.4 workspace reads.
const { containsOnDisk } = require('./utils/path-fence');
const { RUNNING_VERSION } = require('./utils/version-info');
const { enrichLegUsage, markLive, rollupWaveUsage } = require('./observe/live-doc');
const { buildLegRows } = require('./observe/council-legs');

/**
 * Every wave a stage launched: the primary `waveId` plus the recorded
 * `waveIds` sub-waves (chair ch1..ch4, lens solos, critic solo, repairs).
 */
function subWaveIds(stage) {
  return [...new Set(
    [stage.waveId, ...(Array.isArray(stage.waveIds) ? stage.waveIds : [])].filter(Boolean))];
}

/**
 * The pid to probe for liveness. run.json's own pid is authoritative once the
 * engine has checkpointed it; before that, the spawning process's record is all
 * there is (see run-state.writeSpawnPid).
 */
function enginePid(run, runDir) {
  return run.pid || runState.readSpawnPid(runDir);
}

/** @returns {{total: number, complete: number}|null} null when not on disk yet */
function countWaveLegs(project, waveId) {
  const { getSessionDir } = require('./session-manager');
  const { TERMINAL_STATUSES } = require('./utils/result-schema');
  let legs;
  try {
    legs = JSON.parse(fs.readFileSync(
      path.join(getSessionDir(project, waveId), 'metadata.json'), 'utf-8')).legs;
  } catch { return null; }
  // A hand-edited or half-written metadata.json can carry a non-array `legs`;
  // treat anything that is not an array as no legs rather than throwing out of
  // a status read.
  if (!Array.isArray(legs)) { return { total: 0, complete: 0 }; }
  const complete = legs.filter((id) => {
    try {
      const m = JSON.parse(fs.readFileSync(
        path.join(getSessionDir(project, id), 'metadata.json'), 'utf-8'));
      return TERMINAL_STATUSES.includes(m.status);
    } catch { return false; }
  }).length;
  return { total: legs.length, complete };
}

/**
 * Leg ids recorded on a sub-wave's metadata.json, or [] when the wave record
 * is absent/malformed. A small sibling to countWaveLegs — kept separate so
 * that helper's {total, complete} contract (other callers depend on it) isn't
 * overloaded into returning ids too.
 * @returns {string[]}
 */
function waveLegIds(project, waveId) {
  const { getSessionDir } = require('./session-manager');
  let legs;
  try {
    legs = JSON.parse(fs.readFileSync(
      path.join(getSessionDir(project, waveId), 'metadata.json'), 'utf-8')).legs;
  } catch { return []; }
  return Array.isArray(legs) ? legs : [];
}

/**
 * Read-time cost-by-seat for one leg (A8: progress.json only, never a ledger).
 * Tolerates a leg with no progress.usage yet — contributes nothing (N3).
 */
function legUsage(project, legId) {
  const { getSessionDir } = require('./session-manager');
  const { readProgress } = require('./sidecar/progress');
  let model = null;
  try {
    model = JSON.parse(fs.readFileSync(
      path.join(getSessionDir(project, legId), 'metadata.json'), 'utf-8')).model || null;
  } catch { /* leg metadata not written yet */ }
  let progressUsage;
  try { progressUsage = readProgress(getSessionDir(project, legId)).usage; }
  catch { /* no progress.json yet */ }
  return enrichLegUsage({ model }, progressUsage);
}

/**
 * readPointer PLUS the containment check the pointer file itself cannot
 * provide. runState.readPointer validates `council-<id>.json`'s {runId, runDir}
 * JSON only for truthiness (run-state.js:133-139), so a tampered or stale
 * pointer can point runDir anywhere on disk — and the two callers below do not
 * merely READ from it, they runState.checkpoint() INTO it (crash detection and
 * abort), which makes an unfenced pointer a write primitive at an
 * attacker-chosen path. A real runDir is always nested inside the project:
 * src/mcp-council-run.js:109 rejects an outDir outside it at creation time, so
 * nothing legitimate is refused here.
 *
 * Fails to null — the SAME "not a council run" signal an absent/corrupt pointer
 * already produces, so amicus_status / amicus_abort keep their existing
 * "Session <id> not found in project <cwd>" error contract (mcp-server.js:586,
 * :1005) and `amicus abort` keeps falling through to its own not-found path.
 * No new error shape, and — because the fence runs before readRun — no read or
 * write ever reaches the escaping directory.
 * @returns {{runId: string, runDir: string}|null}
 */
function readFencedPointer(project, taskId) {
  const ptr = runState.readPointer(project, taskId);
  return ptr && containsOnDisk(project, ptr.runDir) ? ptr : null;
}

function elapsedOf(run) {
  const end = run.completedAt || new Date().toISOString();
  const ms = Math.max(0, new Date(end).getTime() - new Date(run.createdAt || end).getTime());
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

/** Status payload for a council runId, or null when the id is not a council run. */
function buildCouncilStatusPayload(project, taskId) {
  const ptr = readFencedPointer(project, taskId);
  if (!ptr) { return null; }
  const run = runState.readRun(ptr.runDir);
  if (!run) { return null; }

  // Crash detection: a running run.json whose engine pid is gone is 'error'.
  const pid = run.status === 'running' ? enginePid(run, ptr.runDir) : null;
  if (pid) {
    try { process.kill(pid, 0); } catch (err) {
      if (err.code !== 'EPERM') {
        runState.checkpoint(ptr.runDir, {
          status: 'error', completedAt: new Date().toISOString(),
          error: { code: 'INTERNAL', message: 'Council engine process exited unexpectedly' },
        });
        run.status = 'error';
        run.error = { code: 'INTERNAL', message: 'Council engine process exited unexpectedly' };
      }
    }
  }

  const stages = (run.stages || []).map(s => ({
    name: s.name, status: s.status, waveId: s.waveId || null,
  }));
  const active = (run.stages || []).find(s => s.status === 'running') || null;
  let legsTotal = null; let legsComplete = null;
  // Sum across every sub-wave the active stage launched: a lens stage1 has no
  // seat wave at all, and a critic solo runs beside one. Stays null until at
  // least one sub-wave record exists on disk.
  // Cost-by-seat rides the same loop, read-time from progress.json only (A8) —
  // usageLegs stays empty (no `usage` on the payload) until a leg has actually
  // flushed usage; a leg with none yet contributes nothing (N3). allLegIds
  // collects every leg id seen regardless of usage — the row builder below
  // needs just-started legs too (DE-ROT F01: the naive `payload.legs =
  // usageLegs` would silently drop them).
  const usageLegs = [];
  const allLegIds = [];
  for (const waveId of active && active.project ? subWaveIds(active) : []) {
    const c = countWaveLegs(active.project, waveId);
    if (!c) { continue; }
    legsTotal = (legsTotal || 0) + c.total;
    legsComplete = (legsComplete || 0) + c.complete;
    for (const legId of waveLegIds(active.project, waveId)) {
      allLegIds.push(legId);
      const enriched = legUsage(active.project, legId);
      if (enriched.usage) { usageLegs.push(enriched); }
    }
  }
  const payload = {
    taskId: run.runId, type: 'council-run', runId: run.runId, runDir: ptr.runDir,
    status: run.status, currentStage: active ? active.name : null, stages,
    legsTotal, legsComplete, elapsed: elapsedOf(run),
    exitCode: run.exitCode !== undefined ? run.exitCode : null,
    version: RUNNING_VERSION,
    degrades: run.degrades || [],
  };
  if (usageLegs.length) { payload.usage = rollupWaveUsage(usageLegs); }
  if (allLegIds.length) {
    // F34/F36: bench/critic/lenses are the alias-valued fields legRole needs
    // (roleFor's rule); stageName lets it treat the chair stage as its own
    // case rather than matching on alias (see council-legs.js's legRole doc).
    const runCtx = { bench: run.bench, critic: run.critic, lenses: run.lenses, stageName: active.name };
    const built = buildLegRows(active.project, allLegIds, runCtx);
    payload.legs = built.rows;
    if (built.stalled) { payload.stalled = true; payload.stalledForSeconds = built.stalledForSeconds; }
  }
  if (run.error) { payload.reason = `${run.error.code}: ${run.error.message}`; }
  return markLive(payload);
}

/** amicus_list entries for every council pointer in the project. */
function listCouncilRuns(project) {
  const { sanitizePreview } = require('./sidecar/progress-fields');
  const out = [];
  for (const ptr of runState.listPointers(project)) {
    // Same fence as readFencedPointer, applied per enumerated pointer
    // (listPointers parses the files itself and is no stricter about runDir).
    // Skipping is the right failure mode here: an escaping pointer degrades
    // exactly like the unreadable-run.json case below, so one tampered pointer
    // can never blank the rest of the list.
    if (!containsOnDisk(project, ptr.runDir)) { continue; }
    const run = runState.readRun(ptr.runDir);
    if (!run) { continue; }
    let briefing = '';
    try { briefing = fs.readFileSync(path.join(ptr.runDir, 'briefing.md'), 'utf-8'); }
    catch { /* optional */ }
    const active = (run.stages || []).find(s => s.status === 'running');
    out.push({
      id: run.runId, type: 'council-run', status: run.status, mode: 'headless',
      model: null, agent: 'Plan', createdAt: run.createdAt,
      briefing: sanitizePreview(briefing, 80),
      stage: active ? active.name : null,
      ...(run.tag ? { tag: run.tag } : {}),
    });
  }
  return out;
}

/** Mark one sub-wave and its legs aborted. @returns {number} legs newly marked */
function cascadeWave(project, waveId) {
  const { markAborted } = require('./utils/session-abort');
  const { getSessionDir } = require('./session-manager');
  const waveDir = getSessionDir(project, waveId);
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(path.join(waveDir, 'metadata.json'), 'utf-8')); }
  catch { /* wave record may not exist yet */ }
  let n = 0;
  // Non-array `legs` (hand-edited or half-written) would throw out of the
  // for..of and lose the wave-level mark below.
  for (const legId of Array.isArray(meta.legs) ? meta.legs : []) {
    try { if (markAborted(getSessionDir(project, legId), 'council abort')) { n++; } }
    catch { /* skip leg */ }
  }
  // Guarded so a failure here cannot discard the legs already marked: the
  // caller only learns the count through the return value.
  try { markAborted(waveDir, 'council abort'); } catch { /* best-effort */ }
  return n;
}

/**
 * Abort a council run via its pointer: checkpoint run.json aborted (abort-wins)
 * and cascade to every in-flight sub-wave + its legs so they settle.
 * @returns {null|{notFound?: true}|{alreadyTerminal: true, status}|{aborted: true, cascaded: number}}
 */
function abortCouncilRun(project, taskId) {
  const ptr = readFencedPointer(project, taskId);
  if (!ptr) { return null; }
  const run = runState.readRun(ptr.runDir);
  if (!run) { return null; }
  if (run.status !== 'running') { return { alreadyTerminal: true, status: run.status }; }

  let cascaded = 0;
  for (const s of run.stages || []) {
    if (s.status !== 'running' || !s.project) { continue; }
    for (const waveId of subWaveIds(s)) {
      try { cascaded += cascadeWave(s.project, waveId); } catch { /* skip sub-wave */ }
    }
  }
  runState.checkpoint(ptr.runDir, { status: 'aborted', completedAt: new Date().toISOString() });
  const pid = enginePid(run, ptr.runDir);
  if (pid) {
    try { require('./utils/abort-coordinator').waitThenKill(pid).catch(() => {}); }
    catch { /* best-effort */ }
  }
  return { aborted: true, cascaded };
}

module.exports = {
  subWaveIds, countWaveLegs, elapsedOf, enginePid,
  buildCouncilStatusPayload, listCouncilRuns, cascadeWave, abortCouncilRun,
};

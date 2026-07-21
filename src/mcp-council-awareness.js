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
const { RUNNING_VERSION } = require('./utils/version-info');

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

function elapsedOf(run) {
  const end = run.completedAt || new Date().toISOString();
  const ms = Math.max(0, new Date(end).getTime() - new Date(run.createdAt || end).getTime());
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

/** Status payload for a council runId, or null when the id is not a council run. */
function buildCouncilStatusPayload(project, taskId) {
  const ptr = runState.readPointer(project, taskId);
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
  for (const waveId of active && active.project ? subWaveIds(active) : []) {
    const c = countWaveLegs(active.project, waveId);
    if (!c) { continue; }
    legsTotal = (legsTotal || 0) + c.total;
    legsComplete = (legsComplete || 0) + c.complete;
  }
  const payload = {
    taskId: run.runId, type: 'council-run', runId: run.runId, runDir: ptr.runDir,
    status: run.status, currentStage: active ? active.name : null, stages,
    legsTotal, legsComplete, elapsed: elapsedOf(run),
    exitCode: run.exitCode !== undefined ? run.exitCode : null,
    version: RUNNING_VERSION,
  };
  if (run.error) { payload.reason = `${run.error.code}: ${run.error.message}`; }
  return payload;
}

/** amicus_list entries for every council pointer in the project. */
function listCouncilRuns(project) {
  const { sanitizePreview } = require('./sidecar/progress-fields');
  const out = [];
  for (const ptr of runState.listPointers(project)) {
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
  const ptr = runState.readPointer(project, taskId);
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

// src/council/run-state.js
'use strict';

/**
 * @module council/run-state
 * Durable state for one headless council run (spec §4/§5): atomic run.json
 * read/write with checkpoint semantics, plus the sessions-dir pointer file
 * (`council-<runId>.json` → {runId, runDir}) that lets status/wait/list/abort
 * resolve council runIds without knowing --out-dir.
 *
 * Abort-wins: once run.json's status is 'aborted', no later checkpoint can
 * demote it (same precedence rule as fanout's writeWaveMetadata — an external
 * `amicus abort` must never lose a write race against the engine's own
 * finalize).
 */

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('../utils/atomic-write');
const { SESSIONS_DIR } = require('../session-manager');

const RUN_FILE = 'run.json';
const SPAWN_PID_FILE = 'spawn.pid';

function runPath(runDir) { return path.join(runDir, RUN_FILE); }
function spawnPidPath(runDir) { return path.join(runDir, SPAWN_PID_FILE); }

/**
 * Record the engine child's pid in its own file rather than patching run.json.
 * The spawning process (the MCP handler) and the engine child both write
 * run.json, and `checkpoint` is a read-merge-write with no cross-process lock —
 * so a pid patch from the parent can clobber, or be clobbered by, whatever the
 * child wrote in the same window. A standalone single-write file has no read
 * side, so there is no race to lose. Readers fall back to it whenever run.json
 * carries no pid (see readSpawnPid).
 */
function writeSpawnPid(runDir, pid) {
  writeFileAtomic(spawnPidPath(runDir), String(pid), { mode: 0o600 });
}

/** @returns {number|null} the recorded spawn pid, or null when absent/corrupt */
function readSpawnPid(runDir) {
  try {
    const pid = Number.parseInt(fs.readFileSync(spawnPidPath(runDir), 'utf-8').trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch { return null; }
}

/** @returns {object|null} parsed run.json, or null when missing/corrupt */
function readRun(runDir) {
  try { return JSON.parse(fs.readFileSync(runPath(runDir), 'utf-8')); }
  catch { return null; }
}

/** Abort-wins merge: once status is 'aborted', it cannot change to anything else. */
function mergeRun(existing, patch) {
  const merged = { ...existing, ...patch };
  // If the prior run was aborted, preserve that status regardless of patch content
  // (prevents falsy status values, null, '', or omitted status from overwriting)
  if (existing.status === 'aborted' || patch.status === 'aborted') {
    merged.status = 'aborted';
    // An aborted run is terminal: never let a later (racing) finalize report a
    // clean/degraded exitCode. Prefer a recorded abort code, then a patch abort
    // code, else default SIGTERM's 143.
    const prior = [130, 143].includes(existing.exitCode) ? existing.exitCode : null;
    const fromPatch = [130, 143].includes(patch.exitCode) ? patch.exitCode : null;
    merged.exitCode = prior || fromPatch || 143;
  }
  return merged;
}

function writeRun(runDir, run) {
  writeFileAtomic(runPath(runDir), JSON.stringify(run, null, 2), { mode: 0o600 });
  return run;
}

/** Create (or merge into) run.json; preserves an existing createdAt. */
function initRun(runDir, seed) {
  fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
  const existing = readRun(runDir) || {};
  const run = mergeRun(existing, {
    ...seed,
    createdAt: existing.createdAt || seed.createdAt,
  });
  return writeRun(runDir, run);
}

/**
 * Seed run.json for a NEW council run and write its sessions-dir pointer.
 * Lifted verbatim out of run.js for the 300-line gate (v4.4.1 Task 0.5, which
 * needed room for the per-run shared server) — same seed, same order, same
 * pointer write.
 * @param {object} o the council run's resolved options
 */
function initCouncilRun(o) {
  initRun(o.runDir, {
    schemaVersion: 2, type: 'council-run', runId: o.runId, status: 'running', stages: [],
    bench: o.models.slice(), chair: o.chair, critic: o.critic, lenses: o.lenses,
    labelMap: null, seats: null, criticSeat: null,
    // Seeded ONLY under --debate (a `debate:null` seed would both break the v4.0
    // "no debate key" contract and fail the object-typed schema), and with a VALID
    // outcome from the first write so a run killed mid-debate stays schema-valid.
    ...(o.debate ? { debate: { enabled: true, outcome: 'nothing-to-debate' } } : {}),
    // F9 (v4.5): additive-only — absent (not null) without --template. T15-m2
    // (v4.7): the MCP handler (mcp-council-run.js) now pre-seeds this directly
    // via its own initRun call when a pack forwards briefing.template; the
    // spawned CLI child's own seed here still passes o.template: null (no
    // --template flag crosses that spawn boundary), so this spread omits the
    // key and mergeRun's shallow merge preserves the parent's pre-seeded value.
    ...(o.template ? { template: o.template } : {}),
    // v4.5 Task 12 (B7/F5): additive-only — absent (not null) without --pack.
    // Preserved across a later MCP-child initRun whose own seed omits it —
    // mergeRun's plain shallow merge never drops a key patch doesn't mention.
    ...(o.pack ? { pack: o.pack } : {}),
    // v4.7 F8 (D13): additive-only — absent (not null) without --tag. Same
    // merge-preserve precedent as pack above (mergeRun's shallow merge never
    // drops a key a later patch doesn't mention).
    ...(o.tag ? { tag: o.tag } : {}),
    // v4.5 Wave 2 (post-HOLD chip, task-23-report.md Anomaly 1): additive-only
    // — absent (never an empty array) when nothing was dropped. Handler-computed
    // (cli-handlers-council-run.js's resolveBench, via resolveCouncilMembers) so
    // a scripted/--json/MCP caller has a signal a bench member vanished without
    // diffing `bench` against the preset's nominal member list. Same
    // preserved-across-a-later-MCP-child-seed precedent as `pack` above — the
    // MCP handler pre-seeds this directly (mcp-council-run.js) before spawning
    // the CLI child, whose own seed (bench already expanded to --models) never
    // recomputes it and so never mentions the key.
    ...(o.droppedMembers && o.droppedMembers.length ? { droppedMembers: o.droppedMembers } : {}),
    options: { timeout: o.timeout || null, maxCost: o.maxCost, gateway: o.gateway || 'auto', outDir: o.runDir },
    usage: null, pid: process.pid, createdAt: new Date().toISOString(),
  });
  writePointer(o.project, o.runId, o.runDir);
}

/** Read-merge-write checkpoint (atomic; abort-wins on status). */
function checkpoint(runDir, patch) {
  const existing = readRun(runDir) || {};
  return writeRun(runDir, mergeRun(existing, patch));
}

/** Upsert one stages[] entry by name; other stages and order preserved. */
function updateStage(runDir, name, patch) {
  const existing = readRun(runDir) || {};
  const stages = Array.isArray(existing.stages) ? existing.stages.slice() : [];
  const i = stages.findIndex(s => s && s.name === name);
  if (i === -1) { stages.push({ name, ...patch }); }
  else { stages[i] = { ...stages[i], ...patch }; }
  return checkpoint(runDir, { stages });
}

/**
 * Append a sub-wave id to one stage's `waveIds` (dedup, launch order preserved).
 * A stage can have several sub-waves in flight at once (lens solos, a critic
 * solo alongside the seat wave) or in sequence (the chair's ch1..ch4 chain), so
 * the single `waveId` field cannot describe them. `amicus abort` cascades over
 * this list to mark every in-flight leg instead of relying on the pid kill.
 */
function appendStageWave(runDir, name, waveId) {
  const existing = readRun(runDir) || {};
  const stage = (existing.stages || []).find(s => s && s.name === name) || {};
  const waveIds = Array.isArray(stage.waveIds) ? stage.waveIds : [];
  if (waveIds.includes(waveId)) { return existing; }
  return updateStage(runDir, name, { waveIds: [...waveIds, waveId] });
}

function stripPrefix(runId) { return String(runId).replace(/^council-/, ''); }

/** `<project>/.claude/amicus_sessions/council-<runId>.json` */
function pointerPath(project, runId) {
  return path.join(project, '.claude', SESSIONS_DIR, `council-${stripPrefix(runId)}.json`);
}

function writePointer(project, runId, runDir) {
  const p = pointerPath(project, runId);
  fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  writeFileAtomic(p, JSON.stringify({ runId: stripPrefix(runId), runDir }, null, 2), { mode: 0o600 });
  return p;
}

/** @returns {{runId: string, runDir: string}|null} */
function readPointer(project, runId) {
  try {
    const ptr = JSON.parse(fs.readFileSync(pointerPath(project, runId), 'utf-8'));
    return (ptr && ptr.runId && ptr.runDir) ? ptr : null;
  } catch { return null; }
}

/** All council pointers in the project sessions dir. */
function listPointers(project) {
  const root = path.join(project, '.claude', SESSIONS_DIR);
  let names = [];
  try { names = fs.readdirSync(root); } catch { return []; }
  const out = [];
  for (const n of names) {
    if (!/^council-[a-zA-Z0-9_-]{1,64}\.json$/.test(n)) { continue; }
    try {
      const ptr = JSON.parse(fs.readFileSync(path.join(root, n), 'utf-8'));
      if (ptr && ptr.runId && ptr.runDir) { out.push(ptr); }
    } catch { /* skip corrupt pointer */ }
  }
  return out;
}

module.exports = {
  RUN_FILE, readRun, initRun, initCouncilRun, checkpoint, updateStage, appendStageWave,
  writeSpawnPid, readSpawnPid,
  pointerPath, writePointer, readPointer, listPointers,
};

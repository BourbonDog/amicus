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

function runPath(runDir) { return path.join(runDir, RUN_FILE); }

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
  if (existing.status === 'aborted') {
    merged.status = 'aborted';
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
  RUN_FILE, readRun, initRun, checkpoint, updateStage,
  pointerPath, writePointer, readPointer, listPointers,
};

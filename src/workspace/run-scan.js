/**
 * Council Workspace — run discovery (v4.4 spec §4.3 / §5.1).
 *
 * Walks the project sessions dir for v4.0 council pointer files
 * (`council-<runId>.json` = {runId, runDir}) and builds run-list rows from a
 * shallow, defensive read of run.json (+ verdict.json for the overallVerdict
 * chip). Strictly read-only (§6.2). Unreadable pointers/runs come back as
 * {runId, error} rows — this module never throws on bad input.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { formatCost } = require('../utils/pricing');
// ⚠️ DE-ROT (F25): v4.0 module (not v4.3) — safe for Phase 1. Single source of truth
// for reading/validating council pointer files; do not re-parse them here.
const runState = require('../council/run-state');

// ⚠️ DE-ROT (F25): widened from /^council-([0-9a-f]{8})\.json$/ to match the shipped
// walker's pattern (src/council/run-state.js:148) so ids that are not 8 hex still list.
const POINTER_RE = /^council-([a-zA-Z0-9_-]{1,64})\.json$/;

function sessionsDir(project) {
  return path.join(project, '.claude', 'amicus_sessions');
}

function readJson(file) {
  try { return { doc: JSON.parse(fs.readFileSync(file, 'utf-8')) }; }
  catch (err) { return { error: err.message }; }
}

/** Best-effort sort timestamp: run.json createdAt || first stage start || pointer mtime. */
function startedAtOf(run, pointerPath) {
  if (run) {
    if (run.createdAt) { return run.createdAt; }
    const s0 = Array.isArray(run.stages) && run.stages[0];
    if (s0 && s0.startedAt) { return s0.startedAt; }
  }
  try { return fs.statSync(pointerPath).mtime.toISOString(); } catch { return null; }
}

/**
 * Resolve a council runId to its run dir via the pointer file.
 * Accepts the id with or without the `council-` prefix (v4.0 readPointer parity).
 * ⚠️ DE-ROT (F25): thin ADAPTER over the shipped src/council/run-state.js:134
 * readPointer — that one already strips the prefix (:119) and validates
 * {runId, runDir}, but returns null. This wrapper is the ONLY place that turns
 * null into the {runId, error} row the workspace run list renders (§5.1).
 * @returns {{runId: string, runDir: string} | {runId: string, error: string}}
 */
function readPointer(project, runId) {
  const id = String(runId).replace(/^council-/, '');
  const ptr = runState.readPointer(project, id);
  if (!ptr) { return { runId: id, error: 'pointer missing, unreadable, or invalid' }; }
  return { runId: id, runDir: ptr.runDir };
}

/**
 * @param {string} project absolute project dir (AMICUS_PROJECT)
 * @returns {Array<object>} RunRow[] sorted startedAt desc; error rows inline.
 */
function scanCouncilRuns(project) {
  let names = [];
  try { names = fs.readdirSync(sessionsDir(project)); } catch { return []; }
  const rows = [];
  for (const name of names) {
    const m = POINTER_RE.exec(name);
    if (!m) { continue; }
    const pointerPath = path.join(sessionsDir(project), name);
    const ptr = readPointer(project, m[1]);
    if (ptr.error) {
      rows.push({ runId: m[1], runDir: null, error: ptr.error, pointerPath, startedAt: startedAtOf(null, pointerPath) });
      continue;
    }
    const r = readJson(path.join(ptr.runDir, 'run.json'));
    if (r.error) {
      rows.push({ runId: m[1], runDir: ptr.runDir, error: `run.json: ${r.error}`, pointerPath, startedAt: startedAtOf(null, pointerPath) });
      continue;
    }
    const run = r.doc;
    const row = {
      runId: run.runId || m[1],
      runDir: ptr.runDir,
      status: run.status || 'unknown',
      startedAt: startedAtOf(run, pointerPath),
      completedAt: run.completedAt || null,
      bench: Array.isArray(run.bench) ? run.bench : [],
      chair: run.chair || null,
      costDisplay: formatCost(run.usage && run.usage.cost),
      tierCounts: null,
      overallVerdict: null,
    };
    const v = readJson(path.join(ptr.runDir, 'verdict.json'));
    if (!v.error && v.doc) {
      row.overallVerdict = v.doc.overallVerdict === undefined ? null : v.doc.overallVerdict;
      row.tierCounts = v.doc.tierCounts || null;
    }
    rows.push(row);
  }
  rows.sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));
  return rows;
}

module.exports = { scanCouncilRuns, readPointer, POINTER_RE };

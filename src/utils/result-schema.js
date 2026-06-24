// src/utils/result-schema.js
'use strict';

/**
 * @module result-schema
 * Versioned, machine-parseable result documents for `--json` output (F4).
 *
 * Stability contract: fields are only ADDED within a SCHEMA_VERSION;
 * any rename/removal bumps SCHEMA_VERSION.
 */

const SCHEMA_VERSION = 2;

/** Leg/run statuses that count as terminal for wave aggregation. */
const TERMINAL_STATUSES = ['complete', 'error', 'timeout', 'aborted', 'crashed', 'idle-timeout'];

/**
 * Map a runHeadless-style result object to a run status.
 * Precedence: aborted > timeout > error > complete.
 * @param {{aborted?: boolean, timedOut?: boolean, error?: string}} result
 * @returns {string}
 */
function statusFromResult(result) {
  if (result.aborted) { return 'aborted'; }
  if (result.timedOut) { return 'timeout'; }
  if (result.error) { return 'error'; }
  return 'complete';
}

/** Millisecond delta between two ISO timestamps, or null if either is missing/malformed. */
function durationBetween(createdAt, completedAt) {
  if (!createdAt || !completedAt) { return null; }
  const ms = new Date(completedAt).getTime() - new Date(createdAt).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Build a run document (single session result).
 * Used by `start --json`, `read <taskId> --json`, and every wave leg.
 *
 * @param {object} opts
 * @param {string} opts.taskId
 * @param {object} [opts.metadata] - Session metadata (model, agent, timestamps, status…)
 * @param {object|null} [opts.result] - Live runHeadless result (flags win over metadata.status)
 * @param {string|null} [opts.summary]
 * @param {string|null} [opts.modelInput] - What the caller typed (alias), if known
 * @param {string|null} [opts.sessionDir]
 * @param {string|null} [opts.waveId] - Explicit wave id (falls back to metadata.parentWave)
 * @returns {object} run document
 */
function buildRunResult({ taskId, metadata = {}, result = null, summary = null, modelInput = null, sessionDir = null, waveId = null, usage = null }) {
  const status = result ? statusFromResult(result) : (metadata.status || 'unknown');
  const createdAt = metadata.createdAt || null;
  const completedAt = metadata.completedAt || metadata.abortedAt || null;
  const durationMs = durationBetween(createdAt, completedAt);
  return {
    schemaVersion: SCHEMA_VERSION,
    type: 'run',
    taskId,
    waveId: waveId !== null ? waveId : (metadata.parentWave || null),
    model: metadata.model || null,
    modelInput: modelInput !== null ? modelInput : (metadata.modelInput || null),
    agent: metadata.agent || null,
    status,
    summary,
    error: status === 'complete' ? null : ((result && result.error) || metadata.reason || null),
    createdAt,
    completedAt,
    durationMs,
    sessionDir,
    opencodeSessionId: metadata.opencodeSessionId || null,
    usage: usage !== null ? usage : (metadata.usage || null),
  };
}

/**
 * Aggregate wave status from leg documents.
 * any leg running → 'running' (live rebuild of an in-flight wave);
 * all complete → 'complete'; ≥1 complete → 'partial';
 * 0 complete + ≥1 aborted → 'aborted'; else 'error'.
 * @param {Array<{status: string}>} legs
 * @returns {string}
 */
function waveStatusFromLegs(legs) {
  if (legs.some(l => l.status === 'running')) { return 'running'; }
  const complete = legs.filter(l => l.status === 'complete').length;
  if (complete === legs.length && legs.length > 0) { return 'complete'; }
  if (complete > 0) { return 'partial'; }
  if (legs.some(l => l.status === 'aborted')) { return 'aborted'; }
  return 'error';
}

/**
 * Map a wave status to a CLI exit code: complete=0, partial=2, error/aborted=1.
 * @param {string} waveStatus
 * @returns {number}
 */
function waveExitCode(waveStatus) {
  if (waveStatus === 'complete') { return 0; }
  if (waveStatus === 'partial') { return 2; }
  return 1;
}

/**
 * Build a wave document from leg run documents.
 * @param {object} opts
 * @param {string} opts.waveId
 * @param {Array<object>} opts.legs - run documents (in --models order)
 * Counts track the four primary terminal statuses (complete/error/timeout/aborted);
 * legs with other statuses (e.g. 'crashed', 'running' in a rebuilt wave) count toward
 * `total` only, so total may exceed the sum of the named buckets.
 * @param {{source: string, file: string|null, chars: number}|null} [opts.promptMeta]
 * @param {string|null} [opts.createdAt]
 * @param {string|null} [opts.completedAt]
 * @param {string|null} [opts.status] - Override (e.g. 'aborted' on signal); default aggregates legs
 * @returns {object} wave document
 */
function buildWaveResult({ waveId, legs = [], promptMeta = null, createdAt = null, completedAt = null, status = null }) {
  const { sumWaveUsage } = require('./pricing');
  const counts = {
    total: legs.length,
    complete: legs.filter(l => l.status === 'complete').length,
    error: legs.filter(l => l.status === 'error').length,
    timeout: legs.filter(l => l.status === 'timeout').length,
    aborted: legs.filter(l => l.status === 'aborted').length,
  };
  const durationMs = durationBetween(createdAt, completedAt);
  return {
    schemaVersion: SCHEMA_VERSION,
    type: 'wave',
    waveId,
    status: (status !== null && status !== undefined) ? status : waveStatusFromLegs(legs),
    error: null,
    counts,
    legs,
    prompt: promptMeta,
    createdAt,
    completedAt,
    durationMs,
    usage: sumWaveUsage(legs),
  };
}

/**
 * Rebuild a run document from a persisted session directory.
 * @param {string} project - Project dir
 * @param {string} taskId
 * @returns {object} run document
 * @throws {Error} if the session does not exist
 * @throws {Error} if metadata.json is missing or corrupt
 */
function buildRunResultFromSession(project, taskId) {
  const fs = require('fs');
  const path = require('path');
  const { resolveExistingSessionDir } = require('../session-manager');
  const sessionDir = resolveExistingSessionDir(project, taskId);
  const metaPath = path.join(sessionDir, 'metadata.json');
  if (!fs.existsSync(metaPath)) {
    throw new Error(`Session ${taskId} not found`);
  }
  let metadata;
  try {
    metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  } catch (err) {
    throw new Error(`Session ${taskId}: metadata is corrupt (${err.message})`);
  }
  const summaryPath = path.join(sessionDir, 'summary.md');
  const summary = fs.existsSync(summaryPath) ? fs.readFileSync(summaryPath, 'utf-8') : null;
  return buildRunResult({ taskId, metadata, summary, sessionDir });
}

/**
 * Rebuild a wave document. Prefers the stored wave.json (written atomically at
 * fanout exit); falls back to a live rebuild from leg sessions (e.g. after a
 * hard kill of the fanout process).
 * @param {string} project
 * @param {string} waveId
 * @returns {object} wave document
 * @throws {Error} if the wave session does not exist
 * @throws {Error} if metadata.json is missing or corrupt
 */
function buildWaveResultFromSession(project, waveId) {
  const fs = require('fs');
  const path = require('path');
  const { resolveExistingSessionDir } = require('../session-manager');
  const waveDir = resolveExistingSessionDir(project, waveId);
  const wavePath = path.join(waveDir, 'wave.json');
  if (fs.existsSync(wavePath)) {
    try {
      return JSON.parse(fs.readFileSync(wavePath, 'utf-8'));
    } catch {
      // Corrupt wave.json (e.g. hard-kill mid-write) — fall through to live rebuild
    }
  }
  const metaPath = path.join(waveDir, 'metadata.json');
  if (!fs.existsSync(metaPath)) {
    throw new Error(`Wave ${waveId} not found`);
  }
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  } catch (err) {
    throw new Error(`Wave ${waveId}: metadata is corrupt (${err.message})`);
  }
  const legs = (meta.legs || []).map((legId) => {
    try { return buildRunResultFromSession(project, legId); }
    catch (err) {
      const { logger } = require('./logger');
      logger.warn('Failed to rebuild leg session; using unknown stub', { legId, error: err.message });
      return buildRunResult({ taskId: legId, metadata: { status: 'unknown', parentWave: waveId } });
    }
  });
  return buildWaveResult({
    waveId,
    legs,
    promptMeta: meta.promptMeta || null,
    createdAt: meta.createdAt || null,
    completedAt: meta.completedAt || null,
  });
}

/**
 * Build a model-catalog document (`models [--search] [--refresh] --json`).
 * @param {{models: Array, fetchedAt: number|null, refreshed?: boolean, search?: string|null}} opts
 */
function buildCatalogDoc({ models, fetchedAt, refreshed = false, search = null }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    type: 'model-catalog',
    fetchedAt: fetchedAt || null,
    refreshed,
    search,
    count: models.length,
    models,
  };
}

/**
 * Build an alias-audit document (`models --check --json`).
 * @param {{stale: Array<{alias,model,source,suggestions}>, catalogAvailable: boolean}} opts
 */
function buildAuditDoc({ stale, catalogAvailable }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    type: 'alias-audit',
    catalogAvailable,
    staleCount: stale.length,
    stale,
  };
}

/**
 * Build a doctor health-check document (`doctor --json`).
 * @param {{version: string, timestamp: string, checks: Array<{id,name,status,message,hint}>}} opts
 */
function buildDoctorDoc({ version, timestamp, checks }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    type: 'doctor',
    ok: checks.every(c => c.status !== 'error'),
    version,
    timestamp,
    checks,
  };
}

module.exports = {
  SCHEMA_VERSION,
  TERMINAL_STATUSES,
  statusFromResult,
  buildRunResult,
  buildWaveResult,
  waveStatusFromLegs,
  waveExitCode,
  buildRunResultFromSession,
  buildWaveResultFromSession,
  buildCatalogDoc,
  buildAuditDoc,
  buildDoctorDoc,
};

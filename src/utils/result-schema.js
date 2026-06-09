// src/utils/result-schema.js
'use strict';

/**
 * @module result-schema
 * Versioned, machine-parseable result documents for `--json` output (F4).
 *
 * Stability contract: fields are only ADDED within a SCHEMA_VERSION;
 * any rename/removal bumps SCHEMA_VERSION.
 */

const SCHEMA_VERSION = 1;

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
function buildRunResult({ taskId, metadata = {}, result = null, summary = null, modelInput = null, sessionDir = null, waveId = null }) {
  const status = result ? statusFromResult(result) : (metadata.status || 'unknown');
  const createdAt = metadata.createdAt || null;
  const completedAt = metadata.completedAt || metadata.abortedAt || null;
  const durationMs = (createdAt && completedAt)
    ? new Date(completedAt).getTime() - new Date(createdAt).getTime()
    : null;
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
  };
}

/**
 * Aggregate wave status from leg documents.
 * all complete → 'complete'; ≥1 complete → 'partial';
 * 0 complete + ≥1 aborted → 'aborted'; else 'error'.
 * @param {Array<{status: string}>} legs
 * @returns {string}
 */
function waveStatusFromLegs(legs) {
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
 * @param {{source: string, file: string|null, chars: number}|null} [opts.promptMeta]
 * @param {string|null} [opts.createdAt]
 * @param {string|null} [opts.completedAt]
 * @param {string|null} [opts.status] - Override (e.g. 'aborted' on signal); default aggregates legs
 * @returns {object} wave document
 */
function buildWaveResult({ waveId, legs, promptMeta = null, createdAt = null, completedAt = null, status = null }) {
  const counts = {
    total: legs.length,
    complete: legs.filter(l => l.status === 'complete').length,
    error: legs.filter(l => l.status === 'error').length,
    timeout: legs.filter(l => l.status === 'timeout').length,
    aborted: legs.filter(l => l.status === 'aborted').length,
  };
  const durationMs = (createdAt && completedAt)
    ? new Date(completedAt).getTime() - new Date(createdAt).getTime()
    : null;
  return {
    schemaVersion: SCHEMA_VERSION,
    type: 'wave',
    waveId,
    status: status || waveStatusFromLegs(legs),
    counts,
    legs,
    prompt: promptMeta,
    createdAt,
    completedAt,
    durationMs,
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
};

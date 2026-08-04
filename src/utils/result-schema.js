'use strict';

/**
 * @module result-schema
 * Versioned, machine-parseable result documents for `--json` output (F4).
 * Stability contract: fields are only ADDED within a SCHEMA_VERSION; any
 * rename/removal bumps SCHEMA_VERSION (defined in ./result-schema-version.js,
 * split out so ./abort-result.js can depend on it without a circular require).
 */
const { SCHEMA_VERSION } = require('./result-schema-version');

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
 * @returns {object} run document; `pack` (v4.5 Task 13) is additive — present only when
 *   metadata.pack was recorded (solo session launched via --pack), sourced straight off
 *   `metadata` like `usage`/`opencodeSessionId` already are (no new function parameter needed).
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
    ...(metadata.pack ? { pack: metadata.pack } : {}),
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
 *
 * COUNTS REMAINDER RULE (stable, no schemaVersion bump): `counts` exposes four
 * NAMED terminal buckets — complete, error, timeout, aborted — plus `total`
 * (= legs.length). The remaining TERMINAL_STATUSES ('crashed', 'idle-timeout')
 * and any non-terminal status (e.g. 'running' in a live-rebuilt wave) are
 * deliberately NOT given their own bucket; they are reflected ONLY in `total`.
 * Therefore a consumer must treat the unnamed remainder as
 *   total − (complete + error + timeout + aborted)
 * and must NOT assume the named buckets sum to `total`. Adding new buckets
 * would change the document shape and REQUIRES bumping SCHEMA_VERSION.
 * This agrees with the MCP wave path (mcp-server.js), which counts a leg as
 * "done" iff its status is in TERMINAL_STATUSES — including 'crashed' — so a
 * crashed leg is done/total there exactly as it is total-only here.
 * @param {{source: string, file: string|null, chars: number}|null} [opts.promptMeta]
 * @param {string|null} [opts.createdAt]
 * @param {string|null} [opts.completedAt]
 * @param {string|null} [opts.status] - Override (e.g. 'aborted' on signal); default aggregates legs
 * @param {string[]} [opts.notices] - Advisory per-leg migration notices (#61 FIX 2); never affects status/exitCode.
 * @param {{name: string, version: string, hash: string, source: string}|null} [opts.pack] - v4.5 Task 13:
 *   additive — present only when the wave was launched via --pack (absent, never null, otherwise).
 * @returns {object} wave document
 */
function buildWaveResult({ waveId, legs = [], promptMeta = null, createdAt = null, completedAt = null, status = null, notices = [], pack = null }) {
  const { sumWaveUsage } = require('./pricing');
  // Named buckets only (see "COUNTS REMAINDER RULE" above). 'crashed' and
  // 'idle-timeout' legs are intentionally NOT bucketed — they land in `total`
  // only, so total may exceed complete+error+timeout+aborted.
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
    notices: Array.isArray(notices) ? notices.filter(Boolean) : [],
    ...(pack ? { pack } : {}),
  };
}

// buildRunResultFromSession/buildWaveResultFromSession live in
// ./result-schema-rebuild.js (size-gate split); re-exported below.
const { buildRunResultFromSession, buildWaveResultFromSession } = require('./result-schema-rebuild');

/**
 * Build a model-catalog document (`models [--search] [--refresh] --json`).
 * #13: lastRefreshAttempt/lastRefreshError are additive — null/null when the
 * last refresh attempt on record succeeded (or none has happened yet).
 * @param {{models: Array, fetchedAt: number|null, refreshed?: boolean, search?: string|null,
 *   lastRefreshAttempt?: number|null, lastRefreshError?: string|null}} opts
 */
function buildCatalogDoc({ models, fetchedAt, refreshed = false, search = null,
  lastRefreshAttempt = null, lastRefreshError = null }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    type: 'model-catalog',
    fetchedAt: fetchedAt || null,
    refreshed,
    search,
    count: models.length,
    models,
    lastRefreshAttempt: lastRefreshAttempt || null,
    lastRefreshError: lastRefreshError || null,
  };
}

/**
 * Build an alias-audit document (`models --check --json`).
 * `gatewayFindings` (Task 6, #gwid) is additive: the per-gateway-form audit
 * of curated DEFAULT aliases (toGatewayRoutes() vs. the live catalog),
 * distinct from the flat `stale` audit above. Defaults to [] so existing
 * callers that omit it are unaffected.
 * `drifted` (v4.6.2 PR1, 2A) is additive: stored user-config aliases whose
 * target is still catalog-live but behind the current quick-pick family
 * resolution (findDriftedStoredAliases). Defaults to [] so existing callers
 * that omit it are unaffected. Paired with an additive `driftedCount`
 * (drifted.length), mirroring the staleCount/stale and
 * gatewayFindingsCount/gatewayFindings pairs above.
 * `probe` (v4.6.2 PR3, spec §6 D5) is additive: the `--live` opt-in per-alias
 * probe outcomes (probeStoredAliases — served/accepted-but-silent/error), one
 * row per stored alias actually probed. Defaults to [] so every call without
 * --live (i.e. every existing caller) is unaffected. Paired with an additive
 * `probeCount` (probe.length), mirroring the driftedCount/drifted pair above.
 * @param {{stale: Array<{alias,model,source,suggestions}>, catalogAvailable: boolean,
 *   gatewayFindings?: Array<{alias,gateway,kind,model,expected?}>,
 *   drifted?: Array<{alias,stored,current}>,
 *   probe?: Array<{alias,target,outcome,detail,cost}>}} opts
 */
function buildAuditDoc({ stale, catalogAvailable, gatewayFindings = [], drifted = [], probe = [] }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    type: 'alias-audit',
    catalogAvailable,
    staleCount: stale.length,
    stale,
    gatewayFindingsCount: gatewayFindings.length,
    gatewayFindings,
    driftedCount: drifted.length,
    drifted,
    probeCount: probe.length,
    probe,
  };
}

/**
 * Build a doctor health-check document (`doctor --json`).
 * @param {{version: string, timestamp: string, checks: Array<{id,name,status,message,hint}>,
 *   degrades?: Array<{kind,channel,what,why,effect,remedy?,data?}>}} opts
 */
function buildDoctorDoc({ version, timestamp, checks, degrades }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    type: 'doctor',
    ok: checks.every(c => c.status !== 'error'),
    version,
    timestamp,
    checks,
    // v4.6 Plan 3 (spec §4/§6): the shared-vocabulary surface. Additive and
    // OPTIONAL — present only when a check failed or --fix repaired something.
    ...(degrades && degrades.length ? { degrades } : {}),
  };
}

// buildAbortResult lives in ./abort-result.js (size-gate split); re-exported below.
const { buildAbortResult } = require('./abort-result');

module.exports = {
  SCHEMA_VERSION,
  TERMINAL_STATUSES,
  durationBetween,
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
  buildAbortResult,
};

'use strict';

/**
 * @module result-schema-rebuild
 * Rebuild run/wave documents from persisted session directories (as opposed to
 * `result-schema.js`'s builders, which assemble a document from in-memory
 * state right after a run/wave finishes). Split out of result-schema.js to
 * stay under the 300-line size gate (#61 whole-branch review housekeeping) —
 * re-exported from result-schema.js so every existing caller's import path is
 * unaffected.
 *
 * `buildRunResult`/`buildWaveResult` are required LAZILY inside each function
 * body (not at module load time) so this file can depend on result-schema.js
 * without a circular-require ordering hazard: result-schema.js requires this
 * module too (to re-export these two functions), and a top-level require here
 * would see result-schema.js's exports mid-assembly (see result-schema.js's
 * module doc for why abort-result.js already avoids the same trap).
 */

/**
 * Rebuild a run document from a persisted session directory.
 * @param {string} project - Project dir
 * @param {string} taskId
 * @returns {object} run document
 * @throws {Error} if the session does not exist or metadata.json is missing/corrupt
 */
function buildRunResultFromSession(project, taskId) {
  const fs = require('fs');
  const path = require('path');
  const { resolveExistingSessionDir } = require('../session-manager');
  const { buildRunResult } = require('./result-schema');
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
 * @throws {Error} if the wave session does not exist or metadata.json is missing/corrupt
 */
function buildWaveResultFromSession(project, waveId) {
  const fs = require('fs');
  const path = require('path');
  const { resolveExistingSessionDir } = require('../session-manager');
  const { buildRunResult, buildWaveResult } = require('./result-schema');
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
    ...(meta.pack ? { pack: meta.pack } : {}), // v4.5 Task 13: absent-not-null, mirrors promptMeta's sourcing above.
    createdAt: meta.createdAt || null,
    completedAt: meta.completedAt || null,
  });
}

module.exports = { buildRunResultFromSession, buildWaveResultFromSession };

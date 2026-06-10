// src/sidecar/fanout-leg.js
'use strict';

/**
 * @module fanout-leg
 * Per-leg helpers extracted from fanout.js to keep both files ≤300 lines.
 * Exports: legStatusFromResult, writeLegPatch, runLeg
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');

/** Map a runHeadless result to a leg metadata status. */
function legStatusFromResult(result) {
  const { statusFromResult } = require('../utils/result-schema');
  return statusFromResult(result);
}

/** Read-merge-write a leg's metadata.json. Returns the merged object. */
function writeLegPatch(legDir, patch) {
  const metaPath = path.join(legDir, 'metadata.json');
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch { /* fresh */ }
  const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  // A signal/abort marker is authoritative: never demote 'aborted' back to a
  // softer terminal status (a leg finishing concurrently with Ctrl-C must not
  // win the write race and report 'complete').
  if (meta.status === 'aborted' && defined.status && defined.status !== 'aborted') {
    delete defined.status;
  }
  const merged = { ...meta, ...defined };
  fs.writeFileSync(metaPath, JSON.stringify(merged, null, 2), { mode: 0o600 });
  return merged;
}

/**
 * Run one leg end-to-end: session record → runHeadless (shared server) →
 * leg finalize. Never throws — always resolves to a run document.
 */
async function runLeg({ leg, legId, waveId, project, systemPrompt, userMessage, timeoutMs, agent, client, server, summaryLength, reasoning, quiet }) {
  const { IdleWatchdog } = require('../utils/idle-watchdog');
  const { markAborted } = require('../utils/session-abort');
  const { runHeadless } = require('../headless');
  const { SessionPaths, saveInitialContext } = require('./session-utils');
  const { buildRunResult } = require('../utils/result-schema');
  const { createSessionMetadata } = require('./start');

  const legDir = createSessionMetadata(legId, project, {
    model: leg.model, prompt: userMessage, noUi: true, agent: agent || 'build',
  });
  writeLegPatch(legDir, { parentWave: waveId, modelInput: leg.modelInput });
  saveInitialContext(legDir, systemPrompt, userMessage);

  // Per-leg watchdog: a BACKSTOP strictly behind runHeadless's own deadline
  // (timeoutMs + 60s), so it only fires if the poll loop itself wedges. Its
  // timeout aborts ONLY this leg, and only while the leg is still running.
  // NEVER server.close()/process.exit() — shared server.
  const watchdog = new IdleWatchdog({
    mode: 'headless',
    timeout: timeoutMs + 60000,
    onTimeout: () => {
      let current = {};
      try { current = JSON.parse(fs.readFileSync(path.join(legDir, 'metadata.json'), 'utf-8')); } catch { /* unreadable */ }
      if (current.status === 'running') {
        logger.warn('Leg watchdog backstop fired — aborting leg', { legId });
        markAborted(legDir, 'leg watchdog backstop');
      }
    },
  }).start();

  let result;
  try {
    result = await runHeadless(
      leg.model, systemPrompt, userMessage, legId, project,
      timeoutMs, agent || 'build',
      { client, server, watchdog, summaryLength, reasoning }
    );
  } catch (err) {
    result = { summary: '', completed: false, timedOut: false, aborted: false, error: err.message, taskId: legId };
  } finally {
    watchdog.cancel();
  }

  const status = legStatusFromResult(result);
  const summary = result.summary || null;
  if (summary) {
    fs.writeFileSync(SessionPaths.summaryFile(legDir), summary, { mode: 0o600 });
  }
  const finalMeta = writeLegPatch(legDir, {
    status,
    reason: result.error || undefined,
    completedAt: new Date().toISOString(),
  });
  const effectiveResult = finalMeta.status === 'aborted'
    ? { ...result, aborted: true }
    : result;
  if (!quiet) {
    process.stderr.write(`[fanout] leg ${legId} (${leg.modelInput}): ${finalMeta.status}\n`);
  }
  return buildRunResult({
    taskId: legId, metadata: finalMeta, result: effectiveResult, summary,
    modelInput: leg.modelInput, sessionDir: legDir, waveId,
  });
}

module.exports = { legStatusFromResult, writeLegPatch, runLeg };

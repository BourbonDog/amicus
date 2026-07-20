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
const { writeFileAtomic } = require('../utils/atomic-write');

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
  writeFileAtomic(metaPath, JSON.stringify(merged, null, 2), { mode: 0o600 });
  return merged;
}

/**
 * Synthesize an error run document for a leg whose MODEL never routed (#61
 * Task 7.3) — the gateway router returned `error` (or, in principle,
 * `selection_required`) for this leg's requested model before any session was
 * created, so there is nothing to run. Mirrors the shape runLeg's own catch
 * branch already produces for "setup threw before the session dir existed":
 * no legDir, no summary, an `error` status — this never touches the shared
 * server or the Promise.all in runFanout, so it can never sink a sibling leg.
 * @param {{leg: {modelInput: string, routeResult: object}, legId: string,
 *   waveId: string, quiet?: boolean}} args
 * @returns {object} run document (status 'error')
 */
function buildRoutingFailureLeg({ leg, legId, waveId, quiet }) {
  const { toCliMessage } = require('../utils/route-error');
  const { buildRunResult } = require('../utils/result-schema');
  const message = toCliMessage(leg.routeResult);
  if (!quiet) {
    process.stderr.write(`[fanout] leg ${legId} (${leg.modelInput}): error (routing)\n`);
  }
  return buildRunResult({
    taskId: legId, metadata: {}, result: { error: message, completed: false },
    summary: null, modelInput: leg.modelInput, sessionDir: null, waveId,
  });
}

/**
 * Run one leg end-to-end: session record → runHeadless (shared server) →
 * leg finalize. Never throws — always resolves to a run document.
 */
async function runLeg({ leg, legId, waveId, project, systemPrompt, userMessage, timeoutMs, agent, client, server, summaryLength, reasoning, quiet, foldNonce, directory }) {
  const { IdleWatchdog } = require('../utils/idle-watchdog');
  const { markAborted } = require('../utils/session-abort');
  const { runHeadless } = require('../headless');
  const { SessionPaths, saveInitialContext } = require('./session-utils');
  const { buildRunResult } = require('../utils/result-schema');
  const { createSessionMetadata } = require('./start');

  // Setup + run under ONE try so ANY throw (session record creation, initial
  // context write, watchdog arm, or the poll loop itself) becomes an error run
  // document — the wave still aggregates and writes wave.json. This function
  // must NEVER throw / reject for a leg error (fanout.js relies on this in its
  // Promise.all so one leg cannot sink the whole wave).
  let legDir = null;
  let watchdog = null;
  let result;
  try {
    legDir = createSessionMetadata(legId, project, {
      model: leg.model, prompt: userMessage, noUi: true, agent: agent || 'build',
    });
    writeLegPatch(legDir, { parentWave: waveId, modelInput: leg.modelInput });
    saveInitialContext(legDir, systemPrompt, userMessage);

    // Per-leg watchdog: a BACKSTOP strictly behind runHeadless's own deadline
    // (timeoutMs + 60s), so it only fires if the poll loop itself wedges. Its
    // timeout aborts ONLY this leg, and only while the leg is still running.
    // NEVER server.close()/process.exit() — shared server.
    watchdog = new IdleWatchdog({
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

    result = await runHeadless(
      leg.model, systemPrompt, userMessage, legId, project,
      timeoutMs, agent || 'build',
      { client, server, watchdog, summaryLength, reasoning, nonce: foldNonce, directory }
    );
  } catch (err) {
    result = { summary: '', completed: false, timedOut: false, aborted: false, error: err.message, taskId: legId };
  } finally {
    if (watchdog) { watchdog.cancel(); }
  }

  const status = legStatusFromResult(result);
  const summary = result.summary || null;
  const { resolveUsage } = require('../utils/pricing');
  const usage = result && result.usage ? resolveUsage({ model: leg.model, usageTotals: result.usage }) : null;
  // B24: cross-run spend ledger — one row per leg (mirrors start.js's single-run
  // append). Best-effort; never let ledger bookkeeping affect the leg's own result.
  if (usage) {
    try {
      const { appendSpend } = require('../utils/spend-ledger');
      appendSpend({ taskId: legId, waveId, model: leg.model, mode: 'leg', usage });
    } catch { /* best-effort */ }
  }
  // If setup threw before the session dir existed, there is nothing on disk to
  // finalize — still resolve to an error run document so the wave aggregates.
  const legPatch = {
    status,
    reason: result.error || undefined,
    completedAt: new Date().toISOString(),
    usage: usage || undefined,
  };
  let finalMeta = legPatch;
  if (legDir) {
    if (summary) {
      fs.writeFileSync(SessionPaths.summaryFile(legDir), summary, { mode: 0o600 });
    }
    finalMeta = writeLegPatch(legDir, legPatch);
  }
  const effectiveResult = finalMeta.status === 'aborted'
    ? { ...result, aborted: true }
    : result;
  if (!quiet) {
    process.stderr.write(`[fanout] leg ${legId} (${leg.modelInput}): ${finalMeta.status}\n`);
  }
  return buildRunResult({
    taskId: legId, metadata: finalMeta, result: effectiveResult, summary,
    modelInput: leg.modelInput, sessionDir: legDir, waveId, usage,
  });
}

module.exports = { legStatusFromResult, writeLegPatch, runLeg, buildRoutingFailureLeg };

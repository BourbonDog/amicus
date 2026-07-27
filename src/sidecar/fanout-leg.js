// src/sidecar/fanout-leg.js
'use strict';

/**
 * @module fanout-leg
 * Per-leg helpers extracted from fanout.js to keep both files ≤300 lines.
 * Exports: legStatusFromResult, writeLegPatch, runLeg, runSingleAttempt,
 * buildRoutingFailureLeg (+ runLegWithFallback/recordAttemptSpend/
 * sumAttemptUsage, re-exported from ./fanout-leg-fallback — split out to keep
 * THIS file under the size gate; see that module for the substitution loop).
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
 * Run ONE leg attempt end-to-end: session record -> runHeadless (shared
 * server) -> leg finalize. Faithful extraction of the pre-fallback `runLeg`
 * body — same setup, same never-throws try/finally, same leg-started/
 * leg-terminal emits (with `follow` + the M4 own-try/catch), same `directory`
 * threading into runHeadless. Never throws — always resolves to a run
 * document. Does NOT append spend (the caller owns that: `runLeg` appends
 * once; `runLegWithFallback` appends per attempt via recordAttemptSpend).
 * Adds `.reason` (alias of buildRunResult's `.error`) and `.legId` so the
 * fallback loop reads a stable shape without re-deriving them.
 */
async function runSingleAttempt({ leg, legId, waveId, project, directory, follow, systemPrompt, userMessage, timeoutMs, agent, client, server, summaryLength, reasoning, quiet, foldNonce }) {
  const { IdleWatchdog } = require('../utils/idle-watchdog');
  const { markAborted } = require('../utils/session-abort');
  const { runHeadless } = require('../headless');
  const { SessionPaths, saveInitialContext } = require('./session-utils');
  const { buildRunResult, durationBetween } = require('../utils/result-schema');
  const { createSessionMetadata } = require('./start');
  const { emitLegStarted, emitLegTerminal } = require('../observe/events');
  const { getSessionDir } = require('../session-manager');

  let legDir = null;
  let watchdog = null;
  let result;
  // Captured inside the try below so a getSessionDir throw (invalid taskId)
  // still becomes an error run document like every other setup failure; used
  // again AFTER the try/finally closes to emit leg-terminal (M4: that emit is
  // unguarded by the try, so it must never depend on something that could throw).
  let waveDir = null;
  try {
    legDir = createSessionMetadata(legId, project, {
      model: leg.model, prompt: userMessage, noUi: true, agent: agent || 'build',
    });
    waveDir = getSessionDir(project, waveId);
    emitLegStarted(waveDir, waveId, legId, leg.model, leg.modelInput, follow);
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
  // v4.4 Task 2 (B4) + v4.4.1 CA-1: a leg that made a SUBAGENT (`task`) call has
  // spend in a child OpenCode session that is billed separately and is NOT
  // rolled into the parent session's cost. runHeadless now WALKS those sessions
  // (src/sidecar/child-sessions.js), so `subtreeUnknown` narrows from "this leg
  // called `task`, therefore assume the worst" to what it should always have
  // meant: the walk could not account for the subtree.
  //
  // The walk is authoritative when it ran — including in the direction that
  // CLEARS the flag, which the name-string proxy could never do (backlog CA-5:
  // a tool merely NAMED `task` that spawns nothing used to make an exact run
  // report itself inexact). The proxy survives only as the fallback for a leg
  // where the walk could not run at all.
  const walked = result && result.subtree;
  const subtreeUnknown = walked
    ? !!walked.unknown
    : !!(result && result.subagentToolCalls > 0);
  const usage = result && result.usage
    ? resolveUsage({ model: leg.model, usageTotals: result.usage, subtreeUnknown, subtree: walked || undefined })
    : null;
  // If setup threw before the session dir existed, there is nothing on disk to
  // finalize — still resolve to an error run document so the wave aggregates.
  const legPatch = {
    status,
    reason: result.error || undefined,
    completedAt: new Date().toISOString(),
    usage: usage || undefined,
    // v4.4 B4 part 1: the leg completed with tool calls still live, so its
    // OpenCode session may have kept working (and billing) afterwards. Travels
    // with the leg so it is readable long after the run's stderr is gone.
    toolSettleTimedOut: (result && result.toolSettleTimedOut) || undefined,
    // v4.4.1 LC-2: whether the ceiling's abort landed. Deliberately NOT
    // `|| undefined` like the flag above — a `false` here is the whole point
    // ("we tried to stop it and could not; it may still be billing") and must
    // survive onto disk. runHeadless sets it only when the ceiling was hit, so
    // passing it through unchanged keeps a clean leg carrying neither field.
    toolSettleAborted: result ? result.toolSettleAborted : undefined,
  };
  let finalMeta = legPatch;
  if (legDir) {
    if (summary) { fs.writeFileSync(SessionPaths.summaryFile(legDir), summary, { mode: 0o600 }); }
    finalMeta = writeLegPatch(legDir, legPatch);
  }
  if (waveDir) {
    try {
      emitLegTerminal(waveDir, waveId, legId, {
        model: leg.model, status: finalMeta.status,
        durationMs: durationBetween(finalMeta.createdAt, finalMeta.completedAt),
        usage: usage || null,
      }, follow);
    } catch { /* best-effort: a missing duration/emit never fails the leg */ }
  }
  const effectiveResult = finalMeta.status === 'aborted' ? { ...result, aborted: true } : result;
  if (!quiet) {
    process.stderr.write(`[fanout] leg ${legId} (${leg.modelInput}): ${finalMeta.status}\n`);
  }
  const doc = buildRunResult({
    taskId: legId, metadata: finalMeta, result: effectiveResult, summary,
    modelInput: leg.modelInput, sessionDir: legDir, waveId, usage,
  });
  doc.reason = doc.error || null; // classifier alias (buildRunResult stores it as .error)
  doc.legId = legId;
  return doc;
}

/**
 * Run one leg end-to-end. Thin wrapper: fallback OFF (the default) is a
 * single `runSingleAttempt` + exactly one spend row (`attempt:0`, byte-
 * identical to the pre-fallback appendSpend row); fallback ON delegates to
 * `runLegWithFallback` (./fanout-leg-fallback). Never throws.
 */
async function runLeg(args) {
  const { leg, legId, waveId, project, fallback } = args;
  const { runLegWithFallback, recordAttemptSpend } = require('./fanout-leg-fallback');
  if (fallback && fallback.enabled) { return runLegWithFallback(args); }
  const doc = await runSingleAttempt(args);
  recordAttemptSpend({ doc, leg, currentModel: leg.model, legId, waveId, project, attempt: 0, originalModel: leg.model }, {});
  return doc;
}

module.exports = {
  legStatusFromResult, writeLegPatch, runLeg, buildRoutingFailureLeg, runSingleAttempt,
  ...require('./fanout-leg-fallback'),
};

// src/sidecar/fanout.js
'use strict';

/**
 * @module fanout
 * F4 council-native fan-out: run N models on the same prompt concurrently on
 * ONE shared OpenCode server (runHeadless external-server mode). Each leg is
 * an ordinary session (parentWave metadata); results aggregate into a wave
 * document persisted as wave.json in the wave session dir.
 * Spec: docs/superpowers/specs/2026-06-09-f4-fanout-json-design.md
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');
const { runLeg, buildRoutingFailureLeg } = require('./fanout-leg');
const { parseModelsList, DEFAULT_MAX_LEGS, validateFanoutModels } = require('./fanout-validate');
const { ERROR_CODES } = require('../utils/error-doc');
const { writeFileAtomic } = require('../utils/atomic-write');

/**
 * Derive leg task IDs: <waveId>-1 .. <waveId>-N (matches TASK_ID_PATTERN).
 * @param {string} waveId
 * @param {number} count
 * @returns {string[]}
 */
function deriveLegIds(waveId, count) {
  return Array.from({ length: count }, (_, i) => `${waveId}-${i + 1}`);
}

/**
 * Write/merge wave metadata (preserves fields an MCP pre-spawn handler wrote).
 * Abort-wins: once existing status is 'aborted', a patch cannot demote it back
 * to a softer status (same precedence rule as writeLegPatch — a signal/abort
 * marker must never lose a write race against an in-flight init/finalize).
 */
function writeWaveMetadata(waveDir, patch) {
  const metaPath = path.join(waveDir, 'metadata.json');
  let existing = {};
  if (fs.existsSync(metaPath)) {
    try { existing = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch { /* corrupt → rewrite */ }
  }
  const safePatch = { ...patch };
  if (existing.status === 'aborted' && safePatch.status && safePatch.status !== 'aborted') {
    delete safePatch.status;
  }
  const merged = { ...existing, ...safePatch };
  writeFileAtomic(metaPath, JSON.stringify(merged, null, 2), { mode: 0o600 });
  return merged;
}

/**
 * Run a fan-out wave. Spec §4.3.
 * @param {object} options - models, prompt, promptMeta, waveId?, project, agent?,
 *   thinking?, timeout? (minutes), summaryLength?, includeContext?, sessionId?,
 *   coworkProcess? (#10: Cowork parent-session pin, forwarded to buildContext),
 *   contextTurns?, contextSince?, contextMaxTokens?, mcp?, mcpConfig?, noMcp?,
 *   excludeMcp?, noValidateModel?, gatewayMode? (#61 Task 7.3: --gateway merged
 *   with routing.prefer, applied per leg), json?, client?, quiet? (suppress
 *   stdout — tests)
 * @returns {Promise<{wave: object, exitCode: number}>} Never rejects for leg errors.
 */
async function runFanout(options) {
  const { buildWaveResult, waveExitCode } = require('../utils/result-schema');
  const { generateTaskId, buildMcpConfig } = require('./start');
  const { startOpenCodeServer, HEARTBEAT_INTERVAL } = require('./session-utils');
  const { createWaveHeartbeat } = require('./wave-progress');
  const { buildContext } = require('./context-builder');
  const { buildPrompts } = require('../prompt-builder');
  const { generateFoldNonce } = require('../utils/fold-marker');
  const { installSignalAbort, markAborted } = require('../utils/session-abort');
  const { getSessionDir } = require('../session-manager');

  const project = options.project || process.cwd();
  const createdAt = new Date().toISOString();
  const emit = (doc) => {
    if (options.quiet) { return; }
    if (options.json) {
      console.log(JSON.stringify(doc, null, 2));
    } else {
      const { formatWaveHuman } = require('./fanout-output');
      console.log(formatWaveHuman(doc));
    }
  };
  const errorWave = (waveId, message) => {
    const doc = buildWaveResult({ waveId: waveId || null, legs: [], promptMeta: options.promptMeta || null, createdAt, completedAt: new Date().toISOString(), status: 'error' });
    doc.error = message;
    emit(doc);
    return { wave: doc, exitCode: 1 };
  };

  const failPre = (code, message, hint) => {
    if (!options.quiet) {
      if (options.json) {
        const { buildErrorDoc } = require('../utils/error-doc');
        console.log(JSON.stringify(buildErrorDoc({ code, message, hint }), null, 2));
      } else {
        console.error(hint ? `${message}\n${hint}` : message);
      }
    }
    return { wave: null, errorDoc: { code, message }, exitCode: 1 };
  };

  // 1. Fail-fast validation (list-level only — see validateFanoutModels).
  // Per-leg routing is resolved here too (#61 Task 7.3): a leg that fails to
  // route is NOT a wave-level failure — it comes back `ok:false` and still
  // occupies its slot in `legs`, so sibling legs launch normally (step 6).
  const validated = await validateFanoutModels(options.models, {
    noValidateModel: options.noValidateModel,
    gatewayMode: options.gatewayMode,
  });
  if (validated.error) { return failPre(validated.code || 'BAD_ARGS', validated.error); }
  const legs = validated.legs;
  const okLegs = legs.filter(l => l.ok);
  // FIX 2 (#61 whole-branch review): a leg's migration notice has no CLI
  // stderr to land on (fanout is one process resolving many legs, not one
  // launch) — surface it on the wave doc instead, deduped in case two legs
  // for the same vendor happen to both migrate (only the first ever fires
  // since markMigrationNotified is one-shot per vendor, but dedupe defensively).
  const notices = [...new Set(legs.map(l => l.notice).filter(Boolean))];

  // 1b. Budget gate (pre-creation; refuse before spending). Only legs that
  // will actually run cost anything — a leg that never routed never spends.
  if (!options.noCostGate) {
    const { checkBudget, formatBudgetError } = require('./budget');
    const { loadConfig } = require('../utils/config');
    const cfg = loadConfig() || {};
    const maxCostPerMtok = options.maxCostPerMtok !== undefined ? options.maxCostPerMtok : cfg.maxCostPerMtok;
    const promptChars = (options.promptMeta && options.promptMeta.chars) || (options.prompt ? options.prompt.length : 0);
    const budget = checkBudget(okLegs, { maxCostPerMtok, maxCost: options.maxCost !== null && options.maxCost !== undefined ? options.maxCost : cfg.maxCost, promptChars });
    if (!budget.ok) {
      return failPre(ERROR_CODES.BUDGET_EXCEEDED, 'Error: budget gate refused the wave', formatBudgetError(budget));
    }
  }

  // 2. Wave record
  const waveId = options.waveId || generateTaskId();
  const legIds = deriveLegIds(waveId, legs.length);
  const waveDir = getSessionDir(project, waveId);
  fs.mkdirSync(waveDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(waveDir, 'briefing.md'), options.prompt, { mode: 0o600 });
  writeWaveMetadata(waveDir, {
    taskId: waveId, type: 'wave', status: 'running', mode: 'headless',
    models: legs.map(l => (l.ok ? l.model : l.modelInput)), legs: legIds,
    briefing: String(options.prompt).slice(0, 200),
    promptMeta: options.promptMeta || null,
    pid: process.pid, project, createdAt,
  });

  // 3. Context + prompts built ONCE (model-independent)
  const context = options.includeContext !== false
    ? buildContext(project, options.sessionId || 'current', {
        contextTurns: options.contextTurns, contextSince: options.contextSince,
        contextMaxTokens: options.contextMaxTokens, client: options.client,
        // #10: pin the right Cowork parent session for every leg (built once).
        coworkProcess: options.coworkProcess,
      })
    : '[Context excluded by caller - briefing is self-contained]';
  // 15b.3: ONE nonce for the whole wave — every leg shares the SAME prompt
  // (built once, above), so every leg's model is instructed with the same
  // nonce, and runLeg threads it to each leg's own runHeadless detector.
  const foldNonce = generateFoldNonce();
  const { system: systemPrompt, userMessage } = buildPrompts(
    options.prompt, context, project, true, options.agent || 'build', options.summaryLength, options.client, foldNonce
  );

  // 4. One shared OpenCode server. Sole-input invariant (#61 Task 4.6/7.3):
  // register EVERY leg's actually-resolved executable id in provider.models,
  // not just the alias-derived defaults, so a leg whose router decision
  // diverges from its alias (e.g. alias stores openrouter/... but the router
  // picked direct) still matches what the leg is actually told to launch.
  const mcpServers = buildMcpConfig({
    mcp: options.mcp, mcpConfig: options.mcpConfig, clientType: options.client,
    noMcp: options.noMcp, excludeMcp: options.excludeMcp,
  });
  let client, server;
  try {
    ({ client, server } = await startOpenCodeServer(mcpServers, { models: okLegs.map(l => l.model) }));
  } catch (err) {
    writeWaveMetadata(waveDir, { status: 'error', reason: err.message, completedAt: new Date().toISOString() });
    return errorWave(waveId, `Failed to start server: ${err.message}`);
  }
  if (server.goPid) { writeWaveMetadata(waveDir, { goPid: server.goPid }); }

  // 5. Signal abort: mark wave + all legs aborted, close the server, then let
  // NORMAL control flow finalize — legs see their abort marker within one poll
  // (~2s) and settle, so step 7 still writes wave.json and emits a parseable
  // aborted document. An unref'd force-exit watchdog backstops a wedged leg.
  const legDirs = legIds.map(id => getSessionDir(project, id));
  let signalled = null;
  const uninstallSignals = installSignalAbort({
    onAbort: (signal) => {
      const code = signal === 'SIGINT' ? 130 : 143;
      if (signalled) { process.exit(code); } // second signal: exit NOW
      signalled = signal;
      logger.warn('Signal received — aborting wave', { waveId, signal });
      markAborted(waveDir, signal);
      for (const dir of legDirs) { markAborted(dir, signal); }
      // close() is async (B06 escalation); this handler stays sync, so
      // fire-and-forget with a rejection guard. The 10s exit watchdog below
      // comfortably outlives the ~2s escalation grace inside close().
      try { server.close().catch(() => {}); } catch { /* best-effort */ }
      const { armExitWatchdog } = require('../utils/lifecycle');
      armExitWatchdog(code, 10000, { log: (m, meta) => logger.debug(m, meta) });
    },
  });

  // 6. Launch all ROUTABLE legs concurrently (runLeg never rejects). A leg
  // that failed to route (leg.ok === false) never touches the shared server —
  // it resolves immediately to an error run document (buildRoutingFailureLeg)
  // in its own slot, so it fails only itself, never the sibling legs or the
  // whole wave (#61 Task 7.3).
  const heartbeat = options.quiet
    ? { stop() {} }
    : createWaveHeartbeat(
        legs.map((leg, i) => ({ label: leg.modelInput || leg.model, dir: legDirs[i] })),
        HEARTBEAT_INTERVAL
      );
  const timeoutMs = (options.timeout || 15) * 60 * 1000;
  const reasoning = options.thinking ? { effort: options.thinking } : undefined;
  let legDocs;
  try {
    legDocs = await Promise.all(legs.map((leg, i) => (leg.ok
      ? runLeg({
          leg, legId: legIds[i], waveId, project, systemPrompt, userMessage,
          timeoutMs, agent: options.agent, client, server,
          summaryLength: options.summaryLength, reasoning, quiet: options.quiet,
          foldNonce,
        })
      : Promise.resolve(buildRoutingFailureLeg({ leg, legId: legIds[i], waveId, quiet: options.quiet }))
    )));
  } finally {
    heartbeat.stop();
    uninstallSignals();
    try { await server.close(); } catch { /* already closed on signal */ }
  }

  // 7. Aggregate, persist (atomic: tmp + rename), finalize, emit
  const completedAt = new Date().toISOString();
  const wave = buildWaveResult({
    waveId, legs: legDocs, promptMeta: options.promptMeta || null, createdAt, completedAt,
    status: signalled ? 'aborted' : null, notices,
  });
  const wavePath = path.join(waveDir, 'wave.json');
  writeFileAtomic(wavePath, JSON.stringify(wave, null, 2), { mode: 0o600 });
  writeWaveMetadata(waveDir, { status: wave.status, completedAt });
  emit(wave);
  const exitCode = signalled
    ? (signalled === 'SIGINT' ? 130 : 143)
    : waveExitCode(wave.status);
  return { wave, exitCode };
}

module.exports = {
  parseModelsList, deriveLegIds, validateFanoutModels, DEFAULT_MAX_LEGS,
  runFanout, writeWaveMetadata,
};

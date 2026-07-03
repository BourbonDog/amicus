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
const { runLeg } = require('./fanout-leg');
const { ERROR_CODES } = require('../utils/error-doc');

/** Default max legs per wave (env-overridable). */
const DEFAULT_MAX_LEGS = 10;

/**
 * Split a --models value into trimmed, non-empty entries (duplicates allowed).
 * @param {string|boolean|undefined} modelsArg
 * @returns {string[]}
 */
function parseModelsList(modelsArg) {
  if (typeof modelsArg !== 'string') { return []; }
  return modelsArg.split(',').map(s => s.trim()).filter(Boolean);
}

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
 * Fail-fast validation of the whole model list BEFORE any leg launches:
 * alias resolution, API-key presence, live-catalog validation (F3 machinery).
 * @param {string} modelsArg - Raw --models value
 * @param {{noValidateModel?: boolean}} [opts]
 * @returns {Promise<{legs: Array<{modelInput: string, model: string}>} | {error: string}>}
 */
async function validateFanoutModels(modelsArg, opts = {}) {
  const raw = parseModelsList(modelsArg);
  if (raw.length === 0) {
    return { error: 'Error: --models requires a comma-separated list (e.g. gemini,gpt,deepseek)', code: 'BAD_ARGS' };
  }
  // Invalid or non-positive AMICUS_FANOUT_MAX_LEGS (0, negative, garbage) falls back to the default.
  const envCap = Number(process.env.AMICUS_FANOUT_MAX_LEGS);
  const maxLegs = (Number.isInteger(envCap) && envCap > 0) ? envCap : DEFAULT_MAX_LEGS;
  if (raw.length > maxLegs) {
    return { error: `Error: --models exceeds the fan-out cap of ${maxLegs} legs (set AMICUS_FANOUT_MAX_LEGS to raise)`, code: 'BAD_ARGS' };
  }

  const { tryResolveModel } = require('../utils/config');
  const { validateApiKey } = require('../utils/validators');
  const { validateAgainstCatalog } = require('../utils/model-validator');
  const { lookupPricing } = require('../utils/pricing');
  const legs = [];
  for (const modelInput of raw) {
    const resolved = tryResolveModel(modelInput);
    if (resolved.error) {
      return { error: `Error: model '${modelInput}': ${resolved.error}`, code: 'BAD_MODEL' };
    }
    let model = resolved.model;
    const keyCheck = validateApiKey(model);
    if (!keyCheck.valid) {
      return { error: keyCheck.error, code: 'MISSING_KEY' };
    }
    if (!opts.noValidateModel) {
      const alias = modelInput.includes('/') ? undefined : modelInput;
      try {
        model = await validateAgainstCatalog(model, alias);
      } catch (err) {
        return { error: err.message, code: 'BAD_MODEL' };
      }
    }
    legs.push({ modelInput, model, pricing: lookupPricing(model) });
  }
  return { legs };
}

/** Write/merge wave metadata (preserves fields an MCP pre-spawn handler wrote). */
function writeWaveMetadata(waveDir, patch) {
  const metaPath = path.join(waveDir, 'metadata.json');
  let existing = {};
  if (fs.existsSync(metaPath)) {
    try { existing = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch { /* corrupt → rewrite */ }
  }
  const merged = { ...existing, ...patch };
  fs.writeFileSync(metaPath, JSON.stringify(merged, null, 2), { mode: 0o600 });
  return merged;
}

/**
 * Run a fan-out wave. Spec §4.3.
 * @param {object} options - models, prompt, promptMeta, waveId?, project, agent?,
 *   thinking?, timeout? (minutes), summaryLength?, includeContext?, sessionId?,
 *   coworkProcess? (#10: Cowork parent-session pin, forwarded to buildContext),
 *   contextTurns?, contextSince?, contextMaxTokens?, mcp?, mcpConfig?, noMcp?,
 *   excludeMcp?, noValidateModel?, json?, client?, quiet? (suppress stdout — tests)
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

  // 1. Fail-fast validation
  const validated = await validateFanoutModels(options.models, { noValidateModel: options.noValidateModel });
  if (validated.error) { return failPre(validated.code || 'BAD_ARGS', validated.error); }
  const legs = validated.legs;

  // 1b. Budget gate (pre-creation; refuse before spending)
  if (!options.noCostGate) {
    const { checkBudget, formatBudgetError } = require('./budget');
    const { loadConfig } = require('../utils/config');
    const cfg = loadConfig() || {};
    const maxCostPerMtok = options.maxCostPerMtok !== undefined ? options.maxCostPerMtok : cfg.maxCostPerMtok;
    const promptChars = (options.promptMeta && options.promptMeta.chars) || (options.prompt ? options.prompt.length : 0);
    const budget = checkBudget(legs, { maxCostPerMtok, maxCost: options.maxCost !== null && options.maxCost !== undefined ? options.maxCost : cfg.maxCost, promptChars });
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
    models: legs.map(l => l.model), legs: legIds,
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

  // 4. One shared OpenCode server
  const mcpServers = buildMcpConfig({
    mcp: options.mcp, mcpConfig: options.mcpConfig, clientType: options.client,
    noMcp: options.noMcp, excludeMcp: options.excludeMcp,
  });
  let client, server;
  try {
    ({ client, server } = await startOpenCodeServer(mcpServers));
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

  // 6. Launch all legs concurrently (runLeg never rejects)
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
    legDocs = await Promise.all(legs.map((leg, i) => runLeg({
      leg, legId: legIds[i], waveId, project, systemPrompt, userMessage,
      timeoutMs, agent: options.agent, client, server,
      summaryLength: options.summaryLength, reasoning, quiet: options.quiet,
      foldNonce,
    })));
  } finally {
    heartbeat.stop();
    uninstallSignals();
    try { await server.close(); } catch { /* already closed on signal */ }
  }

  // 7. Aggregate, persist (atomic: tmp + rename), finalize, emit
  const completedAt = new Date().toISOString();
  const wave = buildWaveResult({
    waveId, legs: legDocs, promptMeta: options.promptMeta || null, createdAt, completedAt,
    status: signalled ? 'aborted' : null,
  });
  const wavePath = path.join(waveDir, 'wave.json');
  const waveTmp = `${wavePath}.tmp`;
  fs.writeFileSync(waveTmp, JSON.stringify(wave, null, 2), { mode: 0o600 });
  fs.renameSync(waveTmp, wavePath);
  writeWaveMetadata(waveDir, { status: wave.status, completedAt });
  emit(wave);
  const exitCode = signalled
    ? (signalled === 'SIGINT' ? 130 : 143)
    : waveExitCode(wave.status);
  return { wave, exitCode };
}

module.exports = {
  parseModelsList, deriveLegIds, validateFanoutModels, DEFAULT_MAX_LEGS,
  runFanout,
};

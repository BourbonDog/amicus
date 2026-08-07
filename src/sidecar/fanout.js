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
// Wave-document persistence lives in ./fanout-wave-io (size-gate split, v4.4.1
// Task 0.5). writeWaveMetadata is re-exported below — fanout-retry.js and the
// fanout tests import it from here.
const { writeWaveMetadata, writeWaveDoc, finishWave, stampLegAttribution } = require('./fanout-wave-io');

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
 * Run a fan-out wave. Spec §4.3.
 * @param {object} options - models, prompt, promptMeta, waveId?, project, agent?,
 *   thinking?, timeout? (minutes), summaryLength?, includeContext?, sessionId?,
 *   coworkProcess? (#10: Cowork parent-session pin, forwarded to buildContext),
 *   contextTurns?, contextSince?, contextMaxTokens?, mcp?, mcpConfig?, noMcp?,
 *   excludeMcp?, noValidateModel?, gatewayMode? (#61 Task 7.3: --gateway merged
 *   with routing.prefer, applied per leg), json?, client?, quiet? (suppress
 *   stdout — tests), councilRunId? / councilName? (v4.3 §7.2: stamped onto legs),
 *   fallback? / catalog? (v4.3 Task 18 §6.2: opt-in substitution; off/absent unchanged),
 *   retryContexts? / retryOfWaveId? (v4.3 Task 19: --retry-failed relaunch seam; absent -> byte-identical),
 *   pack? (v4.5 Task 13: {name,version,hash,source} record when launched via
 *     --pack; absent/null -> omitted from wave metadata.json/wave.json, not stored as null.
 *     v4.5 final-review F2: when absent, wave.json still inherits a pack the caller
 *     pre-seeded onto this wave dir's metadata.json before calling runFanout — see
 *     `metaPack` below. That is how an MCP-spawned child, which never receives
 *     --pack itself, still ends up with the pack on its wave.json),
 *   server? + serverClient? (v4.4.1 Task 0.5: an ALREADY-STARTED OpenCode server
 *     to run this wave's legs on. Both or neither. When supplied this wave never
 *     starts a server and never closes one — see the seam comment in step 4.
 *     NOT `client`, which is the client TYPE string on this function.)
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
  const { installWaveAbort } = require('./fanout-signals');
  const { getSessionDir } = require('../session-manager');
  const { emitWaveStarted } = require('../observe/events'); // wave-terminal is emitted by finishWave

  const project = options.project || process.cwd();
  const createdAt = new Date().toISOString();
  // v4.3 Task 13: live stderr mirror of this wave's own events, in-process
  // (no tail). Off by default; every emit* call below threads it through.
  const follow = options.follow ? require('../observe/follow').createFollowPrinter({ json: options.json }) : null;
  const emit = (doc) => {
    if (options.quiet || options.retryOfWaveId) { return; } // v4.3 T19 FW1#3: retry launches print via fanout-retry.js instead
    if (options.json) {
      console.log(JSON.stringify(doc, null, 2));
    } else {
      const { formatWaveHuman } = require('./fanout-output');
      console.log(formatWaveHuman(doc));
    }
  };
  // v4.4.1 Task 0.5: a wave that dies BEFORE its legs still owes the run a
  // wave.json. Backlog C1 covered the pre-`try` throw; a server that never
  // started was its uncovered sibling — run v441plan01's four dead seats left a
  // `reason` in metadata.json, no wave.json, and stage1 recorded 'complete'.
  // waveDir is optional (only the post-creation caller has one).
  const errorWave = (waveId, message, waveDir) => {
    // v4.7 F8 (D13, T3 review): tag: options.tag || metaTag, TDZ-safe (sole call site runs after `const metaTag` below).
    // v4.7 PR3 rider: pack got the same `|| metaPack` inherit the other two
    // buildWaveResult sites have — it was the lone holdout, so an MCP-spawned
    // wave whose server died dropped its pre-seeded pack while keeping its tag.
    const doc = buildWaveResult({ waveId: waveId || null, legs: [], promptMeta: options.promptMeta || null, pack: options.pack || metaPack, tag: options.tag || metaTag, createdAt, completedAt: new Date().toISOString(), status: 'error' });
    doc.error = message;
    doc.reason = message; // classifier alias, same as fanout-leg.js's run docs
    // best-effort: an unwritable wave dir must not mask the real error
    if (waveDir) { try { writeWaveDoc(waveDir, doc); } catch { /* ignore */ } }
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
    fallback: options.fallback, // v4.3 Task 18 §6.2: serverModels union only when enabled
    catalog: options.catalog,
  });
  if (validated.error) { return failPre(validated.code || 'BAD_ARGS', validated.error); }
  const legs = validated.legs;
  stampLegAttribution(legs, options);
  const okLegs = legs.filter(l => l.ok);
  // FIX 2 (#61 whole-branch review): a leg's migration notice has no CLI
  // stderr to land on — surface it on the wave doc instead, deduped in case
  // two legs for the same vendor happen to both migrate.
  const notices = [...new Set(legs.map(l => l.notice).filter(Boolean))];

  // 1b. Budget gate (pre-creation; refuse before spending). Only legs that
  // will actually run cost anything — a leg that never routed never spends.
  // Lives in ./fanout-budget so the v4.4 concurrency reservation seam has room;
  // that module's docblock carries the why.
  const preflight = require('./fanout-budget').preflightBudget(okLegs, options);
  if (!preflight.ok) { return failPre(ERROR_CODES.BUDGET_EXCEEDED, preflight.message, preflight.hint); }

  // 2. Wave record
  const waveId = options.waveId || generateTaskId();
  const legIds = deriveLegIds(waveId, legs.length);
  const waveDir = getSessionDir(project, waveId);
  fs.mkdirSync(waveDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(waveDir, 'briefing.md'), options.prompt, { mode: 0o600 });
  const waveMeta = writeWaveMetadata(waveDir, {
    taskId: waveId, type: 'wave', status: 'running', mode: 'headless',
    models: legs.map(l => (l.ok ? l.model : l.modelInput)), legs: legIds,
    briefing: String(options.prompt).slice(0, 200),
    promptMeta: options.promptMeta || null,
    ...(options.pack ? { pack: options.pack } : {}), // v4.5 Task 13: absent-not-null.
    ...(options.tag ? { tag: options.tag } : {}), // v4.7 F8 (D13): absent-not-null, same idiom as pack above.
    pid: process.pid, project, createdAt,
  });
  // v4.5 final-review F2: an MCP-spawned child never gets --pack (single-
  // resolution rule), but mcp-server.js pre-seeds THIS wave dir's
  // metadata.json with the pack it already resolved in-process before
  // spawning the child. writeWaveMetadata read-merges (fanout-wave-io.js),
  // so its RETURN VALUE already carries that pre-seeded pack when
  // options.pack is absent here — inherit from it below rather than
  // re-reading the file (mirrors the inherit idiom in
  // result-schema-rebuild.js:93, which reads meta.pack off a metadata.json
  // it loaded for an unrelated reason).
  const metaPack = waveMeta.pack;
  const metaTag = waveMeta.tag; // v4.7 F8 (D13): same pre-seed inherit mechanism as metaPack above.
  emitWaveStarted(waveDir, waveId, legs.map(l => (l.ok ? l.model : l.modelInput)), legIds, follow);

  // 2b. All legs failed to route (#61 perf): no leg will ever touch the
  // shared server, so starting one (and tearing it down) is pure waste.
  // Short-circuit to the same routing-failure wave the normal path would
  // eventually produce — same per-leg docs, aggregation, and exit mapping.
  if (okLegs.length === 0) {
    const legDocs = legs.map((leg, i) => buildRoutingFailureLeg({ leg, legId: legIds[i], waveId, quiet: options.quiet }));
    const completedAt = new Date().toISOString();
    const wave = buildWaveResult({
      waveId, legs: legDocs, promptMeta: options.promptMeta || null, pack: options.pack || metaPack, tag: options.tag || metaTag, createdAt, completedAt, notices,
    });
    return finishWave({ wave, waveDir, waveId, project, completedAt, follow, emit,
      exitCode: waveExitCode(wave.status),
      onComplete: options.onComplete, onCompleteDeps: options.onCompleteDeps });
  }

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
  // ⚠️ v4.4.1 Task 0.5 — the external-server seam runHeadless has carried since
  // v4.0 (src/headless.js:245): a caller that already owns a server passes it in
  // and we must NOT close it. Added here because a council run launches its
  // Stage-1 seat wave and its critic solo under ONE Promise.all (run-stages.js:83)
  // and two concurrent startOpenCodeServer calls race on OpenCode's SQLite —
  // run v441plan01 lost four of five seats in 736ms to `database is locked`.
  // NAME DIVERGENCE, deliberate: runHeadless spells the pair client+server, but
  // runFanout's `options.client` is ALREADY the client TYPE string (buildMcpConfig
  // above, buildContext, buildPrompts, cli-handlers-run.js `client: args.client`),
  // so the SDK client is `options.serverClient`. Both or neither: a half-injection
  // falls back to owning a server rather than running clientless.
  const externalServer = !!(options.server && options.serverClient);
  let client, server;
  if (externalServer) {
    ({ serverClient: client, server } = options);
    logger.debug('Using external server (shared server mode)', { waveId, url: server.url });
  } else {
    try {
      ({ client, server } = await startOpenCodeServer(mcpServers, { models: validated.serverModels || okLegs.map(l => l.model) }));
    } catch (err) {
      writeWaveMetadata(waveDir, { status: 'error', reason: err.message, completedAt: new Date().toISOString() });
      return errorWave(waveId, `Failed to start server: ${err.message}`, waveDir);
    }
  }
  // Only an OWNED server's pid belongs in this wave's metadata: mcp-server.js's
  // wave abort SIGTERMs `metadata.goPid` as "the orchestrator + its OWNED
  // OpenCode server", which on an injected server would kill every sibling wave.
  if (!externalServer && server.goPid) { writeWaveMetadata(waveDir, { goPid: server.goPid }); }

  // 5. Signal abort (./fanout-signals owns the handler — size gate): mark wave +
  // all legs aborted, close an OWNED server, then let NORMAL control flow
  // finalize, so step 7 still writes wave.json and emits a parseable aborted
  // document. An unref'd force-exit watchdog backstops a wedged leg.
  const legDirs = legIds.map(id => getSessionDir(project, id));
  const waveAbort = installWaveAbort({ waveId, waveDir, legDirs, server, externalServer });

  // 6. Launch all ROUTABLE legs concurrently (runLeg never rejects). A leg that
  // failed to route (leg.ok === false) resolves to an error run doc in its own
  // slot (buildRoutingFailureLeg), failing only itself, never the wave (#61).
  const heartbeat = (options.quiet || options.follow)
    ? { stop() {} }
    : createWaveHeartbeat(
        legs.map((leg, i) => ({ label: leg.modelInput || leg.model, dir: legDirs[i] })),
        HEARTBEAT_INTERVAL
      );
  const timeoutMs = (options.timeout || 15) * 60 * 1000;
  const reasoning = options.thinking ? { effort: options.thinking } : undefined;
  let legDocs;
  try {
    // retryContexts/retryOfWaveId (v4.3 Task 19): absent on a normal wave, so
    // every leg below falls back to the wave-wide prompt — byte-identical.
    legDocs = await Promise.all(legs.map((leg, i) => {
      if (!leg.ok) { return Promise.resolve(buildRoutingFailureLeg({ leg, legId: legIds[i], waveId, quiet: options.quiet })); }
      const rc = options.retryContexts && options.retryContexts[i];
      const saved = rc && rc.hadSavedContext;
      return runLeg({
        leg: options.retryOfWaveId ? { ...leg, retryOfWaveId: options.retryOfWaveId } : leg,
        legId: legIds[i], waveId, project,
        systemPrompt: saved ? rc.systemPrompt : systemPrompt,
        userMessage: saved ? rc.userMessage : userMessage,
        timeoutMs, agent: options.agent, client, server,
        summaryLength: options.summaryLength, reasoning, quiet: options.quiet,
        foldNonce, directory: options.directory, follow,
        fallback: options.fallback, catalog: options.catalog, noOutputBackstopMs: options.noOutputBackstopMs,
      });
    }));
  } finally {
    heartbeat.stop();
    waveAbort.uninstall();
    // ⚠️ close site 2 of 2 (`grep -n "server.close()" src/sidecar/fanout.js`).
    // An injected server outlives this wave by design — the owner closes it once.
    if (!externalServer) { try { await server.close(); } catch { /* already closed on signal */ } }
  }

  // 7. Aggregate, persist (atomic: tmp + rename), finalize, emit
  const completedAt = new Date().toISOString();
  const signalled = waveAbort.signal();
  const wave = buildWaveResult({
    waveId, legs: legDocs, promptMeta: options.promptMeta || null, pack: options.pack || metaPack, tag: options.tag || metaTag, createdAt, completedAt,
    status: signalled ? 'aborted' : null, notices,
  });
  const exitCode = signalled
    ? (signalled === 'SIGINT' ? 130 : 143)
    : waveExitCode(wave.status);
  return finishWave({ wave, waveDir, waveId, project, exitCode, completedAt, follow, emit,
    onComplete: options.onComplete, onCompleteDeps: options.onCompleteDeps });
}

module.exports = {
  parseModelsList, deriveLegIds, validateFanoutModels, DEFAULT_MAX_LEGS,
  runFanout, writeWaveMetadata,
};

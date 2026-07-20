/**
 * Headless Mode Runner
 *
 * Spec Reference: §6.2 Headless Mode, §9 Implementation
 * Uses OpenCode SDK for headless execution (no CLI spawning required).
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('./utils/logger');
const { ensureNodeModulesBinInPath } = require('./utils/path-setup');
const { ensurePortAvailable } = require('./utils/server-setup');
const { mapAgentToOpenCode } = require('./utils/agent-mapping');
const { writeProgress } = require('./sidecar/progress');
const { writeFileAtomic } = require('./utils/atomic-write');
const { createMirrorState, mirrorMessages, logMessage, getPendingToolCalls } = require('./sidecar/conversation-mirror');
const { buildFoldMarker, trailingFoldMarkerRegex, generateFoldNonce } = require('./utils/fold-marker');

/**
 * Fold marker that the agent outputs when done.
 * Spec Reference: §6.2
 *
 * #BL-7 residual (15b.3): the bare `[SIDECAR_FOLD]` string is now a LEGACY
 * literal only, kept exported for external consumers with no nonce context
 * (see extractSummary/formatFoldOutput's no-nonce fallback paths below).
 * NOTE for anyone `.toContain('[SIDECAR_FOLD]')`-checking real run output:
 * that substring check does NOT match the real nonced marker — a nonced
 * marker is `[SIDECAR_FOLD:<nonce>]`, which lacks the literal closing
 * bracket immediately after FOLD that `[SIDECAR_FOLD]` requires. Real runs
 * always call buildFoldMarker(nonce), never this bare constant.
 */
const FOLD_MARKER = '[SIDECAR_FOLD]';
const COMPLETE_MARKER = FOLD_MARKER; // backward compat

/**
 * #BL-7: the fold marker used to be the fixed public string [SIDECAR_FOLD]. A
 * model can legitimately emit that bare string on its own line mid-output —
 * summarizing a prior sidecar, reproducing these instructions, or from
 * scraped content — which forced a PREMATURE fold even after pinning the
 * marker to the final non-empty line (the marker being fixed and public means
 * ANY echo of it, if it happened to land last, still completed the run).
 *
 * 15b.3 closes the residual gap: every run now carries a per-run random
 * nonce, and the model is instructed to emit `[SIDECAR_FOLD:<nonce>]` — a
 * string the model can only produce by actually finishing (it isn't public,
 * isn't in training data, and isn't guessable). A bare `[SIDECAR_FOLD]` or a
 * marker carrying a DIFFERENT run's nonce no longer completes.
 *
 * @param {string} output - Accumulated assistant output
 * @param {string} nonce - This run's fold nonce (required — see runHeadless)
 * @returns {number} char index where the trailing marker line begins, or -1
 */
function findTrailingFoldMarker(output, nonce) {
  if (!output || !nonce) { return -1; }
  // The marker must be the last non-empty line: it sits alone on its line
  // (only intra-line whitespace around it) and NOTHING but whitespace follows
  // to the end of the string. The `(?![\s\S]*\S)` lookahead pins it to the true
  // end — a marker followed by more prose is echoed content, not a signal.
  const m = trailingFoldMarkerRegex(nonce).exec(output);
  return m ? m.index : -1;
}

/**
 * Default timeout: 15 minutes per spec §6.2
 */
const DEFAULT_TIMEOUT = 15 * 60 * 1000;

/** Poll cadence + completion thresholds (env-overridable; injectable via options for tests). */
const POLL_INTERVAL_MS = Number(process.env.AMICUS_POLL_INTERVAL_MS) || 2000;
const STABLE_FINISHED_POLLS = Number(process.env.AMICUS_STABLE_FINISHED_POLLS) || 2;   // when time.completed is set
const STABLE_IDLE_POLLS = Number(process.env.AMICUS_STABLE_IDLE_POLLS) || 30;          // ~60s at 2s — no completion signal
const POLL_CALL_TIMEOUT_MS = Number(process.env.AMICUS_POLL_CALL_TIMEOUT_MS) || 30000; // per getMessages call (used by a later task)
const MAX_CONSECUTIVE_POLL_FAILURES = Number(process.env.AMICUS_MAX_CONSECUTIVE_POLL_FAILURES) || 15; // ≈30s at 2s polls
const TOOL_CALL_STALL_MS = Number(process.env.AMICUS_TOOL_CALL_STALL_MS) || 180000; // B53: wedged tool call w/ no progress

/**
 * Race a promise against a timeout. Returns the promise's result, or rejects with
 * a timeout error after `ms`. A non-positive `ms` means "no extra timer" (return as-is).
 */
function withTimeout(promise, ms, label) {
  if (!(ms > 0)) { return promise; }
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      if (t.unref) { t.unref(); }
    }),
  ]);
}

/**
 * Wait for the OpenCode server to be ready using SDK health check
 */
async function waitForServer(client, checkHealthFn, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const isHealthy = await checkHealthFn(client);
      if (isHealthy) {
        return true;
      }
    } catch (e) {
      // Server not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

/**
 * Run a headless sidecar session
 * Spec Reference: §6.2, §9.1 runHeadless function
 *
 * @param {string} model - Model to use (e.g., 'openrouter/google/gemini-2.5-flash')
 * @param {string} systemPrompt - The system prompt for the agent (instruction-level context)
 * @param {string} userMessage - The user message (task briefing)
 * @param {string} taskId - Unique task identifier
 * @param {string} project - Project directory path
 * @param {number} [timeoutMs=DEFAULT_TIMEOUT] - Timeout in milliseconds
 * @param {string} [agent] - Agent mode: build (default), plan, explore, general
 * @param {object} [options] - Additional options
 * @param {object} [options.mcp] - MCP server configurations
 * @param {string} [options.summaryLength='normal'] - Desired summary length
 * @param {object} [options.reasoning] - Reasoning/thinking configuration
 * @param {string} [options.reasoning.effort] - Effort level: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'none'
 * @param {string} [options.nonce] - Per-run fold nonce (15b.3, #BL-7 residual). The
 *   PROMPT the caller built (prompt-builder.js buildPrompts) must have instructed the
 *   model with this SAME nonce — runHeadless only DETECTS, it never re-derives one from
 *   the prompt text, so caller and detector agreeing on the nonce is the caller's
 *   responsibility. Falls back to a freshly generated nonce if omitted (keeps this
 *   function usable standalone / in tests that don't care about the fold-nonce
 *   property) — but a fallback nonce the prompt never advertised means the model can
 *   never legitimately produce it, so such a run can only ever complete via one of the
 *   non-fold-marker paths (idle/timeout/etc.), never a premature bare-marker fold.
 * @returns {Promise<object>} Result object with summary, completed, timedOut flags
 */
async function runHeadless(model, systemPrompt, userMessage, taskId, project, timeoutMs = DEFAULT_TIMEOUT, agent, options = {}) {
  const {
    createSession,
    sendPromptAsync,
    getMessages,
    checkHealth,
    startServer,
    getSessionStatus
  } = require('./opencode-client');

  const { reasoning } = options;
  // 15b.3: never fall back to bare-marker detection — an omitted nonce still
  // gets ONE generated here so findTrailingFoldMarker always has something to
  // match, but since the prompt (built by the caller) never advertised THIS
  // fallback value, the model cannot legitimately produce it. No silent
  // bare-`[SIDECAR_FOLD]` acceptance path exists anywhere below.
  const foldNonce = options.nonce || generateFoldNonce();
  const { getSessionDir } = require('./session-manager');
  const sessionDir = getSessionDir(project, taskId);
  const conversationPath = path.join(sessionDir, 'conversation.jsonl');

  // #47: scope every per-session SDK call to the project directory so a SHARED
  // OpenCode server (one server, many projects) files and finds this session
  // under the right ?directory=. `dirArgs` is the trailing arg list for the
  // positional client wrappers (createSession/getMessages/getSessionStatus/
  // abortSession) and is EMPTY when no directory is supplied — so the un-scoped
  // (owned-server) call shape stays byte-for-byte identical. A scoped create
  // with un-scoped follow-ups reproduces the identical "session not found"
  // failure, so ALL of them must carry it.
  const { directory } = options;
  const dirArgs = directory === undefined ? [] : [directory];

  // Ensure session directory exists
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
  }

  // Log system prompt as first message in conversation
  logMessage(conversationPath, {
    role: 'system',
    content: systemPrompt,
    timestamp: new Date().toISOString()
  });

  // Write initial progress
  writeProgress(sessionDir, 'initializing');

  // Ensure node_modules/.bin is in PATH so SDK can find opencode wrapper
  ensureNodeModulesBinInPath();

  // Use specified port, or 0 to let the OS auto-assign (enables parallel sessions)
  const port = options.port || 0;
  if (port > 0) {
    ensurePortAvailable(port);
  }

  // Detect shared-server mode: caller provides client + server directly
  const externalServer = !!(options.client && options.server);
  let client, server;

  if (externalServer) {
    client = options.client;
    server = options.server;
    logger.debug('Using external server (shared server mode)', { url: server.url });
  } else {
    // Start OpenCode server using SDK (no CLI spawning required)
    logger.debug('Starting OpenCode server via SDK', { model, hasMcp: !!options.mcp, port });
    try {
      // Pass MCP config and port to server
      const serverOptions = { port };
      if (options.mcp) {
        serverOptions.mcp = options.mcp;
      }
      const result = await startServer(serverOptions);
      client = result.client;
      server = result.server;
      logger.debug('Server started', { url: server.url });
    } catch (error) {
      logger.error('Failed to start OpenCode server', { error: error.message });
      return {
        summary: '',
        completed: false,
        timedOut: false,
        taskId,
        error: `Failed to start server: ${error.message}`
      };
    }
  }

  let sessionId;
  const { IdleWatchdog } = require('./utils/idle-watchdog');
  let watchdog;
  let uninstallSignals;

  try {
    if (!externalServer) {
      // Wait for server to be ready
      logger.debug('Waiting for OpenCode server to be ready');
      const serverReady = await waitForServer(client, checkHealth);
      logger.debug('Server ready', { serverReady });
      writeProgress(sessionDir, 'server_ready');

      if (!serverReady) {
        await server.close();
        return {
          summary: '',
          completed: false,
          timedOut: false,
          taskId,
          error: 'OpenCode server failed to start'
        };
      }
    } else {
      writeProgress(sessionDir, 'server_ready');
    }

    // Start idle watchdog to enforce the headless timeout
    if (options.watchdog) {
      watchdog = options.watchdog;
    } else {
      watchdog = new IdleWatchdog({
        mode: 'headless',
        onTimeout: () => {
          logger.info('Headless idle timeout - shutting down', { taskId });
          const { idleBackstopTeardown } = require('./utils/session-abort');
          process.exit(idleBackstopTeardown(sessionDir, server, externalServer));
        },
      }).start();
    }

    // Create a new session using SDK
    logger.debug('Creating OpenCode session');
    if (options.sessionId) {
      sessionId = options.sessionId;
      logger.debug('Using existing session', { sessionId });
    } else {
      try {
        sessionId = await createSession(client, ...dirArgs);
      } catch (error) {
        if (watchdog) { watchdog.cancel(); }
        if (!externalServer) { await server.close(); }
        return {
          summary: '',
          completed: false,
          timedOut: false,
          taskId,
          error: error.message
        };
      }
    }
    logger.debug('Session ID', { sessionId });
    writeProgress(sessionDir, 'session_created');

    // F3 #20: abort this session if the parent process is signalled. Record the
    // Go server PID so `amicus list` liveness checks can see it. Only for the
    // owned (non-shared) server — shared servers are torn down by their owner.
    if (!externalServer) {
      if (server && server.goPid) {
        try {
          const metaPath = path.join(sessionDir, 'metadata.json');
          const m = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          m.goPid = server.goPid;
          writeFileAtomic(metaPath, JSON.stringify(m, null, 2), { mode: 0o600 });
        } catch { /* metadata optional */ }
      }
      const { installSignalAbort, markAborted } = require('./utils/session-abort');
      let aborting = false;
      uninstallSignals = installSignalAbort({
        onAbort: (signal) => {
          if (aborting) { return; }
          aborting = true;
          logger.warn('Signal received — aborting headless session', { taskId, signal });
          markAborted(sessionDir, signal);
          try {
            const { abortSession } = require('./opencode-client');
            abortSession(client, sessionId, ...dirArgs).catch(() => {});
          } catch { /* best-effort */ }
          // close() is now async (B06 escalation) — this handler stays sync
          // (do not restructure signal handlers), so fire-and-forget with a
          // rejection guard. The REF'd escalation poll inside close() still
          // does its work; the pre-existing 300ms exit timer below may cut
          // that grace short — see task 15b.1 report for that known gap.
          try { server.close().catch(() => {}); } catch { /* best-effort */ }
          const { resolveTerminalState } = require('./sidecar/session-finalize');
          const code = resolveTerminalState({ aborted: true }, signal).exitCode;
          const t = setTimeout(() => process.exit(code), 300);
          if (t.unref) { t.unref(); }
        },
      });
    }

    // Log user message to conversation before sending
    logMessage(conversationPath, {
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString()
    });

    // Send system prompt and user message using SDK
    logger.debug('Sending message to OpenCode', {
      sessionId,
      systemLength: systemPrompt.length,
      userMessageLength: userMessage.length
    });

    const promptOptions = {
      model: model,
      system: systemPrompt,
      parts: [{ type: 'text', text: userMessage }]
    };
    // #47: scope the prompt to the project on a shared server. Only set when a
    // directory was supplied so the owned-server options object is unchanged.
    if (directory !== undefined) { promptOptions.directory = directory; }

    // Default to 'build' in headless mode — 'chat' stalls without user interaction
    const agentConfig = mapAgentToOpenCode(agent || 'build');
    promptOptions.agent = agentConfig.agent;

    // Add reasoning/thinking configuration if provided
    if (reasoning) {
      promptOptions.reasoning = reasoning;
    }

    // Send prompt asynchronously (returns immediately, we poll for results)
    logger.info('Sending prompt to OpenCode', {
      sessionId,
      model,
      agent: promptOptions.agent,
      userMessageLength: userMessage.length
    });
    const promptResult = await sendPromptAsync(client, sessionId, promptOptions);
    writeProgress(sessionDir, 'prompt_sent');
    logger.info('Prompt sent successfully, entering polling loop', {
      sessionId,
      timeoutMs
    });

    const mirror = createMirrorState();
    let completed = false;
    let timedOut = false;
    let aborted = false;
    let sessionError = null; // Captures model/SDK errors from assistant messages

    // Hard provider failure detected at the client boundary (#37): a non-2xx /
    // 402 from promptAsync surfaces here even when the server never emits an
    // assistant message carrying info.error. Seed sessionError so the loop's
    // "error with no output" gate ends the run promptly with a usable reason.
    const boundaryProviderError = !!(promptResult && promptResult.providerError);
    if (boundaryProviderError) {
      sessionError = promptResult.providerError;
      logger.error('Provider error at client boundary', { taskId, sessionId, reason: sessionError });
    }

    // Poll for completion by checking messages
    const startTime = Date.now();
    const deadline = startTime + timeoutMs;
    let pollCount = 0;
    const pollIntervalMs = options.pollIntervalMs || POLL_INTERVAL_MS;
    const stableFinishedPolls = options.stableFinishedPolls || STABLE_FINISHED_POLLS;
    const stableIdlePolls = options.stableIdlePolls || STABLE_IDLE_POLLS;
    const pollCallTimeoutMs = options.pollCallTimeoutMs || POLL_CALL_TIMEOUT_MS;
    const maxConsecutivePollFailures = options.maxConsecutivePollFailures || MAX_CONSECUTIVE_POLL_FAILURES;
    const toolCallStallMs = options.toolCallStallMs || TOOL_CALL_STALL_MS;
    let consecutivePollFailures = 0;
    let pollFailureBail = false;
    let lastAssistantMsgId = null;
    let lastOutputLength = 0; // Track output growth to detect streaming
    let stablePolls = 0; // Count polls where nothing has changed
    let lastToolCallCount = 0;
    let lastToolResultCount = 0;
    let lastMessageCount = 0;
    let lastReasoningLength = 0; // B53: track reasoning-output growth to detect thinking
    let lastProgressAt = Date.now(); // B53: last poll where `progressed` was true
    let toolStalled = false; // B53: distinct from completed/timedOut/aborted — see resolveTerminalState

    while (!completed && (Date.now() - startTime) < timeoutMs) {
      watchdog.touch();
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));

      // Check for external abort signal (MCP tool or CLI command)
      try {
        const metaCheck = path.join(sessionDir, 'metadata.json');
        if (fs.existsSync(metaCheck)) {
          const metaContent = fs.readFileSync(metaCheck, 'utf-8');
          const meta = JSON.parse(metaContent);
          if (meta.status === 'aborted') {
            logger.info('External abort signal received', { taskId });
            try {
              const { abortSession } = require('./opencode-client');
              await abortSession(client, sessionId, ...dirArgs);
            } catch (abortErr) {
              logger.warn('Failed to abort OpenCode session', { error: abortErr.message });
            }
            aborted = true;
            break;
          }
        }
      } catch {
        // Ignore metadata read errors during polling
      }
      pollCount++;

      try {
        const remaining = deadline - Date.now();
        const messages = await withTimeout(
          getMessages(client, sessionId, ...dirArgs),
          Math.min(pollCallTimeoutMs, remaining),
          'getMessages'
        );
        consecutivePollFailures = 0;
        const messageCount = messages?.length || 0;

        const mr = mirrorMessages(messages, mirror);
        mr.appendLines.forEach(line => logMessage(conversationPath, line));
        mr.progressUpdates.forEach(p => writeProgress(sessionDir, p.stage, p.extra));
        const currentAssistantMsgId = mr.currentAssistantMsgId;
        const assistantFinished = mr.assistantFinished;
        if (mr.sessionError) {
          sessionError = mr.sessionError;
          logger.error('Session error detected in assistant message', { sessionId, message: mr.sessionError });
        }

        logger.debug('Poll status', {
          pollCount,
          messageCount,
          assistantFinished,
          outputLength: mirror.output.length,
          elapsed: Date.now() - startTime
        });

        // Check for the completion marker as the FINAL non-empty line, carrying
        // THIS run's nonce (#BL-7 + 15b.3). Models may emit a bare or wrong-nonce
        // marker on its own line mid-output (echoing a prior sidecar, these
        // instructions, or scraped content) — only the exact nonced marker,
        // with nothing but blank lines after it, is a completion signal.
        if (findTrailingFoldMarker(mirror.output, foldNonce) !== -1) {
          completed = true;
          break;
        }

        // Hard provider failure at the client boundary (#37): the request was
        // rejected (e.g., 402) so no assistant message will ever arrive. Exit as
        // soon as we confirm nothing streamed — don't wait for assistantFinished
        // (which never flips here) or the full timeout.
        if (boundaryProviderError && !mirror.output) {
          logger.error('Provider error at boundary with no output, exiting', {
            sessionError, pollCount
          });
          break;
        }

        // If the model returned an error with no output, exit immediately
        // (don't wait for timeout — the model won't produce anything)
        if (sessionError && !mirror.output && assistantFinished) {
          logger.error('Model returned error with no output, exiting', {
            sessionError, pollCount
          });
          break;
        }

        // Authoritative idle signal from the OpenCode SDK (preferred over the heuristic).
        // Gate on real output so a pre-processing 'idle' cannot end the run early.
        // Best-effort: on any error, fall back to the activity heuristic below.
        if (mirror.output.length > 0) {
          try {
            const remainingForStatus = deadline - Date.now();
            const statusData = await withTimeout(
              getSessionStatus(client, sessionId, ...dirArgs),
              Math.min(pollCallTimeoutMs, remainingForStatus),
              'getSessionStatus'
            );
            const s = (statusData && statusData.type) ? statusData : (statusData && statusData[sessionId]);
            if (s && s.type === 'idle') {
              logger.debug('Session reported idle by SDK — completing', { sessionId });
              completed = true;
              break;
            }
          } catch (statusErr) {
            logger.debug('session.status unavailable; using activity heuristic', { error: statusErr.message });
          }
        }

        // Activity-aware idle detection: ANY of text growth, a new tool call, a new
        // tool result, a new message, a new assistant message id, or reasoning-output
        // growth counts as progress. Only count toward completion when NOTHING changed
        // (genuine idle).
        const outputGrew = mirror.output.length > lastOutputLength;
        lastOutputLength = mirror.output.length;
        const toolActivity = mirror.toolCalls.length > lastToolCallCount;
        lastToolCallCount = mirror.toolCalls.length;
        const resultActivity = mirror.seenToolResultIds.size > lastToolResultCount;
        lastToolResultCount = mirror.seenToolResultIds.size;
        const messageActivity = messageCount > lastMessageCount;
        lastMessageCount = messageCount;
        const newAssistant = currentAssistantMsgId !== lastAssistantMsgId;
        // B53: an interleaved-thinking model with a pending tool call can stream ONLY
        // reasoning deltas for minutes with no text/tool/result/message growth — mirror
        // the F6d treatment in conversation-mirror.js (reasoning growth = activity) so
        // the stall clock resets instead of falsely firing "Tool call stalled".
        const reasoningActivity = mirror.reasoningOutput.length > lastReasoningLength;
        lastReasoningLength = mirror.reasoningOutput.length;

        const progressed = outputGrew || toolActivity || resultActivity || messageActivity
          || newAssistant || reasoningActivity;
        if (progressed) { lastProgressAt = Date.now(); }

        // B53: a wedged tool call (tool_use emitted, result never arrives) otherwise
        // burns the full --timeout with zero output — the stable-poll idle gate above
        // requires mirror.output.length > 0, which a pre-text wedge never satisfies.
        // Fire ONLY when a tool call is genuinely pending AND no progress of any kind
        // (text/tool/result/message/new-assistant) has been observed for the stall
        // window — this cannot false-positive during active streaming (progress
        // resets the clock every poll) and cannot fire without a wedged tool.
        const pendingToolCalls = getPendingToolCalls(mirror);
        if (pendingToolCalls.length > 0 && (Date.now() - lastProgressAt) > toolCallStallMs) {
          const stalled = pendingToolCalls[0];
          const pendingSeconds = Math.round((Date.now() - Date.parse(stalled.firstSeenAt)) / 1000);
          sessionError = `Tool call stalled: ${stalled.name} pending ${pendingSeconds}s with no result or output`;
          logger.error('Tool call stalled — no progress within threshold', {
            taskId, toolName: stalled.name, toolId: stalled.id, pendingSeconds, toolCallStallMs
          });
          toolStalled = true;
          try {
            const { abortSession } = require('./opencode-client');
            await abortSession(client, sessionId, ...dirArgs);
            logger.info('Session aborted after tool-call stall', { taskId, sessionId });
          } catch (abortErr) {
            logger.warn('Failed to abort session after tool-call stall', { error: abortErr.message });
          }
          break;
        }

        if (!progressed) {
          // Require real output before counting toward completion — the SDK creates an
          // empty assistant-message placeholder on promptAsync that is NOT a finished response.
          if (currentAssistantMsgId !== null && mirror.output.length > 0) {
            stablePolls++;
            const threshold = assistantFinished ? stableFinishedPolls : stableIdlePolls;
            if (stablePolls >= threshold) {
              logger.debug('Session appears complete (idle)', { stablePolls, assistantFinished });
              completed = true;
              break;
            }
          } else {
            logger.debug('Waiting for model to produce output', {
              pollCount, hasAssistantMsg: currentAssistantMsgId !== null, outputLength: mirror.output.length
            });
          }
        } else {
          stablePolls = 0;
        }
        lastAssistantMsgId = currentAssistantMsgId;

      } catch (pollError) {
        consecutivePollFailures++;
        logger.debug('Polling error', {
          error: pollError.message, consecutivePollFailures
        });
        if (consecutivePollFailures >= maxConsecutivePollFailures) {
          // F4: a dead server otherwise burns the full timeout in futile polls.
          sessionError = sessionError
            || `Polling failed ${consecutivePollFailures} consecutive times: ${pollError.message}`;
          logger.error('Exiting poll loop after consecutive failures', {
            consecutivePollFailures, taskId
          });
          pollFailureBail = true;
          break;
        }
      }
    }

    // Log why the polling loop exited
    const logLevel = (completed && !sessionError) ? 'info' : 'error';
    logger[logLevel]('Polling loop exited', {
      taskId,
      completed,
      aborted,
      pollCount,
      stablePolls,
      outputLength: mirror.output.length,
      elapsed: Date.now() - startTime,
      hasAssistantMsg: lastAssistantMsgId !== null,
      sessionError: sessionError || null
    });

    // Handle timeout
    if (!completed && !aborted && (Date.now() - startTime) >= timeoutMs) {
      timedOut = true;
      logger.warn('Task timed out', { taskId, elapsed: Date.now() - startTime });

      // Abort the OpenCode session on timeout (agent keeps running otherwise)
      try {
        const { abortSession } = require('./opencode-client');
        await abortSession(client, sessionId, ...dirArgs);
        logger.info('Session aborted after timeout', { taskId, sessionId });
      } catch (abortErr) {
        logger.warn('Failed to abort session after timeout', { error: abortErr.message });
      }
    }

    watchdog.cancel();
    if (uninstallSignals) { uninstallSignals(); }
    if (!externalServer) { await server.close(); }

    // Log summary of tool calls for debugging
    if (mirror.toolCalls.length > 0) {
      logger.info('Tool calls summary', {
        totalToolCalls: mirror.toolCalls.length,
        taskToolCalls: mirror.toolCalls.filter(t => t.name === 'Task').length,
        subagentTypes: mirror.toolCalls
          .filter(t => t.name === 'Task' && t.input?.subagent_type)
          .map(t => ({ type: t.input.subagent_type, model: t.input.model || 'inherited' }))
      });
    }

    // Propagate the error when the model errored with no output (F1 semantics:
    // a model error alongside streamed output still yields a usable summary),
    // and ALWAYS when the poll loop bailed on consecutive failures (F4: a dead
    // server must never classify as a complete leg, even with partial output)
    // or on a tool-call stall (B53: same — a wedged tool must never classify
    // as complete, even if some text streamed alongside it before the wedge).
    const { sumPerMessageUsage } = require('./utils/pricing');
    const usage = sumPerMessageUsage(mirror.usageByMsg);

    if (sessionError && (!mirror.output || pollFailureBail || toolStalled)) {
      return {
        summary: mirror.output ? extractSummary(mirror.output, foldNonce) : '',
        completed: false,
        timedOut,
        aborted,
        taskId,
        toolCalls: mirror.toolCalls,
        usage,
        error: sessionError
      };
    }

    return {
      summary: extractSummary(mirror.output, foldNonce),
      completed,
      timedOut,
      aborted,
      taskId,
      toolCalls: mirror.toolCalls, // Include tool calls in result for verification
      usage,
      exitCode: 0
    };

  } catch (error) {
    logger.error('runHeadless caught exception', {
      taskId,
      error: error.message,
      stack: error.stack?.split('\n').slice(0, 3).join(' | ')
    });
    // Abort session on error (agent may keep running)
    if (sessionId) {
      try {
        const { abortSession } = require('./opencode-client');
        await abortSession(client, sessionId, ...dirArgs);
      } catch {
        // Ignore abort errors during error handling
      }
    }
    if (watchdog) { watchdog.cancel(); }
    if (uninstallSignals) { uninstallSignals(); }
    if (!externalServer) { await server.close(); }
    const { emptyUsageTotals } = require('./utils/pricing');
    return {
      summary: '',
      completed: false,
      timedOut: false,
      aborted: false,
      taskId,
      usage: emptyUsageTotals(),
      error: error.message
    };
  }
}

/**
 * Extract summary from output (everything before the trailing fold marker)
 * Spec Reference: §6.2 - Return summary (everything before the fold marker)
 *
 * v4.0 §9 (BL-7 done-done): `nonce` is REQUIRED for any non-empty output.
 * The pre-15b.3 no-nonce fallback (matching the legacy bare `[SIDECAR_FOLD]`
 * marker) is retired — no code path, internal or external, may complete on a
 * bare marker. Callers with no nonce have no valid marker to split on and
 * must not call this.
 *
 * @param {string} output - Raw output from OpenCode
 * @param {string} nonce - This run's fold nonce (required for non-empty output)
 * @returns {string} Extracted summary
 * @throws {TypeError} when output is non-empty and nonce is missing/empty
 */
function extractSummary(output, nonce) {
  if (!output) {
    return '';
  }
  if (!nonce) {
    throw new TypeError('extractSummary requires a per-run nonce (15b.3/v4.0 §9)');
  }

  // Split on the fold marker only when it is the FINAL non-empty line (#BL-7).
  // A marker echoed mid-output (describing code, reproducing these
  // instructions, or from scraped content) is NOT a delimiter — keep it as
  // content. Only the true trailing marker is stripped.
  const idx = findTrailingFoldMarker(output, nonce);
  if (idx !== -1) {
    return output.slice(0, idx).trim();
  }
  return output.trim();
}

/**
 * Format a structured fold output with metadata
 * @param {Object} options - Fold output options
 * @param {string} options.model - Model identifier
 * @param {string} options.sessionId - Session identifier
 * @param {string} [options.client='code-local'] - Client identifier
 * @param {string} [options.cwd] - Working directory (defaults to process.cwd())
 * @param {string} [options.mode='headless'] - Execution mode
 * @param {string} options.summary - Summary text
 * @param {string} [options.nonce] - This run's fold nonce (15b.3). When omitted,
 *   falls back to the legacy bare `[SIDECAR_FOLD]` marker for back-compat with
 *   external callers of this exported utility that predate the nonce scheme.
 * @returns {string} Formatted fold output
 */
function formatFoldOutput({ model, sessionId, client, cwd, mode, summary, nonce }) {
  return [
    nonce ? buildFoldMarker(nonce) : FOLD_MARKER,
    `Model: ${model}`,
    `Session: ${sessionId}`,
    `Client: ${client || 'code-local'}`,
    `CWD: ${cwd || process.cwd()}`,
    `Mode: ${mode || 'headless'}`,
    '---',
    summary
  ].join('\n');
}

module.exports = {
  runHeadless,
  waitForServer,
  withTimeout,
  extractSummary,
  findTrailingFoldMarker,
  formatFoldOutput,
  DEFAULT_TIMEOUT,
  FOLD_MARKER,
  COMPLETE_MARKER,
  // 15b.3: re-exported so callers that already `require('./headless')` don't
  // also need `require('./utils/fold-marker')` for the common case.
  buildFoldMarker,
  generateFoldNonce,
  POLL_INTERVAL_MS,
  STABLE_FINISHED_POLLS,
  STABLE_IDLE_POLLS,
  POLL_CALL_TIMEOUT_MS,
  MAX_CONSECUTIVE_POLL_FAILURES,
  TOOL_CALL_STALL_MS,
};

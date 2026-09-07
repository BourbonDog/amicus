/**
 * Sidecar Session Utilities - Shared functionality for session management
 * Consolidates duplicated code from start.js, resume.js, continue.js
 */

const fs = require('fs');
const path = require('path');

const { detectConflicts, formatConflictWarning } = require('../conflict');
const { logger } = require('../utils/logger');
const { fenceSidecarOutput } = require('../utils/untrusted-fence');
const { writeFileAtomic } = require('../utils/atomic-write');
// isProcessAlive/checkSessionLiveness live in utils/abort-coordinator.js
// (shared EPERM-aware liveness classification with isAlive); re-exported
// below for backward-compatible imports.
const { isAlive: isProcessAlive, checkSessionLiveness } = require('../utils/abort-coordinator');
const {
  SESSIONS_DIR,
  getSessionDir,
  resolveExistingSessionDir
} = require('../session-manager');

/** Standard heartbeat interval in milliseconds */
const HEARTBEAT_INTERVAL = 15000;

/** Session path utilities - eliminates magic strings across modules */
const SessionPaths = {
  /** Get canonical root sessions directory (amicus) — used for WRITES. */
  rootDir(project) {
    return path.join(project, '.claude', SESSIONS_DIR);
  },

  /** Get canonical session directory for a specific task — used for WRITES. */
  sessionDir(project, taskId) {
    return getSessionDir(project, taskId);
  },

  /**
   * Resolve an EXISTING session directory for READS. Use this when
   * resuming/continuing an existing session.
   */
  resolveSessionDir(project, taskId) {
    return resolveExistingSessionDir(project, taskId);
  },

  /** Get metadata.json path */
  metadataFile(sessionDir) {
    return path.join(sessionDir, 'metadata.json');
  },

  /** Get conversation.jsonl path */
  conversationFile(sessionDir) {
    return path.join(sessionDir, 'conversation.jsonl');
  },

  /** Get summary.md path */
  summaryFile(sessionDir) {
    return path.join(sessionDir, 'summary.md');
  },

  /** Get initial_context.md path */
  contextFile(sessionDir) {
    return path.join(sessionDir, 'initial_context.md');
  }
};

/** Save system prompt and user message to initial_context.md */
function saveInitialContext(sessionDir, systemPrompt, userMessage) {
  const content = `# System Prompt\n\n${systemPrompt}\n\n# User Message (Task)\n\n${userMessage}`;
  fs.writeFileSync(SessionPaths.contextFile(sessionDir), content, { mode: 0o600 });
}

/** Finalize session - detect conflicts, save summary, update metadata. opts.finish (#218 PR 3) stamps metadata.finish when set and REMOVES a prior one otherwise; opts.variant / opts.variantUnverified (#218 PR 4) follow the same rule — a resumed run reuses the same metadata and must not inherit the last attempt's finish (council #232 r1 B1). */
function finalizeSession(sessionDir, summary, project, metadata, opts = {}) {
  const metaPath = SessionPaths.metadataFile(sessionDir);

  // Detect file conflicts
  const conflicts = detectConflicts(
    { written: metadata.filesWritten },
    project,
    new Date(metadata.createdAt)
  );

  if (conflicts.length > 0) {
    const conflictWarning = formatConflictWarning(conflicts);
    if (opts.quietStdout) {
      // JSON mode: stdout must stay pure JSON (F4) — warn on stderr instead.
      process.stderr.write(`\n${conflictWarning}\n`);
    } else {
      console.log(`\n${conflictWarning}\n`);
    }
    metadata.conflicts = conflicts;
  }

  // Save summary
  fs.writeFileSync(SessionPaths.summaryFile(sessionDir), summary, { mode: 0o600 });

  // Update metadata to the resolved terminal status. Callers that know the
  // terminal state (CLI start.js, shared-server finalizeHeadlessResult) pass it
  // explicitly via opts.status — that always wins, so they are never
  // re-classified. Defense-in-depth (#36): when NO status is supplied, an empty
  // summary must never silently default to 'complete' — that hid errored/empty
  // shared-server runs behind a 0-byte summary and a false success.
  const hasSummary = typeof summary === 'string' && summary.trim().length > 0;
  if (typeof opts.finish === 'string') { metadata.finish = opts.finish; } else { delete metadata.finish; }
  // #218 PR 4: the effort level SENT and whether the engine's catalogue knew the model — the same emit-when-set / delete-when-absent rule as finish. Named mutants "SOLOVARIANTDROPPED" / "STALEVARIANT" (tests/sidecar/session-utils.test.js).
  if (typeof opts.variant === 'string') { metadata.variant = opts.variant; } else { delete metadata.variant; }
  if (opts.variantUnverified === true) { metadata.variantUnverified = true; } else { delete metadata.variantUnverified; }
  metadata.status = opts.status || (hasSummary ? 'complete' : 'error');
  metadata.completedAt = new Date().toISOString();
  writeFileAtomic(metaPath, JSON.stringify(metadata, null, 2), { mode: 0o600 });

  logger.info('Session finalized', { taskId: metadata.taskId, status: metadata.status });
}

/**
 * Output the foreground summary echo to stdout, fenced as untrusted model
 * prose (B03). Shared seam for start.js/continue.js/resume.js's non-JSON
 * foreground path — fencing here covers all three callers at once.
 */
function outputSummary(summary) {
  console.log(fenceSidecarOutput(summary));
}

/**
 * Create a heartbeat that writes status to stderr periodically.
 * When sessionDir is provided, includes message count and latest activity.
 *
 * @param {number} [interval=HEARTBEAT_INTERVAL] - Interval in milliseconds
 * @param {string} [sessionDir] - Session directory to read progress from
 * @returns {{ stop: () => void }}
 */
function createHeartbeat(interval = HEARTBEAT_INTERVAL, sessionDir) {
  const startTime = Date.now();
  const intervalId = setInterval(() => {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    const ts = mins > 0 ? `${mins}m${secs}s` : `${secs}s`;

    if (sessionDir) {
      const { readProgress } = require('./progress');
      const progress = readProgress(sessionDir);
      process.stderr.write(`[amicus] ${ts} | ${progress.messages} messages | ${progress.latest}\n`);
    } else {
      process.stderr.write(`[amicus] still running... ${ts} elapsed\n`);
    }
  }, interval);

  return {
    stop() {
      clearInterval(intervalId);
    }
  };
}

/**
 * Execute sidecar in either headless or interactive mode
 * Consolidates the if/else pattern duplicated across start, resume, continue
 */
async function executeMode(options) {
  const {
    headless,
    runHeadless,
    runInteractive,
    model,
    systemPrompt,
    userMessage,
    taskId,
    project,
    timeout,
    agent,
    extraOptions = {},
    defaultSummary = '## Sidecar Results: No Output\n\nSession completed without summary.',
    operationType = 'task'
  } = options;

  let result;

  if (headless) {
    result = await runHeadless(
      model,
      systemPrompt,
      userMessage,
      taskId,
      project,
      timeout * 60 * 1000,
      agent,
      extraOptions
    );

    result.summary = result.summary || defaultSummary;

    if (result.timedOut) {
      logger.warn(`${operationType} timed out`, { taskId });
    }
    if (result.error) {
      logger.error(`${operationType} error`, { taskId, error: result.error });
    }
  } else {
    logger.info(`Launching interactive ${operationType}`, { taskId, model, agent });

    result = await runInteractive(
      model,
      systemPrompt,
      userMessage,
      taskId,
      project,
      { agent, ...extraOptions }
    );

    result.summary = result.summary || '';

    if (result.error) {
      logger.error(`Interactive ${operationType} error`, { taskId, error: result.error });
    }
  }

  return result;
}

/**
 * Start OpenCode server, wait for health, return client+server.
 * Shared by headless and interactive modes.
 *
 * @param {object} [mcpConfig] - Optional MCP server configuration
 * @param {object} [options] - Additional server options
 * @param {string} [options.client] - Client type (e.g. 'cowork', 'code-local')
 * @param {string} [options.systemPrompt] - System prompt to set on agent config (hidden from UI)
 * @param {string} [options.agentName] - Agent to set systemPrompt on (default: 'chat')
 * @param {string[]} [options.models] - Resolved executable id(s) actually launched on this
 *   server (#61 Task 4.6/7.3 sole-input invariant) — a multi-model shared server (fanout)
 *   has no single default `config.model`, so this registers ALL of them in provider.models
 *   instead. Additive alongside the single-model `options.model` path used by owned-server
 *   callers (start/continue); see opencode-client.js's buildServerOptions.
 * @param {number} [options.retryDelayMs] - Test seam: collapse the lock-race backoff.
 * @returns {Promise<{client: object, server: object}>}
 * @throws {Error} If server fails to start or health check fails
 */
async function startOpenCodeServer(mcpConfig, options = {}) {
  const { checkHealth, startServer } = require('../opencode-client');
  const { ensureNodeModulesBinInPath } = require('../utils/path-setup');
  const { ensurePortAvailable, retryOnLockRace } = require('../utils/server-setup');
  const { waitForServer } = require('../headless');

  ensureNodeModulesBinInPath();

  // Use specified port, or 0 to let the OS auto-assign (enables parallel sessions)
  const port = options.port || 0;
  if (port > 0) {
    ensurePortAvailable(port);
  }

  const serverOptions = { port };
  if (mcpConfig) { serverOptions.mcp = mcpConfig; }
  if (options.client) { serverOptions.client = options.client; }
  if (options.models) { serverOptions.models = options.models; }
  if (options.systemPrompt) { serverOptions.systemPrompt = options.systemPrompt; }
  if (options.agentName) { serverOptions.agentName = options.agentName; }
  // Explicit per-call override only. Unset is the normal case and is correct:
  // buildServerOptions resolves AMICUS_SERVER_START_TIMEOUT_MS / the platform
  // default downstream, so forwarding `undefined` here would change nothing.
  if (options.timeout !== undefined) { serverOptions.timeout = options.timeout; }

  // v4.4.1 Task 0.5: a LOCK-CLASS start failure is retried (5 attempts,
  // 250/500/1000/2000ms — widened from 3/750ms by Step 10.5, see server-setup).
  // The per-run shared server removes the races a single amicus process creates;
  // this covers the ones it cannot — two amicus processes, or a CLI run beside a
  // live MCP server, sharing one OpenCode SQLite database. Nothing else retries:
  // see isLockClassStartFailure in ../utils/server-setup.
  return retryOnLockRace(async () => {
    const { client, server } = await startServer(serverOptions);
    logger.debug('OpenCode server started', { url: server.url });

    const ready = await waitForServer(client, checkHealth);
    if (!ready) {
      // Fire-and-forget: today close() is sync (Promise.resolve wraps a
      // non-promise harmlessly); once close() becomes async (bounded
      // kill-escalation poll) this guard prevents an unhandled rejection
      // from racing the throw below.
      Promise.resolve(server.close()).catch(() => {});
      throw new Error('OpenCode server failed to become ready');
    }

    return { client, server };
  }, { retryDelayMs: options.retryDelayMs });
}

module.exports = {
  HEARTBEAT_INTERVAL,
  SessionPaths,
  saveInitialContext,
  finalizeSession,
  outputSummary,
  createHeartbeat,
  executeMode,
  startOpenCodeServer,
  isProcessAlive,
  checkSessionLiveness
};

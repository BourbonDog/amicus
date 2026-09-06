/**
 * Sidecar Continue Operations - Handles continuing from previous sessions
 * Spec Reference: §4.4, §8.5
 */

const fs = require('fs');

const { writeFileAtomic } = require('../utils/atomic-write');
const { generateTaskId, runInteractive, buildMcpConfig } = require('./start');
const {
  SessionPaths,
  saveInitialContext,
  finalizeSession,
  outputSummary,
  createHeartbeat
} = require('./session-utils');
const { acquireLock, releaseLock } = require('../utils/session-lock');
const { runHeadless } = require('../headless');
const { buildPrompts } = require('../prompt-builder');
const { generateFoldNonce } = require('../utils/fold-marker');
const { logger } = require('../utils/logger');

/** Load previous session data (metadata, summary, conversation) */
function loadPreviousSession(taskId, project) {
  // Reads an EXISTING session — resolve dual-dir (amicus, then legacy).
  const sessionDir = SessionPaths.resolveSessionDir(project, taskId);

  if (!fs.existsSync(sessionDir)) {
    throw new Error(`Session ${taskId} not found`);
  }

  // Load metadata
  const metaPath = SessionPaths.metadataFile(sessionDir);
  const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

  // Load summary if available
  const summaryPath = SessionPaths.summaryFile(sessionDir);
  const summary = fs.existsSync(summaryPath) ? fs.readFileSync(summaryPath, 'utf-8') : '';

  // Load and format conversation if available
  const convPath = SessionPaths.conversationFile(sessionDir);
  let conversation = '';

  if (fs.existsSync(convPath)) {
    const lines = fs.readFileSync(convPath, 'utf-8').split('\n').filter(Boolean);
    const messages = lines.map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);

    conversation = messages.map(m => {
      const time = m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : '';
      return `[${m.role} @ ${time}] ${m.content}`;
    }).join('\n\n');
  }

  return { metadata, summary, conversation };
}

/** Build continuation context from previous session data */
function buildContinuationContext(metadata, summary, conversation, contextMaxTokens = 80000) {
  const maxChars = contextMaxTokens * 4;

  const truncatedConversation = conversation.length > maxChars
    ? conversation.slice(-maxChars)
    : conversation;

  return `
## PREVIOUS SIDECAR SESSION

This sidecar continues from a previous session (${metadata.taskId}).

### Previous Task
${metadata.briefing || 'No briefing recorded'}

### Previous Summary
${summary || 'No summary available'}

### Previous Conversation Excerpt
${truncatedConversation || 'No conversation recorded'}

---

## NEW TASK

Build on the previous sidecar's findings. The user wants to continue or extend that work.
`;
}

/** Create session metadata for continuation */
function createContinueSessionMetadata(taskId, project, options, oldTaskId) {
  const { model, briefing, headless, agent, gateway, resolutionVersion, tag } = options;

  const sessionDir = SessionPaths.sessionDir(project, taskId);
  fs.mkdirSync(sessionDir, { recursive: true });

  const metadata = {
    taskId,
    model,
    project,
    briefing,
    mode: headless ? 'headless' : 'interactive',
    agent: agent || (headless ? 'build' : 'chat'),
    status: 'running',
    createdAt: new Date().toISOString(),
    continuesFrom: oldTaskId,
    // v4.7.1 Task 7 (D13): absent-not-null, same idiom as start-metadata.js:50
    // — a continuation inherits the parent's tag so a continue chain never
    // scatters into `(unattributed)`.
    ...(tag ? { tag } : {}),
  };
  // #61 Task 5.2 (best-effort provenance): only present when THIS continue
  // call freshly routed an explicit --model through the gateway router — the
  // no-model inherit path never re-resolves, so gateway/resolutionVersion
  // stay undefined there and are simply omitted (never written as `undefined`).
  if (gateway !== undefined) { metadata.gateway = gateway; }
  if (resolutionVersion !== undefined) { metadata.resolutionVersion = resolutionVersion; }

  writeFileAtomic(SessionPaths.metadataFile(sessionDir), JSON.stringify(metadata, null, 2));

  return sessionDir;
}

/**
 * Continue from a previous sidecar session - Spec Reference: §4.4, §8.5
 * @returns {Promise<number>} process exit code
 */
async function continueSidecar(options) {
  const {
    taskId: oldTaskId,
    briefing,
    project = process.cwd(),
    contextMaxTokens = 80000,
    headless = false,
    timeout = 15,
    agent,
    mcp, mcpConfig, client, noMcp, excludeMcp, json = false,
    gateway, resolutionVersion, // #61 Task 5.2 (best-effort provenance)
  } = options;

  // Load previous session data
  const { metadata: oldMetadata, summary: previousSummary, conversation: previousConversation } =
    loadPreviousSession(oldTaskId, project);

  // Lock the previous (EXISTING) session directory to prevent concurrent
  // continue operations — resolve dual-dir so a legacy session is locked too.
  const prevSessionDir = SessionPaths.resolveSessionDir(project, oldTaskId);
  acquireLock(prevSessionDir, headless ? 'headless' : 'interactive');

  const model = options.model || oldMetadata.model;
  if (!options.model) {
    // Inherited model: advisory only (F5) — never block reopening a session.
    const { warnIfNotInCatalog } = require('../utils/model-validator');
    await warnIfNotInCatalog(model);
  }
  const mcpServers = buildMcpConfig({ mcp, mcpConfig, clientType: client, noMcp, excludeMcp });
  logger.info('Continuing from session', { oldTaskId, model });

  // Build continuation context
  const previousContext = buildContinuationContext(
    oldMetadata, previousSummary, previousConversation, contextMaxTokens
  );
  const fullContext = previousContext + '\n\n' + briefing;

  // Inherit agent from previous session if not specified
  const effectiveAgent = agent || oldMetadata.agent || 'Build';

  // 15b.3: a continuation builds a FRESH prompt (unlike resume, which re-sends
  // the original), so it gets a fresh nonce too — the old session's nonce has
  // no bearing on this new one.
  const foldNonce = generateFoldNonce();

  // Build system prompt and user message
  const { system: systemPrompt, userMessage } = buildPrompts(
    briefing, fullContext, project, headless, effectiveAgent, 'normal', client, foldNonce
  );

  // Use provided task ID (from MCP server) or generate a new one
  const newTaskId = options.newTaskId || generateTaskId();
  logger.info('New continuation task', { newTaskId, oldTaskId });

  const sessionDir = createContinueSessionMetadata(newTaskId, project, {
    model, briefing, headless, agent: effectiveAgent, gateway, resolutionVersion,
    tag: oldMetadata.tag, // v4.7.1 Task 7: inherit the parent's tag (absent if the parent had none).
  }, oldTaskId);

  // Lock the NEW continuation session dir too — not just the previous one — so a
  // concurrent operation on the new session is blocked for its whole lifetime.
  acquireLock(sessionDir, headless ? 'headless' : 'interactive');

  saveInitialContext(sessionDir, systemPrompt, userMessage);

  // Start heartbeat
  const heartbeat = createHeartbeat();

  let summary;
  let result;

  try {
    if (headless) {
      try {
        result = await runHeadless(
          model, systemPrompt, userMessage, newTaskId, project,
          timeout * 60 * 1000, effectiveAgent, { mcp: mcpServers, nonce: foldNonce }
        );
      } catch (err) {
        if (!json) { throw err; }
        // --json contract: stdout must always carry a parseable run doc,
        // even when the engine throws rather than returning {error}.
        result = { summary: '', completed: false, timedOut: false, aborted: false, error: err.message, taskId: newTaskId };
      }
      summary = result.summary ||
        '## Sidecar Results: No Output\n\nContinued session completed without summary.';

      if (result.timedOut) { logger.warn('Continuation task timed out', { taskId: newTaskId }); }
      if (result.error) { logger.error('Continuation task error', { taskId: newTaskId, error: result.error }); }
    } else {
      logger.info('Launching interactive continue', { taskId: newTaskId, model });
      result = await runInteractive(
        model, systemPrompt, userMessage, newTaskId, project,
        { agent: effectiveAgent, mcp: mcpServers, foldNonce }
      );
      summary = result.summary || '';
      if (result.error) { logger.error('Interactive continue error', { taskId: newTaskId, error: result.error }); }
    }
  } finally {
    heartbeat.stop();
    releaseLock(sessionDir);
    releaseLock(prevSessionDir);
  }

  // Output summary (human mode only — json mode keeps stdout to the doc below)
  if (!json) { outputSummary(summary); }

  // Load current metadata for finalization
  const metaPath = SessionPaths.metadataFile(sessionDir);
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

  // Map the run result to the canonical terminal status + exit code — mirrors
  // start.js; resolveTerminalState is the single source of truth. Passing the
  // status explicitly also preserves the interactive empty-summary carve-out:
  // a clean interactive run finalizes 'complete' without tripping the #36
  // empty-summary guard.
  const { resolveTerminalState } = require('./session-finalize');
  const terminal = resolveTerminalState(result);
  if (terminal.status === 'error') {
    meta.status = 'error';
    meta.reason = (result && result.error) ? String(result.error) : 'Incomplete';
    if (result && typeof result.finish === 'string') { meta.finish = result.finish; } // #218 PR 3: emit-when-set, as the finalizeSession branch below
    meta.completedAt = new Date().toISOString();
    writeFileAtomic(metaPath, JSON.stringify(meta, null, 2), { mode: 0o600 });
    logger.error('Continuation completed with error', { taskId: newTaskId, error: meta.reason });
  } else {
    finalizeSession(sessionDir, summary, project, meta, { quietStdout: json, status: terminal.status, finish: result && result.finish });
  }
  // v4.3: attribute continue spend (C9/E4). Reload meta, write usage + append a
  // ledger row (status: statusFromResult, matching start.js — not terminal.status).
  {
    const { statusFromResult } = require('../utils/result-schema');
    const { finalizeSpendForReopen } = require('./reopen-spend');
    const reloaded = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const { usage } = finalizeSpendForReopen({
      taskId: newTaskId, model, mode: headless ? 'headless' : 'interactive',
      op: 'continue', result, status: statusFromResult(result), project, metadata: reloaded,
    });
    if (usage) { writeFileAtomic(metaPath, JSON.stringify(reloaded, null, 2), { mode: 0o600 }); }
  }

  if (json) {
    const { buildRunResult } = require('../utils/result-schema');
    const finalMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const doc = buildRunResult({ taskId: newTaskId, metadata: finalMeta, result, summary, sessionDir });
    console.log(JSON.stringify(doc, null, 2));
  }

  return terminal.exitCode;
}

module.exports = {
  loadPreviousSession,
  buildContinuationContext,
  createContinueSessionMetadata,
  continueSidecar
};

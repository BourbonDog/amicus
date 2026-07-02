/**
 * Sidecar Continue Operations - Handles continuing from previous sessions
 * Spec Reference: §4.4, §8.5
 */

const fs = require('fs');

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
  const { model, briefing, headless, agent } = options;

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
    continuesFrom: oldTaskId
  };

  fs.writeFileSync(SessionPaths.metadataFile(sessionDir), JSON.stringify(metadata, null, 2));

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
    mcp, mcpConfig, client, noMcp, excludeMcp
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

  // Build system prompt and user message
  const { system: systemPrompt, userMessage } = buildPrompts(
    briefing, fullContext, project, headless, effectiveAgent, 'normal', client
  );

  // Use provided task ID (from MCP server) or generate a new one
  const newTaskId = options.newTaskId || generateTaskId();
  logger.info('New continuation task', { newTaskId, oldTaskId });

  const sessionDir = createContinueSessionMetadata(newTaskId, project, {
    model, briefing, headless, agent: effectiveAgent
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
      result = await runHeadless(
        model, systemPrompt, userMessage, newTaskId, project,
        timeout * 60 * 1000, effectiveAgent, { mcp: mcpServers }
      );
      summary = result.summary ||
        '## Sidecar Results: No Output\n\nContinued session completed without summary.';

      if (result.timedOut) { logger.warn('Continuation task timed out', { taskId: newTaskId }); }
      if (result.error) { logger.error('Continuation task error', { taskId: newTaskId, error: result.error }); }
    } else {
      logger.info('Launching interactive continue', { taskId: newTaskId, model });
      result = await runInteractive(
        model, systemPrompt, userMessage, newTaskId, project,
        { agent: effectiveAgent, mcp: mcpServers }
      );
      summary = result.summary || '';
      if (result.error) { logger.error('Interactive continue error', { taskId: newTaskId, error: result.error }); }
    }
  } finally {
    heartbeat.stop();
    releaseLock(sessionDir);
    releaseLock(prevSessionDir);
  }

  // Output summary
  outputSummary(summary);

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
    meta.completedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), { mode: 0o600 });
    logger.error('Continuation completed with error', { taskId: newTaskId, error: meta.reason });
  } else {
    finalizeSession(sessionDir, summary, project, meta, { status: terminal.status });
  }
  return terminal.exitCode;
}

module.exports = {
  loadPreviousSession,
  buildContinuationContext,
  createContinueSessionMetadata,
  continueSidecar
};

/**
 * Sidecar Resume Operations - Handles resuming previous sidecar sessions
 * Spec Reference: §4.3, §8.3
 */

const fs = require('fs');
const path = require('path');

const { writeFileAtomic } = require('../utils/atomic-write');
const { runInteractive, buildMcpConfig } = require('./start');
const {
  SessionPaths,
  finalizeSession,
  outputSummary,
  createHeartbeat,
  checkSessionLiveness
} = require('./session-utils');
const { acquireLock, releaseLock } = require('../utils/session-lock');
const { runHeadless } = require('../headless');
const { extractNonceFromText, generateFoldNonce } = require('../utils/fold-marker');
const { logger } = require('../utils/logger');

/** Load session metadata from session directory */
function loadSessionMetadata(sessionDir) {
  const metaPath = SessionPaths.metadataFile(sessionDir);
  if (!fs.existsSync(metaPath)) {
    throw new Error(`Session metadata not found: ${metaPath}`);
  }
  return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
}

/** Load initial context (system prompt) from session */
function loadInitialContext(sessionDir) {
  const contextPath = SessionPaths.contextFile(sessionDir);
  if (fs.existsSync(contextPath)) {
    return fs.readFileSync(contextPath, 'utf-8');
  }
  return '';
}

/** Check for file drift - files that were read may have changed */
function checkFileDrift(metadata, project) {
  const filesRead = metadata.filesRead || [];
  const lastActivity = metadata.completedAt || metadata.createdAt;
  const lastActivityTime = new Date(lastActivity).getTime();
  const changedFiles = [];

  for (const file of filesRead) {
    const filePath = path.join(project, file);
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs > lastActivityTime) {
        changedFiles.push(file);
      }
    }
  }

  return { hasChanges: changedFiles.length > 0, changedFiles, lastActivityTime };
}

/** Build drift warning message */
function buildDriftWarning(changedFiles, lastActivityTime) {
  const timeSince = Date.now() - lastActivityTime;
  const hours = Math.floor(timeSince / 3600000);

  return `
## ⚠️ RESUME NOTICE

This session is being resumed after a pause. **The file system has changed since your last message.**

**Time since last activity:** ${hours > 0 ? hours + ' hours' : 'Less than an hour'}

**Changed files:**
${changedFiles.map(f => `- ${f}`).join('\n')}

Please verify your previous findings against the current state of these files before continuing.
`;
}

/** Build user message for headless resume, including conversation history */
function buildResumeUserMessage(briefing, conversation) {
  const parts = [];

  if (conversation) {
    parts.push('## PREVIOUS CONVERSATION\n');
    parts.push(conversation);
    parts.push('\n---\n');
    parts.push('## RESUME\n');
    parts.push('You are resuming a previous session. Continue from where you left off.');
  }

  if (briefing) {
    if (parts.length === 0) {
      parts.push(briefing);
    } else {
      parts.push(`\nOriginal task: ${briefing}`);
    }
  }

  return parts.join('\n');
}

/** Update session metadata status */
function updateSessionStatus(sessionDir, status) {
  const metaPath = SessionPaths.metadataFile(sessionDir);
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  meta.status = status;
  if (status === 'running') {
    meta.resumedAt = new Date().toISOString();
  }
  writeFileAtomic(metaPath, JSON.stringify(meta, null, 2));
  return meta;
}

/**
 * Resume a previous sidecar session - Spec Reference: §4.3, §8.3
 * @returns {Promise<number>} process exit code
 */
async function resumeSidecar(options) {
  const {
    taskId, project = process.cwd(), headless = false, timeout = 15,
    mcp, mcpConfig, client, noMcp, excludeMcp, json = false
  } = options;

  // Resume operates on an EXISTING session — resolve dual-dir (amicus, then legacy).
  const sessionDir = SessionPaths.resolveSessionDir(project, taskId);
  if (!fs.existsSync(sessionDir)) {
    throw new Error(`Session ${taskId} not found`);
  }

  // Load previous session data
  const metadata = loadSessionMetadata(sessionDir);
  const systemPrompt = loadInitialContext(sessionDir);

  // Dead-process detection: log if the previous process is no longer alive
  const liveness = checkSessionLiveness(metadata);
  if (liveness !== 'alive') {
    logger.info('Session process is dead, restoring from disk', {
      taskId, liveness, pid: metadata.pid,
    });
  }

  // Acquire lock to prevent concurrent resume operations
  acquireLock(sessionDir, headless ? 'headless' : 'interactive');

  let heartbeat;
  try {
    const mcpServers = buildMcpConfig({ mcp, mcpConfig, clientType: client, noMcp, excludeMcp });
    logger.info('Resuming session', { taskId, model: metadata.model, briefing: metadata.briefing });
    // Inherited model: advisory only (F5) — never block reopening a session.
    const { warnIfNotInCatalog } = require('../utils/model-validator');
    await warnIfNotInCatalog(metadata.model);

    // Check for file drift
    const drift = checkFileDrift(metadata, project);
    let resumePrompt = systemPrompt;

    if (drift.hasChanges) {
      const driftWarning = buildDriftWarning(drift.changedFiles, drift.lastActivityTime);
      resumePrompt = systemPrompt + '\n' + driftWarning;
      logger.warn('Files changed since last activity', { taskId, changedFileCount: drift.changedFiles.length });
    }

    // 15b.3: resume re-sends the ORIGINAL prompt text verbatim (unlike
    // continue, which builds a fresh one) — that prompt already instructed
    // the model with the nonce baked in at the initial start/continue time.
    // Recover it from the saved text so the detector agrees with what the
    // model was actually told. A session saved before 15b.3 shipped (or any
    // prompt that somehow lost its marker instruction) has no nonce to
    // recover — generate a fresh one so resume still gets nonce protection,
    // even though the OLD prompt text won't mention it (that just means this
    // resumed run can only complete via a non-fold-marker path, same as any
    // other run whose prompt and detector nonce happen to mismatch).
    const foldNonce = extractNonceFromText(systemPrompt) || generateFoldNonce();

    // Update metadata (get updated metadata with resumedAt)
    const updatedMetadata = updateSessionStatus(sessionDir, 'running');

    // Start heartbeat
    heartbeat = createHeartbeat();

    let summary;
    let result;
    const effectiveAgent = metadata.agent || 'Build';

    // Load conversation for both paths (interactive already did this, headless didn't)
    const conversationPath = SessionPaths.conversationFile(sessionDir);
    const existingConversation = fs.existsSync(conversationPath)
      ? fs.readFileSync(conversationPath, 'utf-8')
      : '';

    if (headless) {
      const userMessage = buildResumeUserMessage(metadata.briefing || '', existingConversation);
      try {
        result = await runHeadless(
          metadata.model, resumePrompt, userMessage,
          taskId, project, timeout * 60 * 1000, effectiveAgent, { mcp: mcpServers, nonce: foldNonce }
        );
      } catch (err) {
        if (!json) { throw err; }
        // --json contract: stdout must always carry a parseable run doc,
        // even when the engine throws rather than returning {error}.
        result = { summary: '', completed: false, timedOut: false, aborted: false, error: err.message, taskId };
      }
      summary = result.summary || '## Sidecar Results: No Output\n\nResumed session completed without summary.';

      if (result.timedOut) { logger.warn('Resume task timed out', { taskId }); }
      if (result.error) { logger.error('Resume task error', { taskId, error: result.error }); }
    } else {
      logger.info('Launching interactive resume', { taskId, model: metadata.model });

      result = await runInteractive(
        metadata.model, resumePrompt, metadata.briefing || '',
        taskId, project,
        {
          agent: effectiveAgent,
          isResume: true,
          conversation: existingConversation,
          opencodeSessionId: metadata.opencodeSessionId,
          mcp: mcpServers,
          foldNonce
        }
      );
      summary = result.summary || '';
      if (result.error) { logger.error('Interactive resume error', { taskId, error: result.error }); }
    }

    // Output summary (human mode only — json mode keeps stdout to the doc below)
    if (!json) { outputSummary(summary); }

    // Map the run result to the canonical terminal status + exit code —
    // mirrors start.js. Explicit status preserves the interactive
    // empty-summary carve-out (the #36 guard never re-classifies it).
    const { resolveTerminalState } = require('./session-finalize');
    const terminal = resolveTerminalState(result);
    const metaPath = SessionPaths.metadataFile(sessionDir);
    if (terminal.status === 'error') {
      updatedMetadata.status = 'error';
      updatedMetadata.reason = (result && result.error) ? String(result.error) : 'Incomplete';
      updatedMetadata.completedAt = new Date().toISOString();
      writeFileAtomic(metaPath, JSON.stringify(updatedMetadata, null, 2), { mode: 0o600 });
      logger.error('Resume completed with error', { taskId, error: updatedMetadata.reason });
    } else {
      finalizeSession(sessionDir, summary, project, updatedMetadata, { quietStdout: json, status: terminal.status });
    }

    if (json) {
      const { buildRunResult } = require('../utils/result-schema');
      const finalMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      const doc = buildRunResult({ taskId, metadata: finalMeta, result, summary, sessionDir });
      console.log(JSON.stringify(doc, null, 2));
    }

    return terminal.exitCode; // finally below still releases the lock first
  } finally {
    if (heartbeat) { heartbeat.stop(); }
    releaseLock(sessionDir);
  }
}

module.exports = {
  loadSessionMetadata,
  loadInitialContext,
  checkFileDrift,
  buildDriftWarning,
  buildResumeUserMessage,
  updateSessionStatus,
  resumeSidecar
};

/**
 * Sidecar Start Operations - Handles starting new sidecar sessions
 * Spec Reference: §4.1, §9
 */

const crypto = require('crypto');
const fs = require('fs');

const { writeFileAtomic } = require('../utils/atomic-write');
const { buildContext } = require('./context-builder');
const {
  SessionPaths,
  saveInitialContext,
  finalizeSession,
  outputSummary,
  createHeartbeat,
  HEARTBEAT_INTERVAL
} = require('./session-utils');
const { runInteractive } = require('./interactive');
const { checkElectronAvailable } = require('./interactive-process');
const { buildPrompts } = require('../prompt-builder');
const { runHeadless } = require('../headless');
const { logger } = require('../utils/logger');
const { acquireLock, releaseLock } = require('../utils/session-lock');
const { loadMcpConfig, parseMcpSpec } = require('../opencode-client');
const { mapAgentToOpenCode } = require('../utils/agent-mapping');
const { discoverParentMcps } = require('../utils/mcp-discovery');
const { stripSelfMcpEntries } = require('../utils/mcp-self-identity');
const { generateFoldNonce } = require('../utils/fold-marker');
const { createSessionMetadata } = require('./start-metadata');

/** Generate a unique 8-character hex task ID */
function generateTaskId() {
  return crypto.randomBytes(4).toString('hex');
}

/**
 * Build MCP configuration from options.
 * Merge priority: CLI --mcp > --mcp-config > file config > discovered parent MCPs
 *
 * @param {object} options
 * @param {string} [options.mcp] - CLI --mcp spec
 * @param {string} [options.mcpConfig] - CLI --mcp-config path
 * @param {string} [options.clientType] - Parent client type for discovery
 * @param {boolean} [options.noMcp] - Skip MCP inheritance from parent
 * @param {string[]} [options.excludeMcp] - Server names to exclude
 * @param {string} [options.projectDir] - Target project directory used to resolve
 *   a project-scoped opencode.json (NOT process.cwd() under Claude Code/MCP/Cowork)
 * @returns {object|null} MCP server configs or null
 */
function buildMcpConfig(options) {
  const { mcp, mcpConfig, clientType, noMcp, excludeMcp, projectDir } = options;
  let mcpServers = null;

  // Layer 1: Discover parent MCPs (unless --no-mcp)
  if (!noMcp) {
    const discovered = discoverParentMcps(clientType);
    if (discovered) {
      mcpServers = { ...discovered };
      logger.info('Discovered parent MCP servers', { serverCount: Object.keys(mcpServers).length });
    }
  }

  // Layer 2: File config (opencode.json) overrides discovered.
  // Resolve the project-scoped opencode.json against the target project dir,
  // not process.cwd() (which differs under Claude Code/MCP/Cowork).
  const fileConfig = loadMcpConfig(mcpConfig, projectDir);
  if (fileConfig) {
    mcpServers = mcpServers ? { ...mcpServers, ...fileConfig } : { ...fileConfig };
    logger.debug('Loaded MCP config from file', { serverCount: Object.keys(fileConfig).length });
  }

  // Layer 3: CLI --mcp (highest priority)
  if (mcp) {
    const parsed = parseMcpSpec(mcp);
    if (parsed) {
      mcpServers = mcpServers || {};
      mcpServers[parsed.name] = parsed.config;
      logger.debug('Added CLI MCP server', { name: parsed.name });
    } else {
      logger.warn('Invalid MCP server spec', { mcp });
    }
  }

  // Always exclude amicus itself — under ANY registered name or aliased
  // invocation — to prevent recursive spawning. When launched from Cowork or
  // Claude Code the discovered list includes 'amicus'/'sidecar' (and possibly
  // a user alias), which would cause an infinite spawn loop.
  if (mcpServers) { stripSelfMcpEntries(mcpServers, logger); }

  // Apply explicit exclusions
  if (excludeMcp && Array.isArray(excludeMcp) && mcpServers) {
    for (const name of excludeMcp) {
      if (mcpServers[name]) {
        delete mcpServers[name];
        logger.debug('Excluded MCP server', { name });
      }
    }
  }

  // Return null if all servers were excluded
  if (mcpServers && Object.keys(mcpServers).length === 0) {
    mcpServers = null;
  }

  return mcpServers;
}

/** Start a new sidecar session - Spec Reference: §4.1, §9 */
async function startSidecar(options) {
  const {
    model, prompt, briefing, sessionId, session = 'current',
    cwd, project = process.cwd(), contextTurns = 50, contextSince,
    contextMaxTokens = 80000, noUi, headless = false, timeout = 15,
    agent, mcp, mcpConfig, summaryLength = 'normal', thinking,
    client, sessionDir, noMcp, excludeMcp, opencodePort, coworkProcess, includeContext = true,
    position = 'right', json = false, modelInput = null, pack = null, tag
  } = options;

  const effectivePrompt = prompt || briefing;
  const effectiveSession = sessionId || session;
  const effectiveProject = cwd || project;
  const effectiveHeadless = noUi !== undefined ? noUi : headless;
  const mcpServers = buildMcpConfig({
    mcp, mcpConfig, clientType: client, noMcp, excludeMcp, projectDir: effectiveProject
  });
  const taskId = options.taskId || generateTaskId();
  const variant = thinking || undefined; // #218 PR 4: the level itself is the engine's `variant` field (named mutant "STARTVARIANTDROPPED", tests/sidecar/start.test.js: drop `variant` from the two options objects below)
  // 15b.3: one nonce per run, generated BEFORE prompt construction so the
  // SAME value can be baked into the prompt's instruction (buildPrompts) and
  // handed to the detector (runHeadless.options.nonce / the GUI fold writer
  // via env). Harmless to generate even for the interactive path — buildPrompts
  // only consumes it in headless mode.
  const foldNonce = generateFoldNonce();

  logger.info('Starting task', { taskId, model, mode: effectiveHeadless ? 'headless' : 'interactive' });

  const context = includeContext !== false
    ? buildContext(effectiveProject, effectiveSession, { contextTurns, contextSince, contextMaxTokens, sessionDir, client, coworkProcess })
    : '[Context excluded by caller - briefing is self-contained]';
  const { system: systemPrompt, userMessage } = buildPrompts(
    effectivePrompt, context, effectiveProject, effectiveHeadless, agent, summaryLength, client, foldNonce
  );

  const sessDir = createSessionMetadata(taskId, effectiveProject, {
    model, prompt: effectivePrompt, noUi: effectiveHeadless, agent, thinking, pack, tag
  });
  saveInitialContext(sessDir, systemPrompt, userMessage);
  acquireLock(sessDir, effectiveHeadless ? 'headless' : 'interactive');

  const heartbeat = createHeartbeat(HEARTBEAT_INTERVAL, sessDir);
  let summary;
  let result;

  try {
    if (effectiveHeadless) {
      try {
        result = await runHeadless(
          model, systemPrompt, userMessage, taskId, effectiveProject,
          timeout * 60 * 1000, agent || 'build',
          { mcp: mcpServers, summaryLength, variant, port: opencodePort, nonce: foldNonce }
        );
      } catch (err) {
        if (!json) { throw err; }
        // --json contract: stdout must always carry a parseable run doc,
        // even when the engine throws rather than returning {error}.
        result = { summary: '', completed: false, timedOut: false, aborted: false, error: err.message, taskId };
      }
      summary = result.summary || '## Sidecar Results: No Output\n\nHeadless mode completed without summary.';
      if (result.timedOut) { logger.warn('Task timed out', { taskId }); }
      if (result.error) { logger.error('Task error', { taskId, error: result.error }); }
    } else {
      const effectiveAgent = mapAgentToOpenCode(agent).agent;
      logger.info('Launching interactive sidecar', { taskId, model, agent: effectiveAgent });
      result = await runInteractive(
        model, systemPrompt, userMessage, taskId, effectiveProject,
        { agent, mcp: mcpServers, variant, client, windowPosition: position, foldNonce }
      );
      summary = result.summary || '';
      if (result.error) { logger.error('Interactive task error', { taskId, error: result.error }); }
    }
  } finally {
    heartbeat.stop();
    releaseLock(sessDir);
  }

  if (!json) { outputSummary(summary); }
  const metaPath = SessionPaths.metadataFile(sessDir);
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

  // Persist OpenCode session ID for resume capability
  if (result && result.opencodeSessionId) {
    meta.opencodeSessionId = result.opencodeSessionId;
    writeFileAtomic(metaPath, JSON.stringify(meta, null, 2), { mode: 0o600 });
  }

  // Map the run result to a definitive terminal status + exit code (single source of truth).
  const { resolveTerminalState } = require('./session-finalize');
  const terminal = resolveTerminalState(result);
  if (terminal.status === 'error') {
    meta.status = 'error';
    meta.reason = (result && result.error) ? String(result.error) : 'Incomplete';
    if (result && typeof result.finish === 'string') { meta.finish = result.finish; } // #218 PR 3: emit-when-set; a fresh session's metadata has no prior finish to remove (resume's does -- resume.js)
    if (result && typeof result.variant === 'string') { meta.variant = result.variant; } // #218 PR 4: emit-when-set, like finish (named mutant "SOLOERRORNOVARIANT", tests/start-terminal-status.test.js)
    if (result && result.variantUnverified === true) { meta.variantUnverified = true; }
    meta.completedAt = new Date().toISOString();
    writeFileAtomic(metaPath, JSON.stringify(meta, null, 2), { mode: 0o600 });
    logger.error('Session completed with error', { taskId, error: meta.reason });
  } else {
    // complete / timed-out / aborted: persist the (possibly partial) summary with the correct status.
    finalizeSession(sessDir, summary, effectiveProject, meta, { quietStdout: json, status: terminal.status, finish: result && result.finish, variant: result && result.variant, variantUnverified: result && result.variantUnverified });
  }

  const { resolveUsage } = require('../utils/pricing');
  const runUsage = result && result.usage ? resolveUsage({ model, usageTotals: result.usage }) : null;
  if (runUsage) {
    const m = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    m.usage = runUsage;
    writeFileAtomic(metaPath, JSON.stringify(m, null, 2), { mode: 0o600 });
    // B24: cross-run spend ledger. Best-effort — appendSpend never throws, but
    // this run's own success must never hinge on ledger bookkeeping either way.
    try {
      const { appendSpend } = require('../utils/spend-ledger');
      const { statusFromResult } = require('../utils/result-schema');
      const { gatewayOf } = require('../utils/gateway-router');
      appendSpend({
        taskId, model, mode: effectiveHeadless ? 'headless' : 'interactive', usage: runUsage,
        op: 'start', status: statusFromResult(result), project: effectiveProject,
        finish: result && result.finish, // #218 PR 3: appendSpend keeps it only when it is a string
        variant: result && result.variant, // #218 PR 4: same emit-when-set rule (named mutant "SOLOROWNOVARIANT", tests/start-json.test.js)
        // ⚠️ DE-ROT: `metadata` is NOT in scope at startSidecar's finalize site — the objects
        // there are `meta` (createSessionMetadata result) and `m`; `metadata` is a local only
        // inside createSessionMetadata. Reading `metadata.gateway` throws a ReferenceError the
        // best-effort catch swallows → EVERY start-mode spend row silently dropped + start-json.test.js
        // goes red. Use an in-scope value (spec-complete for direct/openrouter):
        gateway: gatewayOf(model),
        // (To also attribute v4.2 'local': thread the resolved route gateway — dropped today at
        // cli-handlers-run.js:47 — into createSessionMetadata and read `meta.gateway`, as continue.js:111 does.)
        // v4.7 F8 D16: same in-scope-value rule as gateway above — `m` is the
        // just-re-read metadata (line 215), which carries `tag` when
        // createSessionMetadata stored one (absent otherwise); `|| null` folds
        // that into spend-ledger.js's null-not-absent dim convention.
        tag: m.tag || null,
      });
    } catch { /* best-effort */ }
  }

  if (json) {
    const { buildRunResult } = require('../utils/result-schema');
    const finalMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const doc = buildRunResult({
      taskId, metadata: finalMeta, result, summary,
      modelInput, sessionDir: sessDir, usage: runUsage,
    });
    console.log(JSON.stringify(doc, null, 2));
  }

  return terminal.exitCode;
}

module.exports = {
  generateTaskId,
  createSessionMetadata,
  buildMcpConfig,
  checkElectronAvailable,
  runInteractive,
  startSidecar,
  HEARTBEAT_INTERVAL
};

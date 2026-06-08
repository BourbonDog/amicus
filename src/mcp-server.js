/** @module mcp-server — Amicus MCP Server (stdio transport) */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { getTools, getGuideText } = require('./mcp-tools');
const { tryResolveModel } = require('./utils/config');
const os = require('os');
const { logger } = require('./utils/logger');
const { safeSessionDir } = require('./utils/validators');
const { getSessionDir, SESSIONS_DIR, LEGACY_SESSIONS_DIR } = require('./session-manager');
const { readProgress } = require('./sidecar/progress');
const { SharedServerManager } = require('./utils/shared-server');

const sharedServer = new SharedServerManager({ logger });

/** Resolve the project directory with smart fallback. */
function getProjectDir(explicitProject) {
  if (explicitProject && fs.existsSync(explicitProject)) { return explicitProject; }
  const cwd = process.cwd();
  if (cwd !== '/' && fs.existsSync(cwd)) { return cwd; }
  if (cwd === '/') { logger.warn('cwd is root (/), falling back to $HOME'); }
  return os.homedir();
}

/** Read session metadata from disk, or null if not found */
function readMetadata(taskId, project) {
  const sessionDir = safeSessionDir(project, taskId);
  const metaPath = path.join(sessionDir, 'metadata.json');
  if (!fs.existsSync(metaPath)) { return null; }
  return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
}

/** Build an MCP text response */
function textResult(text, isError) {
  const result = { content: [{ type: 'text', text }] };
  if (isError) { result.isError = true; }
  return result;
}

/**
 * Compute next poll hint for headless sessions.
 * @returns {{ hint: string }}
 */
function computeNextPoll() {
  return {
    hint: 'Run `sleep 25` in your shell before calling amicus_status again. This enforces the wait and prevents token-wasting rapid polls.',
    wait_command: 'sleep 25',
  };
}

const HEADLESS_START_REMINDER = '<system-reminder>IMPORTANT: Before calling amicus_status, you MUST run `sleep 25` in your shell first. This enforces the polling interval and prevents token waste. Do other useful work while waiting, or run `sleep 25` to block until the next poll window.</system-reminder>';
const HEADLESS_STATUS_REMINDER = '<system-reminder>IMPORTANT: This session is still running. Before calling amicus_status again, you MUST run `sleep 25` in your shell first. Each premature poll wastes context tokens for zero benefit. Run `sleep 25` now, then check again.</system-reminder>';

/** Spawn an Amicus CLI process (fire-and-forget) */
function spawnSidecarProcess(args, sessionDir) {
  const sidecarBin = path.join(__dirname, '..', 'bin', 'amicus.js');
  let stderrFd = 'ignore';
  if (sessionDir) {
    try {
      fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
      stderrFd = fs.openSync(path.join(sessionDir, 'debug.log'), 'w');
    } catch { /* fall back to ignore */ }
  }
  const child = spawn('node', [sidecarBin, ...args], {
    cwd: getProjectDir(),
    stdio: ['ignore', 'ignore', stderrFd],
    env: { ...process.env, SIDECAR_DEBUG_PORT: '9223', LOG_LEVEL: process.env.LOG_LEVEL || 'info' },
  });
  child.unref();
  return child;
}

/** Tool handler implementations */
const handlers = {
  async amicus_start(input, project) {
    // Validate all inputs before any session creation
    const { validateStartInputs } = require('./utils/input-validators');
    const validation = validateStartInputs(input);
    if (!validation.valid) {
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify(validation.error) }],
      };
    }
    const resolvedModel = validation.resolvedModel;

    const cwd = project || getProjectDir(input.project);
    const { generateTaskId } = require('./sidecar/start');
    const taskId = generateTaskId();

    const args = ['start', '--prompt', input.prompt, '--task-id', taskId, '--client', 'cowork'];
    if (resolvedModel) { args.push('--model', resolvedModel); }
    const agent = (input.noUi && (!input.agent || input.agent.toLowerCase() === 'chat'))
      ? 'build' : input.agent;
    if (agent) { args.push('--agent', agent); }
    if (input.noUi) { args.push('--no-ui'); }
    if (input.thinking) { args.push('--thinking', input.thinking); }
    if (input.timeout) { args.push('--timeout', String(input.timeout)); }
    if (input.contextTurns)     { args.push('--context-turns', String(input.contextTurns)); }
    if (input.contextSince)     { args.push('--context-since', input.contextSince); }
    if (input.contextMaxTokens) { args.push('--context-max-tokens', String(input.contextMaxTokens)); }
    if (input.summaryLength)    { args.push('--summary-length', input.summaryLength); }
    if (input.includeContext === false) { args.push('--no-context'); }
    if (input.coworkProcess)    { args.push('--cowork-process', input.coworkProcess); }
    if (input.parentSession)    { args.push('--session-id', input.parentSession); }
    if (input.windowPosition)   { args.push('--position', input.windowPosition); }
    args.push('--cwd', cwd);

    // New session → canonical amicus dir (writes).
    const sessionDir = getSessionDir(cwd, taskId);

    if (sharedServer.enabled && input.noUi) {
      // Shared server path: headless only, delegates to runHeadless()
      let sessionId;
      try {
        const { server, client } = await sharedServer.ensureServer();
        const { createSession } = require('./opencode-client');
        const { buildContext } = require('./sidecar/context-builder');
        const { buildPrompts } = require('./prompt-builder');
        const { runHeadless } = require('./headless');
        const { finalizeSession } = require('./sidecar/session-utils');
        // resolvedModel is already available from validateStartInputs() above

        sessionId = await createSession(client);

        // Write initial metadata (MCP handler owns this, runHeadless skips it)
        fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
        const metaPath = path.join(sessionDir, 'metadata.json');
        const serverPort = server.url ? new URL(server.url).port : null;
        fs.writeFileSync(metaPath, JSON.stringify({
          taskId, status: 'running',
          pid: null, // Shared server path: don't store MCP server PID (abort would kill all sessions)
          opencodeSessionId: sessionId,
          opencodePort: serverPort,
          goPid: server.goPid || null,
          createdAt: new Date().toISOString(),
          headless: true, model: resolvedModel,
        }, null, 2), { mode: 0o600 });

        // Build context from parent conversation (unless --no-context)
        let context = null;
        if (input.includeContext !== false) {
          try {
            context = buildContext(cwd, input.parentSession, {
              contextTurns: input.contextTurns,
              contextSince: input.contextSince,
              contextMaxTokens: input.contextMaxTokens,
              coworkProcess: input.coworkProcess,
            });
          } catch (ctxErr) {
            logger.warn('Failed to build context, proceeding without', { error: ctxErr.message });
          }
        }

        // Build prompts (same as CLI path in start.js)
        const { system: systemPrompt, userMessage } = buildPrompts(
          input.prompt, context, cwd, true, agent, input.summaryLength
        );

        // Register session with idle eviction
        sharedServer.addSession(sessionId, (_evictedId) => {
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
            meta.status = 'idle-timeout';
            meta.completedAt = new Date().toISOString();
            fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), { mode: 0o600 });
          } catch (err) {
            logger.warn('Failed to update evicted session metadata', { error: err.message });
          }
        });
        const watchdog = sharedServer.getSessionWatchdog(sessionId);

        const timeoutMs = (input.timeout || 15) * 60 * 1000;

        // Fire-and-forget: runHeadless with shared server's client
        runHeadless(resolvedModel, systemPrompt, userMessage, taskId, cwd,
          timeoutMs, agent, {
            client, server, watchdog, sessionId,
            mcp: undefined, // shared server already has MCP config
          }
        ).then((result) => {
          // Session complete - finalize and remove from tracking
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
            finalizeSession(sessionDir, result.summary || '', cwd, meta);
          } catch (finErr) {
            logger.warn('Failed to finalize session', { error: finErr.message });
          }
          sharedServer.removeSession(sessionId);
        }).catch((err) => {
          logger.error('Shared server session failed', { taskId, error: err.message });
          sharedServer.removeSession(sessionId);
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
            meta.status = 'error';
            meta.reason = err.message;
            meta.completedAt = new Date().toISOString();
            fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), { mode: 0o600 });
          } catch (writeErr) {
            logger.warn('Failed to write error metadata', { error: writeErr.message });
          }
        });

        // Return immediately
        const body = JSON.stringify({
          taskId, status: 'running', mode: 'headless',
          message: 'Amicus started in headless mode. Use amicus_status to check progress.',
        });
        return { content: [{ type: 'text', text: body }, { type: 'text', text: HEADLESS_START_REMINDER }] };
      } catch (err) {
        logger.warn('Shared server path failed, falling back to spawn', { error: err.message });
        // Clean up partial shared server state before falling through
        if (sessionId) {
          sharedServer.removeSession(sessionId);
        }
        // Fall through to spawn path below
      }
    }

    // Feature flag disabled (or shared server failed): fall back to per-process spawn
    let child;
    try { child = spawnSidecarProcess(args, sessionDir); } catch (err) {
      return textResult(`Failed to start Amicus: ${err.message}`, true);
    }

    if (child && child.pid) {
      fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
      const metaPath = path.join(sessionDir, 'metadata.json');
      if (!fs.existsSync(metaPath)) {
        fs.writeFileSync(metaPath, JSON.stringify({
          taskId, status: 'running', pid: child.pid, createdAt: new Date().toISOString(),
          headless: !!input.noUi,
        }, null, 2), { mode: 0o600 });
      }
    }

    const isHeadless = !!input.noUi;
    const mode = isHeadless ? 'headless' : 'interactive';
    const message = isHeadless
      ? 'Amicus started in headless mode. Use amicus_status to check progress.'
      : 'Amicus opened in interactive mode. Do NOT poll for status. ' +
        "Tell the user: 'Let me know when you're done with the session and have clicked Fold.' " +
        'Then wait for the user to tell you. Use amicus_read to get results once they confirm.';

    const body = JSON.stringify({ taskId, status: 'running', mode, message });
    if (isHeadless) {
      return { content: [{ type: 'text', text: body }, { type: 'text', text: HEADLESS_START_REMINDER }] };
    }
    return textResult(body);
  },

  async amicus_status(input, project) {
    const cwd = project || getProjectDir(input.project);
    const sessionDir = safeSessionDir(cwd, input.taskId);
    const metadata = readMetadata(input.taskId, cwd);
    if (!metadata) { return textResult(`Session ${input.taskId} not found.`, true); }

    if (metadata.status === 'running' && metadata.pid) {
      try { process.kill(metadata.pid, 0); } catch {
        Object.assign(metadata, {
          status: 'crashed', crashedAt: new Date().toISOString(),
          reason: 'Process exited unexpectedly',
        });
        fs.writeFileSync(path.join(sessionDir, 'metadata.json'),
          JSON.stringify(metadata, null, 2));
      }
    }

    const ms = Date.now() - new Date(metadata.createdAt).getTime();
    const response = {
      taskId: metadata.taskId, status: metadata.status,
      elapsed: `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`,
    };
    if (metadata.model) { response.model = metadata.model; }

    if (metadata.status === 'running') {
      const progress = readProgress(sessionDir);
      Object.assign(response, progress);

      // Stall detection: flag when no activity for 2+ minutes
      const STALL_THRESHOLD_MS = 120000;
      if (metadata.headless && progress.lastActivityMs !== null && progress.lastActivityMs > STALL_THRESHOLD_MS) {
        response.stalled = true;
        response.stalledForSeconds = Math.floor(progress.lastActivityMs / 1000);
        response.recovery = `This session appears stalled (no activity for ${response.stalledForSeconds}s). ` +
          `To recover: 1) call amicus_abort with taskId "${input.taskId}" ` +
          `2) call amicus_resume with taskId "${input.taskId}" and noUi: true to pick up where it left off.`;
      }

      if (metadata.headless) {
        response.next_poll = computeNextPoll();
      }
    }
    if (metadata.status === 'crashed' || metadata.status === 'error') {
      response.reason = metadata.reason || 'Unknown error';
    }
    const responseText = JSON.stringify(response);
    if (metadata.status === 'running' && metadata.headless) {
      return { content: [{ type: 'text', text: responseText }, { type: 'text', text: HEADLESS_STATUS_REMINDER }] };
    }
    return textResult(responseText);
  },

  async amicus_read(input, project) {
    const cwd = project || getProjectDir(input.project);
    const sessionDir = safeSessionDir(cwd, input.taskId);
    if (!fs.existsSync(sessionDir)) {
      return textResult(`Session ${input.taskId} not found.`, true);
    }

    const mode = input.mode || 'summary';
    if (mode === 'metadata') {
      return textResult(fs.readFileSync(path.join(sessionDir, 'metadata.json'), 'utf-8'));
    }
    if (mode === 'conversation') {
      const convPath = path.join(sessionDir, 'conversation.jsonl');
      if (!fs.existsSync(convPath)) { return textResult('No conversation recorded.'); }
      return textResult(fs.readFileSync(convPath, 'utf-8'));
    }
    // Default: summary
    const summaryPath = path.join(sessionDir, 'summary.md');
    if (!fs.existsSync(summaryPath)) {
      return textResult('No summary available (session may still be running or was not folded).');
    }
    const metaForRead = (() => {
      try { return JSON.parse(fs.readFileSync(path.join(sessionDir, 'metadata.json'), 'utf-8')); }
      catch { return {}; }
    })();
    const summaryText = fs.readFileSync(summaryPath, 'utf-8');
    const header = metaForRead.model ? `**Model:** ${metaForRead.model}\n\n` : '';
    return textResult(header + summaryText);
  },

  async amicus_list(input, project) {
    const cwd = project || getProjectDir(input.project);
    // Scan BOTH roots: canonical amicus first, then legacy sidecar (shim).
    const roots = [SESSIONS_DIR, LEGACY_SESSIONS_DIR]
      .map(d => path.join(cwd, '.claude', d))
      .filter(fs.existsSync);
    if (roots.length === 0) { return textResult('No amicus sessions found.'); }

    // Dedup by task id — amicus (first root) wins over legacy.
    const byId = new Map();
    for (const root of roots) {
      for (const d of fs.readdirSync(root)) {
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(d)) { continue; }
        if (byId.has(d)) { continue; }
        const metaPath = path.join(root, d, 'metadata.json');
        if (!fs.existsSync(metaPath)) { continue; }
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          byId.set(d, {
            id: d, model: meta.model, status: meta.status, agent: meta.agent,
            briefing: (String(meta.briefing || '')).slice(0, 80),
            createdAt: meta.createdAt,
          });
        } catch {
          // Skip unreadable metadata
        }
      }
    }

    let sessions = Array.from(byId.values())
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    if (input.status && input.status !== 'all') {
      sessions = sessions.filter(s => s.status === input.status);
    }
    if (sessions.length === 0) { return textResult('No amicus sessions found.'); }

    return textResult(JSON.stringify(sessions, null, 2));
  },

  async amicus_resume(input, project) {
    const cwd = project || getProjectDir(input.project);
    const sessionDir = safeSessionDir(cwd, input.taskId);
    const args = ['resume', input.taskId, '--client', 'cowork', '--cwd', cwd];
    if (input.noUi) { args.push('--no-ui', '--agent', 'build'); }
    if (input.timeout) { args.push('--timeout', String(input.timeout)); }
    try { spawnSidecarProcess(args, sessionDir); } catch (err) {
      return textResult(`Failed to resume: ${err.message}`, true);
    }
    return textResult(JSON.stringify({
      taskId: input.taskId, status: 'running',
      message: 'Session resumed. Use amicus_status to check progress.',
    }));
  },

  async amicus_continue(input, project) {
    if (input.model) {
      const modelCheck = tryResolveModel(input.model);
      if (modelCheck.error) {
        return textResult(modelCheck.error, true);
      }
    }

    const cwd = project || getProjectDir(input.project);
    const { generateTaskId } = require('./sidecar/start');
    const newTaskId = generateTaskId();
    // New continuation session → canonical amicus dir (writes).
    const sessionDir = getSessionDir(cwd, newTaskId);

    const args = ['continue', input.taskId, '--prompt', input.prompt,
      '--task-id', newTaskId, '--client', 'cowork', '--cwd', cwd];
    if (input.model) { args.push('--model', input.model); }
    if (input.noUi) { args.push('--no-ui', '--agent', 'build'); }
    if (input.timeout) { args.push('--timeout', String(input.timeout)); }
    if (input.contextTurns)     { args.push('--context-turns', String(input.contextTurns)); }
    if (input.contextMaxTokens) { args.push('--context-max-tokens', String(input.contextMaxTokens)); }
    try { spawnSidecarProcess(args, sessionDir); } catch (err) {
      return textResult(`Failed to continue: ${err.message}`, true);
    }
    return textResult(JSON.stringify({
      taskId: newTaskId, status: 'running',
      message: 'Continuation started. Use amicus_status to check progress.',
    }));
  },

  async amicus_abort(input, project) {
    const cwd = project || getProjectDir(input.project);
    const metadata = readMetadata(input.taskId, cwd);
    if (!metadata) { return textResult(`Session ${input.taskId} not found.`, true); }
    if (metadata.status !== 'running') {
      return textResult(`Session ${input.taskId} is not running (status: ${metadata.status}).`);
    }

    if (metadata.pid) {
      try { process.kill(metadata.pid, 'SIGTERM'); } catch (err) {
        if (err.code !== 'ESRCH') {
          logger.warn('Failed to kill Amicus process', { pid: metadata.pid, error: err.message });
        }
      }
    }
    const sessionDir = safeSessionDir(cwd, input.taskId);
    const metaPath = path.join(sessionDir, 'metadata.json');
    metadata.status = 'aborted';
    metadata.abortedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

    return textResult(JSON.stringify({
      taskId: input.taskId, status: 'aborted',
      message: 'Session abort requested. The Amicus process will terminate shortly.',
    }));
  },

  async amicus_setup() {
    try { spawnSidecarProcess(['setup']); } catch (err) {
      return textResult(`Failed to launch setup: ${err.message}`, true);
    }
    return textResult('Setup wizard launched. The Electron window should appear on your desktop.');
  },
  async amicus_guide() { return textResult(getGuideText()); },
};

// DEPRECATED(amicus-shim): also register each tool under its legacy sidecar_*
// name so existing agent scripts keep working. Remove in a future revision.
const LEGACY_TOOL_ALIASES = {
  amicus_start: 'sidecar_start', amicus_status: 'sidecar_status',
  amicus_read: 'sidecar_read', amicus_list: 'sidecar_list',
  amicus_resume: 'sidecar_resume', amicus_continue: 'sidecar_continue',
  amicus_setup: 'sidecar_setup', amicus_abort: 'sidecar_abort',
  amicus_guide: 'sidecar_guide',
};

/** Start the MCP server on stdio transport */
async function startMcpServer() {
  const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
  const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
  const server = new McpServer({ name: 'amicus', version: require('../package.json').version });

  for (const tool of getTools()) {
    const register = (name) => server.registerTool(
      name,
      { description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations },
      async (input) => {
        try { return await handlers[tool.name](input, getProjectDir(input.project)); }
        catch (err) {
          logger.error(`MCP tool error: ${name}`, { error: err.message });
          return textResult(`Error: ${err.message}`, true);
        }
      }
    );
    register(tool.name);
    if (LEGACY_TOOL_ALIASES[tool.name]) { register(LEGACY_TOOL_ALIASES[tool.name]); }
  }
  process.on('SIGTERM', () => {
    sharedServer.shutdown();
    process.exit(0);
  });
  process.on('SIGINT', () => {
    sharedServer.shutdown();
    process.exit(0);
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[amicus] MCP server running on stdio\n');
}

module.exports = { handlers, startMcpServer, getProjectDir, LEGACY_TOOL_ALIASES };

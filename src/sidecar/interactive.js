/**
 * Sidecar Interactive Mode - Electron GUI session management
 * Extracted from start.js for file size compliance (< 300 lines).
 */

const path = require('path');
const { spawn } = require('child_process');

const { startOpenCodeServer } = require('./session-utils');
const { createSession, sendPromptAsync, getMessages, abortSession } = require('../opencode-client');
const { mapAgentToOpenCode } = require('../utils/agent-mapping');
const { logger } = require('../utils/logger');
const { getCompatEnv } = require('../utils/env-compat');
const { startInteractiveMirror } = require('./interactive-mirror');
const { startAbortWatch, markResultAborted, readAbortedMarker } = require('./interactive-abort');
const { getSessionDir } = require('../session-manager');
const { canonicalProjectPath } = require('../utils/project-path');
const { ensureElectron } = require('./electron-ensure');

/** Resolve the Electron binary path ONLY when the exe actually exists on disk.
 *  #54: path.txt surviving (require('electron') resolving) is NOT enough — a
 *  quarantined/missing dist/<exe> must read as not-installed. Delegates to the
 *  stat-the-exe probe so the runtime check matches postinstall's strictness.
 *  Stays a PURE PROBE: no download/extract side-effect.
 *  @returns {string|null} Full path to a usable Electron binary, or null. */
function getElectronPath() {
  try {
    const { isElectronUsable, resolveElectronBinary } = require('./electron-install');
    return isElectronUsable() ? resolveElectronBinary() : null;
  } catch {
    return null;
  }
}

/** Check if Electron is available (lazy loading guard). Pure probe — stats the
 *  exe via getElectronPath(), never provisions. */
function checkElectronAvailable() {
  return getElectronPath() !== null;
}

/** Build environment variables for Electron process */
function buildElectronEnv(taskId, model, project, nodeModulesBin, existingPath, options = {}) {
  const { agent, isResume, conversation, mcp, client, windowPosition, sessionDirectory } = options;
  const env = {
    ...process.env,
    PATH: `${nodeModulesBin}${path.delimiter}${existingPath}`,
    AMICUS_TASK_ID: taskId,
    AMICUS_MODEL: model,
    SIDECAR_PROJECT: project
  };

  if (client) { env.AMICUS_CLIENT = client; }
  if (windowPosition) { env.AMICUS_WINDOW_POSITION = windowPosition; }
  // The directory the OpenCode session is scoped to (#45). Electron builds the
  // Web-UI route from THIS, not a fresh base64url(CWD) guess, so follow-up
  // prompts resolve the session when process cwd != --cwd.
  if (sessionDirectory) { env.AMICUS_SESSION_DIRECTORY = sessionDirectory; }

  if (agent) {
    const agentConfig = mapAgentToOpenCode(agent);
    env.SIDECAR_AGENT = agentConfig.agent;
    if (agentConfig.permissions) { env.SIDECAR_PERMISSIONS = agentConfig.permissions; }
  }

  if (isResume) {
    env.SIDECAR_RESUME = 'true';
    if (conversation) { env.SIDECAR_CONVERSATION = conversation; }
  }

  if (mcp) { env.SIDECAR_MCP_CONFIG = JSON.stringify(mcp); }

  return env;
}

/** Handle Electron process stdout/stderr and exit */
function handleElectronProcess(electronProcess, taskId, resolve) {
  let stdout = '';

  electronProcess.stdout.on('data', (data) => { stdout += data.toString(); });

  electronProcess.stderr.on('data', (data) => {
    data.toString().trim().split('\n').filter(l => l.trim())
      .forEach(line => logger.debug('Electron', { output: line.trim() }));
  });

  electronProcess.on('error', (error) => {
    logger.error('Electron process error', { error: error.message });
    resolve({
      summary: '', completed: false, timedOut: false, taskId,
      error: `Failed to start Electron: ${error.message}`
    });
  });

  electronProcess.on('close', (code) => {
    logger.debug('Electron closed', { code, stdoutLength: stdout.length });
    resolve({
      summary: stdout.trim() || 'Session ended without summary.',
      completed: code === 0, timedOut: false, taskId, exitCode: code
    });
  });
}

/** Run sidecar in interactive mode (Electron GUI) */
async function runInteractive(model, systemPrompt, userMessage, taskId, project, options = {}) {
  // Lazily PROVISION electron on FIRST GUI use (#55). ensureElectron() is the
  // one place network provisioning is allowed; the probes stay pure. When it
  // returns ok:false the GUI is unavailable — fail gracefully toward --no-ui.
  const ensured = await ensureElectron();
  if (!ensured.ok) {
    logger.error('Electron not available — interactive mode unavailable', { reason: ensured.reason });
    return {
      summary: '', completed: false, timedOut: false, taskId,
      error: `Interactive mode requires electron. ${ensured.reason} (or use --no-ui for headless mode)`
    };
  }

  const { agent, isResume, conversation, mcp, reasoning, opencodeSessionId, client } = options;

  // Scope the OpenCode session to the project/--cwd (#45). The SDK Session
  // object echoes a `directory`, but createSession() returns only the id, so we
  // use the canonicalized --cwd CONSISTENTLY for BOTH the create scope and the
  // Web-UI route — the documented fallback that keeps them matching even when
  // the amicus process cwd != --cwd. undefined when project is falsy → calls
  // stay byte-for-byte identical to before.
  const sessionDirectory = canonicalProjectPath(project);

  // Start OpenCode server with system prompt baked into agent config.
  // Agent config prompts are hidden from the UI, unlike promptAsync's system field.
  const agentConfig = mapAgentToOpenCode(agent);
  let ocClient, server;
  try {
    const result = await startOpenCodeServer(mcp, {
      client, systemPrompt, agentName: agentConfig.agent
    });
    ocClient = result.client;
    server = result.server;
  } catch (error) {
    logger.error('Failed to start OpenCode server', { error: error.message });
    return {
      summary: '', completed: false, timedOut: false, taskId,
      error: `Failed to start server: ${error.message}`
    };
  }

  // Create or reconnect to session
  let sessionId;
  try {
    if (isResume && opencodeSessionId) {
      // Resume: reconnect to existing OpenCode session
      sessionId = opencodeSessionId;
      logger.info('Reconnecting to existing session', { sessionId });
    } else {
      // New session: create and send initial prompt, scoped to --cwd (#45).
      sessionId = await createSession(ocClient, sessionDirectory);

      // System prompt is set on agent config (hidden from UI).
      // Do NOT pass system here — promptAsync's system field is visible in the UI.
      const promptOptions = {
        model,
        parts: [{ type: 'text', text: userMessage }],
        directory: sessionDirectory
      };

      // Always set agent — defaults to 'chat' when not specified
      promptOptions.agent = agentConfig.agent;
      if (reasoning) { promptOptions.reasoning = reasoning; }

      await sendPromptAsync(ocClient, sessionId, promptOptions);
    }
    logger.debug('Interactive session ready', { sessionId, isResume: !!isResume });
  } catch (error) {
    server.close();
    return {
      summary: '', completed: false, timedOut: false, taskId,
      error: `Session setup failed: ${error.message}`
    };
  }

  const serverPort = new URL(server.url).port;

  // Start idle watchdog for interactive mode (60-min default timeout).
  // The real teardown handler is installed BEFORE start() (closes the startup
  // race) and references a closure that is assigned once Electron spawns.
  const { IdleWatchdog } = require('../utils/idle-watchdog');
  const { createActivityPoller, killIfAlive } = require('../utils/activity-poller');
  const { getSessionStatus } = require('../opencode-client');
  let electronProcess = null;
  const watchdog = new IdleWatchdog({
    mode: 'interactive',
    onTimeout: () => {
      logger.info('Interactive idle timeout - shutting down', { taskId });
      killIfAlive(electronProcess);
    },
  }).start();

  // Keep the idle clock from killing an actively-working session: poll OpenCode
  // session status and touch the watchdog on any non-idle (busy/retry) state.
  const activityPoller = createActivityPoller({
    getStatus: () => getSessionStatus(ocClient, sessionId, sessionDirectory),
    onActivity: () => watchdog.touch(),
  });

  const sessionDir = getSessionDir(project, taskId);
  const mirror = startInteractiveMirror({
    getMessages: () => getMessages(ocClient, sessionId, sessionDirectory),
    sessionDir,
    onActivity: () => watchdog.touch(),
  });

  // Phase 3: external aborts (CLI `amicus abort` / MCP amicus_abort) write a
  // metadata marker; nothing in the GUI path watched it before. On marker:
  // server-side abort + SIGTERM Electron; the close handler finishes teardown.
  const abortWatch = startAbortWatch({
    sessionDir,
    abortOpenCodeSession: () => abortSession(ocClient, sessionId, sessionDirectory),
    killElectron: () => killIfAlive(electronProcess),
  });

  return new Promise((resolve, _reject) => {
    // Prefer the path ensureElectron() resolved: a same-process first-use
    // provision can leave require('electron') cached as a stale null (#55).
    const electronPath = ensured.path || getElectronPath();
    const mainPath = path.join(__dirname, '..', '..', 'electron', 'main.js');

    const nodeModulesBin = path.join(__dirname, '..', '..', 'node_modules', '.bin');
    const existingPath = process.env.PATH || '';
    const env = buildElectronEnv(
      taskId, model, project, nodeModulesBin, existingPath,
      { agent, isResume, conversation, mcp, client, sessionDirectory }
    );
    env.AMICUS_OPENCODE_PORT = serverPort;
    env.AMICUS_SESSION_ID = sessionId;

    const debugPort = getCompatEnv('DEBUG_PORT') || '9222';
    logger.debug('Launching Electron', { taskId, model, debugPort, serverPort, sessionId });

    electronProcess = spawn(electronPath, [
      `--remote-debugging-port=${debugPort}`,
      mainPath
    ], { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] });

    // Best-effort: if the parent amicus process dies (exit / Ctrl-C / SIGTERM)
    // before Electron exits, SIGTERM the orphaned child so it doesn't linger.
    // Guarded against double-kill via killIfAlive(); removed in teardown below so
    // the normal close path stays the sole owner of shutdown.
    const killChildOnParentDeath = () => killIfAlive(electronProcess);
    process.on('exit', killChildOnParentDeath);
    process.on('SIGINT', killChildOnParentDeath);
    process.on('SIGTERM', killChildOnParentDeath);

    // Belt-and-suspenders: also touch on raw Electron stdout activity.
    electronProcess.stdout.on('data', () => { watchdog.touch(); });

    // Clean up server + timers when Electron exits.
    handleElectronProcess(electronProcess, taskId, async (result) => {
      process.removeListener('exit', killChildOnParentDeath);
      process.removeListener('SIGINT', killChildOnParentDeath);
      process.removeListener('SIGTERM', killChildOnParentDeath);
      watchdog.cancel();
      activityPoller.stop();
      abortWatch.stop();
      // Close a race the poll-based watch can miss: the marker can land and
      // Electron can exit naturally before the next ~2s tick. Re-read the
      // on-disk marker ONCE here and OR it in so a durable 'aborted' status
      // is never clobbered to 'complete' below (phase-3 final review, FIX 2).
      const wasAborted = abortWatch.wasAborted() || readAbortedMarker(sessionDir);
      markResultAborted(result, wasAborted);
      try {
        const { usage } = await mirror.stop();
        if (usage) { result.usage = usage; }
      } catch (err) { logger.debug('mirror stop failed', { error: err.message }); }
      server.close();
      logger.debug('OpenCode server closed after Electron exit');
      result.opencodeSessionId = sessionId;
      resolve(result);
    });
  });
}

module.exports = {
  getElectronPath,
  checkElectronAvailable,
  buildElectronEnv,
  handleElectronProcess,
  runInteractive
};

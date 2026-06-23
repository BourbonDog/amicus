/**
 * Sidecar Interactive Mode - Electron GUI session management
 * Extracted from start.js for file size compliance (< 300 lines).
 */

const path = require('path');
const { spawn } = require('child_process');

const { startOpenCodeServer } = require('./session-utils');
const { createSession, sendPromptAsync } = require('../opencode-client');
const { mapAgentToOpenCode } = require('../utils/agent-mapping');
const { logger } = require('../utils/logger');
const { getCompatEnv } = require('../utils/env-compat');

/** Get the Electron binary path via require('electron').
 *  Works in all install contexts (global, local, npx hoisted).
 *  @returns {string|null} Full path to Electron binary, or null if not installed */
function getElectronPath() {
  try {
    return require('electron');
  } catch {
    return null;
  }
}

/** Check if Electron is available (lazy loading guard) */
function checkElectronAvailable() {
  return getElectronPath() !== null;
}

/** Build environment variables for Electron process */
function buildElectronEnv(taskId, model, project, nodeModulesBin, existingPath, options = {}) {
  const { agent, isResume, conversation, mcp, client, windowPosition } = options;
  const env = {
    ...process.env,
    PATH: `${nodeModulesBin}${path.delimiter}${existingPath}`,
    AMICUS_TASK_ID: taskId,
    AMICUS_MODEL: model,
    SIDECAR_PROJECT: project
  };

  if (client) { env.AMICUS_CLIENT = client; }
  if (windowPosition) { env.AMICUS_WINDOW_POSITION = windowPosition; }

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
  if (!checkElectronAvailable()) {
    logger.error('Electron not installed — interactive mode unavailable');
    return {
      summary: '', completed: false, timedOut: false, taskId,
      error: 'Interactive mode requires electron. Install with: npm install -g amicus (or use --no-ui for headless mode)'
    };
  }

  const { agent, isResume, conversation, mcp, reasoning, opencodeSessionId, client } = options;

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
      // New session: create and send initial prompt
      sessionId = await createSession(ocClient);

      // System prompt is set on agent config (hidden from UI).
      // Do NOT pass system here — promptAsync's system field is visible in the UI.
      const promptOptions = {
        model,
        parts: [{ type: 'text', text: userMessage }]
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
  const { createActivityPoller } = require('../utils/activity-poller');
  const { getSessionStatus } = require('../opencode-client');
  let electronProcess = null;
  const watchdog = new IdleWatchdog({
    mode: 'interactive',
    onTimeout: () => {
      logger.info('Interactive idle timeout - shutting down', { taskId });
      if (electronProcess && !electronProcess.killed) {
        electronProcess.kill('SIGTERM');
      }
    },
  }).start();

  // Keep the idle clock from killing an actively-working session: poll OpenCode
  // session status and touch the watchdog on any non-idle (busy/retry) state.
  const activityPoller = createActivityPoller({
    getStatus: () => getSessionStatus(ocClient, sessionId),
    onActivity: () => watchdog.touch(),
  });

  return new Promise((resolve, _reject) => {
    const electronPath = getElectronPath();
    const mainPath = path.join(__dirname, '..', '..', 'electron', 'main.js');

    const nodeModulesBin = path.join(__dirname, '..', '..', 'node_modules', '.bin');
    const existingPath = process.env.PATH || '';
    const env = buildElectronEnv(
      taskId, model, project, nodeModulesBin, existingPath,
      { agent, isResume, conversation, mcp, client }
    );
    env.AMICUS_OPENCODE_PORT = serverPort;
    env.AMICUS_SESSION_ID = sessionId;

    const debugPort = getCompatEnv('DEBUG_PORT') || '9222';
    logger.debug('Launching Electron', { taskId, model, debugPort, serverPort, sessionId });

    electronProcess = spawn(electronPath, [
      `--remote-debugging-port=${debugPort}`,
      mainPath
    ], { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] });

    // Belt-and-suspenders: also touch on raw Electron stdout activity.
    electronProcess.stdout.on('data', () => { watchdog.touch(); });

    // Clean up server + timers when Electron exits.
    handleElectronProcess(electronProcess, taskId, (result) => {
      watchdog.cancel();
      activityPoller.stop();
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

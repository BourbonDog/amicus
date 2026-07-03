/**
 * Sidecar Interactive Process Helpers - Electron probe/env/process-exit plumbing
 * Extracted from interactive.js for file size compliance (< 300 lines).
 */

const path = require('path');

const { logger } = require('../utils/logger');

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
  const { client, windowPosition, sessionDirectory, foldNonce } = options;
  const env = {
    ...process.env,
    PATH: `${nodeModulesBin}${path.delimiter}${existingPath}`,
    AMICUS_TASK_ID: taskId,
    AMICUS_MODEL: model
  };

  if (client) { env.AMICUS_CLIENT = client; }
  if (windowPosition) { env.AMICUS_WINDOW_POSITION = windowPosition; }
  // The directory the OpenCode session is scoped to (#45). Electron builds the
  // Web-UI route from THIS, not a fresh base64url(CWD) guess, so follow-up
  // prompts resolve the session when process cwd != --cwd.
  if (sessionDirectory) { env.AMICUS_SESSION_DIRECTORY = sessionDirectory; }
  // 15b.3: per-run fold nonce (#BL-7 residual) — the same value baked into the
  // system prompt's instruction (buildPrompts) so fold.js writes a marker the
  // prompt actually asked for, not the guessable legacy bare `[SIDECAR_FOLD]`.
  if (foldNonce) { env.AMICUS_FOLD_NONCE = foldNonce; }

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

module.exports = {
  getElectronPath,
  checkElectronAvailable,
  buildElectronEnv,
  handleElectronProcess
};

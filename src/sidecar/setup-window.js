/**
 * Setup Window Launcher
 *
 * Spawns the Electron window in setup mode (SIDECAR_MODE=setup)
 * for API key configuration. Waits for the window to close and
 * returns whether setup completed successfully.
 */

const { spawn } = require('child_process');
const path = require('path');
const { logger } = require('../utils/logger');
const { getElectronPath } = require('./interactive');
const { ensureElectron } = require('./electron-ensure');
const { getCompatEnv } = require('../utils/env-compat');

/**
 * Launch the Electron setup window for API key entry.
 * Lazily PROVISIONS electron on first GUI use (#55) via ensureElectron() — the
 * one place network provisioning is allowed; getElectronPath() stays a pure probe.
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function launchSetupWindow() {
  const ensured = await ensureElectron();
  if (!ensured.ok) {
    return { success: false, error: ensured.reason || 'Electron not installed' };
  }
  return new Promise((resolve) => {
    // Prefer the path ensureElectron() resolved: a same-process first-use
    // provision can leave require('electron') cached as a stale null (#55).
    const electronPath = ensured.path || getElectronPath();
    const mainPath = path.join(__dirname, '..', '..', 'electron', 'main.js');

    const env = {
      ...process.env,
      AMICUS_MODE: 'setup'
    };

    const debugPort = getCompatEnv('DEBUG_PORT');
    const args = debugPort
      ? [`--remote-debugging-port=${debugPort}`, mainPath]
      : [mainPath];
    logger.info('Launching setup window', { debugPort: debugPort || 'disabled' });

    const proc = spawn(electronPath, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    proc.stdout.setEncoding('utf-8');
    proc.stdout.on('data', (chunk) => { stdout += chunk; });

    proc.stderr.setEncoding('utf-8');
    proc.stderr.on('data', (chunk) => {
      logger.debug('Setup window stderr', { data: chunk.trim() });
    });

    // A spawn failure (ENOENT/EACCES) emits 'error' and NEVER 'close'. Without
    // this listener the Promise would hang forever and Node would treat the
    // unhandled child 'error' as a crash. Resolve with a clear failure instead.
    proc.on('error', (err) => {
      logger.error('Setup window failed to spawn', { error: err.message });
      resolve({ success: false, error: `Failed to start setup window: ${err.message}` });
    });

    proc.on('close', (code) => {
      logger.info('Setup window closed', { code });

      // Check if setup completed (stdout contains JSON status)
      if (stdout.includes('"status":"complete"')) {
        // Parse enriched JSON for default model and keyCount
        try {
          const jsonLine = stdout.split('\n').find(l => l.includes('"status":"complete"'));
          const data = JSON.parse(jsonLine);
          const result = { success: true };
          if (data.default) { result.default = data.default; }
          if (data.keyCount) { result.keyCount = data.keyCount; }
          resolve(result);
        } catch (_err) {
          resolve({ success: true });
        }
      } else {
        resolve({
          success: false,
          error: 'Setup window closed without completing'
        });
      }
    });
  });
}

module.exports = { launchSetupWindow };

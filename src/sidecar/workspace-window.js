/**
 * Council Workspace launcher (v4.4 §4.3/§4.4) — setup-window.js pattern:
 * ensureElectron() (the one place provisioning is allowed, #55) → spawn
 * electron/main.js in council-workspace mode. Unlike setup (which buffers),
 * this RELAYS child stdout live — the nonced fold block must reach the
 * launching terminal's command output verbatim. Exit code propagates
 * (0 on fold-then-close and on plain close).
 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const { logger } = require('../utils/logger');
const { getElectronPath } = require('./interactive-process');
const { ensureElectron } = require('./electron-ensure');
const { generateFoldNonce } = require('../utils/fold-marker');

/**
 * @param {{project: string, runId?: string}} opts
 * @param {{ensureElectron?: Function, spawn?: Function, nonce?: string}} [deps] test injection
 * @returns {Promise<{code: number, error?: string}>}
 */
async function launchWorkspaceWindow({ project, runId = '' }, deps = {}) {
  const ensure = deps.ensureElectron || ensureElectron;
  const spawnFn = deps.spawn || spawn;
  const ensured = await ensure();
  if (!ensured.ok) {
    return { code: 1, error: ensured.reason || 'Electron not installed' };
  }
  return new Promise((resolve) => {
    const electronPath = ensured.path || getElectronPath();
    const mainPath = path.join(__dirname, '..', '..', 'electron', 'main.js');
    const env = {
      ...process.env,
      AMICUS_MODE: 'council-workspace',
      AMICUS_PROJECT: project,
      AMICUS_RUN_ID: runId || '',
      AMICUS_FOLD_NONCE: deps.nonce || generateFoldNonce(),
    };
    const debugPort = process.env.AMICUS_DEBUG_PORT;
    const args = debugPort ? [`--remote-debugging-port=${debugPort}`, mainPath] : [mainPath];
    logger.info('Launching council workspace', { runId: runId || '(run list)', debugPort: debugPort || 'disabled' });

    const proc = spawnFn(electronPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });

    proc.stdout.setEncoding('utf-8');
    proc.stdout.on('data', (chunk) => { process.stdout.write(chunk); }); // fold relay — live, verbatim
    proc.stderr.setEncoding('utf-8');
    proc.stderr.on('data', (chunk) => { logger.debug('Workspace stderr', { data: String(chunk).trim() }); });

    proc.on('error', (err) => {
      logger.error('Workspace failed to spawn', { error: err.message });
      resolve({ code: 1, error: `Failed to start workspace: ${err.message}` });
    });
    proc.on('close', (code) => {
      logger.info('Workspace closed', { code });
      resolve({ code: code === null ? 1 : code });
    });
  });
}

module.exports = { launchWorkspaceWindow };

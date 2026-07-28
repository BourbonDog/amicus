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

/**
 * v4.5 auto-open: fire-and-forget Workspace launch for the MCP path.
 * DELIBERATELY different from launchWorkspaceWindow above:
 * - never provisions (isElectronUsable check only — ensureElectron can
 *   DOWNLOAD Electron, which auto-open guard 3 forbids);
 * - no stdout relay (the caller may be an MCP stdio server whose stdout IS
 *   the JSON-RPC channel — relaying would corrupt the protocol);
 * - detached + unref, returns immediately (the sibling's promise resolves
 *   only when the window CLOSES, which no request path may wait on).
 * @param {{project: string, runId?: string}} opts
 * @param {{isElectronUsable?: Function, resolveElectronBinary?: Function, spawn?: Function}} [deps]
 * @returns {{launched: boolean, reason?: string}}
 */
function launchWorkspaceWindowDetached({ project, runId = '' }, deps = {}) {
  const usable = deps.isElectronUsable || require('./electron-install').isElectronUsable;
  const resolveExe = deps.resolveElectronBinary || require('./electron-install').resolveElectronBinary;
  const spawnFn = deps.spawn || spawn;
  if (!usable()) { return { launched: false, reason: 'electron-absent' }; }
  const electronPath = resolveExe() || getElectronPath();
  const mainPath = path.join(__dirname, '..', '..', 'electron', 'main.js');
  const env = {
    ...process.env,
    AMICUS_MODE: 'council-workspace',
    AMICUS_PROJECT: project,
    AMICUS_RUN_ID: runId || '',
    AMICUS_FOLD_NONCE: generateFoldNonce(),
  };
  try {
    const proc = spawnFn(electronPath, [mainPath], { env, detached: true, stdio: 'ignore' });
    // Node emits spawn failures (ENOENT/EACCES/corrupt binary) as an async
    // 'error' event on the child; an unlistened ChildProcess 'error' is an
    // uncaught exception. The MCP server (`amicus mcp`) installs no
    // uncaughtException handler (bin/amicus.js only does that for
    // start/continue), so that would kill the JSON-RPC channel. Best-effort:
    // just log it, matching the fire-and-forget contract of this function.
    proc.on('error', (err) => logger.debug('Workspace auto-open child failed (best-effort)', { error: err.message }));
    proc.unref();
    logger.info('Auto-opened council workspace (detached)', { runId: runId || '(run list)' });
    return { launched: true };
  } catch (err) {
    logger.debug('Workspace auto-open spawn failed (best-effort)', { error: err.message });
    return { launched: false, reason: `spawn-failed: ${err.message}` };
  }
}

module.exports = { launchWorkspaceWindow, launchWorkspaceWindowDetached };

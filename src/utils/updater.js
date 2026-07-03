/**
 * Updater Module
 *
 * Self-update functionality for amicus.
 * Checks for new versions via update-notifier and performs
 * updates via npm install -g.
 *
 * Supports AMICUS_MOCK_UPDATE env var for testing:
 *   "available" — getUpdateInfo returns fake update
 *   "updating"  — getUpdateInfo returns fake update
 *   "success"   — performUpdate resolves immediately
 *   "error"     — performUpdate returns failure
 */

const { spawn } = require('child_process');
const path = require('path');
const { logger } = require('./logger');
const { loadUpdateNotifier } = require('./update-notifier-loader');

const pkg = require(path.join(__dirname, '..', '..', 'package.json'));

const MOCK_MODES = ['available', 'updating', 'success', 'error'];
const FAKE_LATEST = '99.0.0';

/** @type {import('update-notifier').UpdateNotifier|null} */
let notifier = null;

/**
 * Check if mock mode is active
 * @returns {string|null} The mock mode or null
 */
function getMockMode() {
  const mode = process.env.AMICUS_MOCK_UPDATE;
  if (mode && MOCK_MODES.includes(mode)) {
    return mode;
  }
  return null;
}

/**
 * Initialize the update checker with package info.
 * Async because update-notifier is ESM-only and must be loaded with a
 * dynamic import(). In mock mode, skips the real update-notifier call.
 * @returns {Promise<void>}
 */
async function initUpdateCheck() {
  const mock = getMockMode();
  if (mock) {
    logger.debug('Update check skipped (mock mode)', { mock });
    return;
  }

  try {
    const mod = await loadUpdateNotifier();
    const updateNotifier = mod.default || mod;
    notifier = updateNotifier({
      pkg: { name: pkg.name, version: pkg.version }
    });
  } catch (err) {
    logger.warn('Failed to initialize update checker', { error: err.message });
  }
}

/**
 * Get update information from the cached check.
 * @returns {{ current: string, latest: string, hasUpdate: boolean }|null}
 */
function getUpdateInfo() {
  const mock = getMockMode();
  if (mock) {
    return {
      current: pkg.version,
      latest: FAKE_LATEST,
      hasUpdate: true
    };
  }

  if (!notifier || !notifier.update) {
    return null;
  }

  return {
    current: notifier.update.current,
    latest: notifier.update.latest,
    hasUpdate: true
  };
}

/**
 * Display update notification via update-notifier's built-in notify.
 * Mentions `amicus update` as the upgrade command.
 */
function notifyUpdate() {
  if (!notifier) {
    return;
  }

  notifier.notify({
    message: 'Update available: {currentVersion} -> {latestVersion}\n' +
      'Run `amicus update` to upgrade'
  });
}

/**
 * Perform the actual update by spawning npm install -g.
 * @returns {Promise<{ success: boolean, newVersion?: string, error?: string }>}
 */
function performUpdate() {
  const mock = getMockMode();

  if (mock === 'success') {
    return Promise.resolve({ success: true, newVersion: FAKE_LATEST });
  }

  if (mock === 'error') {
    return Promise.resolve({
      success: false,
      error: 'Mock update error for testing'
    });
  }

  return new Promise((resolve) => {
    let stderr = '';

    const proc = spawn('npm', ['install', '-g', 'amicus@latest'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true });
      } else {
        resolve({
          success: false,
          error: stderr.trim() || `npm exited with code ${code}`
        });
      }
    });

    proc.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
  });
}

module.exports = {
  initUpdateCheck,
  getUpdateInfo,
  notifyUpdate,
  performUpdate
};

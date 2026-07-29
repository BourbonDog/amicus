/**
 * Workspace Auto-Open Decision Helper
 *
 * Pure helper to determine whether the Council Workspace should auto-open
 * on MCP council runs from Claude Code (local). Returns the decision and reason.
 *
 * Decision order (spec §6 guard 4):
 * 1. uiParam === false → 'param-suppressed' (explicit user request beats everything, checked first)
 * 2. Hard guards (always checked, beat even explicit true):
 *    - !electronUsable → 'electron-absent'
 *    - platform === 'linux' && !env.DISPLAY → 'no-display'
 * 3. uiParam === true → 'ok' (explicit request overrides config and client gate, never hard guards)
 * 4. autoOpenConfig === false → 'config-disabled'
 * 5. client !== 'code-local' → 'client-not-code-local'
 * 6. else → 'ok'
 *
 * @param {object} options
 * @param {string} options.client - The client type (e.g., 'code-local', 'cowork', 'code-web')
 * @param {boolean} options.electronUsable - Whether Electron is available
 * @param {string} options.platform - The platform (e.g., 'win32', 'darwin', 'linux')
 * @param {object} options.env - Environment variables object
 * @param {boolean} options.autoOpenConfig - The config.workspace.autoOpen setting
 * @param {boolean|undefined} options.uiParam - Explicit UI parameter (true, false, or undefined)
 * @returns {{open: boolean, reason: string}}
 */
function shouldAutoOpenWorkspace({
  client,
  electronUsable,
  platform,
  env,
  autoOpenConfig,
  uiParam,
}) {
  // Step 1: uiParam === false beats everything (checked first)
  if (uiParam === false) {
    return { open: false, reason: 'param-suppressed' };
  }

  // Step 2: Hard guards (always checked, beat even explicit uiParam === true)
  if (!electronUsable) {
    return { open: false, reason: 'electron-absent' };
  }

  if (platform === 'linux' && !env.DISPLAY) {
    return { open: false, reason: 'no-display' };
  }

  // Step 3: uiParam === true overrides config and client gate (but not hard guards)
  if (uiParam === true) {
    return { open: true, reason: 'ok' };
  }

  // Step 4: autoOpenConfig === false
  if (autoOpenConfig === false) {
    return { open: false, reason: 'config-disabled' };
  }

  // Step 5: client !== 'code-local'
  if (client !== 'code-local') {
    return { open: false, reason: 'client-not-code-local' };
  }

  // Step 6: else
  return { open: true, reason: 'ok' };
}

module.exports = {
  shouldAutoOpenWorkspace,
};

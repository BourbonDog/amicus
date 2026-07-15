/**
 * IPC Guard Helpers
 *
 * Small, pure helpers extracted from main.js so the security-sensitive bits are
 * unit-testable (main.js itself runs heavy Electron side effects at import).
 *
 *  - isPrivilegedSender: pin privileged IPC handlers to the toolbar window so a
 *    compromised/remote page in the OpenCode WebContentsView cannot invoke them (M9).
 *  - isAllowedContentNavigation: pin the OpenCode WebContentsView to its localhost
 *    origin so it cannot be navigated off to an attacker-controlled page (M9).
 *  - handleFatalException: EPIPE stays a no-op; any other uncaught exception is
 *    logged and then quits the app rather than leaving a wedged invisible shell
 *    (L10).
 */

/**
 * Whether an IPC event originated from the privileged toolbar window.
 * @param {{ sender?: object }} event - The ipcMain event.
 * @param {() => (object|null)} getToolbarWindow - Returns the toolbar BrowserWindow (or null).
 * @returns {boolean} true only when the sender is the toolbar window's webContents.
 */
function isPrivilegedSender(event, getToolbarWindow) {
  const win = getToolbarWindow();
  if (!win || win.isDestroyed?.()) { return false; }
  return Boolean(event && event.sender && event.sender === win.webContents);
}

/**
 * Whether a navigation target is allowed for the OpenCode content WebContentsView.
 * Only the OpenCode localhost origin (any path) is permitted; everything else
 * (external http(s), file:, etc.) is blocked. data: URLs are allowed so the
 * in-app load-error page can render.
 * @param {string} targetUrl - The URL the view is trying to navigate to.
 * @param {string} allowedOrigin - e.g. 'http://localhost:4096'.
 * @returns {boolean}
 */
function isAllowedContentNavigation(targetUrl, allowedOrigin) {
  if (typeof targetUrl !== 'string' || !targetUrl) { return false; }
  if (targetUrl.startsWith('data:')) { return true; }
  try {
    const target = new URL(targetUrl);
    const allowed = new URL(allowedOrigin);
    return target.origin === allowed.origin;
  } catch {
    return false;
  }
}

/**
 * Handle a process 'uncaughtException'. EPIPE is a benign no-op; anything else
 * is logged and then quits the app so a genuinely unexpected error cannot leave
 * an invisible, silently-hung shell.
 * @param {Error & { code?: string }} err
 * @param {{ quit: () => void, log?: (err: Error) => void }} deps
 */
function handleFatalException(err, { quit, log } = {}) {
  if (err && err.code === 'EPIPE') { return; }
  if (log) {
    log(err);
  } else {
    console.error('Uncaught exception:', err);
  }
  if (typeof quit === 'function') { quit(); }
}

module.exports = { isPrivilegedSender, isAllowedContentNavigation, handleFatalException };

/**
 * Sidecar Preload - v3 Minimal
 *
 * Exposes only the fold IPC bridge to the renderer.
 * OpenCode's Web UI handles all other functionality natively.
 */

const { contextBridge, ipcRenderer } = require('electron');

// Bridge exposure needs no DOM and must run before any cosmetic step:
// the CSS injection below once threw at preload-evaluation time and killed
// the script before the bridge was exposed.
contextBridge.exposeInMainWorld('sidecar', {
  /** Trigger fold: summarize and return to Claude Code */
  fold: () => ipcRenderer.invoke('sidecar:fold'),
  /** Open settings wizard in a child window */
  openSettings: () => ipcRenderer.invoke('sidecar:open-settings'),
  /** Check if an update is available */
  getUpdateInfo: () => ipcRenderer.invoke('sidecar:get-update-info'),
  /** Trigger the update process */
  performUpdate: () => ipcRenderer.invoke('sidecar:perform-update'),
  /** Listen for update result */
  onUpdateResult: (callback) => ipcRenderer.on('sidecar:update-result', (_event, data) => callback(data)),
  /** Notify main process to resize toolbar area */
  resizeToolbar: (height) => ipcRenderer.invoke('sidecar:resize-toolbar', height),
});

/**
 * Inject CSS to hide OpenCode branding and match the window background color
 * to prevent a white flash on load. Cosmetic only — must never throw, or it
 * would kill the rest of the preload.
 */
function injectBrandingCss() {
  try {
    const style = document.createElement('style');
    style.textContent = [
      'html, body { background-color: var(--bg, #0a0a0a) !important; }',
      '#root > div > header { display: none !important; }',
      'svg[viewBox="0 0 234 42"] { display: none !important; }',
    ].join('\n');
    document.documentElement.appendChild(style);
  } catch {
    // cosmetic — a failed injection must not break the preload
  }
}

// documentElement is still null while the preload evaluates; defer until the
// DOM exists so the injection cannot null-deref.
if (document.documentElement) {
  injectBrandingCss();
} else {
  document.addEventListener('DOMContentLoaded', injectBrandingCss);
}

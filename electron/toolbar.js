/**
 * Amicus Toolbar HTML Builder
 *
 * Generates the toolbar HTML for the bottom bar of the Electron window.
 * Supports two modes: 'sidecar' (default) and 'setup'.
 */

const { tokenCss } = require('../src/design/tokens');

const TOOLBAR_H = 40;

/**
 * Get the brand name to display
 * @returns {string} Always 'Amicus' — all clients share one brand
 */
function getBrandName() {
  return 'Amicus';
}

/**
 * Build toolbar HTML string
 * @param {object} [options={}]
 * @param {string} [options.mode='sidecar'] - 'sidecar' or 'setup'
 * @param {string} [options.taskId='unknown'] - Task ID to display
 * @param {string} [options.foldShortcut='Cmd+Shift+F'] - Shortcut label
 * @param {string} [options.client='code-local'] - Client type for branding
 * @returns {string} Complete HTML document for the toolbar
 */
function buildToolbarHTML(options = {}) {
  const {
    mode = 'sidecar',
    taskId = 'unknown',
    foldShortcut = 'Cmd+Shift+F',
    client = 'code-local',
    updateInfo = null
  } = options;

  const brandName = getBrandName(client);

  const baseStyles = `
  ${tokenCss({ absoluteFontUrls: true })}
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: ${TOOLBAR_H}px;
    background: var(--surface-1);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 14px;
    font-family: var(--font-sans), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    border-top: 1px solid var(--border);
    -webkit-app-region: no-drag;
    user-select: none;
  }
  .info {
    color: var(--text-2);
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .brand {
    color: var(--accent);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.8px;
    text-transform: uppercase;
  }
  .logo path { stroke: var(--accent); stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: miter; }
  .logo path.brand-main { stroke: var(--gold-400); }
  .sep { color: var(--border-strong); font-size: 14px; }
  .detail, .timer {
    color: var(--text-3);
    font-size: 11px;
    font-family: var(--font-mono), 'SF Mono', Menlo, Monaco, monospace;
  }
  .action-btn {
    padding: 5px 14px;
    background: var(--accent);
    color: var(--on-accent);
    border: none;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
  }
  .action-btn:hover { background: var(--accent-hover); }
  .action-btn:disabled { opacity: 0.5; cursor: default; }
  .icon-btn {
    background: none; border: 1px solid var(--border);
    border-radius: 4px; color: var(--text-2); cursor: pointer;
    font-size: 14px; padding: 3px 8px; transition: all 0.15s;
    display: flex; align-items: center;
  }
  .icon-btn:hover { border-color: var(--accent); color: var(--accent); }
  .right-actions { display: flex; align-items: center; gap: 8px; }
  .update-banner {
    position: fixed;
    bottom: ${TOOLBAR_H}px;
    left: 0;
    right: 0;
    height: 32px;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border-strong);
    display: none;
    align-items: center;
    justify-content: center;
    gap: 10px;
    font-size: 12px;
    color: var(--text-1);
    z-index: 100;
  }
  .update-banner .update-btn {
    padding: 2px 10px;
    background: var(--accent);
    color: var(--on-accent);
    border: none;
    border-radius: 3px;
    font-size: 11px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .update-banner .update-btn:hover { background: var(--accent-hover); }
  .update-banner .update-btn:disabled { opacity: 0.5; cursor: default; }
  .update-banner .dismiss-btn {
    background: none;
    border: none;
    color: var(--text-3);
    cursor: pointer;
    font-size: 14px;
    padding: 0 4px;
  }
  .update-banner .dismiss-btn:hover { color: var(--text-1); }`;

  const logoSvg = `<svg class="logo" width="16" height="16" viewBox="0 0 32 32" fill="none">
      <path d="M4 8H19"/><path d="M4 11H14L19 8"/><path d="M4 14H13L19 8"/>
      <path d="M4 17H12L19 8"/><path d="M4 20H11L19 8"/><path d="M4 23H10L19 8"/>
      <path class="brand-main" d="M19 8H28"/>
    </svg>`;

  if (mode === 'setup') {
    return `<!DOCTYPE html>
<html><head><style>${baseStyles}</style></head><body>
  <div class="info">
    ${logoSvg}
    <span class="brand">${brandName}</span>
  </div>
  <button class="action-btn" id="continue-btn" disabled>Continue</button>
<script>
  document.getElementById('continue-btn').addEventListener('click', function() {
    if (!this.disabled) {
      window.sidecar && window.sidecar.setupDone();
    }
  });
</script>
</body></html>`;
  }

  // Default: sidecar mode
  return `<!DOCTYPE html>
<html><head><style>${baseStyles}</style></head><body>
  <div class="update-banner" id="update-banner">
    <span id="update-text"></span>
    <button class="update-btn" id="update-btn">Update</button>
    <button class="dismiss-btn" id="dismiss-btn">&times;</button>
  </div>
  <div class="info">
    ${logoSvg}
    <span class="brand">${brandName}</span>
    <span class="sep">|</span>
    <span class="detail" title="Task ID — use with: amicus resume ${taskId}">task: ${taskId}</span>
    <span class="sep">|</span>
    <span class="timer" id="timer">0:00</span>
  </div>
  <div class="right-actions">
    <button class="icon-btn" id="settings-btn" title="Settings">&#x2699;</button>
    <button class="action-btn" id="fold-btn">Fold (${foldShortcut})</button>
  </div>
<script>
  var start = Date.now();
  setInterval(function() {
    var s = Math.floor((Date.now() - start) / 1000);
    var m = Math.floor(s / 60);
    s = s % 60;
    document.getElementById('timer').textContent = m + ':' + (s < 10 ? '0' : '') + s;
  }, 1000);
  // contextBridge doesn't work with data: URLs, so use window action flags
  // that the main process polls via executeJavaScript (same pattern as update banner).
  window.__amicusToolbarAction = null;
  document.getElementById('fold-btn').addEventListener('click', function() {
    window.__amicusToolbarAction = 'fold';
  });
  document.getElementById('settings-btn').addEventListener('click', function() {
    window.__amicusToolbarAction = 'open-settings';
  });

  // Update banner logic (data injected at build time, no IPC needed)
  (function() {
    var updateInfo = ${JSON.stringify(updateInfo)};
    if (!updateInfo || !updateInfo.hasUpdate) { return; }

    var banner = document.getElementById('update-banner');
    var text = document.getElementById('update-text');
    var btn = document.getElementById('update-btn');
    var dismiss = document.getElementById('dismiss-btn');

    text.textContent = 'v' + updateInfo.latest + ' available';
    banner.style.display = 'flex';

    // Notify main process to expand toolbar area
    // Uses postMessage since preload contextBridge doesn't work with data: URLs
    window.__amicusUpdateAction = null;
    btn.addEventListener('click', function() {
      btn.disabled = true;
      btn.textContent = 'Updating...';
      dismiss.style.display = 'none';
      window.__amicusUpdateAction = 'perform-update';
    });

    dismiss.addEventListener('click', function() {
      banner.style.display = 'none';
      window.__amicusUpdateAction = 'dismiss';
    });
  })();
</script>
</body></html>`;
}

module.exports = { buildToolbarHTML, TOOLBAR_H, getBrandName };

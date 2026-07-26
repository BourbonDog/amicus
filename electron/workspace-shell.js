/**
 * Council Workspace window (v4.4 §4.1/§4.2) — the third Electron mode's
 * BrowserWindow. One window, no WebContentsView split: the workspace is a
 * single first-party page. Extracted from main.js (grandfathered size) so
 * the posture is source-testable.
 *
 * H9 posture: this page renders untrusted model prose, so it is the MOST
 * locked-down page in the app — full sandbox, minimal preload, CSP in the
 * page itself, and it never navigates or opens windows.
 *
 * Close semantics (spec §7 resolved Q3): NO auto-fold on close — closing a
 * viewer discards nothing (all artifacts are on disk). The only guard is the
 * in-flight fold-write latch supplied by ipc-workspace's gate.
 */
'use strict';

const path = require('path');
const { BrowserWindow } = require('electron');
const { TOKENS } = require('../src/design/tokens');
// ⚠️ DE-ROT (F31): shipped guard for exactly this show:false hazard — reuse, don't
// re-invent (electron/load-failsafe.js:27, paired with show:false at main.js:210-232).
const { attachLoadFailsafe } = require('./load-failsafe');
const { logger } = require('../src/utils/logger');

const ICON_PATH = path.join(__dirname, 'assets', 'icon.png');

/**
 * @param {{runId?: string, gate: {isWriting: () => boolean, noteBlockedClose: () => void}, headless?: boolean}} opts
 * @returns {BrowserWindow}
 */
function createWorkspaceWindow({ runId, gate, headless }) {
  const win = new BrowserWindow({
    width: 1100, height: 800, minWidth: 860, minHeight: 600,
    show: false,
    frame: true, backgroundColor: TOKENS.bg,
    title: 'Amicus Council Workspace',
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload-workspace.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });

  win.webContents.on('will-navigate', (event) => { event.preventDefault(); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('page-title-updated', (e) => e.preventDefault());

  // ⚠️ DE-ROT (F31): attach BEFORE loadFile. onFail shows the window anyway (so the
  // user sees an empty-but-present shell instead of nothing) and logs the reason;
  // default timeout is 15s (load-failsafe.js:19). No buildLoadErrorHTML here — the
  // workspace page is first-party and CSP-locked, so just surface + log.
  const failsafe = attachLoadFailsafe({
    webContents: win.webContents,
    onFail: ({ reason, errorCode, errorDescription, validatedURL }) => {
      logger.error('Council Workspace page failed to load', {
        reason, errorCode, errorDescription, validatedURL, runId: runId || ''
      });
      if (!headless && !win.isDestroyed()) { win.show(); }
    },
  });

  // ⚠️ CODE REVIEW: loadFile() rejects on load failure (and, until Task 11 lands
  // workspace-ui/index.html, on EVERY launch). The failsafe above already surfaces
  // and logs the failure, so swallow the rejection itself rather than leaving an
  // unhandled rejection in the main process (precedent: main.js's own
  // .loadURL(...).catch(() => {})).
  win.loadFile(path.join(__dirname, 'workspace-ui', 'index.html'), { query: { runId: runId || '' } })
    .catch(() => {});

  win.once('ready-to-show', () => {
    failsafe.cancel(); // disarm on the success path
    if (!headless) { win.show(); }
  });

  win.on('close', (event) => {
    if (gate && gate.isWriting()) {
      event.preventDefault();
      gate.noteBlockedClose();
    }
  });

  return win;
}

module.exports = { createWorkspaceWindow };

/**
 * M9 wiring regression (source-level): main.js runs heavy Electron side effects
 * at import, so we assert the security wiring by inspecting the source rather
 * than booting the shell. Runtime behavior of the guards themselves is covered
 * by tests/electron/ipc-guard.test.js.
 */

const fs = require('fs');
const path = require('path');

const MAIN = fs.readFileSync(path.join(__dirname, '..', '..', 'electron', 'main.js'), 'utf-8');

describe('main.js M9 security wiring', () => {
  test('the content WebContentsView uses the minimal preload, not the bridge preload', () => {
    // The WebContentsView block must reference preload-content.js.
    const viewBlock = MAIN.slice(MAIN.indexOf('new WebContentsView('));
    expect(viewBlock).toContain("preload-content.js");
  });

  test('the toolbar/main window keeps preload.js', () => {
    const winBlock = MAIN.slice(
      MAIN.indexOf('new BrowserWindow('),
      MAIN.indexOf('new WebContentsView(')
    );
    expect(winBlock).toContain("preload.js");
    expect(winBlock).not.toContain("preload-content.js");
  });

  test('the content view guards navigation and window-open', () => {
    expect(MAIN).toContain("opencodeView.webContents.on('will-navigate'");
    expect(MAIN).toContain('isAllowedContentNavigation');
    expect(MAIN).toContain('setWindowOpenHandler');
  });

  test('every privileged sidecar IPC handler validates the sender', () => {
    for (const channel of [
      'sidecar:fold',
      'sidecar:open-settings',
      'sidecar:get-update-info',
      'sidecar:perform-update',
      'sidecar:resize-toolbar',
    ]) {
      const idx = MAIN.indexOf(`ipcMain.handle('${channel}'`);
      expect(idx).toBeGreaterThan(-1);
      // The handler body (up to the next ipcMain.handle or 800 chars) must gate on the sender.
      const body = MAIN.slice(idx, idx + 800);
      expect(body).toMatch(/fromToolbar\(event\)/);
    }
  });
});

describe('preload-content.js', () => {
  const SRC = fs.readFileSync(
    path.join(__dirname, '..', '..', 'electron', 'preload-content.js'),
    'utf-8'
  );

  test('exposes NO contextBridge / privileged IPC to the OpenCode page', () => {
    expect(SRC).not.toContain('exposeInMainWorld');
    expect(SRC).not.toContain('ipcRenderer');
  });

  test('still injects branding CSS (flash prevention preserved)', () => {
    expect(SRC).toContain('injectBrandingCss');
    expect(SRC).toContain('background-color');
  });
});

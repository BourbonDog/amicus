/**
 * Electron Toolbar E2E Integration Test
 *
 * Spawns a real Electron sidecar window (hidden via AMICUS_HEADLESS_TEST),
 * connects via Chrome DevTools Protocol, and asserts toolbar DOM state.
 *
 * Requires OPENROUTER_API_KEY for real OpenCode server.
 * On Linux without DISPLAY, auto-launches Xvfb.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { CdpClient } = require('./helpers/cdp-client');

// require('electron') from plain Node returns the absolute path to the real
// binary (dist/electron.exe on Windows). The previous node_modules/.bin shim
// path silently ENOENT'd on Windows spawn() — .cmd shims need shell:true, and
// the unhandled 'error' event made it look like a CDP "target not found".
const ELECTRON_BIN = (() => { try { return require('electron'); } catch { return null; } })();
const ELECTRON_MAIN = path.join(__dirname, '..', 'electron', 'main.js');
const SERVER_HELPER = path.join(__dirname, 'helpers', 'start-server.js');
const CDP_PORT = 9224;

const HAS_API_KEY = !!(
  process.env.OPENROUTER_API_KEY ||
  (() => {
    try {
      const envPath = path.join(os.homedir(), '.config', 'sidecar', '.env');
      const content = fs.readFileSync(envPath, 'utf-8');
      return content.includes('OPENROUTER_API_KEY=');
    } catch { return false; }
  })()
);

const HAS_ELECTRON = (() => {
  try {
    require.resolve('electron');
    return true;
  } catch { return false; }
})();

const describeE2E = (HAS_API_KEY && HAS_ELECTRON) ? describe : describe.skip;

function ensureDisplay() {
  if (process.platform !== 'linux' || process.env.DISPLAY) {
    return { display: process.env.DISPLAY, cleanup: () => {} };
  }
  const display = ':99';
  let xvfbProcess;
  try {
    xvfbProcess = spawn('Xvfb', [display, '-screen', '0', '1280x720x24', '-nolisten', 'tcp'], {
      stdio: 'ignore', detached: true,
    });
    xvfbProcess.unref();
  } catch (err) {
    throw new Error(`Xvfb not found. Install with: apt-get install xvfb. Error: ${err.message}`);
  }
  return {
    display,
    cleanup: () => { try { xvfbProcess.kill(); } catch { /* already dead */ } }
  };
}

/**
 * Start a real OpenCode server in a child process to avoid ESM import issues
 * in Jest. The helper script outputs JSON with { port, sessionId } on stdout.
 * Returns the server child process (kill it to stop the server).
 */
function startRealServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER_HELPER], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';
    let resolved = false;

    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Server helper timed out. stderr: ${stderr}`));
    }, 25000);

    // The helper prints a single JSON line then stays alive
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (resolved) { return; }
      // Try to parse on each chunk in case it arrives in pieces
      try {
        const info = JSON.parse(stdout.trim());
        resolved = true;
        clearTimeout(timeout);
        resolve({
          port: info.port,
          sessionId: info.sessionId,
          process: child,
          cleanup: () => {
            try { child.kill('SIGTERM'); } catch { /* already dead */ }
          }
        });
      } catch {
        // Not complete JSON yet, wait for more data
      }
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (!resolved && code !== 0 && code !== null) {
        reject(new Error(`Server helper exited with code ${code}. stderr: ${stderr}`));
      }
    });
  });
}

function spawnElectron(options) {
  const { opencodePort, sessionId, taskId, display, extraEnv = {} } = options;
  const env = {
    ...process.env,
    AMICUS_OPENCODE_PORT: String(opencodePort),
    AMICUS_SESSION_ID: sessionId,
    AMICUS_TASK_ID: taskId,
    AMICUS_MODEL: 'test-model',
    AMICUS_DEBUG_PORT: String(CDP_PORT),
    AMICUS_HEADLESS_TEST: '1',
    AMICUS_CWD: process.cwd(),
    ...extraEnv,
  };
  if (display) { env.DISPLAY = display; }

  return spawn(ELECTRON_BIN, [
    `--remote-debugging-port=${CDP_PORT}`,
    ELECTRON_MAIN
  ], { env, stdio: ['ignore', 'pipe', 'pipe'] });
}

describeE2E('Electron Toolbar E2E (CDP)', () => {
  let serverInfo;
  let displayInfo;
  let electronProcess;
  let cdp;
  const taskId = 'e2e-toolbar-test';

  beforeAll(async () => {
    displayInfo = ensureDisplay();
    serverInfo = await startRealServer();
    electronProcess = spawnElectron({
      opencodePort: serverInfo.port,
      sessionId: serverInfo.sessionId,
      taskId,
      display: displayInfo.display,
    });
    cdp = await CdpClient.toolbar(CDP_PORT, 20000);
  }, 30000);

  afterAll(async () => {
    if (cdp) { cdp.close(); }
    if (electronProcess) {
      electronProcess.kill('SIGTERM');
      await new Promise(resolve => {
        electronProcess.on('close', resolve);
        setTimeout(() => {
          try { electronProcess.kill('SIGKILL'); } catch { /* already dead */ }
          resolve();
        }, 3000);
      });
    }
    if (serverInfo) {
      serverInfo.cleanup();
      // Wait for server process to actually exit
      await new Promise(resolve => {
        if (serverInfo.process.exitCode !== null) { resolve(); return; }
        serverInfo.process.on('close', resolve);
        setTimeout(() => {
          try { serverInfo.process.kill('SIGKILL'); } catch { /* already dead */ }
          resolve();
        }, 3000);
      });
    }
    if (displayInfo) { displayInfo.cleanup(); }
  });

  it('renders brand name', async () => {
    await cdp.waitForSelector('.brand');
    const brand = await cdp.evaluate(`document.querySelector('.brand')?.textContent`);
    // Pre-rebrand this pinned 'Sidecar'; the suite was dead on Windows (spawn
    // shim ENOENT) from before the Amicus rename, so it never caught the drift.
    expect(brand).toContain('Amicus');
  });

  it('displays task ID', async () => {
    const detail = await cdp.evaluate(`document.querySelector('.detail')?.textContent`);
    expect(detail).toContain(taskId);
  });

  it('timer ticks after 2 seconds', async () => {
    const t1 = await cdp.evaluate(`document.getElementById('timer')?.textContent`);
    await new Promise(r => setTimeout(r, 2500));
    const t2 = await cdp.evaluate(`document.getElementById('timer')?.textContent`);
    expect(t1).not.toEqual(t2);
  });

  it('fold button exists with shortcut label', async () => {
    const text = await cdp.evaluate(`document.getElementById('fold-btn')?.textContent`);
    expect(text).toContain('Fold');
  });

  it('settings gear button exists', async () => {
    const exists = await cdp.evaluate(`!!document.getElementById('settings-btn')`);
    expect(exists).toBe(true);
  });

  it('update banner is hidden by default', async () => {
    const display = await cdp.evaluate(`document.getElementById('update-banner')?.style?.display`);
    expect(display).not.toBe('flex');
  });

  it('captures toolbar screenshot', async () => {
    const screenshotDir = path.join(__dirname, 'screenshots');
    if (!fs.existsSync(screenshotDir)) { fs.mkdirSync(screenshotDir, { recursive: true }); }
    const filePath = path.join(screenshotDir, 'toolbar-default.png');
    await cdp.screenshot(filePath);
    expect(fs.existsSync(filePath)).toBe(true);
    const buf = fs.readFileSync(filePath);
    expect(buf.length).toBeGreaterThan(100);
    expect(buf[0]).toBe(0x89);
    process.stderr.write(`  [electron-e2e] Screenshot: ${filePath}\n`);
  });
});

describeE2E('Electron Toolbar E2E: Update Banner (CDP)', () => {
  let serverInfo;
  let displayInfo;
  let electronProcess;
  let cdp;

  beforeAll(async () => {
    displayInfo = ensureDisplay();
    serverInfo = await startRealServer();
    electronProcess = spawnElectron({
      opencodePort: serverInfo.port,
      sessionId: serverInfo.sessionId,
      taskId: 'e2e-update-test',
      display: displayInfo.display,
      extraEnv: { AMICUS_MOCK_UPDATE: 'available' },
    });
    cdp = await CdpClient.toolbar(CDP_PORT, 20000);
  }, 30000);

  afterAll(async () => {
    if (cdp) { cdp.close(); }
    if (electronProcess) {
      electronProcess.kill('SIGTERM');
      await new Promise(resolve => {
        electronProcess.on('close', resolve);
        setTimeout(() => {
          try { electronProcess.kill('SIGKILL'); } catch { /* already dead */ }
          resolve();
        }, 3000);
      });
    }
    if (serverInfo) {
      serverInfo.cleanup();
      await new Promise(resolve => {
        if (serverInfo.process.exitCode !== null) { resolve(); return; }
        serverInfo.process.on('close', resolve);
        setTimeout(() => {
          try { serverInfo.process.kill('SIGKILL'); } catch { /* already dead */ }
          resolve();
        }, 3000);
      });
    }
    if (displayInfo) { displayInfo.cleanup(); }
  });

  it('update banner is visible when update available', async () => {
    await cdp.waitForSelector('#update-banner');
    const display = await cdp.evaluate(`document.getElementById('update-banner')?.style?.display`);
    expect(display).toBe('flex');
  });

  it('update banner shows version text', async () => {
    const text = await cdp.evaluate(`document.getElementById('update-text')?.textContent`);
    expect(text).toContain('available');
  });

  it('captures update banner screenshot', async () => {
    const screenshotDir = path.join(__dirname, 'screenshots');
    if (!fs.existsSync(screenshotDir)) { fs.mkdirSync(screenshotDir, { recursive: true }); }
    const filePath = path.join(screenshotDir, 'toolbar-update-banner.png');
    await cdp.screenshot(filePath);
    expect(fs.existsSync(filePath)).toBe(true);
    process.stderr.write(`  [electron-e2e] Screenshot: ${filePath}\n`);
  });
});

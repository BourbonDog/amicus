/**
 * Tests for src/sidecar/setup-window.js
 *
 * Tests the launchSetupWindow function that spawns Electron in setup mode.
 * Verifies enriched JSON result parsing (status, default model, keyCount).
 */

const { spawn } = require('child_process');

jest.mock('child_process');
jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));
jest.mock('../../src/sidecar/interactive', () => ({
  getElectronPath: () => '/mock/path/to/Electron',
  checkElectronAvailable: () => true,
}));
// #55: launchSetupWindow now lazily provisions electron via ensureElectron().
// Mock it usable so the spawn path runs without any real provisioning.
jest.mock('../../src/sidecar/electron-ensure', () => ({
  ensureElectron: jest.fn(async () => ({ ok: true, path: '/mock/path/to/Electron' })),
}));

const { launchSetupWindow } = require('../../src/sidecar/setup-window');

// ensureElectron() is awaited BEFORE spawn, so spawn + its listeners are wired
// on a later microtask. Flush the queue so the synchronous callback lookups
// below find the registered handlers (#55).
const flush = () => new Promise((r) => setImmediate(r));

describe('setup-window', () => {
  let mockProcess;

  beforeEach(() => {
    mockProcess = {
      stdout: {
        on: jest.fn(),
        setEncoding: jest.fn()
      },
      stderr: {
        on: jest.fn(),
        setEncoding: jest.fn()
      },
      on: jest.fn()
    };
    spawn.mockReturnValue(mockProcess);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should spawn Electron with AMICUS_MODE=setup', async () => {
    const promise = launchSetupWindow();
    await flush();

    const dataCallback = mockProcess.stdout.on.mock.calls.find(c => c[0] === 'data')[1];
    dataCallback('{"status":"complete","default":"gemini","keyCount":2}\n');

    const closeCallback = mockProcess.on.mock.calls.find(c => c[0] === 'close')[1];
    closeCallback(0);

    const result = await promise;

    expect(spawn).toHaveBeenCalled();
    const spawnArgs = spawn.mock.calls[0];
    // Debug port is opt-in: without AMICUS_DEBUG_PORT, only main.js is passed
    expect(spawnArgs[1][0]).toContain('main.js');

    const env = spawnArgs[2].env;
    expect(env.AMICUS_MODE).toBe('setup');

    expect(result.success).toBe(true);
  });

  it('should pass --remote-debugging-port when AMICUS_DEBUG_PORT is set', async () => {
    process.env.AMICUS_DEBUG_PORT = '9333';
    spawn.mockClear();
    spawn.mockReturnValue(mockProcess);

    const promise = launchSetupWindow();
    await flush();

    const dataCallback = mockProcess.stdout.on.mock.calls.find(c => c[0] === 'data')[1];
    dataCallback('{"status":"complete"}\n');

    const closeCallback = mockProcess.on.mock.calls.find(c => c[0] === 'close')[1];
    closeCallback(0);

    await promise;

    const spawnArgs = spawn.mock.calls[0];
    expect(spawnArgs[1][0]).toBe('--remote-debugging-port=9333');
    expect(spawnArgs[1][1]).toContain('main.js');
    delete process.env.AMICUS_DEBUG_PORT;
  });

  it('should parse enriched JSON with default model and keyCount', async () => {
    const promise = launchSetupWindow();
    await flush();

    const dataCallback = mockProcess.stdout.on.mock.calls.find(c => c[0] === 'data')[1];
    dataCallback('{"status":"complete","default":"gemini-pro","keyCount":3}\n');

    const closeCallback = mockProcess.on.mock.calls.find(c => c[0] === 'close')[1];
    closeCallback(0);

    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.default).toBe('gemini-pro');
    expect(result.keyCount).toBe(3);
  });

  it('should handle legacy JSON without default/keyCount', async () => {
    const promise = launchSetupWindow();
    await flush();

    const dataCallback = mockProcess.stdout.on.mock.calls.find(c => c[0] === 'data')[1];
    dataCallback('{"status":"complete"}\n');

    const closeCallback = mockProcess.on.mock.calls.find(c => c[0] === 'close')[1];
    closeCallback(0);

    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.default).toBeUndefined();
    expect(result.keyCount).toBeUndefined();
  });

  it('should resolve with failure when Electron exits non-zero', async () => {
    const promise = launchSetupWindow();
    await flush();

    const closeCallback = mockProcess.on.mock.calls.find(c => c[0] === 'close')[1];
    closeCallback(1);

    const result = await promise;
    expect(result).toEqual({ success: false, error: 'Setup window closed without completing' });
  });

  it('should resolve with failure when Electron exits without output', async () => {
    const promise = launchSetupWindow();
    await flush();

    const closeCallback = mockProcess.on.mock.calls.find(c => c[0] === 'close')[1];
    closeCallback(0);

    const result = await promise;
    expect(result).toEqual({ success: false, error: 'Setup window closed without completing' });
  });

  it('should resolve (not hang) when spawn emits an error (ENOENT/EACCES)', async () => {
    const promise = launchSetupWindow();
    await flush();

    // A spawn failure emits 'error' and NEVER 'close'. Without an error handler
    // this Promise would hang forever; assert it resolves with a clear failure.
    const errorCallback = mockProcess.on.mock.calls.find(c => c[0] === 'error')[1];
    errorCallback(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }));

    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('spawn ENOENT');
  });

  it('should use the ensureElectron()-resolved path for the electron binary', async () => {
    launchSetupWindow();
    await flush();

    const electronPath = spawn.mock.calls[0][0];
    expect(electronPath).toBe('/mock/path/to/Electron');
  });

  it('should resolve with failure when electron cannot be provisioned (#55)', async () => {
    jest.resetModules();
    jest.mock('child_process');
    jest.mock('../../src/utils/logger', () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
    }));
    jest.mock('../../src/sidecar/interactive', () => ({
      getElectronPath: () => null,
      checkElectronAvailable: () => false,
    }));
    // ensureElectron() defers/fails — the GUI is unavailable.
    jest.mock('../../src/sidecar/electron-ensure', () => ({
      ensureElectron: jest.fn(async () => ({ ok: false, reason: 'Electron not installed' })),
    }));
    const { launchSetupWindow: freshLaunch } = require('../../src/sidecar/setup-window');

    const result = await freshLaunch();
    expect(result).toEqual({ success: false, error: 'Electron not installed' });
  });
});

'use strict';

// Task 13 (v4.2 §4.6): Electron wizard local-server probe + save IPC handlers.
// Mirrors the F2e injectable-ipcMain pattern used by the CLI's handleProvider
// tests, but here the injection point is registerSetupHandlers's own second
// parameter (C9 ruling) rather than a jest.mock('electron', ...) — both
// probe and save handlers are exercised against real src/utils machinery
// (local-providers/local-probe/api-key-store/config), not hand-rolled here.

describe('ipc-setup: local probe handler', () => {
  afterEach(() => jest.resetModules());

  test('the probe handler returns model count for a reachable endpoint', async () => {
    jest.resetModules();
    jest.doMock('../../src/utils/local-probe', () => ({
      probeLocalProvider: jest.fn().mockResolvedValue({ status: 'ok', models: ['ollama/a', 'ollama/b'] }),
    }));
    const handlers = {};
    const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; } };
    const { registerSetupHandlers } = require('../../electron/ipc-setup');
    registerSetupHandlers(() => ({}), { ipcMain });
    const res = await handlers['setup:probe-local']({}, { baseURL: 'http://127.0.0.1:11434/v1', flavor: 'ollama' });
    expect(res.ok).toBe(true);
    expect(res.count).toBe(2);
  });

  test('the probe handler reports unreachable without throwing', async () => {
    jest.resetModules();
    jest.doMock('../../src/utils/local-probe', () => ({
      probeLocalProvider: jest.fn().mockResolvedValue({ status: 'unreachable', models: [] }),
    }));
    const handlers = {};
    const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; } };
    require('../../electron/ipc-setup').registerSetupHandlers(() => ({}), { ipcMain });
    const res = await handlers['setup:probe-local']({}, { baseURL: 'http://127.0.0.1:1/v1', flavor: 'generic' });
    expect(res.ok).toBe(false);
  });

  test('the probe handler rejects a bad scheme before ever probing (validateProviderEntry gate)', async () => {
    jest.resetModules();
    const probeLocalProvider = jest.fn();
    jest.doMock('../../src/utils/local-probe', () => ({ probeLocalProvider }));
    const handlers = {};
    const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; } };
    require('../../electron/ipc-setup').registerSetupHandlers(() => ({}), { ipcMain });
    const res = await handlers['setup:probe-local']({}, { baseURL: 'ftp://nope', flavor: 'generic' });
    expect(res.ok).toBe(false);
    expect(probeLocalProvider).not.toHaveBeenCalled();
  });

  test('the probe handler never leaks the bearer/Authorization value into its response', async () => {
    jest.resetModules();
    jest.doMock('../../src/utils/local-probe', () => ({
      probeLocalProvider: jest.fn().mockResolvedValue({ status: 'ok', models: ['lab/x'] }),
    }));
    const handlers = {};
    const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; } };
    require('../../electron/ipc-setup').registerSetupHandlers(() => ({}), { ipcMain });
    const res = await handlers['setup:probe-local'](
      {}, { baseURL: 'http://127.0.0.1:8000/v1', flavor: 'vllm', bearer: 'sk-top-secret' }
    );
    expect(JSON.stringify(res)).not.toContain('sk-top-secret');
    expect(JSON.stringify(res)).not.toContain('Authorization');
  });
});

describe('ipc-setup: local save handler', () => {
  const os = require('os');
  const path = require('path');
  const fs = require('fs');

  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // ENV ISOLATION (mandatory, per Task-13 ruling): restore every env var
    // touched below, including AMICUS_CONFIG_DIR/AMICUS_ENV_DIR that tmpHome()
    // deletes but the base fixture may never have set in the first place —
    // `process.env = originalEnv` (mirrors tests/ipc-setup-provider-default.test.js)
    // is the only reassignment that undoes a delete as well as a set.
    process.env = originalEnv;
    jest.resetModules();
  });

  /**
   * Sandboxes BOTH config.js's getConfigDir() and api-key-store's getEnvPath():
   * both fall back to HOME/USERPROFILE when their own override
   * (AMICUS_CONFIG_DIR / AMICUS_ENV_DIR respectively) is unset, so a real
   * sandbox requires clearing both overrides in addition to pointing
   * HOME/USERPROFILE at a fresh mkdtemp dir. Deleting only AMICUS_ENV_DIR
   * (as an earlier draft of this test did) leaves AMICUS_CONFIG_DIR free to
   * point config.js at the developer's real ~/.config/amicus — the exact
   * leak this isolation is required to prevent.
   */
  function tmpHome() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saveloc-'));
    process.env.HOME = dir; process.env.USERPROFILE = dir;
    delete process.env.AMICUS_CONFIG_DIR;
    delete process.env.AMICUS_ENV_DIR;
    delete process.env.LAB_API_KEY;
    fs.mkdirSync(path.join(dir, '.config', 'amicus'), { recursive: true });
    return dir;
  }
  const readConfig = (dir) => JSON.parse(fs.readFileSync(path.join(dir, '.config', 'amicus', 'config.json'), 'utf-8'));

  function register() {
    const handlers = {};
    const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; } };
    require('../../electron/ipc-setup').registerSetupHandlers(() => ({}), { ipcMain });
    return handlers;
  }

  test('save handler validates, writes config.providers[id], persists bearer to .env (never in config)', async () => {
    const dir = tmpHome();
    jest.resetModules();
    const handlers = register();
    const res = await handlers['setup:save-local-provider']({}, {
      id: 'lab', baseURL: 'https://10.0.0.5:8000/v1', flavor: 'vllm', bearer: 'sk-secret',
    });
    expect(res.ok).toBe(true);
    const cfg = readConfig(dir);
    expect(cfg.providers.lab.baseURL).toBe('https://10.0.0.5:8000/v1');
    expect(cfg.providers.lab.flavor).toBe('vllm');
    expect(cfg.providers.lab.apiKeyEnv).toBe('LAB_API_KEY');
    expect(cfg.default).toBeUndefined(); // B7/D4: applyProviderDefault is the sole config.default writer
    expect(JSON.stringify(cfg)).not.toContain('sk-secret'); // bearer never in config.json
    const env = fs.readFileSync(path.join(dir, '.config', 'amicus', '.env'), 'utf-8');
    expect(env).toContain('LAB_API_KEY=sk-secret');
    expect(res.warning).toBeUndefined(); // https -- never cleartext, no warning
  });

  // Security posture parity with Task 10's CLI (cli-handlers-provider.js's doAdd):
  // a bearer over plain http to a non-loopback host travels in cleartext and warns,
  // but the save itself is never blocked by the warning (informational only).
  test('save handler warns (but still saves) on a bearer over plain http to a non-loopback host', async () => {
    tmpHome();
    jest.resetModules();
    const handlers = register();
    const res = await handlers['setup:save-local-provider']({}, {
      id: 'remotelab', baseURL: 'http://10.0.0.9:8000/v1', flavor: 'vllm', bearer: 'sk-plain',
    });
    expect(res.ok).toBe(true);
    expect(res.warning).toMatch(/cleartext/i);
  });

  test('save handler does NOT warn for a bearer over http to a loopback host (127.0.0.1)', async () => {
    tmpHome();
    jest.resetModules();
    const handlers = register();
    const res = await handlers['setup:save-local-provider']({}, {
      id: 'locallab', baseURL: 'http://127.0.0.1:8000/v1', flavor: 'vllm', bearer: 'sk-local',
    });
    expect(res.ok).toBe(true);
    expect(res.warning).toBeUndefined();
  });

  test('save handler writes a bearer-less LM Studio entry (parity) without an apiKeyEnv', async () => {
    const dir = tmpHome();
    jest.resetModules();
    const handlers = register();
    const res = await handlers['setup:save-local-provider']({}, {
      id: 'lmstudio', baseURL: 'http://127.0.0.1:1234/v1', flavor: 'lmstudio',
    });
    expect(res.ok).toBe(true);
    const cfg = readConfig(dir);
    expect(cfg.providers.lmstudio.baseURL).toBe('http://127.0.0.1:1234/v1');
    expect(cfg.providers.lmstudio.apiKeyEnv).toBeUndefined();
    expect(fs.existsSync(path.join(dir, '.config', 'amicus', '.env'))).toBe(false); // no bearer written
  });

  test('save handler rejects an invalid entry (bad scheme) and writes nothing', async () => {
    const dir = tmpHome();
    jest.resetModules();
    const handlers = register();
    const res = await handlers['setup:save-local-provider']({}, { id: 'lab', baseURL: 'ftp://nope', flavor: 'generic' });
    expect(res.ok).toBe(false);
    // Handler returns before saveConfig → no config.json written at all.
    expect(fs.existsSync(path.join(dir, '.config', 'amicus', 'config.json'))).toBe(false);
  });

  test('save handler rejects a reserved / malformed id', async () => {
    tmpHome();
    jest.resetModules();
    const handlers = register();
    const reserved = await handlers['setup:save-local-provider']({}, { id: 'openai', baseURL: 'http://127.0.0.1:1234/v1', flavor: 'lmstudio' });
    expect(reserved.ok).toBe(false);
    const bad = await handlers['setup:save-local-provider']({}, { id: 'BAD ID', baseURL: 'http://127.0.0.1:1234/v1', flavor: 'lmstudio' });
    expect(bad.ok).toBe(false);
  });

  // Prototype-chain discipline (mirrors the recurring v4.2 'constructor' bug class
  // already guarded in local-providers.js/config.js): a provider literally named
  // 'constructor' is a valid, non-reserved id (ID_RE matches, RESERVED_IDS.includes
  // is a real Array method, not a prototype walk) and must save like any other id.
  test("a provider id of 'constructor' is valid and round-trips through config.providers", async () => {
    const dir = tmpHome();
    jest.resetModules();
    const handlers = register();
    const res = await handlers['setup:save-local-provider']({}, {
      id: 'constructor', baseURL: 'http://127.0.0.1:8000/v1', flavor: 'vllm',
    });
    expect(res.ok).toBe(true);
    const cfg = readConfig(dir);
    expect(cfg.providers.constructor.baseURL).toBe('http://127.0.0.1:8000/v1');
  });
});

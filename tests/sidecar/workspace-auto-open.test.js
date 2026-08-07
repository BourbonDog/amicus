'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { shouldAutoOpenWorkspace } = require('../../src/sidecar/workspace-auto-open');

describe('shouldAutoOpenWorkspace', () => {
  const BASE = {
    client: 'code-local',
    electronUsable: true,
    platform: 'win32',
    env: {},
    autoOpenConfig: true,
    uiParam: undefined,
  };

  // [overrides, expectedOpen, expectedReason]
  const MATRIX = [
    [{}, true, 'ok'],
    [{ uiParam: false }, false, 'param-suppressed'],
    [{ uiParam: false, autoOpenConfig: false }, false, 'param-suppressed'],
    [{ uiParam: false, electronUsable: false }, false, 'param-suppressed'],
    [{ autoOpenConfig: false }, false, 'config-disabled'],
    [{ autoOpenConfig: false, uiParam: true }, true, 'ok'],
    [{ client: 'cowork' }, false, 'client-not-code-local'],
    [{ client: 'code-web' }, false, 'client-not-code-local'],
    [{ client: 'cowork', uiParam: true }, true, 'ok'],
    [{ electronUsable: false }, false, 'electron-absent'],
    [{ electronUsable: false, uiParam: true }, false, 'electron-absent'],
    [{ platform: 'linux', env: {} }, false, 'no-display'],
    [{ platform: 'linux', env: {}, uiParam: true }, false, 'no-display'],
    [{ platform: 'linux', env: { DISPLAY: ':0' } }, true, 'ok'],
    // T16-m1: env is documented (JSDoc :26) as always an object, but callers
    // can still pass `env: undefined` — must not throw, must fall through
    // the linux/no-display guard the same as an empty object would.
    [{ platform: 'linux', env: undefined }, false, 'no-display'],
    [{ platform: 'darwin' }, true, 'ok'],
    // #76: electronState (3-state probe) splits the old electron-absent reason.
    // When provided it takes precedence over the legacy electronUsable boolean.
    [{ electronState: 'ok', electronUsable: false }, true, 'ok'],
    [{ electronState: 'package-missing' }, false, 'electron-absent'],
    [{ electronState: 'package-missing', uiParam: true }, false, 'electron-absent'],
    [
      { electronState: 'binary-missing', electronDir: 'C:\\x\\electron' },
      false, 'electron-broken: binary missing under C:\\x\\electron — run `amicus doctor --fix`',
    ],
    [
      { electronState: 'binary-missing', electronDir: 'C:\\x\\electron', uiParam: true },
      false, 'electron-broken: binary missing under C:\\x\\electron — run `amicus doctor --fix`',
    ],
  ];

  test.each(MATRIX)('%o -> open=%s reason=%s', (over, open, reason) => {
    expect(shouldAutoOpenWorkspace({ ...BASE, ...over })).toEqual({ open, reason });
  });

  // #76: a binary-missing state with no electronDir supplied must still produce
  // a self-explanatory reason, not "under undefined".
  test('binary-missing without electronDir omits the dir clause', () => {
    const r = shouldAutoOpenWorkspace({ ...BASE, electronState: 'binary-missing' });
    expect(r.open).toBe(false);
    expect(r.reason).toMatch(/^electron-broken: binary missing/);
    expect(r.reason).not.toMatch(/undefined/);
  });
});

describe('getWorkspaceAutoOpen (config accessor)', () => {
  let tempDir;
  let originalEnv;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-auto-open-test-'));
    originalEnv = { ...process.env };
    process.env.AMICUS_CONFIG_DIR = tempDir;
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function loadModule() {
    return require('../../src/utils/config');
  }

  it('should return true when no config exists (default ON)', () => {
    const config = loadModule();
    expect(config.getWorkspaceAutoOpen()).toBe(true);
  });

  it('should return false when config.workspace.autoOpen is explicitly false', () => {
    const configPath = path.join(tempDir, 'config.json');
    const data = { workspace: { autoOpen: false } };
    fs.writeFileSync(configPath, JSON.stringify(data));
    const config = loadModule();
    expect(config.getWorkspaceAutoOpen()).toBe(false);
  });

  it('should return true when config.workspace.autoOpen is non-boolean junk (opt-out semantics)', () => {
    const configPath = path.join(tempDir, 'config.json');
    const data = { workspace: { autoOpen: 'off' } };
    fs.writeFileSync(configPath, JSON.stringify(data));
    const config = loadModule();
    expect(config.getWorkspaceAutoOpen()).toBe(true);
  });
});

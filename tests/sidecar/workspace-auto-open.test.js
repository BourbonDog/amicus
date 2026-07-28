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
    [{ platform: 'darwin' }, true, 'ok'],
  ];

  test.each(MATRIX)('%o -> open=%s reason=%s', (over, open, reason) => {
    expect(shouldAutoOpenWorkspace({ ...BASE, ...over })).toEqual({ open, reason });
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

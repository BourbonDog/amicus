// Covers all three legacy registration paths: CLI add-json, ~/.claude.json file
// fallback, and Claude Desktop. child_process is mocked so the test can NEVER
// shell out to a real `claude` CLI (which would mutate the dev box's config);
// os.homedir + APPDATA are redirected to a tmp fixture because postinstall's
// registration fns resolve their paths at call time.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('child_process', () => ({
  execFileSync: jest.fn(),
}));
const { execFileSync } = require('child_process');

const { registerClaudeCode, registerClaudeDesktop, addMcpToConfigFile } = require('../scripts/postinstall');
const MCP_CONFIG = { command: 'npx', args: ['-y', 'amicus@latest', 'mcp'] }; // scripts/postinstall.js:40

describe('postinstall no longer registers a legacy sidecar MCP server', () => {
  let tmpHome; let homedirSpy; let savedAppData;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'postinstall-legacy-'));
    homedirSpy = jest.spyOn(os, 'homedir').mockReturnValue(tmpHome);
    savedAppData = process.env.APPDATA;
    process.env.APPDATA = path.join(tmpHome, 'AppData', 'Roaming'); // win32 Desktop path
    // Default: no `claude` CLI available → registerClaudeCode uses the file fallback.
    execFileSync.mockReset();
    execFileSync.mockImplementation(() => { throw new Error('claude CLI unavailable in tests'); });
  });
  afterEach(() => {
    homedirSpy.mockRestore();
    if (savedAppData === undefined) { delete process.env.APPDATA; } else { process.env.APPDATA = savedAppData; }
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  const desktopConfigPath = () => {
    const dir = process.platform === 'darwin'
      ? path.join(tmpHome, 'Library', 'Application Support', 'Claude')
      : process.platform === 'win32'
        ? path.join(process.env.APPDATA, 'Claude')
        : path.join(tmpHome, '.config', 'claude');
    return path.join(dir, 'claude_desktop_config.json');
  };

  test('CLI path: add-json is invoked for amicus ONLY — never for sidecar', () => {
    execFileSync.mockImplementation(() => Buffer.from('')); // CLI "succeeds"
    registerClaudeCode();
    const registeredNames = execFileSync.mock.calls
      .filter(([cmd, args]) => cmd === 'claude' && args[1] === 'add-json')
      .map(([, args]) => args[2]);
    expect(registeredNames).toEqual(['amicus']); // exactly one registration, no shim
  });

  // Pre-v1.8.0 fix: the CLI path built its add-json payload from the bare
  // MCP_CONFIG only, never looking at the previous registration's `env`. The
  // file-fallback path already merges (`{ ...prev, ...config }` in
  // addMcpToConfigFile) so a user's custom env (API key, AMICUS_* tuning
  // knobs) survived a file-fallback re-registration but was silently dropped
  // whenever the `claude` CLI was present — delegating overwrite semantics to
  // the claude binary, which has no idea about the user's previous entry.
  describe('CLI path: previous env is merged into the add-json payload', () => {
    test('prev amicus-shaped entry WITH env → env is preserved in the add-json JSON payload', () => {
      const existingWithEnv = { ...MCP_CONFIG, env: { AMICUS_LEGACY_ALIASES: '1' } };
      fs.writeFileSync(path.join(tmpHome, '.claude.json'), JSON.stringify({
        mcpServers: { amicus: existingWithEnv },
      }, null, 2));
      execFileSync.mockImplementation(() => Buffer.from('')); // CLI "succeeds"

      registerClaudeCode();

      const call = execFileSync.mock.calls.find(([cmd, args]) => cmd === 'claude' && args[1] === 'add-json');
      const payload = JSON.parse(call[1][3]);
      expect(payload.env).toEqual({ AMICUS_LEGACY_ALIASES: '1' });
      expect(payload.command).toBe(MCP_CONFIG.command);
      expect(payload.args).toEqual(MCP_CONFIG.args);
    });

    test('collision → canonical/new MCP_CONFIG keys win over the previous entry', () => {
      const stalePrev = { command: 'npx', args: ['-y', 'amicus@1.0.0', 'mcp'], env: { FOO: 'bar' } };
      fs.writeFileSync(path.join(tmpHome, '.claude.json'), JSON.stringify({
        mcpServers: { amicus: stalePrev },
      }, null, 2));
      execFileSync.mockImplementation(() => Buffer.from(''));

      registerClaudeCode();

      const call = execFileSync.mock.calls.find(([cmd, args]) => cmd === 'claude' && args[1] === 'add-json');
      const payload = JSON.parse(call[1][3]);
      expect(payload.args).toEqual(MCP_CONFIG.args); // canonical args win, not the stale ones
      expect(payload.env).toEqual({ FOO: 'bar' });    // prev env still carried forward
    });

    test('no previous entry → add-json payload is identical to today (unchanged)', () => {
      execFileSync.mockImplementation(() => Buffer.from(''));

      registerClaudeCode();

      const call = execFileSync.mock.calls.find(([cmd, args]) => cmd === 'claude' && args[1] === 'add-json');
      const payload = JSON.parse(call[1][3]);
      expect(payload).toEqual(MCP_CONFIG);
    });
  });

  test('file-fallback path: ~/.claude.json gains amicus and NO sidecar entry', () => {
    registerClaudeCode(); // execFileSync throws → file fallback
    const config = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude.json'), 'utf-8'));
    expect(config.mcpServers.amicus).toEqual({ command: 'npx', args: ['-y', 'amicus@latest', 'mcp'] });
    expect(config.mcpServers.sidecar).toBeUndefined();
  });

  test('Desktop path: claude_desktop_config.json gains amicus and NO sidecar entry', () => {
    registerClaudeDesktop();
    const config = JSON.parse(fs.readFileSync(desktopConfigPath(), 'utf-8'));
    expect(config.mcpServers.amicus).toBeDefined();
    expect(config.mcpServers.sidecar).toBeUndefined();
  });

  test('upgrade path: registration + migration leaves a pre-1.8 dupe machine with amicus only', () => {
    const { migrateLegacyMcp } = require('../scripts/postinstall');
    // Simulate a machine upgraded from v1.7.x (dupe in both configs).
    const codePath = path.join(tmpHome, '.claude.json');
    const dupe = { mcpServers: {
      amicus: { command: 'npx', args: ['-y', 'amicus@latest', 'mcp'] },
      sidecar: { command: 'npx', args: ['-y', 'amicus@latest', 'mcp'] },
    } };
    fs.writeFileSync(codePath, JSON.stringify(dupe, null, 2));
    fs.mkdirSync(path.dirname(desktopConfigPath()), { recursive: true });
    fs.writeFileSync(desktopConfigPath(), JSON.stringify(dupe, null, 2));

    registerClaudeCode();
    registerClaudeDesktop();
    migrateLegacyMcp(); // paths resolve through the redirected homedir/APPDATA

    for (const p of [codePath, desktopConfigPath()]) {
      const config = JSON.parse(fs.readFileSync(p, 'utf-8'));
      expect(config.mcpServers.amicus).toBeDefined();
      expect(config.mcpServers.sidecar).toBeUndefined();
    }
  });
});

// Phase-4 final-review FIX 2: addMcpToConfigFile must not wipe a user's env on
// upgrade. Re-running `npm i -g amicus` always overwrote the 'amicus' entry
// with the bare MCP_CONFIG, silently dropping "env": {"AMICUS_LEGACY_ALIASES":"1"}
// (the exact opt-in escape hatch Phase 4 tells users to add) or any API key env.
describe('addMcpToConfigFile preserves user env on re-registration (upgrade)', () => {
  let tmpDir; let configPath;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'postinstall-env-'));
    configPath = path.join(tmpDir, '.claude.json');
  });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  test('existing amicus-shaped entry WITH env → env is preserved after re-registration', () => {
    const existingWithEnv = { ...MCP_CONFIG, env: { AMICUS_LEGACY_ALIASES: '1' } };
    fs.writeFileSync(configPath, JSON.stringify({ mcpServers: { amicus: existingWithEnv } }, null, 2));

    const status = addMcpToConfigFile(configPath, 'amicus', MCP_CONFIG);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config.mcpServers.amicus.env).toEqual({ AMICUS_LEGACY_ALIASES: '1' });
    expect(config.mcpServers.amicus.command).toBe(MCP_CONFIG.command);
    expect(config.mcpServers.amicus.args).toEqual(MCP_CONFIG.args);
    expect(status).toBe('unchanged'); // command/args identical, only env carried forward — no-op write
  });

  test('entry absent → written as before (no regression)', () => {
    const status = addMcpToConfigFile(configPath, 'amicus', MCP_CONFIG);
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(status).toBe('added');
    expect(config.mcpServers.amicus).toEqual(MCP_CONFIG);
  });

  test('foreign entry at the amicus key that is NOT amicus-shaped → overwritten as today (reclaiming the reserved key)', () => {
    const foreign = { command: 'uvx', args: ['some-other-server'] };
    fs.writeFileSync(configPath, JSON.stringify({ mcpServers: { amicus: foreign } }, null, 2));

    const status = addMcpToConfigFile(configPath, 'amicus', MCP_CONFIG);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(status).toBe('updated');
    expect(config.mcpServers.amicus).toEqual(MCP_CONFIG); // 'amicus' is a reserved key — foreign entries there are reclaimed
  });

  test('command/args change while env is preserved → status is updated and both apply', () => {
    const existingWithEnv = { command: 'npx', args: ['-y', 'amicus@1.0.0', 'mcp'], env: { FOO: 'bar' } };
    fs.writeFileSync(configPath, JSON.stringify({ mcpServers: { amicus: existingWithEnv } }, null, 2));

    const status = addMcpToConfigFile(configPath, 'amicus', MCP_CONFIG);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(status).toBe('updated');
    expect(config.mcpServers.amicus.args).toEqual(MCP_CONFIG.args); // refreshed
    expect(config.mcpServers.amicus.env).toEqual({ FOO: 'bar' });   // preserved
  });
});

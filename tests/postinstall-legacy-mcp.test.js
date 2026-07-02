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

const { registerClaudeCode, registerClaudeDesktop } = require('../scripts/postinstall');

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

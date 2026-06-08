const fs = require('fs');
const path = require('path');
const os = require('os');

describe('Postinstall MCP registration', () => {
  test('addMcpToConfigFile creates config file if it does not exist', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'postinstall-test-'));
    const configPath = path.join(tmpDir, 'claude.json');

    const { addMcpToConfigFile } = require('../scripts/postinstall');
    addMcpToConfigFile(configPath, 'sidecar', { command: 'sidecar', args: ['mcp'] });

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config.mcpServers.sidecar).toEqual({ command: 'sidecar', args: ['mcp'] });

    fs.rmSync(tmpDir, { recursive: true });
  });

  test('addMcpToConfigFile preserves existing config entries', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'postinstall-test-'));
    const configPath = path.join(tmpDir, 'claude.json');

    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: { existing: { command: 'other' } },
      otherKey: 'preserved',
    }));

    const { addMcpToConfigFile } = require('../scripts/postinstall');
    addMcpToConfigFile(configPath, 'sidecar', { command: 'sidecar', args: ['mcp'] });

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config.mcpServers.existing).toEqual({ command: 'other' });
    expect(config.mcpServers.sidecar).toEqual({ command: 'sidecar', args: ['mcp'] });
    expect(config.otherKey).toBe('preserved');

    fs.rmSync(tmpDir, { recursive: true });
  });

  test('addMcpToConfigFile updates existing sidecar entry with new config', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'postinstall-test-'));
    const configPath = path.join(tmpDir, 'claude.json');

    const oldConfig = { command: 'sidecar', args: ['mcp'] };
    const newConfig = { command: 'npx', args: ['-y', 'amicus@latest', 'mcp'] };
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: { sidecar: oldConfig },
    }));

    const { addMcpToConfigFile } = require('../scripts/postinstall');
    const status = addMcpToConfigFile(configPath, 'sidecar', newConfig);

    expect(status).toBe('updated');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config.mcpServers.sidecar).toEqual(newConfig);

    fs.rmSync(tmpDir, { recursive: true });
  });

  test('addMcpToConfigFile returns unchanged when config matches', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'postinstall-test-'));
    const configPath = path.join(tmpDir, 'claude.json');

    const config = { command: 'npx', args: ['-y', 'amicus@latest', 'mcp'] };
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: { sidecar: config },
    }));

    const { addMcpToConfigFile } = require('../scripts/postinstall');
    const status = addMcpToConfigFile(configPath, 'sidecar', config);

    expect(status).toBe('unchanged');

    fs.rmSync(tmpDir, { recursive: true });
  });
});

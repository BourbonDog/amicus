const { buildClaudeCommand, createSandbox, buildMcpConfig } = require('../claude_runner');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('buildMcpConfig', () => {
  test('generates valid MCP config pointing to the amicus binary (canonical names, no legacy env)', () => {
    const config = buildMcpConfig();
    expect(config.mcpServers).toHaveProperty('amicus');
    expect(config.mcpServers.amicus.command).toBe('node');
    expect(config.mcpServers.amicus.args[0]).toContain('amicus.js');
    expect(config.mcpServers.amicus.args[1]).toBe('mcp');
    // Deliberately env-free: the harness must exercise the DEFAULT tool
    // surface (amicus_* only), not the AMICUS_LEGACY_ALIASES=1 opt-in.
    expect(config.mcpServers.amicus.env).toBeUndefined();
  });

  test('MCP config binary actually exists on disk (bin/sidecar.js was renamed in the rebrand)', () => {
    const config = buildMcpConfig();
    expect(fs.existsSync(config.mcpServers.amicus.args[0])).toBe(true);
  });
});

describe('createSandbox', () => {
  test('copies fixture to temp directory', () => {
    const fixturesDir = path.join(__dirname, '..', 'fixtures');
    if (!fs.existsSync(path.join(fixturesDir, 'buggy-auth-app'))) {
      return;
    }
    const sandbox = createSandbox('buggy-auth-app');
    expect(fs.existsSync(sandbox)).toBe(true);
    expect(fs.existsSync(path.join(sandbox, 'src', 'auth.js'))).toBe(true);
    fs.rmSync(sandbox, { recursive: true });
  });

  test('throws if fixture does not exist', () => {
    expect(() => createSandbox('nonexistent-fixture')).toThrow('Fixture not found');
  });
});

describe('buildClaudeCommand', () => {
  test('builds command with required flags', () => {
    const cmd = buildClaudeCommand({
      prompt: 'test prompt',
      model: 'sonnet',
      maxBudget: 2.0,
      mcpConfigPath: '/tmp/mcp.json',
      sandboxDir: '/tmp/sandbox',
    });
    expect(cmd.command).toBe('claude');
    expect(cmd.args).toContain('-p');
    expect(cmd.args).toContain('test prompt');
    expect(cmd.args).toContain('--output-format');
    expect(cmd.args).toContain('stream-json');
    expect(cmd.args).toContain('--model');
    expect(cmd.args).toContain('sonnet');
    expect(cmd.args).toContain('--max-budget-usd');
    expect(cmd.args).toContain('2');
    expect(cmd.args).toContain('--mcp-config');
    expect(cmd.args).toContain('/tmp/mcp.json');
    expect(cmd.env.CLAUDECODE).toBe('');
  });

  test('MCP mode includes --mcp-config flag', () => {
    const cmd = buildClaudeCommand({
      prompt: 'test', model: 'sonnet', maxBudget: 2.0,
      mcpConfigPath: '/tmp/mcp.json', sandboxDir: '/tmp/sandbox',
    });
    expect(cmd.args).toContain('--mcp-config');
    expect(cmd.args).toContain('/tmp/mcp.json');
  });

  test('CLI mode omits --mcp-config, adds sidecar to PATH, and includes --allowedTools', () => {
    const cmd = buildClaudeCommand({
      prompt: 'test', model: 'sonnet', maxBudget: 2.0,
      mcpConfigPath: null, sandboxDir: '/tmp/sandbox',
    });
    expect(cmd.args).not.toContain('--mcp-config');
    expect(cmd.args).not.toContain(null);
    expect(cmd.env.PATH).toContain('bin');
    expect(cmd.args).toContain('--allowedTools');
    const allowedIdx = cmd.args.indexOf('--allowedTools');
    const allowedVal = cmd.args[allowedIdx + 1];
    expect(allowedVal).toContain('Bash');
    expect(allowedVal).toContain('Edit');
    expect(allowedVal).not.toContain('mcp__amicus');
    expect(allowedVal).not.toContain('mcp__sidecar');
  });

  test('MCP mode --allowedTools includes mcp__amicus__*', () => {
    const cmd = buildClaudeCommand({
      prompt: 'test', model: 'sonnet', maxBudget: 2.0,
      mcpConfigPath: '/tmp/mcp.json', sandboxDir: '/tmp/sandbox',
    });
    const allowedIdx = cmd.args.indexOf('--allowedTools');
    const allowedVal = cmd.args[allowedIdx + 1];
    expect(allowedVal).toContain('mcp__amicus__*');
    expect(allowedVal).toContain('Edit');
  });
});

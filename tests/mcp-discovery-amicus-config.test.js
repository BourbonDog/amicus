// tests/mcp-discovery-amicus-config.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

jest.mock('../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { readAmicusMcpConfig } = require('../src/utils/mcp-discovery');

const NPX_AMICUS = { command: 'npx', args: ['-y', 'amicus@latest', 'mcp'] };

describe('readAmicusMcpConfig — the raw amicus registration config (for launch classification)', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-cfg-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  const writeJson = (p, obj) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(obj)); };
  const emptyClaudeDir = () => { const d = path.join(tmp, '.claude'); fs.mkdirSync(d, { recursive: true }); return d; };
  const noCowork = () => path.join(tmp, 'no-cowork');

  test('returns the amicus config from ~/.claude.json mcpServers', () => {
    const claudeJson = path.join(tmp, '.claude.json');
    writeJson(claudeJson, { mcpServers: { amicus: NPX_AMICUS } });
    const cfg = readAmicusMcpConfig(emptyClaudeDir(), claudeJson, noCowork());
    expect(cfg).toEqual(NPX_AMICUS);
  });

  test('returns the amicus config from the Cowork/Desktop config', () => {
    const coworkDir = path.join(tmp, 'Claude');
    writeJson(path.join(coworkDir, 'claude_desktop_config.json'), { mcpServers: { amicus: NPX_AMICUS } });
    const cfg = readAmicusMcpConfig(emptyClaudeDir(), path.join(tmp, 'no.json'), coworkDir);
    expect(cfg).toEqual(NPX_AMICUS);
  });

  test('recognizes an aliased entry whose command/args resolve to an amicus mcp launch', () => {
    const claudeJson = path.join(tmp, '.claude.json');
    writeJson(claudeJson, { mcpServers: { 'my-helper': NPX_AMICUS } });
    const cfg = readAmicusMcpConfig(emptyClaudeDir(), claudeJson, noCowork());
    expect(cfg).toEqual(NPX_AMICUS);
  });

  test('returns null when no amicus MCP is registered anywhere', () => {
    const claudeJson = path.join(tmp, '.claude.json');
    writeJson(claudeJson, { mcpServers: { unrelated: { command: 'node', args: ['x.js'] } } });
    const cfg = readAmicusMcpConfig(emptyClaudeDir(), claudeJson, noCowork());
    expect(cfg).toBeNull();
  });
});

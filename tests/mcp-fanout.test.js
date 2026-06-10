// tests/mcp-fanout.test.js
'use strict';

const { getTools } = require('../src/mcp-tools');

describe('amicus_fanout MCP surface (F4)', () => {
  it('defines the amicus_fanout tool with models array and prompt', () => {
    const tool = getTools().find(t => t.name === 'amicus_fanout');
    expect(tool).toBeDefined();
    expect(tool.description).toMatch(/parallel/i);
    expect(tool.inputSchema.models).toBeDefined();
    expect(tool.inputSchema.prompt).toBeDefined();
  });

  it('handler writes briefing.md and spawns the CLI with --prompt-file, never inline prompt', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '../src/mcp-server.js'), 'utf-8');
    expect(src).toContain('async amicus_fanout(');
    expect(src).toContain("'--prompt-file'");
    expect(src).toContain("'--wave-id'");
    expect(src).toContain('briefing.md');
    // wave-aware status + read
    expect(src).toMatch(/type === 'wave'/);
  });
});

'use strict';
// Real export is getTools() (a function returning the array), not TOOL_DEFINITIONS.
// inputSchema is a raw object of zod field schemas (not a z.object), so we access
// fields directly: tool.inputSchema.models, tool.inputSchema.council.
const { getTools } = require('../src/mcp-tools');

describe('amicus_fanout schema (council)', () => {
  const TOOLS = getTools();
  const tool = TOOLS.find(t => t.name === 'amicus_fanout');

  it('models is optional and council is accepted', () => {
    expect(tool).toBeDefined();
    // council field exists and parses a string without throwing
    expect(() => tool.inputSchema.council.parse('free')).not.toThrow();
    // models is optional
    expect(tool.inputSchema.models.isOptional()).toBe(true);
  });
});

const { getTools } = require('../src/mcp-tools');
const { handlers } = require('../src/mcp-server');

describe('MCP tool naming (post-shim-removal)', () => {
  it('canonical tools are amicus_*', () => {
    const names = getTools().map(t => t.name);
    expect(names).toContain('amicus_start');
    expect(names).toContain('amicus_guide');
  });

  it('handlers expose amicus_* keys', () => {
    expect(typeof handlers.amicus_start).toBe('function');
    expect(typeof handlers.amicus_status).toBe('function');
  });

  it('no sidecar_* tool is ever registered (absence pin)', () => {
    const names = getTools().map(t => t.name);
    expect(names.some((n) => n.startsWith('sidecar_'))).toBe(false);
  });

  it('no LEGACY_TOOL_ALIASES export remains on the mcp-server module', () => {
    const mcpServer = require('../src/mcp-server');
    expect(mcpServer.LEGACY_TOOL_ALIASES).toBeUndefined();
    expect(mcpServer.legacyAliasesEnabled).toBeUndefined();
  });
});

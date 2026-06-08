const { getTools } = require('../src/mcp-tools');
const { handlers, LEGACY_TOOL_ALIASES } = require('../src/mcp-server');

describe('MCP tool naming + alias shim', () => {
  it('canonical tools are amicus_*', () => {
    const names = getTools().map(t => t.name);
    expect(names).toContain('amicus_start');
    expect(names).toContain('amicus_guide');
    expect(names).not.toContain('sidecar_start');
  });

  it('handlers expose amicus_* keys', () => {
    expect(typeof handlers.amicus_start).toBe('function');
    expect(typeof handlers.amicus_status).toBe('function');
  });

  it('every canonical tool has a legacy sidecar_* alias (shim)', () => {
    const canonical = getTools().map(t => t.name);
    for (const name of canonical) {
      expect(LEGACY_TOOL_ALIASES[name]).toBe(name.replace(/^amicus_/, 'sidecar_'));
    }
  });
});

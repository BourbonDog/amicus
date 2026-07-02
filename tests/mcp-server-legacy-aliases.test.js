// In-process registration test: mock the MCP SDK so registerTool calls are
// captured — no stdio transport, no handshake. Counts are DERIVED from
// getTools().length (never literal 13/26) so Phase 5's 14th tool (amicus_wait)
// does not break this suite.
'use strict';

// jest.mock factories may only reference out-of-scope vars named mock*.
const mockRegistered = [];
jest.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: jest.fn(() => ({
    registerTool: (name) => { mockRegistered.push(name); },
    connect: jest.fn().mockResolvedValue(undefined),
  })),
}));
jest.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: jest.fn(() => ({})),
}));

const { getTools } = require('../src/mcp-tools');
const { startMcpServer, legacyAliasesEnabled, LEGACY_TOOL_ALIASES } = require('../src/mcp-server');

const CANONICAL_COUNT = getTools().length; // single source of truth for counts

const sigBaseline = {};
beforeEach(() => {
  mockRegistered.length = 0;
  delete process.env.AMICUS_LEGACY_ALIASES;
  // startMcpServer installs SIGTERM/SIGINT listeners per call — snapshot so
  // afterEach can remove only the ones each test added (MaxListeners hygiene).
  for (const sig of ['SIGTERM', 'SIGINT']) { sigBaseline[sig] = process.listeners(sig); }
});
afterEach(() => {
  delete process.env.AMICUS_LEGACY_ALIASES;
  for (const sig of ['SIGTERM', 'SIGINT']) {
    for (const l of process.listeners(sig)) {
      if (!sigBaseline[sig].includes(l)) { process.removeListener(sig, l); }
    }
  }
});

describe('legacyAliasesEnabled', () => {
  test('off by default; on only for the exact value "1"', () => {
    expect(legacyAliasesEnabled({})).toBe(false);
    expect(legacyAliasesEnabled({ AMICUS_LEGACY_ALIASES: '' })).toBe(false);
    expect(legacyAliasesEnabled({ AMICUS_LEGACY_ALIASES: 'true' })).toBe(false);
    expect(legacyAliasesEnabled({ AMICUS_LEGACY_ALIASES: '0' })).toBe(false);
    expect(legacyAliasesEnabled({ AMICUS_LEGACY_ALIASES: '1' })).toBe(true);
  });
});

describe('startMcpServer tool registration (Phase 4 de-bloat)', () => {
  test('default env: only amicus_* names — no sidecar_* twins', async () => {
    await startMcpServer();
    expect(mockRegistered.some((n) => n.startsWith('sidecar_'))).toBe(false);
    expect(mockRegistered.every((n) => n.startsWith('amicus_'))).toBe(true);
    expect(mockRegistered.length).toBe(CANONICAL_COUNT);
  });

  test('AMICUS_LEGACY_ALIASES=1: every canonical tool gains its sidecar_* twin (count doubles)', async () => {
    process.env.AMICUS_LEGACY_ALIASES = '1';
    await startMcpServer();
    expect(mockRegistered.length).toBe(CANONICAL_COUNT * 2);
    for (const tool of getTools()) {
      expect(mockRegistered).toContain(tool.name);
      expect(mockRegistered).toContain(LEGACY_TOOL_ALIASES[tool.name]);
    }
  });

  test('flag is read per startMcpServer call, not at module load', async () => {
    await startMcpServer();
    const defaultCount = mockRegistered.length;
    mockRegistered.length = 0;
    process.env.AMICUS_LEGACY_ALIASES = '1';
    await startMcpServer(); // same module instance, new env → aliases appear
    expect(mockRegistered.length).toBe(defaultCount * 2);
  });
});

describe('docs reflect the opt-in alias behavior (no drift)', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf-8');

  test.each(['docs/usage.md', 'README.md'])('%s documents AMICUS_LEGACY_ALIASES and drops the always-on claim', (file) => {
    const doc = read(file);
    expect(doc).toContain('AMICUS_LEGACY_ALIASES');
    expect(doc).not.toMatch(/still registered as aliases/);
    expect(doc).toMatch(/no longer registered by default/);
  });
});

// Run: npx jest tests/mcp-server-legacy-aliases.test.js
// Failing-first: on current code the default-env test fails (sidecar_* twins
// registered unconditionally) and legacyAliasesEnabled does not exist.
// ALSO EDIT tests/mcp-protocol.integration.test.js per Design: env-parameterize
// createMcpClient, spawn the legacy-surface describe with AMICUS_LEGACY_ALIASES=1,
// and add the default-env only-amicus_* sibling test.

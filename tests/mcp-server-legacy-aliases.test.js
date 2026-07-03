// In-process registration test: mock the MCP SDK so registerTool calls are
// captured — no stdio transport, no handshake. Counts are DERIVED from
// getTools().length (never a literal count) so adding/removing a canonical
// tool does not silently desync this suite.
//
// AMICUS_LEGACY_ALIASES was the v1.8.0 opt-in switch for sidecar_* tool
// twins. As of v2.0.0 the alias mechanism is removed entirely (#19) — the
// env var is now inert. This suite is a regression pin for that: setting it
// must NOT change registration behavior.
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
const { startMcpServer } = require('../src/mcp-server');

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

describe('startMcpServer tool registration (post-shim-removal, #19)', () => {
  test('default env: only canonical amicus_* tools register', async () => {
    await startMcpServer();
    expect(mockRegistered.some((n) => n.startsWith('sidecar_'))).toBe(false);
    expect(mockRegistered.every((n) => n.startsWith('amicus_'))).toBe(true);
    expect(mockRegistered.length).toBe(CANONICAL_COUNT);
  });

  test('AMICUS_LEGACY_ALIASES=1 is now a no-op: still only canonical tools register', async () => {
    process.env.AMICUS_LEGACY_ALIASES = '1';
    await startMcpServer();
    expect(mockRegistered.some((n) => n.startsWith('sidecar_'))).toBe(false);
    expect(mockRegistered.length).toBe(CANONICAL_COUNT);
  });
});

// Run: npx jest tests/mcp-server-legacy-aliases.test.js

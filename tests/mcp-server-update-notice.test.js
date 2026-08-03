'use strict';

/**
 * Registration-level coverage for the MCP update notice (spec 2026-08-03):
 * mock the MCP SDK to capture each registered tool callback (the pattern of
 * tests/mcp-server-legacy-aliases.test.js, extended to keep the callback),
 * then drive callbacks like a client would. AMICUS_MOCK_UPDATE=available
 * makes updater.getUpdateInfo() return a fake without touching the ESM-only
 * update-notifier (jest's CJS VM cannot import() it); AMICUS_PROJECT_DIR
 * pins project resolution to the env fast path so the bare mock server is
 * never asked for roots.
 */

const os = require('os');

// jest.mock factories may only reference out-of-scope vars named mock*.
const mockRegistered = [];
jest.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: jest.fn(() => ({
    registerTool: (name, meta, cb) => { mockRegistered.push({ name, cb }); },
    connect: jest.fn().mockResolvedValue(undefined),
  })),
}));
jest.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: jest.fn(() => ({})),
}));

const originalEnv = { ...process.env };
const sigBaseline = {};
let startMcpServer;

beforeEach(() => {
  jest.resetModules();
  process.env = { ...originalEnv };
  process.env.AMICUS_MOCK_UPDATE = 'available';
  process.env.AMICUS_PROJECT_DIR = os.tmpdir();
  mockRegistered.length = 0;
  ({ startMcpServer } = require('../src/mcp-server'));
  for (const sig of ['SIGTERM', 'SIGINT']) { sigBaseline[sig] = process.listeners(sig); }
});

afterEach(() => {
  process.env = { ...originalEnv };
  for (const sig of ['SIGTERM', 'SIGINT']) {
    for (const l of process.listeners(sig)) {
      if (!sigBaseline[sig].includes(l)) { process.removeListener(sig, l); }
    }
  }
});

const notices = (result) => (result.content || [])
  .filter((b) => b.type === 'text' && typeof b.text === 'string'
    && b.text.startsWith('Update available: amicus'));

describe('MCP update notice wiring (spec 2026-08-03)', () => {
  test('first successful tool result carries exactly one notice block, then latched', async () => {
    await startMcpServer();
    const guide = mockRegistered.find((t) => t.name === 'amicus_guide');
    expect(guide).toBeDefined();

    const first = await guide.cb({});
    expect(first.isError).toBeUndefined();
    expect(notices(first)).toHaveLength(1);
    expect(notices(first)[0].text).toContain('v99.0.0'); // updater mock FAKE_LATEST

    const second = await guide.cb({});
    expect(notices(second)).toHaveLength(0);
  });

  test('an error result does not consume the once — the next success still notices', async () => {
    await startMcpServer();
    const status = mockRegistered.find((t) => t.name === 'amicus_status');
    const guide = mockRegistered.find((t) => t.name === 'amicus_guide');

    // Bogus taskId in an empty project dir -> handler (or wrapper catch)
    // produces an isError result either way; the seam must skip it.
    const err = await status.cb({ taskId: 'no-such-task-xyz' });
    expect(err.isError).toBe(true);
    expect(notices(err)).toHaveLength(0);

    const ok = await guide.cb({});
    expect(notices(ok)).toHaveLength(1);
  });

  test('without mock update info, no notice appears anywhere', async () => {
    delete process.env.AMICUS_MOCK_UPDATE;
    jest.resetModules();
    // House rule (see tests/updater.test.js): never let the real ESM-only
    // update-notifier import() run in jest's CJS VM — mock the loader seam
    // to a notifier with no update.
    jest.doMock('../src/utils/update-notifier-loader', () => ({
      loadUpdateNotifier: () => Promise.resolve({ default: () => ({ update: undefined, notify: () => {} }) }),
    }));
    ({ startMcpServer } = require('../src/mcp-server'));
    await startMcpServer();
    const guide = mockRegistered.find((t) => t.name === 'amicus_guide');
    const result = await guide.cb({});
    expect(notices(result)).toHaveLength(0);
  });
});

// Run: npx jest tests/mcp-server-update-notice.test.js

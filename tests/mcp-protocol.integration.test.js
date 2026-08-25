/**
 * MCP Protocol Integration Tests
 *
 * Starts the real MCP server over a stdio pipe and sends actual JSON-RPC
 * messages. Tests the full MCP SDK handshake, tool discovery, and tool
 * invocation without any mocks.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const SIDECAR_BIN = path.join(__dirname, '..', 'bin', 'amicus.js');
const NODE = process.execPath;
// Derived from the real tool registry — never a literal count — so adding a
// new canonical tool doesn't silently desync this suite.
const EXPECTED_TOOLS = require('../src/mcp-tools').getTools().map(t => t.name);

/**
 * Helper: spawn the MCP server and provide send/receive methods.
 * Uses the MCP JSON-RPC framing over stdin/stdout.
 * @param {object} extraEnv - extra env vars merged onto process.env for the
 *   spawned server.
 */
function createMcpClient(extraEnv = {}) {
  const child = spawn(NODE, [SIDECAR_BIN, 'mcp'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...extraEnv },
  });

  let buffer = '';
  const pending = new Map();
  let nextId = 1;

  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    // MCP SDK uses newline-delimited JSON on stdout
    let newlineIdx;
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (!line) { continue; }
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && pending.has(msg.id)) {
          const entry = pending.get(msg.id);
          clearTimeout(entry.timer);
          entry.resolve(msg);
          pending.delete(msg.id);
        }
      } catch {
        // Ignore non-JSON lines (e.g. startup messages)
      }
    }
  });

  return {
    child,

    /** Send a JSON-RPC request and wait for the response */
    request(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
        const entry = { resolve, reject };
        pending.set(id, entry);
        child.stdin.write(msg + '\n');

        // Timeout after 10s
        entry.timer = setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error(`Timeout waiting for response to ${method} (id=${id})`));
          }
        }, 10000);
      });
    },

    /** Send a JSON-RPC notification (no response expected) */
    notify(method, params = {}) {
      const msg = JSON.stringify({ jsonrpc: '2.0', method, params });
      child.stdin.write(msg + '\n');
    },

    /** Gracefully shut down the server */
    async close() {
      child.stdin.end();
      child.stdout.removeAllListeners();
      // Reject any pending requests
      for (const [, { reject, timer }] of pending) {
        clearTimeout(timer);
        reject(new Error('Client closed'));
      }
      pending.clear();
      return new Promise((resolve) => {
        const killTimer = setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 2000);
        child.on('close', () => {
          clearTimeout(killTimer);
          resolve();
        });
      });
    },
  };
}

describe('MCP Protocol: handshake and tool discovery', () => {
  let client;

  beforeAll(async () => {
    client = createMcpClient();
    // MCP protocol requires initialize handshake first
    const initResult = await client.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    });
    expect(initResult.result).toBeDefined();
    // Send initialized notification
    client.notify('notifications/initialized', {});
  });

  afterAll(async () => {
    if (client) { await client.close(); }
  });

  it('returns server info in initialize response', async () => {
    // Already initialized in beforeAll, test a fresh client
    const freshClient = createMcpClient();
    try {
      const result = await freshClient.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      });
      expect(result.result.serverInfo).toBeDefined();
      expect(result.result.serverInfo.name).toBe('amicus');
    } finally {
      await freshClient.close();
    }
  });

  it('tools/list returns ONLY amicus_* names (no sidecar_* aliases)', async () => {
    const result = await client.request('tools/list', {});
    expect(result.result).toBeDefined();
    const toolNames = result.result.tools.map(t => t.name);
    for (const expected of EXPECTED_TOOLS) {
      expect(toolNames).toContain(expected);
    }
    expect(toolNames.every(n => n.startsWith('amicus_'))).toBe(true);
    expect(toolNames.some(n => n.startsWith('sidecar_'))).toBe(false);
    expect(toolNames.length).toBe(EXPECTED_TOOLS.length);
  });

  it('AMICUS_LEGACY_ALIASES=1 is a no-op: tools/list is unchanged', async () => {
    const legacyClient = createMcpClient({ AMICUS_LEGACY_ALIASES: '1' });
    try {
      const initResult = await legacyClient.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      });
      expect(initResult.result).toBeDefined();
      legacyClient.notify('notifications/initialized', {});

      const result = await legacyClient.request('tools/list', {});
      const toolNames = result.result.tools.map(t => t.name);
      expect(toolNames.some(n => n.startsWith('sidecar_'))).toBe(false);
      expect(toolNames.length).toBe(EXPECTED_TOOLS.length);
    } finally {
      await legacyClient.close();
    }
  });

  it('each tool has a description and inputSchema', async () => {
    const result = await client.request('tools/list', {});
    for (const tool of result.result.tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
    }
  });
});

describe('MCP Protocol: tool invocation', () => {
  let client;
  let tmpDir;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-proto-int-'));
    client = createMcpClient();
    const initResult = await client.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    });
    expect(initResult.result).toBeDefined();
    client.notify('notifications/initialized', {});
  });

  afterAll(async () => {
    if (client) { await client.close(); }
    if (tmpDir) { fs.rmSync(tmpDir, { recursive: true, force: true }); }
  });

  it('amicus_guide returns guide text', async () => {
    const result = await client.request('tools/call', {
      name: 'amicus_guide',
      arguments: {},
    });
    expect(result.result).toBeDefined();
    const text = result.result.content[0].text;
    expect(text).toContain('Amicus');
    expect(text).toContain('amicus_start');
  });

  it('amicus_list returns empty message for fresh project', async () => {
    const result = await client.request('tools/call', {
      name: 'amicus_list',
      arguments: { project: tmpDir },
    });
    expect(result.result).toBeDefined();
    expect(result.result.content[0].text).toContain('No amicus sessions');
  });

  it('amicus_status returns error for nonexistent task', async () => {
    const result = await client.request('tools/call', {
      name: 'amicus_status',
      arguments: { taskId: 'nonexistent', project: tmpDir },
    });
    expect(result.result).toBeDefined();
    expect(result.result.isError).toBe(true);
    expect(result.result.content[0].text).toContain('not found');
  });

  it('sidecar_* tool names are not callable (absence pin, #19)', async () => {
    const result = await client.request('tools/call', {
      name: 'sidecar_list',
      arguments: { project: tmpDir },
    });
    // MCP SDK reports an unregistered tool as an error result, not a
    // JSON-RPC protocol error.
    expect(result.result.isError).toBe(true);
    expect(result.result.content[0].text).toContain('not found');
  });

  it('full workflow via canonical names: list -> status -> read over protocol', async () => {
    const sessDir = path.join(tmpDir, '.claude', 'amicus_sessions', 'proto-flow-001');
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
      taskId: 'proto-flow-001', model: 'opus', status: 'complete',
      briefing: 'Workflow test', createdAt: new Date().toISOString(),
    }));
    fs.writeFileSync(path.join(sessDir, 'summary.md'), '## Workflow result\nEverything passed.');

    // Step 1: List
    const listResult = await client.request('tools/call', {
      name: 'amicus_list',
      arguments: { project: tmpDir },
    });
    const sessions = JSON.parse(listResult.result.content[0].text);
    const taskId = sessions.find(s => s.id === 'proto-flow-001').id;

    // Step 2: Status
    const statusResult = await client.request('tools/call', {
      name: 'amicus_status',
      arguments: { taskId, project: tmpDir },
    });
    const status = JSON.parse(statusResult.result.content[0].text);
    expect(status.status).toBe('complete');

    // Step 3: Read
    const readResult = await client.request('tools/call', {
      name: 'amicus_read',
      arguments: { taskId, project: tmpDir },
    });
    expect(readResult.result.content[0].text).toContain('Workflow result');
  });
});

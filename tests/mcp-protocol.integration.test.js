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
const EXPECTED_TOOLS = [
  'amicus_start', 'amicus_status', 'amicus_read',
  'amicus_list', 'amicus_resume', 'amicus_continue',
  'amicus_setup', 'amicus_guide', 'amicus_abort',
];
// Each canonical tool is also registered under its legacy sidecar_* name (shim).
const LEGACY_TOOLS = EXPECTED_TOOLS.map(n => n.replace(/^amicus_/, 'sidecar_'));

/**
 * Helper: spawn the MCP server and provide send/receive methods.
 * Uses the MCP JSON-RPC framing over stdin/stdout.
 */
function createMcpClient() {
  const child = spawn(NODE, [SIDECAR_BIN, 'mcp'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
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
          pending.get(msg.id).resolve(msg);
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
        pending.set(id, { resolve, reject });
        child.stdin.write(msg + '\n');

        // Timeout after 10s
        setTimeout(() => {
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
      for (const [, { reject }] of pending) {
        reject(new Error('Client closed'));
      }
      pending.clear();
      return new Promise((resolve) => {
        child.on('close', resolve);
        setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 2000);
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

  it('lists all 9 amicus tools plus legacy sidecar aliases via tools/list', async () => {
    const result = await client.request('tools/list', {});
    expect(result.result).toBeDefined();
    const toolNames = result.result.tools.map(t => t.name);
    for (const expected of EXPECTED_TOOLS) {
      expect(toolNames).toContain(expected);
    }
    // Dual-registration shim: every canonical tool also exposed under sidecar_*.
    for (const legacy of LEGACY_TOOLS) {
      expect(toolNames).toContain(legacy);
    }
    expect(toolNames.length).toBe(EXPECTED_TOOLS.length + LEGACY_TOOLS.length);
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

  it('legacy sidecar_list alias returns sessions from legacy dir on disk', async () => {
    // Create a session on disk in the legacy sidecar_sessions dir (read-shim)
    const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'proto-test-001');
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
      taskId: 'proto-test-001', model: 'gemini', status: 'complete',
      briefing: 'Protocol test', createdAt: '2026-03-04T00:00:00Z',
    }));

    const result = await client.request('tools/call', {
      name: 'sidecar_list',
      arguments: { project: tmpDir },
    });
    const sessions = JSON.parse(result.result.content[0].text);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe('proto-test-001');
  });

  it('legacy sidecar_read alias returns summary from legacy dir on disk', async () => {
    // Create session with summary in the legacy sidecar_sessions dir (read-shim)
    const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'proto-read-001');
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(path.join(sessDir, 'metadata.json'), '{}');
    fs.writeFileSync(path.join(sessDir, 'summary.md'), '## Found the bug\nIt was a race condition.');

    const result = await client.request('tools/call', {
      name: 'sidecar_read',
      arguments: { taskId: 'proto-read-001', project: tmpDir },
    });
    expect(result.result.content[0].text).toContain('Found the bug');
    expect(result.result.content[0].text).toContain('race condition');
  });

  it('full workflow via legacy aliases: list -> status -> read over protocol', async () => {
    const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'proto-flow-001');
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
      taskId: 'proto-flow-001', model: 'opus', status: 'complete',
      briefing: 'Workflow test', createdAt: new Date().toISOString(),
    }));
    fs.writeFileSync(path.join(sessDir, 'summary.md'), '## Workflow result\nEverything passed.');

    // Step 1: List
    const listResult = await client.request('tools/call', {
      name: 'sidecar_list',
      arguments: { project: tmpDir },
    });
    const sessions = JSON.parse(listResult.result.content[0].text);
    const taskId = sessions.find(s => s.id === 'proto-flow-001').id;

    // Step 2: Status
    const statusResult = await client.request('tools/call', {
      name: 'sidecar_status',
      arguments: { taskId, project: tmpDir },
    });
    const status = JSON.parse(statusResult.result.content[0].text);
    expect(status.status).toBe('complete');

    // Step 3: Read
    const readResult = await client.request('tools/call', {
      name: 'sidecar_read',
      arguments: { taskId, project: tmpDir },
    });
    expect(readResult.result.content[0].text).toContain('Workflow result');
  });
});

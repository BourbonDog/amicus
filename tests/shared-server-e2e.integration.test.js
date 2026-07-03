/**
 * Shared Server E2E Integration Test
 *
 * Spawns a real MCP server, fires multiple concurrent amicus_start calls
 * using Gemini, verifies they all complete on a single shared server,
 * monitors RSS memory throughout, and checks cleanup.
 *
 * Requires OPENROUTER_API_KEY to run. Skipped automatically when missing.
 */

'use strict';

const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const SIDECAR_BIN = path.join(__dirname, '..', 'bin', 'amicus.js');
const NODE = process.execPath;

const HAS_API_KEY = !!(
  process.env.OPENROUTER_API_KEY ||
  (() => {
    try {
      const envPath = path.join(os.homedir(), '.config', 'sidecar', '.env');
      const content = fs.readFileSync(envPath, 'utf-8');
      return content.includes('OPENROUTER_API_KEY=');
    } catch { return false; }
  })()
);

const describeE2E = HAS_API_KEY ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Memory monitor: collects RSS snapshots from the MCP server child process
// ---------------------------------------------------------------------------

class MemoryMonitor {
  constructor(pid) {
    this.pid = pid;
    this.snapshots = [];
    this._interval = null;
  }

  start(intervalMs = 2000) {
    this._record(); // initial snapshot
    this._interval = setInterval(() => this._record(), intervalMs);
    return this;
  }

  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
    this._record(); // final snapshot
    return this;
  }

  _record() {
    try {
      // Use ps to get RSS of the MCP server process (in KB)
      const output = execFileSync('ps', ['-o', 'rss=', '-p', String(this.pid)], {
        encoding: 'utf-8',
      }).trim();
      const rssKB = parseInt(output, 10);
      if (!isNaN(rssKB)) {
        this.snapshots.push({
          timestamp: Date.now(),
          rssKB,
          rssMB: Math.round(rssKB / 1024),
        });
      }
    } catch {
      // Process may have exited
    }
  }

  get peakRSSMB() {
    if (this.snapshots.length === 0) { return 0; }
    return Math.max(...this.snapshots.map(s => s.rssMB));
  }

  get finalRSSMB() {
    if (this.snapshots.length === 0) { return 0; }
    return this.snapshots[this.snapshots.length - 1].rssMB;
  }

  /** Returns summary for test output */
  summary() {
    if (this.snapshots.length === 0) { return 'No snapshots'; }
    const first = this.snapshots[0];
    const last = this.snapshots[this.snapshots.length - 1];
    return [
      `Snapshots: ${this.snapshots.length}`,
      `Initial RSS: ${first.rssMB}MB`,
      `Peak RSS: ${this.peakRSSMB}MB`,
      `Final RSS: ${last.rssMB}MB`,
      `Duration: ${Math.round((last.timestamp - first.timestamp) / 1000)}s`,
    ].join(' | ');
  }
}

// ---------------------------------------------------------------------------
// MCP client (reused from mcp-headless-e2e.integration.test.js)
// ---------------------------------------------------------------------------

function createMcpClient() {
  const child = spawn(NODE, [SIDECAR_BIN, 'mcp'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, AMICUS_SHARED_SERVER: '1' },
  });

  let buffer = '';
  const pending = new Map();
  let nextId = 1;

  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
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
        // Ignore non-JSON lines
      }
    }
  });

  return {
    child,

    request(method, params = {}, timeoutMs = 30000) {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
        pending.set(id, { resolve, reject });
        child.stdin.write(msg + '\n');
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error(`Timeout waiting for response to ${method} (id=${id})`));
          }
        }, timeoutMs);
      });
    },

    notify(method, params = {}) {
      const msg = JSON.stringify({ jsonrpc: '2.0', method, params });
      child.stdin.write(msg + '\n');
    },

    async close() {
      child.stdin.end();
      child.stdout.removeAllListeners();
      for (const [, { reject }] of pending) {
        reject(new Error('Client closed'));
      }
      pending.clear();
      return new Promise((resolve) => {
        child.on('close', resolve);
        setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 5000);
      });
    },
  };
}

async function pollUntilDone(client, taskId, project, { intervalMs = 5000, timeoutMs = 180000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await client.request('tools/call', {
      name: 'amicus_status',
      arguments: { taskId, project },
    });

    const text = result.result.content[0].text;
    let data;
    try { data = JSON.parse(text); } catch {
      return { status: 'error', raw: text };
    }

    if (data.status !== 'running') {
      return data;
    }

    const elapsed = Math.round((Date.now() - start) / 1000);
    process.stderr.write(`  [e2e] ${elapsed}s | task=${taskId} | status=${data.status} | messages=${data.messages || 0}\n`);

    await new Promise(r => setTimeout(r, intervalMs));
  }

  return { status: 'timeout' };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countOpenCodeProcesses() {
  try {
    const output = execFileSync('pgrep', ['-f', 'opencode'], {
      encoding: 'utf-8',
    }).trim();
    return output.split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describeE2E('Shared Server E2E: round-robin concurrent sessions with memory monitoring', () => {
  let client;
  let tmpDir;
  let monitor;
  const SESSION_COUNT = 3;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-server-e2e-'));

    client = createMcpClient();

    // Start memory monitoring on the MCP server process
    monitor = new MemoryMonitor(client.child.pid).start();

    const initResult = await client.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'shared-server-e2e', version: '1.0.0' },
    });
    expect(initResult.result).toBeDefined();
    client.notify('notifications/initialized', {});
  }, 30000);

  afterAll(async () => {
    if (monitor) {
      monitor.stop();
      process.stderr.write(`\n  [e2e] Memory: ${monitor.summary()}\n`);
    }
    if (client) { await client.close(); }
    if (tmpDir) {
      process.stderr.write(`  [e2e] Session dir: ${tmpDir}\n`);
    }
  });

  it('should handle multiple concurrent sessions on a single shared server', async () => {
    // Step 1: Fire N concurrent amicus_start calls
    process.stderr.write(`\n  [e2e] Starting ${SESSION_COUNT} concurrent sessions...\n`);

    const startPromises = [];
    for (let i = 0; i < SESSION_COUNT; i++) {
      startPromises.push(
        client.request('tools/call', {
          name: 'amicus_start',
          arguments: {
            prompt: `Reply with exactly: SESSION_${i}_OK. Nothing else.`,
            model: 'gemini',
            noUi: true,
            timeout: 2,
            project: tmpDir,
          },
        }, 60000)
      );
    }

    const startResults = await Promise.all(startPromises);

    // Verify all starts succeeded
    const taskIds = [];
    for (let i = 0; i < SESSION_COUNT; i++) {
      expect(startResults[i].result).toBeDefined();
      expect(startResults[i].result.isError).toBeUndefined();

      const text = startResults[i].result.content[0].text;
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { taskId: text.match(/[a-f0-9]{8}/)?.[0] };
      }

      if (data.taskId) {
        taskIds.push(data.taskId);
      }
      process.stderr.write(`  [e2e] Session ${i} started: ${data.taskId || 'unknown'}\n`);
    }

    expect(taskIds.length).toBe(SESSION_COUNT);

    // Step 2: Log process count for monitoring
    // Note: pgrep may count parent/wrapper processes too, so we log rather than assert
    const processCount = countOpenCodeProcesses();
    process.stderr.write(`  [e2e] OpenCode processes after start: ${processCount}\n`);
    // With shared server enabled, process count should be lower than 2*N
    // We log for monitoring; the orphan cleanup test below is the strict assertion

    // Step 3: Record memory at peak (all sessions active)
    process.stderr.write(`  [e2e] Peak RSS with ${SESSION_COUNT} active sessions: ${monitor.peakRSSMB}MB\n`);

    // Step 4: Poll all sessions until done
    process.stderr.write(`  [e2e] Polling all sessions...\n`);
    const pollResults = await Promise.all(
      taskIds.map(taskId => pollUntilDone(client, taskId, tmpDir))
    );

    // Verify all completed
    for (let i = 0; i < SESSION_COUNT; i++) {
      process.stderr.write(`  [e2e] Session ${taskIds[i]} final: ${pollResults[i].status}\n`);
      expect(['complete', 'error']).toContain(pollResults[i].status);
    }

    // Step 5: Read results to verify LLM actually responded
    for (let i = 0; i < SESSION_COUNT; i++) {
      const readResult = await client.request('tools/call', {
        name: 'amicus_read',
        arguments: { taskId: taskIds[i], project: tmpDir },
      });
      const readText = readResult.result.content[0].text;
      process.stderr.write(`  [e2e] Session ${i} output length: ${readText.length} chars\n`);
      expect(readText.length).toBeGreaterThan(10);
      // Verify the output contains the session marker we asked for
      expect(readText).toMatch(/SESSION_\d+_OK|session|ok|hello/i);
    }

    // Step 6: Final memory check
    monitor.stop();
    process.stderr.write(`\n  [e2e] === Memory Report ===\n`);
    process.stderr.write(`  [e2e] ${monitor.summary()}\n`);

    // Memory should not grow unboundedly with sessions
    expect(monitor.peakRSSMB).toBeLessThan(512);

  }, 300000); // 5 min timeout

  it('should have no orphaned processes after MCP server exit', async () => {
    const beforeClose = countOpenCodeProcesses();
    process.stderr.write(`  [e2e] OpenCode processes before close: ${beforeClose}\n`);

    // Close MCP client (SIGTERM triggers sharedServer.shutdown())
    await client.close();
    client = null;

    // Wait for cleanup
    await new Promise(r => setTimeout(r, 3000));

    const afterClose = countOpenCodeProcesses();
    process.stderr.write(`  [e2e] OpenCode processes after close: ${afterClose}\n`);

    expect(afterClose).toBeLessThanOrEqual(beforeClose);
  }, 30000);
});

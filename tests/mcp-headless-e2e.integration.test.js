/**
 * MCP Headless E2E Integration Test
 *
 * Spawns a real MCP server over stdio, calls amicus_start with noUi=true
 * to launch a real headless sidecar that calls a real LLM (Gemini via
 * OpenRouter), polls amicus_status until completion, then reads results
 * with amicus_read.
 *
 * Requires OPENROUTER_API_KEY to run. Skipped automatically when missing.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const SIDECAR_BIN = path.join(__dirname, '..', 'bin', 'amicus.js');
const NODE = process.execPath;

const HAS_API_KEY = !!(
  process.env.OPENROUTER_API_KEY ||
  (() => {
    try {
      const envPath = path.join(os.homedir(), '.config', 'amicus', '.env');
      const content = fs.readFileSync(envPath, 'utf-8');
      return content.includes('OPENROUTER_API_KEY=');
    } catch { return false; }
  })()
);

const describeE2E = HAS_API_KEY ? describe : describe.skip;

/** Spawn real MCP server and provide JSON-RPC send/receive methods */
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

    request(method, params = {}, timeoutMs = 10000) {
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
        }, 3000);
      });
    },
  };
}

/** Poll amicus_status until terminal state or timeout.
 * Collects all intermediate poll results for assertions. */
async function pollUntilDone(client, taskId, project, { intervalMs = 5000, timeoutMs = 120000 } = {}) {
  const start = Date.now();
  const polls = [];
  while (Date.now() - start < timeoutMs) {
    const result = await client.request('tools/call', {
      name: 'amicus_status',
      arguments: { taskId, project },
    });

    const text = result.result.content[0].text;
    let data;
    try { data = JSON.parse(text); } catch {
      // Non-JSON response (error message)
      return { final: { raw: text, status: 'error' }, polls };
    }

    polls.push(data);

    if (data.status !== 'running') {
      return { final: data, polls };
    }

    // Log progress for debugging
    const elapsed = Math.round((Date.now() - start) / 1000);
    const latest = data.latest || 'waiting...';
    const stage = data.stage || 'none';
    process.stderr.write(`  [e2e] ${elapsed}s | status=${data.status} | stage=${stage} | messages=${data.messages || 0} | ${latest}\n`);

    await new Promise(r => setTimeout(r, intervalMs));
  }

  return { final: { status: 'timeout', elapsed: `${Math.round((Date.now() - start) / 1000)}s` }, polls };
}

describeE2E('MCP Headless E2E: real LLM via amicus_start', () => {
  let client;
  let tmpDir;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-e2e-'));

    client = createMcpClient();
    const initResult = await client.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'e2e-test-client', version: '1.0.0' },
    });
    expect(initResult.result).toBeDefined();
    client.notify('notifications/initialized', {});
  });

  afterAll(async () => {
    if (client) { await client.close(); }
    // Keep tmpDir on failure for debugging; Jest --forceExit handles cleanup
    if (tmpDir) {
      process.stderr.write(`  [e2e] Session dir: ${tmpDir}\n`);
    }
  });

  it('start -> poll status -> read summary (full lifecycle)', async () => {
    // Step 1: Start a headless sidecar with a trivial prompt
    const startResult = await client.request('tools/call', {
      name: 'amicus_start',
      arguments: {
        prompt: 'Reply with exactly this text and nothing else: SIDECAR_E2E_OK',
        model: 'gemini-flash',
        noUi: true,
        timeout: 2,
        project: tmpDir,
      },
    });

    expect(startResult.result).toBeDefined();
    expect(startResult.result.isError).toBeUndefined();

    const startData = JSON.parse(startResult.result.content[0].text);
    expect(startData.taskId).toBeDefined();
    expect(startData.status).toBe('running');

    const { taskId } = startData;
    process.stderr.write(`  [e2e] Started task ${taskId}\n`);

    // Step 2: Poll amicus_status until it completes (allow up to 3 min)
    const { final: finalStatus, polls } = await pollUntilDone(client, taskId, tmpDir, { timeoutMs: 180000 });

    process.stderr.write(`  [e2e] Final status: ${JSON.stringify(finalStatus)}\n`);
    process.stderr.write(`  [e2e] Total polls: ${polls.length}\n`);

    // Dump debug log if not complete
    if (finalStatus.status !== 'complete') {
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', taskId);
      try {
        const debugLog = fs.readFileSync(path.join(sessDir, 'debug.log'), 'utf-8');
        process.stderr.write(`  [e2e] debug.log:\n${debugLog}\n`);
      } catch { process.stderr.write('  [e2e] No debug.log found\n'); }
      try {
        const meta = fs.readFileSync(path.join(sessDir, 'metadata.json'), 'utf-8');
        process.stderr.write(`  [e2e] metadata.json: ${meta}\n`);
      } catch { process.stderr.write('  [e2e] No metadata.json found\n'); }
    }

    // Step 3: Assert it completed (not crashed, error, or timeout)
    expect(finalStatus.status).toBe('complete');

    // Step 3b: Verify progress tracking during the run
    const runningPolls = polls.filter(p => p.status === 'running');
    if (runningPolls.length > 0) {
      // At least one poll should have a stage field (from progress.json)
      const withStage = runningPolls.filter(p => p.stage);
      expect(withStage.length).toBeGreaterThan(0);

      // latest should never stay as "Starting up..." for ALL running polls
      // (progress.json should override it with a lifecycle stage label)
      const allStartingUp = runningPolls.every(p => p.latest === 'Starting up...');
      expect(allStartingUp).toBe(false);

      // Log progress stages for debugging
      process.stderr.write(`  [e2e] Progress stages seen: ${[...new Set(runningPolls.map(p => p.stage || 'none'))].join(', ')}\n`);
      process.stderr.write(`  [e2e] Latest values seen: ${[...new Set(runningPolls.map(p => p.latest))].join(' | ')}\n`);
    }

    // Step 4: Read the summary
    const readResult = await client.request('tools/call', {
      name: 'amicus_read',
      arguments: { taskId, project: tmpDir },
    });

    expect(readResult.result).toBeDefined();
    expect(readResult.result.isError).toBeUndefined();

    const summary = readResult.result.content[0].text;
    expect(summary.length).toBeGreaterThan(0);
    process.stderr.write(`  [e2e] Summary length: ${summary.length} chars\n`);

    // Step 5: Verify session files exist on disk
    const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', taskId);
    expect(fs.existsSync(path.join(sessDir, 'metadata.json'))).toBe(true);

    // Metadata should show complete
    const meta = JSON.parse(fs.readFileSync(path.join(sessDir, 'metadata.json'), 'utf-8'));
    expect(meta.status).toBe('complete');
    expect(meta.completedAt).toBeDefined();
  }, 180000); // 3 minute Jest timeout

  it('list shows the completed session', async () => {
    const listResult = await client.request('tools/call', {
      name: 'amicus_list',
      arguments: { project: tmpDir },
    });

    expect(listResult.result).toBeDefined();
    const sessions = JSON.parse(listResult.result.content[0].text);
    expect(sessions.length).toBeGreaterThanOrEqual(1);

    const completed = sessions.find(s => s.status === 'complete');
    expect(completed).toBeDefined();
  });
});

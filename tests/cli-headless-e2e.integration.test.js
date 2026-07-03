/**
 * CLI Headless E2E Integration Test
 *
 * Spawns the real sidecar CLI with `start --no-ui` to launch a headless
 * session that calls a real LLM (Gemini via OpenRouter), waits for
 * completion, then verifies session files on disk.
 *
 * Also tests `list` and `read` CLI commands against the completed session.
 *
 * Requires OPENROUTER_API_KEY to run. Skipped automatically when missing.
 */

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
      const envPath = path.join(os.homedir(), '.config', 'amicus', '.env');
      const content = fs.readFileSync(envPath, 'utf-8');
      return content.includes('OPENROUTER_API_KEY=');
    } catch { return false; }
  })()
);

const describeE2E = HAS_API_KEY ? describe : describe.skip;

/** Run a sidecar CLI command and return { stdout, stderr, exitCode } */
function runCli(args, { timeoutMs = 180000, cwd } = {}) {
  return new Promise((resolve) => {
    const child = spawn(NODE, [SIDECAR_BIN, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
      cwd: cwd || process.cwd(),
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ stdout, stderr, exitCode: null, timedOut: true });
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code, timedOut: false });
    });
  });
}

/** Run a sidecar CLI command synchronously */
function runCliSync(args, { cwd } = {}) {
  try {
    const stdout = execFileSync(NODE, [SIDECAR_BIN, ...args], {
      encoding: 'utf-8',
      cwd: cwd || process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    });
    return { stdout, exitCode: 0 };
  } catch (err) {
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      exitCode: err.status,
    };
  }
}

describeE2E('CLI Headless E2E: real LLM via sidecar start --no-ui', () => {
  let tmpDir;
  let taskId;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-e2e-'));
  });

  afterAll(() => {
    if (tmpDir) {
      process.stderr.write(`  [cli-e2e] Session dir: ${tmpDir}\n`);
    }
  });

  it('start --no-ui runs to completion and produces session files', async () => {
    // Run headless sidecar with a trivial prompt
    const result = await runCli([
      'start',
      '--prompt', 'Reply with exactly this text and nothing else: CLI_E2E_OK',
      '--model', 'gemini-flash',
      '--no-ui',
      '--timeout', '2',
      '--cwd', tmpDir,
    ], { timeoutMs: 180000 });

    process.stderr.write(`  [cli-e2e] exit=${result.exitCode} timedOut=${result.timedOut}\n`);
    process.stderr.write(`  [cli-e2e] stdout length: ${result.stdout.length}\n`);
    if (result.stderr) {
      // Show last 20 lines of stderr for debugging
      const lines = result.stderr.trim().split('\n');
      const tail = lines.slice(-20).join('\n');
      process.stderr.write(`  [cli-e2e] stderr (last 20 lines):\n${tail}\n`);
    }

    // Should not have timed out
    expect(result.timedOut).toBe(false);

    // Should exit cleanly
    expect(result.exitCode).toBe(0);

    // Should have produced stdout (the summary)
    expect(result.stdout.length).toBeGreaterThan(0);

    // Find the session directory (there should be exactly one)
    const sessionsDir = path.join(tmpDir, '.claude', 'amicus_sessions');
    expect(fs.existsSync(sessionsDir)).toBe(true);

    const sessions = fs.readdirSync(sessionsDir);
    expect(sessions.length).toBe(1);
    taskId = sessions[0];

    process.stderr.write(`  [cli-e2e] Task ID: ${taskId}\n`);

    // Verify session files
    const sessDir = path.join(sessionsDir, taskId);
    expect(fs.existsSync(path.join(sessDir, 'metadata.json'))).toBe(true);
    expect(fs.existsSync(path.join(sessDir, 'summary.md'))).toBe(true);
    expect(fs.existsSync(path.join(sessDir, 'initial_context.md'))).toBe(true);

    // Metadata should show complete
    const meta = JSON.parse(fs.readFileSync(path.join(sessDir, 'metadata.json'), 'utf-8'));
    expect(meta.status).toBe('complete');
    expect(meta.completedAt).toBeDefined();
    expect(meta.mode).toBe('headless');
  }, 180000);

  it('list shows the completed session', () => {
    expect(taskId).toBeDefined();

    const result = runCliSync(['list', '--cwd', tmpDir]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(taskId);
    expect(result.stdout).toContain('complete');
  });

  it('read returns summary for the completed session', () => {
    expect(taskId).toBeDefined();

    const result = runCliSync(['read', taskId, '--cwd', tmpDir]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);

    process.stderr.write(`  [cli-e2e] Read summary length: ${result.stdout.length}\n`);
  });

  it('read --metadata returns valid JSON metadata', () => {
    expect(taskId).toBeDefined();

    const result = runCliSync(['read', taskId, '--metadata', '--cwd', tmpDir]);
    expect(result.exitCode).toBe(0);

    const meta = JSON.parse(result.stdout);
    expect(meta.taskId).toBe(taskId);
    expect(meta.status).toBe('complete');
  });
});

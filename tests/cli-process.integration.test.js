/**
 * CLI Process Integration Tests
 *
 * Spawns the actual `node bin/amicus.js` binary and asserts on
 * exit codes, stdout, and stderr. No mocks — tests the real CLI entry point.
 */

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const AMICUS_BIN = path.join(__dirname, '..', 'bin', 'amicus.js');
const NODE = process.execPath;
const VERSION = require('../package.json').version;

/** Helper: run sidecar CLI and return { stdout, stderr, code } */
function runCli(args, opts = {}) {
  return new Promise((resolve) => {
    const { env: extraEnv, ...execOpts } = opts;
    const env = { ...process.env, ...extraEnv };
    execFile(NODE, [AMICUS_BIN, ...args], { env, timeout: 10000, ...execOpts }, (err, stdout, stderr) => {
      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        code: err ? err.code : 0,
      });
    });
  });
}

describe('CLI Process: --version', () => {
  it('prints version and exits 0', async () => {
    const { stdout, code } = await runCli(['--version']);
    expect(code).toBe(0);
    expect(stdout.trim()).toContain(`amicus v${VERSION}`);
  });
});

describe('CLI Process: --help', () => {
  it('prints usage text and exits 0', async () => {
    const { stdout, code } = await runCli(['--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('Usage:');
    expect(stdout).toContain('start');
    expect(stdout).toContain('list');
    expect(stdout).toContain('read');
    expect(stdout).toContain('mcp');
  });

  it('prints usage when no command given', async () => {
    const { stdout, code } = await runCli([]);
    expect(code).toBe(0);
    expect(stdout).toContain('Usage:');
  });
});

describe('CLI Process: unknown command', () => {
  it('exits 1 with error message', async () => {
    const { stderr, code } = await runCli(['bogus-command']);
    expect(code).toBe(1);
    expect(stderr).toContain('Unknown command');
  });

  it('suggests the nearest command for a near-miss typo (did-you-mean)', async () => {
    const { stderr, code } = await runCli(['contnue']);
    expect(code).toBe(1);
    expect(stderr).toContain('Unknown command: contnue');
    expect(stderr).toContain('Did you mean: continue');
  });

  it('prints no suggestion for a command that is not close to any known one', async () => {
    const { stderr, code } = await runCli(['xyzzyplugh']);
    expect(code).toBe(1);
    expect(stderr).toContain('Unknown command: xyzzyplugh');
    expect(stderr).not.toContain('Did you mean');
  });

  it('joins ALL suggestions (up to the cap-3 contract) instead of discarding all but the closest', async () => {
    // 'stat' is within edit-distance 2 of both 'start' and 'status' — suggestCommand's
    // own cap-3 contract returns both, closest first. The CLI must print all of them
    // joined with ', ' (matching the in-repo precedent in src/cli-handlers.js), not just
    // the first one destructured off the array.
    const { stderr, code } = await runCli(['stat']);
    expect(code).toBe(1);
    expect(stderr).toContain('Unknown command: stat');
    expect(stderr).toContain('Did you mean: start, status');
  });
});

/**
 * An unknown FLAG gets the same treatment as an unknown COMMAND.
 *
 * Before this, `parseArgs` accepted any `--token`: it landed on the parsed
 * object, no handler read it, and the command ran as though it were never
 * typed. `amicus start -m deepseek --prompt "…" --headless` exited 0 having
 * silently taken the interactive path, ignored `-m`, and left a session running.
 */
describe('CLI Process: unknown flag', () => {
  it('rejects --headless on start instead of silently ignoring it', async () => {
    const { stderr, code } = await runCli(['start', '--model', 'gemini', '--prompt', 'x', '--headless']);
    expect(code).toBe(1);
    expect(stderr).toContain('Unknown option: --headless');
  });

  it('suggests the nearest flag for a near-miss typo', async () => {
    const { stderr, code } = await runCli(['start', '--modl', 'gemini']);
    expect(code).toBe(1);
    expect(stderr).toContain('Unknown option: --modl');
    expect(stderr).toContain('--model');
  });

  it('names every unknown flag, not just the first', async () => {
    const { stderr, code } = await runCli(['start', '--alpha', '--beta']);
    expect(code).toBe(1);
    expect(stderr).toContain('--alpha');
    expect(stderr).toContain('--beta');
  });

  it('points at the scoped help for the command that was run', async () => {
    const { stderr, code } = await runCli(['council', 'run', 'x.md', '--headless']);
    expect(code).toBe(1);
    expect(stderr).toMatch(/--help/);
  });

  it('does NOT reject a valid flag set', async () => {
    // --help short-circuits before any handler, so this proves the check let it through.
    const { code, stdout } = await runCli(['start', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('Usage:');
  });

  it('does NOT reject the internal MCP passthroughs', async () => {
    // Would exit 1 with "Unknown option" if --task-id were rejected; instead it
    // reaches real validation and fails on the missing --prompt.
    const { stderr, code } = await runCli(['start', '--task-id', 'abc123', '--model', 'gemini']);
    expect(code).toBe(1);
    expect(stderr).not.toContain('Unknown option');
  });
});

describe('CLI Process: start validation errors', () => {
  it('exits 1 when --prompt is missing', async () => {
    const { stderr, code } = await runCli(['start', '--model', 'google/gemini-2.5-flash'], {
      env: { OPENROUTER_API_KEY: 'test', GOOGLE_GENERATIVE_AI_API_KEY: 'test' },
    });
    expect(code).toBe(1);
    expect(stderr).toContain('--prompt');
  });

  it('exits 1 when model format is invalid', async () => {
    const { stderr, code } = await runCli(['start', '--model', 'badmodel', '--prompt', 'test'], {
      env: { OPENROUTER_API_KEY: 'test' },
    });
    expect(code).toBe(1);
    // resolveModel rejects unknown aliases before format validation
    expect(stderr.toLowerCase()).toMatch(/unknown model|provider\/model|alias/);
  });
});

describe('CLI Process: list with empty project', () => {
  it('shows no sessions message for a fresh temp directory', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-cli-int-'));
    try {
      const { stdout, code } = await runCli(['list', '--cwd', tmpDir]);
      expect(code).toBe(0);
      expect(stdout).toContain('No amicus sessions');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('CLI Process: list finds amicus_sessions (canonical write dir)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-cli-int-'));
    const sessDir = path.join(tmpDir, '.claude', 'amicus_sessions', 'amicus-test-001');
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
      taskId: 'amicus-test-001',
      model: 'google/gemini-2.5-flash',
      status: 'complete',
      briefing: 'Amicus canonical-dir task',
      createdAt: '2026-03-05T00:00:00Z',
    }));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('lists a session written under the canonical amicus_sessions dir', async () => {
    const { stdout, code } = await runCli(['list', '--cwd', tmpDir]);
    expect(code).toBe(0);
    expect(stdout).toContain('amicus-test-001');
    expect(stdout).toContain('complete');
  });
});

describe('CLI Process: list with sessions on disk', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-cli-int-'));
    const sessDir = path.join(tmpDir, '.claude', 'amicus_sessions', 'integ-test-001');
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
      taskId: 'integ-test-001',
      model: 'google/gemini-2.5-flash',
      status: 'complete',
      briefing: 'Integration test task',
      createdAt: '2026-03-04T00:00:00Z',
    }));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('lists sessions from the project directory', async () => {
    const { stdout, code } = await runCli(['list', '--cwd', tmpDir]);
    expect(code).toBe(0);
    expect(stdout).toContain('integ-test-001');
    expect(stdout).toContain('complete');
  });

  it('outputs JSON when --json flag is used', async () => {
    const { stdout, code } = await runCli(['list', '--cwd', tmpDir, '--json']);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].id).toBe('integ-test-001');
  });

  it('filters by status', async () => {
    // Add a running session
    const runDir = path.join(tmpDir, '.claude', 'amicus_sessions', 'integ-test-002');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'metadata.json'), JSON.stringify({
      taskId: 'integ-test-002', model: 'openai/gpt-4o', status: 'running',
      briefing: 'Running task', createdAt: '2026-03-04T01:00:00Z',
    }));

    const { stdout, code } = await runCli(['list', '--cwd', tmpDir, '--status', 'running']);
    expect(code).toBe(0);
    expect(stdout).toContain('integ-test-002');
    expect(stdout).not.toContain('integ-test-001');
  });
});

describe('CLI Process: read command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-cli-int-'));
    const sessDir = path.join(tmpDir, '.claude', 'amicus_sessions', 'read-test-001');
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
      taskId: 'read-test-001', model: 'gemini', status: 'complete',
      createdAt: '2026-03-04T00:00:00Z',
    }));
    fs.writeFileSync(path.join(sessDir, 'summary.md'), '## Auth Bug Fix\nFixed the token refresh race condition.');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exits 1 when task_id is missing', async () => {
    const { stderr, code } = await runCli(['read']);
    expect(code).toBe(1);
    expect(stderr).toContain('task_id is required');
  });

  it('reads summary for a valid task', async () => {
    const { stdout, code } = await runCli(['read', 'read-test-001', '--cwd', tmpDir]);
    expect(code).toBe(0);
    expect(stdout).toContain('Auth Bug Fix');
    expect(stdout).toContain('token refresh');
  });
});

describe('CLI Process: abort command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-cli-int-'));
    const sessDir = path.join(tmpDir, '.claude', 'amicus_sessions', 'abort-integ-001');
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
      taskId: 'abort-integ-001', model: 'gemini', status: 'running',
      briefing: 'Task to abort', createdAt: '2026-03-04T00:00:00Z',
    }));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exits 1 when task_id is missing', async () => {
    const { stderr, code } = await runCli(['abort']);
    expect(code).toBe(1);
    expect(stderr).toContain('task_id is required');
  });

  it('aborts a running session and updates metadata on disk', async () => {
    const { stdout, code } = await runCli(['abort', 'abort-integ-001', '--cwd', tmpDir]);
    expect(code).toBe(0);
    expect(stdout).toContain('aborted');

    // Verify metadata was updated on disk
    const meta = JSON.parse(fs.readFileSync(
      path.join(tmpDir, '.claude', 'amicus_sessions', 'abort-integ-001', 'metadata.json'), 'utf-8'
    ));
    expect(meta.status).toBe('aborted');
    expect(meta.abortedAt).toBeDefined();
  });

  it('exits 1 for nonexistent session', async () => {
    const { stderr, code } = await runCli(['abort', 'nonexistent', '--cwd', tmpDir]);
    expect(code).toBe(1);
    expect(stderr).toContain('not found');
  });
});

describe('CLI Process: resume/continue validation', () => {
  it('resume exits 1 without task_id', async () => {
    const { stderr, code } = await runCli(['resume']);
    expect(code).toBe(1);
    expect(stderr).toContain('task_id is required');
    // v2.0.0 ships no `sidecar` binary — the usage hint must name the real one.
    expect(stderr).toContain('Usage: amicus resume <task_id>');
    expect(stderr).not.toContain('Usage: sidecar');
  });

  it('continue exits 1 without task_id', async () => {
    const { stderr, code } = await runCli(['continue']);
    expect(code).toBe(1);
    expect(stderr).toContain('task_id is required');
    // v2.0.0 ships no `sidecar` binary — the usage hint must name the real one.
    expect(stderr).toContain('Usage: amicus continue <task_id> --prompt "..."');
    expect(stderr).not.toContain('Usage: sidecar');
  });

  it('continue exits 1 without --prompt', async () => {
    const { stderr, code } = await runCli(['continue', 'some-task']);
    expect(code).toBe(1);
    expect(stderr).toContain('--prompt');
  });

  // BL-1: continue must accept --prompt-file (mirrors start) so the MCP handler
  // can pass a long follow-up prompt via file, dodging the ~32KB Windows cap.
  it('continue accepts --prompt-file (unreadable path errors via resolvePromptSource, not the --prompt guard)', async () => {
    const missing = path.join(os.tmpdir(), 'does-not-exist-bl1-briefing.md');
    const { stderr, code } = await runCli(['continue', 'some-task', '--prompt-file', missing]);
    expect(code).toBe(1);
    // Proves the flag is wired: the error is the prompt-file read failure, not
    // the "--prompt is required" fallback that fires when the flag is ignored.
    expect(stderr).toContain('--prompt-file');
    expect(stderr).not.toContain('--prompt is required');
  });
});

describe('CLI Process: no leftover "Usage: sidecar" strings anywhere in src/ or bin/', () => {
  // v2.0.0 ships no `sidecar` binary (#19, shim removal). A live error path that
  // still prints "Usage: sidecar ..." would point users at a command that no
  // longer exists. Guard the whole surface, not just resume/continue above.
  it('no source or bin file contains a "Usage: sidecar" string', () => {
    const root = path.join(__dirname, '..');
    const dirs = ['src', 'bin'];
    const offenders = [];

    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
          const content = fs.readFileSync(full, 'utf-8');
          if (/Usage:\s*sidecar\b/.test(content)) {
            offenders.push(path.relative(root, full));
          }
        }
      }
    };

    for (const d of dirs) {
      walk(path.join(root, d));
    }

    expect(offenders).toEqual([]);
  });
});

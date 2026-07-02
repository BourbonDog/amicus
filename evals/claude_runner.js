const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const EVALS_DIR = __dirname;
const AMICUS_BIN = path.join(EVALS_DIR, '..', 'bin', 'amicus.js');
const FIXTURES_DIR = path.join(EVALS_DIR, 'fixtures');

/**
 * Build MCP config JSON for the amicus server.
 *
 * Deliberately env-free: the harness must exercise the DEFAULT tool surface
 * (13 amicus_* tools). Do NOT add AMICUS_LEGACY_ALIASES here — the legacy
 * sidecar_* aliases are opt-in since v1.8.0 and are removed in the next
 * major; pinning the harness to them would only re-hide that debt.
 * @returns {object} MCP config object
 */
function buildMcpConfig() {
  return {
    mcpServers: {
      amicus: {
        command: 'node',
        args: [AMICUS_BIN, 'mcp'],
      },
    },
  };
}

/**
 * Copy fixture to a temp sandbox directory.
 * @param {string} fixtureName - Name of fixture in fixtures/
 * @returns {string} Path to sandbox directory
 */
function createSandbox(fixtureName) {
  const fixtureDir = path.join(FIXTURES_DIR, fixtureName);
  if (!fs.existsSync(fixtureDir)) {
    throw new Error(`Fixture not found: ${fixtureName}`);
  }
  const sandboxDir = fs.mkdtempSync(
    path.join(os.tmpdir(), `sidecar-eval-${fixtureName}-`)
  );
  copyDirRecursive(fixtureDir, sandboxDir);
  return sandboxDir;
}

/** Recursively copy a directory */
function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Build the Claude CLI command and args.
 * @param {object} opts
 * @param {string} opts.prompt - The prompt to send
 * @param {string} opts.model - Model name
 * @param {number} opts.maxBudget - Max budget in USD
 * @param {string} opts.mcpConfigPath - Path to MCP config JSON
 * @param {string} opts.sandboxDir - Working directory for Claude
 * @returns {{ command: string, args: string[], env: object, cwd: string }}
 */
function buildClaudeCommand({ prompt, model, maxBudget, mcpConfigPath, sandboxDir }) {
  const args = [
    '-p', prompt,
    '--output-format', 'stream-json',
    '--model', model,
    '--max-budget-usd', String(maxBudget),
    '--verbose',
  ];

  const baseTools = 'Read,Edit,Write,Bash,Glob,Grep';
  if (mcpConfigPath) {
    args.push('--mcp-config', mcpConfigPath);
    args.push('--allowedTools', `mcp__amicus__*,${baseTools}`);
  } else {
    args.push('--allowedTools', baseTools);
  }

  const env = { ...process.env, CLAUDECODE: '' };

  // For CLI mode (no MCP config), add sidecar bin dir to PATH
  if (!mcpConfigPath) {
    const sidecarBinDir = path.join(EVALS_DIR, '..', 'bin');
    const nodeModulesBin = path.join(EVALS_DIR, '..', 'node_modules', '.bin');
    env.PATH = `${sidecarBinDir}:${nodeModulesBin}:${env.PATH || ''}`;
  }

  return { command: 'claude', args, env, cwd: sandboxDir };
}

/**
 * Run Claude Code and capture stream-json output.
 * @param {object} opts - Same as buildClaudeCommand
 * @param {number} [timeoutMs=300000] - Timeout in ms (default 5 min)
 * @returns {Promise<{ lines: string[], duration: number, exitCode: number }>}
 */
function runClaude(opts, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const { command, args, env, cwd } = buildClaudeCommand(opts);
    const lines = [];
    const startTime = Date.now();

    const proc = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`Claude timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    let stdout = '';
    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      const parts = stdout.split('\n');
      stdout = parts.pop();
      for (const part of parts) {
        if (part.trim()) {
          lines.push(part.trim());
        }
      }
    });

    proc.stderr.on('data', () => {});

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (stdout.trim()) {
        lines.push(stdout.trim());
      }
      resolve({ lines, duration: Date.now() - startTime, exitCode: code });
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

module.exports = { buildMcpConfig, createSandbox, buildClaudeCommand, runClaude };

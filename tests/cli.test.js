/**
 * CLI Argument Parser Tests
 *
 * Spec Reference: §4 CLI Interface
 * Tests the argument parsing for all sidecar commands.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseArgs, validateStartArgs } = require('../src/cli');

describe('CLI Argument Parser', () => {
  // Set up API keys for all tests to avoid validation failures
  const originalEnv = { ...process.env };

  beforeAll(() => {
    // Set default API keys so existing tests pass
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-key';
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.DEEPSEEK_API_KEY = 'test-key';
  });

  afterAll(() => {
    // Restore original environment
    Object.keys(process.env).forEach(key => {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    });
    Object.assign(process.env, originalEnv);
  });
  describe('parseArgs', () => {
    it('should parse command as first positional argument', () => {
      const result = parseArgs(['start']);
      expect(result._).toEqual(['start']);
    });

    it('should parse --model option', () => {
      const result = parseArgs(['start', '--model', 'google/gemini-2.5']);
      expect(result.model).toBe('google/gemini-2.5');
    });

    it('should parse --prompt option', () => {
      const result = parseArgs(['start', '--prompt', 'Debug the auth issue']);
      expect(result.prompt).toBe('Debug the auth issue');
    });

    it('should parse --session-id option', () => {
      const result = parseArgs(['start', '--session-id', 'abc123-def456']);
      expect(result['session-id']).toBe('abc123-def456');
    });

    it('should default session-id to "current" if not specified', () => {
      const result = parseArgs(['start', '--model', 'x', '--prompt', 'y']);
      expect(result['session-id']).toBe('current');
    });

    it('should parse --cwd option', () => {
      const result = parseArgs(['start', '--cwd', '/path/to/project']);
      expect(result.cwd).toBe('/path/to/project');
    });

    it('should default cwd to process.cwd() if not specified', () => {
      const result = parseArgs(['start']);
      expect(result.cwd).toBe(process.cwd());
    });

    it('should parse --context-turns option with default of 50', () => {
      const result = parseArgs(['start']);
      expect(result['context-turns']).toBe(50);
    });

    it('should override --context-turns when specified', () => {
      const result = parseArgs(['start', '--context-turns', '100']);
      expect(result['context-turns']).toBe(100);
    });

    it('should parse --context-since option', () => {
      const result = parseArgs(['start', '--context-since', '2h']);
      expect(result['context-since']).toBe('2h');
    });

    it('should parse --context-max-tokens with default of 80000', () => {
      const result = parseArgs(['start']);
      expect(result['context-max-tokens']).toBe(80000);
    });

    it('should override --context-max-tokens when specified', () => {
      const result = parseArgs(['start', '--context-max-tokens', '120000']);
      expect(result['context-max-tokens']).toBe(120000);
    });

    it('should parse --no-ui flag as boolean', () => {
      const result = parseArgs(['start', '--no-ui']);
      expect(result['no-ui']).toBe(true);
    });

    it('should default --no-ui to false', () => {
      const result = parseArgs(['start']);
      expect(result['no-ui']).toBe(false);
    });

    it('should parse --no-ledger as a boolean without swallowing the next positional', () => {
      const result = parseArgs(['council', 'tally', '--no-ledger', 'in.json']);
      expect(result['no-ledger']).toBe(true);
      expect(result._).toContain('in.json'); // not consumed as the flag's value
    });

    it('should leave --no-ledger unset by default (ledger append on)', () => {
      const result = parseArgs(['council', 'tally', 'in.json']);
      expect(result['no-ledger']).toBeFalsy();
    });

    it('should treat an unknown --no-* flag as boolean without swallowing the next token', () => {
      const result = parseArgs(['start', '--no-frobnicate', 'positional-value']);
      expect(result['no-frobnicate']).toBe(true);
      expect(result._).toContain('positional-value'); // not consumed as the flag's value
    });

    it('should still honor an inline value on an unknown --no-* flag', () => {
      const result = parseArgs(['start', '--no-frobnicate=off']);
      expect(result['no-frobnicate']).toBe('off');
    });

    // R5 (spec §2, §8/D19): '-o' must consume values in lockstep with the
    // generic long-option branch above (`!next.startsWith('--')`), not its
    // own stricter `!next.startsWith('-')` test. Five-row matrix from the
    // v4.7 PR5 owner ruling — parseArgs only normalizes here; a dash-leading
    // value is still a legitimate (if suspicious) string at this layer.
    // cli-handlers-council.js's R1 guard is what actually rejects it (see
    // tests/council/cli-handlers-council.test.js's R1/R5 pins for that half).
    describe('--out / -o (R5 parser normalization matrix)', () => {
      it('--out -x parses the dash-leading value literally (unchanged: the long branch already did this)', () => {
        expect(parseArgs(['council', 'verdict', 't.json', '--out', '-x']).out).toBe('-x');
      });

      it('-o -x now parses the dash-leading value literally too (was: boolean true — the R5 fix)', () => {
        expect(parseArgs(['council', 'verdict', 't.json', '-o', '-x']).out).toBe('-x');
      });

      it('--out bare stays boolean true (unchanged)', () => {
        expect(parseArgs(['council', 'verdict', 't.json', '--out']).out).toBe(true);
      });

      it('-o bare stays boolean true (unchanged)', () => {
        expect(parseArgs(['council', 'verdict', 't.json', '-o']).out).toBe(true);
      });

      it('--out= stays an empty string (unchanged)', () => {
        expect(parseArgs(['council', 'verdict', 't.json', '--out=']).out).toBe('');
      });

      it('-o out.json and --out out.json both still parse the well-formed value unchanged (regression guard)', () => {
        expect(parseArgs(['council', 'verdict', 't.json', '-o', 'out.json']).out).toBe('out.json');
        expect(parseArgs(['council', 'verdict', 't.json', '--out', 'out.json']).out).toBe('out.json');
      });
    });

    it('should parse --position option', () => {
      const result = parseArgs(['start', '--position', 'right']);
      expect(result.position).toBe('right');
    });

    it('should parse --position left', () => {
      const result = parseArgs(['start', '--position', 'left']);
      expect(result.position).toBe('left');
    });

    it('should parse --position center', () => {
      const result = parseArgs(['start', '--position', 'center']);
      expect(result.position).toBe('center');
    });

    it('should default --position to "right"', () => {
      const result = parseArgs(['start']);
      expect(result.position).toBe('right');
    });

    it('should parse --timeout option with default of 15', () => {
      const result = parseArgs(['start']);
      expect(result.timeout).toBe(15);
    });

    it('should override --timeout when specified', () => {
      const result = parseArgs(['start', '--timeout', '30']);
      expect(result.timeout).toBe(30);
    });

    it('should parse task_id as second positional for resume/continue/read', () => {
      const result = parseArgs(['resume', 'abc123']);
      expect(result._).toEqual(['resume', 'abc123']);
    });

    it('should parse --status filter for list command', () => {
      const result = parseArgs(['list', '--status', 'complete']);
      expect(result.status).toBe('complete');
    });

    it('should parse --all flag for list command', () => {
      const result = parseArgs(['list', '--all']);
      expect(result.all).toBe(true);
    });

    it('should parse --summary flag for read command', () => {
      const result = parseArgs(['read', 'abc123', '--summary']);
      expect(result.summary).toBe(true);
    });

    it('should parse --conversation flag for read command', () => {
      const result = parseArgs(['read', 'abc123', '--conversation']);
      expect(result.conversation).toBe(true);
    });

    it('should parse --json flag for list command', () => {
      const result = parseArgs(['list', '--json']);
      expect(result.json).toBe(true);
    });

    it('should parse --version flag', () => {
      const result = parseArgs(['--version']);
      expect(result.version).toBe(true);
    });

    it('should parse --help flag', () => {
      const result = parseArgs(['--help']);
      expect(result.help).toBe(true);
    });

    describe('New v3 CLI flags', () => {
      it('should parse --client option', () => {
        const result = parseArgs(['start', '--client', 'code-local']);
        expect(result.client).toBe('code-local');
      });

      it('should parse --gateway option', () => {
        const result = parseArgs(['start', '--gateway', 'direct', '--model', 'x', '--prompt', 'y']);
        expect(result.gateway).toBe('direct');
      });

      it('should default --gateway to undefined when not specified', () => {
        const result = parseArgs(['start', '--model', 'x', '--prompt', 'y']);
        expect(result.gateway).toBeUndefined();
      });

      it('should parse --session-dir option', () => {
        const result = parseArgs(['start', '--session-dir', '/tmp/sessions']);
        expect(result['session-dir']).toBe('/tmp/sessions');
      });

      it('should parse --setup as boolean flag', () => {
        const result = parseArgs(['start', '--setup']);
        expect(result.setup).toBe(true);
      });

      it('should parse --fold-shortcut option', () => {
        const result = parseArgs(['start', '--fold-shortcut', 'Ctrl+Shift+F']);
        expect(result['fold-shortcut']).toBe('Ctrl+Shift+F');
      });

      it('should parse --opencode-port as numeric', () => {
        const result = parseArgs(['start', '--opencode-port', '8080']);
        expect(result['opencode-port']).toBe(8080);
      });
    });

    describe('--no-mcp and --exclude-mcp options', () => {
      it('should parse --no-mcp as boolean flag', () => {
        const result = parseArgs(['start', '--no-mcp']);
        expect(result['no-mcp']).toBe(true);
      });

      it('should default --no-mcp to undefined when not specified', () => {
        const result = parseArgs(['start', '--model', 'x', '--prompt', 'y']);
        expect(result['no-mcp']).toBeUndefined();
      });

      it('should parse --exclude-mcp into array', () => {
        const result = parseArgs(['start', '--exclude-mcp', 'context7']);
        expect(result['exclude-mcp']).toEqual(['context7']);
      });

      it('should accumulate multiple --exclude-mcp values', () => {
        const result = parseArgs([
          'start', '--exclude-mcp', 'context7', '--exclude-mcp', 'filesystem'
        ]);
        expect(result['exclude-mcp']).toEqual(['context7', 'filesystem']);
      });

      it('should handle --exclude-mcp alongside other options', () => {
        const result = parseArgs([
          'start', '--model', 'gemini', '--prompt', 'test',
          '--exclude-mcp', 'server1', '--no-ui'
        ]);
        expect(result['exclude-mcp']).toEqual(['server1']);
        expect(result.model).toBe('gemini');
        expect(result['no-ui']).toBe(true);
      });
    });

    describe('MCP server options', () => {
      it('should parse --mcp option with name=url format', () => {
        const result = parseArgs(['start', '--mcp', 'my-server=https://mcp.example.com']);
        expect(result.mcp).toBe('my-server=https://mcp.example.com');
      });

      it('should parse --mcp option with name=command format', () => {
        const result = parseArgs(['start', '--mcp', 'my-server=npx my-mcp-server']);
        expect(result.mcp).toBe('my-server=npx my-mcp-server');
      });

      it('should parse --mcp-config option for custom config path', () => {
        const result = parseArgs(['start', '--mcp-config', '/path/to/opencode.json']);
        expect(result['mcp-config']).toBe('/path/to/opencode.json');
      });

      it('should default mcp to undefined if not specified', () => {
        const result = parseArgs(['start', '--model', 'x', '--prompt', 'y']);
        expect(result.mcp).toBeUndefined();
      });
    });

    describe('--mode and --agent options', () => {
      it('should parse --mode build', () => {
        const result = parseArgs(['start', '--mode', 'build']);
        expect(result.mode).toBe('build');
      });

      it('should parse --mode plan', () => {
        const result = parseArgs(['start', '--mode', 'plan']);
        expect(result.mode).toBe('plan');
      });

      it('should parse --agent explore', () => {
        const result = parseArgs(['start', '--agent', 'explore']);
        expect(result.agent).toBe('explore');
      });

      it('should parse --agent general', () => {
        const result = parseArgs(['start', '--agent', 'general']);
        expect(result.agent).toBe('general');
      });

      it('should default mode to undefined when not specified', () => {
        const result = parseArgs(['start']);
        expect(result.mode).toBeUndefined();
      });
    });

    describe('--no-context flag', () => {
      it('should parse --no-context as boolean flag', () => {
        const result = parseArgs(['start', '--no-context']);
        expect(result['no-context']).toBe(true);
      });

      it('should default --no-context to undefined when not specified', () => {
        const result = parseArgs(['start', '--model', 'x', '--prompt', 'y']);
        expect(result['no-context']).toBeUndefined();
      });

      it('should parse --no-context alongside other options', () => {
        const result = parseArgs([
          'start', '--model', 'gemini', '--prompt', 'test', '--no-context', '--no-ui'
        ]);
        expect(result['no-context']).toBe(true);
        expect(result['no-ui']).toBe(true);
        expect(result.model).toBe('gemini');
      });
    });

    describe('--validate-model flag', () => {
      it('should parse --validate-model as boolean flag', () => {
        const result = parseArgs(['start', '--validate-model', '--model', 'gemini', '--prompt', 'test']);
        expect(result['validate-model']).toBe(true);
        expect(result.model).toBe('gemini');
      });

      it('should not consume the next argument as a value', () => {
        const result = parseArgs(['start', '--validate-model', '--prompt', 'test']);
        expect(result['validate-model']).toBe(true);
        expect(result.prompt).toBe('test');
      });
    });

    describe('--thinking option', () => {
      it('should parse --thinking option with valid effort level', () => {
        const result = parseArgs(['start', '--thinking', 'low']);
        expect(result.thinking).toBe('low');
      });

      it('should parse all valid --thinking effort levels', () => {
        const validLevels = ['minimal', 'low', 'medium', 'high', 'xhigh', 'none'];
        validLevels.forEach(level => {
          const result = parseArgs(['start', '--thinking', level]);
          expect(result.thinking).toBe(level);
        });
      });

      it('should default thinking to undefined if not specified', () => {
        const result = parseArgs(['start', '--model', 'x', '--briefing', 'y']);
        expect(result.thinking).toBeUndefined();
      });

      it('should parse --thinking alongside other options', () => {
        const result = parseArgs([
          'start',
          '--model', 'openrouter/google/gemini-3-pro-preview',
          '--prompt', 'Test task',
          '--thinking', 'high',
          '--no-ui'
        ]);
        expect(result.model).toBe('openrouter/google/gemini-3-pro-preview');
        expect(result.prompt).toBe('Test task');
        expect(result.thinking).toBe('high');
        expect(result['no-ui']).toBe(true);
      });
    });

    describe('--key=value syntax', () => {
      it('should parse --model=gemini as model: "gemini"', () => {
        const result = parseArgs(['start', '--model=gemini', '--prompt', 'test']);
        expect(result.model).toBe('gemini');
      });

      it('should parse --timeout=30 as numeric', () => {
        const result = parseArgs(['start', '--timeout=30']);
        expect(result.timeout).toBe(30);
      });

      it('should handle values containing equals signs', () => {
        const result = parseArgs(['start', '--model=google/gemini-2.5-flash']);
        expect(result.model).toBe('google/gemini-2.5-flash');
      });

      it('should still support --model gemini (space-separated)', () => {
        const result = parseArgs(['start', '--model', 'gemini']);
        expect(result.model).toBe('gemini');
      });
    });
  });

  describe('validateStartArgs', () => {
    it('should pass validation when --model is not provided (resolved externally)', () => {
      // Model resolution happens in handleStart before validateStartArgs is called.
      // When model is undefined, validateStartArgs should skip model format check.
      const args = { _: ['start'], prompt: 'test' };
      const result = validateStartArgs(args);
      // Should pass because model is optional now (resolved before validation)
      expect(result.valid).toBe(true);
    });

    it('should validate model format when a resolved full model string is provided', () => {
      const args = { _: ['start'], model: 'openrouter/google/gemini-3-flash-preview', prompt: 'test' };
      const result = validateStartArgs(args);
      expect(result.valid).toBe(true);
    });

    it('should return error if --prompt is missing', () => {
      const args = { _: ['start'], model: 'google/gemini-2.5' };
      const result = validateStartArgs(args);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('--prompt');
    });

    it('should return valid if both --model and --prompt are present', () => {
      const args = { _: ['start'], model: 'google/gemini-2.5', prompt: 'test' };
      const result = validateStartArgs(args);
      expect(result.valid).toBe(true);
    });

    it('should validate model format (provider/model)', () => {
      const args = { _: ['start'], model: 'invalid', prompt: 'test' };
      const result = validateStartArgs(args);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('provider/model');
    });

    it('should accept valid model formats', () => {
      const validModels = [
        // Direct API formats
        'google/gemini-2.5',
        'google/gemini-2.5-pro',
        'openai/o3',
        'openai/gpt-4.1',
        'anthropic/claude-sonnet-4',
        // OpenRouter formats (3 parts)
        'openrouter/google/gemini-2.5-flash',
        'openrouter/openai/gpt-4o',
        'openrouter/anthropic/claude-sonnet-4'
      ];

      validModels.forEach(model => {
        const args = { _: ['start'], model, prompt: 'test' };
        const result = validateStartArgs(args);
        expect(result.valid).toBe(true);
      });
    });

    it('should validate --thinking with valid effort levels', () => {
      const validLevels = ['minimal', 'low', 'medium', 'high', 'xhigh', 'none'];
      validLevels.forEach(level => {
        const args = { _: ['start'], model: 'google/gemini-2.5', prompt: 'test', thinking: level };
        const result = validateStartArgs(args);
        expect(result.valid).toBe(true);
      });
    });

    it('should reject invalid --thinking effort level', () => {
      const args = { _: ['start'], model: 'google/gemini-2.5', prompt: 'test', thinking: 'invalid' };
      const result = validateStartArgs(args);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('thinking');
    });

    it('should accept start command without --thinking (optional)', () => {
      const args = { _: ['start'], model: 'google/gemini-2.5', prompt: 'test' };
      const result = validateStartArgs(args);
      expect(result.valid).toBe(true);
    });

    it('should validate --timeout is a positive number', () => {
      const args = { _: ['start'], model: 'google/gemini-2.5', prompt: 'test', timeout: -5 };
      const result = validateStartArgs(args);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('timeout');
    });

    it('should validate --context-turns is a positive number', () => {
      const args = { _: ['start'], model: 'google/gemini-2.5', prompt: 'test', 'context-turns': 0 };
      const result = validateStartArgs(args);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('context-turns');
    });

    it('should validate --context-since format (e.g., 2h, 30m, 1d)', () => {
      const validFormats = ['30m', '2h', '1d', '12h', '90m'];
      validFormats.forEach(since => {
        const args = { _: ['start'], model: 'google/gemini-2.5', prompt: 'test', 'context-since': since };
        const result = validateStartArgs(args);
        expect(result.valid).toBe(true);
      });
    });

    it('should reject invalid --context-since format', () => {
      const args = { _: ['start'], model: 'google/gemini-2.5', prompt: 'test', 'context-since': 'invalid' };
      const result = validateStartArgs(args);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('context-since');
    });

    describe('--gateway validation (#61 Task 7.1)', () => {
      it('should accept each valid --gateway mode', () => {
        ['auto', 'direct', 'openrouter'].forEach(gateway => {
          const args = { _: ['start'], model: 'google/gemini-2.5', prompt: 'test', gateway };
          const result = validateStartArgs(args);
          expect(result.valid).toBe(true);
        });
      });

      it('should accept when --gateway is not specified', () => {
        const args = { _: ['start'], model: 'google/gemini-2.5', prompt: 'test' };
        const result = validateStartArgs(args);
        expect(result.valid).toBe(true);
      });

      it('should reject an invalid --gateway value with a clear error', () => {
        const args = { _: ['start'], model: 'google/gemini-2.5', prompt: 'test', gateway: 'bogus' };
        const result = validateStartArgs(args);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('--gateway');
        expect(result.error).toContain('auto, direct, openrouter');
      });
    });
  });

  describe('validateStartArgs - comprehensive validation', () => {
    // Save original environment
    const originalEnv = { ...process.env };

    beforeEach(() => {
      // Set up default API keys so other tests pass
      process.env.OPENROUTER_API_KEY = 'test-key';
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-key';
      process.env.OPENAI_API_KEY = 'test-key';
      process.env.ANTHROPIC_API_KEY = 'test-key';
      process.env.DEEPSEEK_API_KEY = 'test-key';
    });

    afterEach(() => {
      // Restore original environment
      Object.keys(process.env).forEach(key => {
        if (!(key in originalEnv)) {
          delete process.env[key];
        }
      });
      Object.assign(process.env, originalEnv);
    });

    describe('--prompt content validation', () => {
      it('should reject empty prompt', () => {
        const result = validateStartArgs({ model: 'openrouter/google/gemini-2.5-flash', prompt: '' });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('prompt');
      });

      it('should reject whitespace-only prompt', () => {
        const result = validateStartArgs({ model: 'openrouter/google/gemini-2.5-flash', prompt: '   ' });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('prompt');
      });

      it('should accept non-empty prompt', () => {
        const result = validateStartArgs({ model: 'openrouter/google/gemini-2.5-flash', prompt: 'Debug the auth issue' });
        expect(result.valid).toBe(true);
      });

      it('should resolve --prompt-file itself so validation is order-independent', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-cli-prompt-'));
        try {
          const f = path.join(tmp, 'briefing.md');
          fs.writeFileSync(f, 'briefing text');
          const args = { model: 'openrouter/google/gemini-2.5-flash', 'prompt-file': f };
          const result = validateStartArgs(args);
          expect(result.valid).toBe(true);
          expect(args.prompt).toBe('briefing text');
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      });

      it('should reject an empty --prompt-file with MISSING_PROMPT', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-cli-prompt-'));
        try {
          const f = path.join(tmp, 'empty.md');
          fs.writeFileSync(f, '   \n');
          const result = validateStartArgs({ model: 'openrouter/google/gemini-2.5-flash', 'prompt-file': f });
          expect(result.valid).toBe(false);
          expect(result.code).toBe('MISSING_PROMPT');
          expect(result.error).toMatch(/empty/);
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      });
    });

    describe('--cwd validation', () => {
      it('should reject non-existent cwd path', () => {
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          prompt: 'Test task',
          cwd: '/nonexistent/path/12345'
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('cwd');
      });

      it('should accept valid cwd path', () => {
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          prompt: 'Test task',
          cwd: process.cwd()
        });
        expect(result.valid).toBe(true);
      });

      it('should accept when cwd is not specified (uses default)', () => {
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          prompt: 'Test task'
        });
        expect(result.valid).toBe(true);
      });
    });

    describe('--session-id validation', () => {
      it('should reject explicit session-id that does not exist', () => {
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          prompt: 'Test task',
          'session-id': 'nonexistent-session-id-12345',
          cwd: process.cwd()
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('session');
      });

      it('should accept "current" session-id (deferred resolution)', () => {
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          prompt: 'Test task',
          'session-id': 'current'
        });
        expect(result.valid).toBe(true);
      });

      it('should accept undefined session-id (uses default)', () => {
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          prompt: 'Test task'
        });
        expect(result.valid).toBe(true);
      });
    });

    describe('--agent validation', () => {
      it('should reject empty agent name', () => {
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          prompt: 'Test task',
          agent: '   '
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('agent');
      });

      it.each(['Build', 'Plan', 'General', 'Explore'])('should accept OpenCode native agent: %s', (agent) => {
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          prompt: 'Test task',
          agent
        });
        expect(result.valid).toBe(true);
      });

      it('should accept custom agent names (for user-defined OpenCode agents)', () => {
        // OpenCode allows custom agents defined in ~/.config/opencode/agents/
        // These should be passed through and validated by OpenCode at runtime
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          prompt: 'Test task',
          agent: 'my-custom-agent'
        });
        expect(result.valid).toBe(true);
      });

      it('should accept when agent is not specified', () => {
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          prompt: 'Test task'
        });
        expect(result.valid).toBe(true);
      });
    });

    describe('headless agent validation (--no-ui + --agent)', () => {
      it('should reject --agent chat with --no-ui', () => {
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          prompt: 'Test task',
          agent: 'chat',
          'no-ui': true
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('interactive');
      });

      it('should reject --agent Chat (case-insensitive) with --no-ui', () => {
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          prompt: 'Test task',
          agent: 'Chat',
          'no-ui': true
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('interactive');
      });

      it.each(['build', 'plan', 'explore', 'general'])('should accept --agent %s with --no-ui', (agent) => {
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          prompt: 'Test task',
          agent,
          'no-ui': true
        });
        expect(result.valid).toBe(true);
      });

      it('should accept custom agent with --no-ui (with warning)', () => {
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          prompt: 'Test task',
          agent: 'my-custom-agent',
          'no-ui': true
        });
        expect(result.valid).toBe(true);
        expect(result.warning).toBeDefined();
      });

      it('should accept --agent chat without --no-ui (interactive is fine)', () => {
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          prompt: 'Test task',
          agent: 'chat'
        });
        expect(result.valid).toBe(true);
      });

      it('should accept no agent + --no-ui (defaults to build)', () => {
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          prompt: 'Test task',
          'no-ui': true
        });
        expect(result.valid).toBe(true);
      });
    });

    describe('--client validation', () => {
      it('should accept valid client values (non-web)', () => {
        const validClients = ['code-local', 'cowork'];
        validClients.forEach(client => {
          const result = validateStartArgs({
            model: 'openrouter/google/gemini-2.5-flash',
            prompt: 'Test task',
            client
          });
          expect(result.valid).toBe(true);
        });
      });

      it('should reject invalid client value', () => {
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          prompt: 'Test task',
          client: 'invalid-client'
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('--client');
      });

      it('should accept when client is not specified', () => {
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          prompt: 'Test task'
        });
        expect(result.valid).toBe(true);
      });

      it('should require --session-dir when client is code-web', () => {
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          prompt: 'Test task',
          client: 'code-web'
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('--session-dir');
      });

      it('should accept code-web with --session-dir', () => {
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          prompt: 'Test task',
          client: 'code-web',
          'session-dir': '/tmp/test-sessions'
        });
        expect(result.valid).toBe(true);
      });
    });

    // MCP flags are OPTIONAL - only validated if explicitly provided
    describe('--mcp validation (optional, only if provided)', () => {
      it('should pass when --mcp is not provided', () => {
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          prompt: 'Test task'
        });
        expect(result.valid).toBe(true);
      });

      it('should reject invalid MCP format when provided', () => {
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          prompt: 'Test task',
          mcp: 'invalid-format-no-equals'
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('mcp');
      });

      it('should accept valid MCP URL format when provided', () => {
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          prompt: 'Test task',
          mcp: 'myserver=http://localhost:3000'
        });
        expect(result.valid).toBe(true);
      });

      it('should accept valid MCP command format when provided', () => {
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          prompt: 'Test task',
          mcp: 'myserver=npx some-mcp-server'
        });
        expect(result.valid).toBe(true);
      });
    });

    describe('--mcp-config validation (optional, only if provided)', () => {
      it('should pass when --mcp-config is not provided', () => {
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          prompt: 'Test task'
        });
        expect(result.valid).toBe(true);
      });

      it('should reject non-existent config file when provided', () => {
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          prompt: 'Test task',
          'mcp-config': '/nonexistent/mcp-config.json'
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('mcp-config');
      });
    });

    describe('API key validation', () => {
      let existsSyncSpy;

      beforeEach(() => {
        // Mock fs.existsSync so auth.json fallback doesn't short-circuit validation
        const fs = require('fs');
        const realExistsSync = fs.existsSync;
        existsSyncSpy = jest.spyOn(fs, 'existsSync').mockImplementation((p) => {
          if (typeof p === 'string' && p.includes('auth.json')) {
            return false;
          }
          return realExistsSync(p);
        });
      });

      afterEach(() => {
        existsSyncSpy.mockRestore();
      });

      it('should error when OPENROUTER_API_KEY is missing for openrouter model', () => {
        delete process.env.OPENROUTER_API_KEY;
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          prompt: 'Test task'
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('OPENROUTER_API_KEY');
      });

      it('should error when GOOGLE_GENERATIVE_AI_API_KEY is missing for google model', () => {
        delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        const result = validateStartArgs({
          model: 'google/gemini-2.5-flash',
          prompt: 'Test task'
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('GOOGLE_GENERATIVE_AI_API_KEY');
      });

      it('should error when OPENAI_API_KEY is missing for openai model', () => {
        delete process.env.OPENAI_API_KEY;
        const result = validateStartArgs({
          model: 'openai/gpt-4o',
          prompt: 'Test task'
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('OPENAI_API_KEY');
      });

      it('should error when ANTHROPIC_API_KEY is missing for anthropic model', () => {
        delete process.env.ANTHROPIC_API_KEY;
        const result = validateStartArgs({
          model: 'anthropic/claude-sonnet-4',
          prompt: 'Test task'
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('ANTHROPIC_API_KEY');
      });

      it('should error when DEEPSEEK_API_KEY is missing for deepseek model', () => {
        delete process.env.DEEPSEEK_API_KEY;
        const result = validateStartArgs({
          model: 'deepseek/deepseek-chat',
          prompt: 'Test task'
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('DEEPSEEK_API_KEY');
      });

      it('should pass when correct API key is set', () => {
        process.env.OPENROUTER_API_KEY = 'sk-or-test-key';
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          prompt: 'Test task'
        });
        expect(result.valid).toBe(true);
      });

      it('should pass for unknown provider (let runtime handle it)', () => {
        const result = validateStartArgs({
          model: 'custom-provider/some-model',
          prompt: 'Test task'
        });
        expect(result.valid).toBe(true);
      });
    });
  });

  describe('mcp command', () => {
    test('parseArgs recognizes mcp as a command', () => {
      const args = parseArgs(['mcp']);
      expect(args._[0]).toBe('mcp');
    });

    test('mcp command appears in usage text as a command', () => {
      const { getUsage } = require('../src/cli');
      const usage = getUsage();
      // Should appear in the Commands section as its own line
      expect(usage).toMatch(/^\s+mcp\s+.*MCP server/m);
    });
  });

  describe('abort command', () => {
    test('parseArgs recognizes abort as a command', () => {
      const args = parseArgs(['abort', 'task123']);
      expect(args._[0]).toBe('abort');
      expect(args._[1]).toBe('task123');
    });
  });

  describe('spend command', () => {
    test('parseArgs recognizes spend as a command', () => {
      const args = parseArgs(['spend']);
      expect(args._[0]).toBe('spend');
    });

    test('parseArgs reads --since as a value flag (not swallowed as boolean)', () => {
      const args = parseArgs(['spend', '--since', '7d', '--json']);
      expect(args.since).toBe('7d');
      expect(args.json).toBe(true);
    });

    test('spend command appears in usage text', () => {
      const { getUsage } = require('../src/cli');
      const usage = getUsage();
      expect(usage).toMatch(/^\s+spend\s+/m);
    });
  });

  describe('provider command', () => {
    test('parseArgs recognizes provider add <id> with sub + id positionals', () => {
      const args = parseArgs(['provider', 'add', 'ollama', '--preset', 'ollama']);
      expect(args._[0]).toBe('provider');
      expect(args._[1]).toBe('add');
      expect(args._[2]).toBe('ollama');
      expect(args.preset).toBe('ollama');
    });

    test('--json is a boolean flag and does not swallow a following positional', () => {
      const args = parseArgs(['provider', 'list', '--json']);
      expect(args.json).toBe(true);
      expect(args._).toEqual(['provider', 'list']);
    });

    test('provider appears in the top-level usage command list (C7)', () => {
      const { getUsage } = require('../src/cli');
      expect(getUsage()).toMatch(/^\s+provider\s+/m);
    });

    test("getUsage('provider') prints only the provider section", () => {
      const { getUsage } = require('../src/cli');
      const usage = getUsage('provider');
      expect(usage).toContain("Options for 'provider':");
      expect(usage).toContain('--preset');
      expect(usage).toContain('Usage: amicus'); // top-level header still present
      expect(usage).not.toContain("Options for 'start':");
    });
  });

  describe('init command', () => {
    test('parseArgs recognizes init as a command', () => {
      const args = parseArgs(['init']);
      expect(args._[0]).toBe('init');
    });

    test('--claude and --desktop are boolean flags and do not swallow a following positional', () => {
      const args = parseArgs(['init', '--claude']);
      expect(args.claude).toBe(true);
      expect(args._).toEqual(['init']);
    });

    test('init appears in the top-level usage command list', () => {
      const { getUsage } = require('../src/cli');
      expect(getUsage()).toMatch(/^\s+init\s+/m);
    });

    test("getUsage('init') prints only the init section", () => {
      const { getUsage } = require('../src/cli');
      const usage = getUsage('init');
      expect(usage).toContain("Options for 'init':");
      expect(usage).toContain('--claude');
      expect(usage).toContain('--desktop');
      expect(usage).toContain('Usage: amicus'); // top-level header still present
      expect(usage).not.toContain("Options for 'start':");
    });
  });

  describe('models command', () => {
    // v4.6.2 PR3 Task 4 (review Minor 2): --live is registered in cli.js's
    // BOOLEAN_FLAGS (Task 3) but never had a parseArgs pin of its own — prove
    // the real parser treats it as boolean and that --check (also boolean)
    // doesn't swallow it, with positionals still intact.
    test('--live is a boolean flag and does not disturb --check or positionals', () => {
      const args = parseArgs(['models', '--check', '--live']);
      expect(args.live).toBe(true);
      expect(args.check).toBe(true);
      expect(args._).toEqual(['models']);
    });
  });

  describe('usage text includes new options', () => {
    test('--no-mcp appears in usage', () => {
      const { getUsage } = require('../src/cli');
      const usage = getUsage();
      expect(usage).toContain('--no-mcp');
    });

    test('--exclude-mcp appears in usage', () => {
      const { getUsage } = require('../src/cli');
      const usage = getUsage();
      expect(usage).toContain('--exclude-mcp');
    });

    test('abort command appears in usage', () => {
      const { getUsage } = require('../src/cli');
      const usage = getUsage();
      expect(usage).toContain('abort');
    });

    test('--no-context appears in usage', () => {
      const { getUsage } = require('../src/cli');
      const usage = getUsage();
      expect(usage).toContain('--no-context');
    });

    test('status command appears in usage', () => {
      const { getUsage } = require('../src/cli');
      expect(getUsage()).toMatch(/^\s+status\s+One-shot status/m);
      expect(getUsage('status')).toContain("Options for 'status':");
    });
  });

  describe('per-subcommand --help (#16)', () => {
    test('bare getUsage() is unchanged when passing undefined', () => {
      const { getUsage } = require('../src/cli');
      // Passing undefined must be byte-identical to passing nothing.
      expect(getUsage(undefined)).toBe(getUsage());
    });

    test("getUsage('start') prints only the start section", () => {
      const { getUsage } = require('../src/cli');
      const usage = getUsage('start');
      expect(usage).toContain("Options for 'start':");
      // start-only flag present
      expect(usage).toContain('--fold-shortcut');
      // other subcommands' option blocks absent
      expect(usage).not.toContain("Options for 'fanout':");
      expect(usage).not.toContain("Options for 'read':");
      expect(usage).not.toContain("Options for 'models':");
    });

    test("getUsage('fanout') prints only the fanout section", () => {
      const { getUsage } = require('../src/cli');
      const usage = getUsage('fanout');
      expect(usage).toContain("Options for 'fanout':");
      expect(usage).toContain('--council');
      expect(usage).not.toContain("Options for 'start':");
      expect(usage).not.toContain("Options for 'list':");
    });

    test("getUsage('models') prints only the models section", () => {
      const { getUsage } = require('../src/cli');
      const usage = getUsage('models');
      expect(usage).toContain("Options for 'models':");
      expect(usage).toContain('--refresh');
      expect(usage).not.toContain("Options for 'start':");
      expect(usage).not.toContain("Options for 'fanout':");
    });

    test("getUsage('list') prints only the list section", () => {
      const { getUsage } = require('../src/cli');
      const usage = getUsage('list');
      expect(usage).toContain("Options for 'list':");
      expect(usage).toContain('--status');
      expect(usage).not.toContain("Options for 'start':");
    });

    test("getUsage('abort') prints only the abort section", () => {
      const { getUsage } = require('../src/cli');
      const usage = getUsage('abort');
      expect(usage).toContain("Options for 'abort':");
      expect(usage).toContain('--all');
      expect(usage).not.toContain("Options for 'start':");
    });

    test("getUsage('read') prints only the read section", () => {
      const { getUsage } = require('../src/cli');
      const usage = getUsage('read');
      expect(usage).toContain("Options for 'read':");
      expect(usage).toContain('--conversation');
      expect(usage).not.toContain("Options for 'start':");
    });

    test('every scoped help still shows the top-level Usage line', () => {
      const { getUsage } = require('../src/cli');
      for (const cmd of ['start', 'fanout', 'models', 'list', 'abort', 'read']) {
        expect(getUsage(cmd)).toContain('Usage: amicus');
      }
    });

    test('a command with no dedicated options block falls back to full usage', () => {
      const { getUsage } = require('../src/cli');
      // 'update' has no "Options for" block; scoped help should not be empty.
      expect(getUsage('update')).toBe(getUsage());
    });
  });

  describe('per-command --help for council + remaining commands (follow-up to #16)', () => {
    const { getUsage } = require('../src/cli');

    test("getUsage('council') prints only the council section", () => {
      const usage = getUsage('council');
      expect(usage).toContain("Subcommands for 'council':");
      // documents its real subcommands
      expect(usage).toContain('tally');
      expect(usage).toContain('stats');
      expect(usage).toContain('report');
      // council-only flag present (from the real surface)
      expect(usage).toContain('--no-ledger');
      // other subcommands' option blocks absent
      expect(usage).not.toContain("Options for 'start':");
      expect(usage).not.toContain("Options for 'fanout':");
      expect(usage).not.toContain("Options for 'read':");
    });

    test("getUsage('council') lists all 8 subcommands, including save|list|show (adversarial-review Fix 3: docs/council.md's 'Known binary gap' note is retired because this is now true)", () => {
      const usage = getUsage('council');
      for (const sub of ['tally', 'stats', 'report', 'validate', 'verdict', 'save', 'list', 'show']) {
        // Each subcommand must appear as its own usage line (word-boundary
        // match against 2-space-indented start), not merely as a substring
        // of some other word.
        expect(usage).toMatch(new RegExp('^\\s{2}' + sub + '\\b', 'm'));
      }
    });

    test("getUsage('council') documents save/list/show's real flags mirroring presets-cli.js", () => {
      const usage = getUsage('council');
      // save <name> --models a,b,c
      expect(usage).toMatch(/save\s+<name>[^\n]*--models/);
      // list, followed (on the next indented line, like every other sub) by --json
      const listIdx = usage.search(/^\s{2}list\b/m);
      expect(listIdx).toBeGreaterThan(-1);
      expect(usage.slice(listIdx, listIdx + 120)).toMatch(/--json/);
      // show <name>, followed by --json
      const showIdx = usage.search(/^\s{2}show\b/m);
      expect(showIdx).toBeGreaterThan(-1);
      expect(usage.slice(showIdx, showIdx + 120)).toMatch(/--json/);
    });

    test("getUsage('continue') prints only the continue section", () => {
      const usage = getUsage('continue');
      expect(usage).toContain("Options for 'continue':");
      expect(usage).toContain('--prompt');
      // continue does NOT support --prompt-file (handleContinue reads only
      // args.prompt/args.briefing); the block must not advertise it.
      expect(usage).not.toContain('--prompt-file');
      expect(usage).not.toContain("Options for 'start':");
      expect(usage).not.toContain("Options for 'fanout':");
    });

    test("getUsage('resume') prints only the resume section", () => {
      const usage = getUsage('resume');
      expect(usage).toContain("Options for 'resume':");
      expect(usage).toContain('--no-ui');
      expect(usage).not.toContain("Options for 'start':");
    });

    test("getUsage('doctor') prints only the doctor section", () => {
      const usage = getUsage('doctor');
      expect(usage).toContain("Options for 'doctor':");
      expect(usage).toContain('--json');
      expect(usage).not.toContain("Options for 'start':");
    });

    test("getUsage('spend') prints only the spend section", () => {
      const usage = getUsage('spend');
      expect(usage).toContain("Options for 'spend':");
      expect(usage).toContain('--since');
      expect(usage).toContain('--json');
      expect(usage).not.toContain("Options for 'start':");
      expect(usage).not.toContain("Options for 'doctor':");
    });

    test("getUsage('setup') prints only the setup section", () => {
      const usage = getUsage('setup');
      expect(usage).toContain("Options for 'setup':");
      expect(usage).toContain('--api-keys');
      expect(usage).toContain('--add-alias');
      expect(usage).not.toContain("Options for 'start':");
    });

    test("getUsage('key') prints only the key section", () => {
      const usage = getUsage('key');
      expect(usage).toContain("Usage for 'key':");
      expect(usage).toContain('--remove');
      expect(usage).not.toContain("Options for 'start':");
    });

    test("getUsage('mcp') prints only the mcp section", () => {
      const usage = getUsage('mcp');
      expect(usage).toContain("Usage for 'mcp':");
      expect(usage).toContain('stdio');
      expect(usage).not.toContain("Options for 'start':");
    });

    test('every newly-covered command still shows the top-level Usage line', () => {
      for (const cmd of ['council', 'continue', 'resume', 'doctor', 'spend', 'setup', 'key', 'mcp']) {
        expect(getUsage(cmd)).toContain('Usage: amicus');
      }
    });

    test('the original 6 blocks (#16) are unchanged in scoped output', () => {
      expect(getUsage('start')).toContain("Options for 'start':");
      expect(getUsage('start')).toContain('--fold-shortcut');
      expect(getUsage('fanout')).toContain('--council');
      expect(getUsage('models')).toContain('--refresh');
      expect(getUsage('list')).toContain('--status');
      expect(getUsage('abort')).toContain('--all');
      expect(getUsage('read')).toContain('--conversation');
    });

    test('bare getUsage() still composes every block (header + all blocks + trailer)', () => {
      const full = getUsage();
      // existing #16 blocks
      expect(full).toContain("Options for 'start':");
      expect(full).toContain("Options for 'fanout':");
      // newly added blocks
      expect(full).toContain("Subcommands for 'council':");
      expect(full).toContain("Options for 'continue':");
      expect(full).toContain("Options for 'resume':");
      expect(full).toContain("Options for 'doctor':");
      expect(full).toContain("Options for 'setup':");
      expect(full).toContain("Usage for 'key':");
      expect(full).toContain("Usage for 'mcp':");
      // header + trailer still present
      expect(full).toContain('Usage: amicus <command> [options]');
      expect(full).toContain('OpenCode Agent Types:');
    });
  });

});

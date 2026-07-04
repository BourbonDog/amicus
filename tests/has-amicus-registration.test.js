// tests/has-amicus-registration.test.js
//
// B14: `amicus doctor` false-negatives the MCP-registration check because its
// only signal (discoverClaudeCodeMcps) strips every 'amicus'/'sidecar' entry
// as a recursive-spawn guard (src/utils/mcp-self-identity.js) — so
// code.amicus is ALWAYS undefined, even with a healthy registration.
//
// hasAmicusRegistration() reads the SAME raw sources (~/.claude.json
// mcpServers + plugin-chain .mcp.json files) WITHOUT stripping, so doctor can
// see the real entry. Precedents for raw (unstripped) reads: postinstall.js
// readPrevClaudeCodeAmicusEntry(), legacy-mcp-migration.js
// inspectLegacySidecarEntry().
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

jest.mock('../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

describe('hasAmicusRegistration', () => {
  let hasAmicusRegistration;
  let tmpDir;

  beforeEach(() => {
    jest.resetModules();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'has-amicus-reg-test-'));
    hasAmicusRegistration = require('../src/utils/mcp-discovery').hasAmicusRegistration;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeClaudeJson(claudeJsonPath, mcpServers) {
    fs.writeFileSync(claudeJsonPath, JSON.stringify({ mcpServers }));
  }

  function claudeJsonPathFor(dir) {
    return path.join(dir, 'claude.json');
  }

  function claudeDirFor(dir) {
    // No settings.json/plugin chain needed for these fixtures — the function
    // must tolerate an absent plugin chain the same way discoverClaudeCodeMcps does.
    return path.join(dir, '.claude-missing');
  }

  describe('positive: real postinstall/registration shapes are detected', () => {
    test('npx amicus@latest mcp (current postinstall shape)', () => {
      const claudeJsonPath = claudeJsonPathFor(tmpDir);
      writeClaudeJson(claudeJsonPath, {
        amicus: { command: 'npx', args: ['-y', 'amicus@latest', 'mcp'] }
      });
      expect(hasAmicusRegistration(claudeDirFor(tmpDir), claudeJsonPath)).toBe(true);
    });

    test('npx amicus mcp (unversioned)', () => {
      const claudeJsonPath = claudeJsonPathFor(tmpDir);
      writeClaudeJson(claudeJsonPath, {
        amicus: { command: 'npx', args: ['-y', 'amicus', 'mcp'] }
      });
      expect(hasAmicusRegistration(claudeDirFor(tmpDir), claudeJsonPath)).toBe(true);
    });

    test('npx amicus@1.0.0 mcp (pinned version)', () => {
      const claudeJsonPath = claudeJsonPathFor(tmpDir);
      writeClaudeJson(claudeJsonPath, {
        amicus: { command: 'npx', args: ['-y', 'amicus@1.0.0', 'mcp'] }
      });
      expect(hasAmicusRegistration(claudeDirFor(tmpDir), claudeJsonPath)).toBe(true);
    });

    test('bare "amicus mcp" (global bin on PATH)', () => {
      const claudeJsonPath = claudeJsonPathFor(tmpDir);
      writeClaudeJson(claudeJsonPath, {
        amicus: { command: 'amicus', args: ['mcp'] }
      });
      expect(hasAmicusRegistration(claudeDirFor(tmpDir), claudeJsonPath)).toBe(true);
    });

    test('node <path>/bin/amicus.js mcp (local/dev install)', () => {
      const claudeJsonPath = claudeJsonPathFor(tmpDir);
      writeClaudeJson(claudeJsonPath, {
        amicus: { command: 'node', args: ['C:\\Users\\me\\code\\amicus\\bin\\amicus.js', 'mcp'] }
      });
      expect(hasAmicusRegistration(claudeDirFor(tmpDir), claudeJsonPath)).toBe(true);
    });

    test("key literally 'amicus' with an unrecognizable value still counts (key-based match)", () => {
      const claudeJsonPath = claudeJsonPathFor(tmpDir);
      writeClaudeJson(claudeJsonPath, {
        amicus: { command: 'some-custom-wrapper', args: ['--whatever'] }
      });
      expect(hasAmicusRegistration(claudeDirFor(tmpDir), claudeJsonPath)).toBe(true);
    });

    test('extra env key present does not break detection', () => {
      const claudeJsonPath = claudeJsonPathFor(tmpDir);
      writeClaudeJson(claudeJsonPath, {
        amicus: { command: 'npx', args: ['-y', 'amicus@latest', 'mcp'], env: { OPENROUTER_API_KEY: 'sk-or-x' } }
      });
      expect(hasAmicusRegistration(claudeDirFor(tmpDir), claudeJsonPath)).toBe(true);
    });

    test("amicus-shaped config under a DIFFERENT key ('my-amicus') still counts (value-based match)", () => {
      const claudeJsonPath = claudeJsonPathFor(tmpDir);
      writeClaudeJson(claudeJsonPath, {
        'my-amicus': { command: 'npx', args: ['-y', 'amicus@latest', 'mcp'] }
      });
      expect(hasAmicusRegistration(claudeDirFor(tmpDir), claudeJsonPath)).toBe(true);
    });

    test('legacy sidecar key with an amicus-shaped value counts too', () => {
      const claudeJsonPath = claudeJsonPathFor(tmpDir);
      writeClaudeJson(claudeJsonPath, {
        sidecar: { command: 'npx', args: ['-y', 'amicus@latest', 'mcp'] }
      });
      expect(hasAmicusRegistration(claudeDirFor(tmpDir), claudeJsonPath)).toBe(true);
    });

    test('registered via a plugin-chain .mcp.json entry (no ~/.claude.json entry at all)', () => {
      const claudeDir = path.join(tmpDir, '.claude');
      const pluginsDir = path.join(claudeDir, 'plugins');
      const installDir = path.join(tmpDir, 'amicus-plugin');
      fs.mkdirSync(pluginsDir, { recursive: true });
      fs.mkdirSync(installDir, { recursive: true });
      fs.writeFileSync(path.join(claudeDir, 'settings.json'),
        JSON.stringify({ enabledPlugins: { 'amicus-plugin': true } }));
      fs.writeFileSync(path.join(pluginsDir, 'installed_plugins.json'),
        JSON.stringify({ plugins: { 'amicus-plugin': { installPath: installDir } } }));
      fs.writeFileSync(path.join(installDir, '.mcp.json'),
        JSON.stringify({ amicus: { command: 'npx', args: ['-y', 'amicus@latest', 'mcp'] } }));

      const missingClaudeJson = path.join(tmpDir, 'nonexistent-claude.json');
      expect(hasAmicusRegistration(claudeDir, missingClaudeJson)).toBe(true);
    });
  });

  describe('negative cases: never a false positive', () => {
    test('empty mcpServers → false', () => {
      const claudeJsonPath = claudeJsonPathFor(tmpDir);
      writeClaudeJson(claudeJsonPath, {});
      expect(hasAmicusRegistration(claudeDirFor(tmpDir), claudeJsonPath)).toBe(false);
    });

    test('missing ~/.claude.json file entirely → false', () => {
      const missingPath = path.join(tmpDir, 'nonexistent.json');
      expect(hasAmicusRegistration(claudeDirFor(tmpDir), missingPath)).toBe(false);
    });

    test('URL-only config under an unrelated key → false (never self, per legacy-mcp-migration.test.js:146)', () => {
      const claudeJsonPath = claudeJsonPathFor(tmpDir);
      writeClaudeJson(claudeJsonPath, {
        'some-remote-server': { url: 'http://localhost:1234/sse' }
      });
      expect(hasAmicusRegistration(claudeDirFor(tmpDir), claudeJsonPath)).toBe(false);
    });

    test('unrelated real MCP servers present → false', () => {
      const claudeJsonPath = claudeJsonPathFor(tmpDir);
      writeClaudeJson(claudeJsonPath, {
        'google-workspace': { command: 'node', args: ['/path/to/workspace-server/dist/index.js'] },
        'my-server': { command: 'npx', args: ['@some/other-mcp'] }
      });
      expect(hasAmicusRegistration(claudeDirFor(tmpDir), claudeJsonPath)).toBe(false);
    });

    test('malformed JSON in ~/.claude.json degrades to false, never throws', () => {
      const claudeJsonPath = claudeJsonPathFor(tmpDir);
      fs.writeFileSync(claudeJsonPath, '{ not valid json');
      expect(() => hasAmicusRegistration(claudeDirFor(tmpDir), claudeJsonPath)).not.toThrow();
      expect(hasAmicusRegistration(claudeDirFor(tmpDir), claudeJsonPath)).toBe(false);
    });
  });

  describe('the false-negative this task fixes', () => {
    test('discoverClaudeCodeMcps sees nothing (strips amicus) while hasAmicusRegistration sees it', () => {
      const claudeJsonPath = claudeJsonPathFor(tmpDir);
      writeClaudeJson(claudeJsonPath, {
        amicus: { command: 'npx', args: ['-y', 'amicus@latest', 'mcp'] }
      });
      const { discoverClaudeCodeMcps } = require('../src/utils/mcp-discovery');
      const stripped = discoverClaudeCodeMcps(claudeDirFor(tmpDir), claudeJsonPath);
      expect(stripped).toBeNull(); // confirms the documented stripping behavior is unchanged
      expect(hasAmicusRegistration(claudeDirFor(tmpDir), claudeJsonPath)).toBe(true);
    });
  });
});

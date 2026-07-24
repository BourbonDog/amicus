// tests/claude-register.test.js
//
// Direct tests for the Task 15 extraction target: src/utils/claude-register.js.
//
// ISOLATION (read before adding a test here): every test that touches
// registration behavior redirects os.homedir()/process.env.APPDATA to a
// fresh tmp dir created in beforeEach and destroyed in afterEach, and
// child_process is fully jest.mock()'d so registerClaudeCode can NEVER shell
// out to a real `claude` binary regardless of which internal branch runs.
// This mirrors tests/postinstall-legacy-mcp.test.js's fixture exactly. This
// file must NEVER read or write ~/.claude.json, the real Claude Desktop
// config, or ~/.claude/skills on the machine running the suite.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('child_process', () => ({
  execFileSync: jest.fn(),
}));
const { execFileSync } = require('child_process');

const reg = require('../src/utils/claude-register');

describe('claude-register module surface', () => {
  test('claude-register exposes the extracted registration core', () => {
    for (const fn of ['installSkill', 'installCouncilSkill', 'registerClaudeCode', 'registerClaudeDesktop', 'migrateLegacyMcp', 'addMcpToConfigFile']) {
      expect(typeof reg[fn]).toBe('function');
    }
    expect(reg.MCP_CONFIG).toEqual({ command: 'npx', args: ['-y', 'amicus@latest', 'mcp'] });
  });

  // M9: the brief's original body here was a second vacuous typeof check
  // (already covered above). Mirrors tests/postinstall-legacy-mcp.test.js:147-190
  // ("preserves user env on re-registration") with a real behavioral assertion,
  // isolated to a throwaway tmpdir file (never a real config path).
  test('addMcpToConfigFile merges an amicus-shaped prev entry env (parity carried over)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-'));
    const file = path.join(dir, 'claude_desktop_config.json');
    fs.writeFileSync(file, JSON.stringify({
      mcpServers: { amicus: { command: 'npx', args: ['-y', 'amicus@latest', 'mcp'], env: { AMICUS_LOG_LEVEL: 'debug' } } },
    }, null, 2));
    reg.addMcpToConfigFile(file, 'amicus', reg.MCP_CONFIG);
    const after = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(after.mcpServers.amicus.env).toEqual({ AMICUS_LOG_LEVEL: 'debug' });   // user env survives
    expect(after.mcpServers.amicus.args).toEqual(['-y', 'amicus@latest', 'mcp']); // config refreshed
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// Everything below touches os.homedir()/APPDATA — ALWAYS redirected to a
// throwaway tmp dir, NEVER the real user profile. child_process stays fully
// mocked (see top of file) so registerClaudeCode can never invoke a real
// `claude` binary no matter which branch executes.
describe('registration core — isolated from real Claude config', () => {
  let tmpHome; let homedirSpy; let savedAppData;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-register-'));
    homedirSpy = jest.spyOn(os, 'homedir').mockReturnValue(tmpHome);
    savedAppData = process.env.APPDATA;
    process.env.APPDATA = path.join(tmpHome, 'AppData', 'Roaming'); // win32 Desktop path
    execFileSync.mockReset();
    execFileSync.mockImplementation(() => { throw new Error('claude CLI unavailable in tests'); });
  });

  afterEach(() => {
    homedirSpy.mockRestore();
    if (savedAppData === undefined) { delete process.env.APPDATA; } else { process.env.APPDATA = savedAppData; }
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  // M18: registerClaudeDesktop must RETURN its status (previously computed,
  // then discarded — callers always saw undefined).
  test('registerClaudeDesktop returns "added" then "unchanged" on the second call (M18)', () => {
    expect(reg.registerClaudeDesktop()).toBe('added');
    expect(reg.registerClaudeDesktop()).toBe('unchanged');
  });

  // M18: file-fallback branch of registerClaudeCode must RETURN its status.
  test('registerClaudeCode (file-fallback, CLI unavailable) returns "added" then "unchanged" (M18)', () => {
    expect(reg.registerClaudeCode()).toBe('added'); // execFileSync throws -> file fallback
    expect(reg.registerClaudeCode()).toBe('unchanged');
    const config = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude.json'), 'utf-8'));
    expect(config.mcpServers.amicus).toEqual(reg.MCP_CONFIG);
  });

  // M18: the CLI-success branch "structurally cannot distinguish
  // added/updated/unchanged without new plumbing" per the brief — resolved by
  // reusing the same prev-vs-next comparison addMcpToConfigFile uses,
  // computed from data already in hand (readPrevClaudeCodeAmicusEntry) before
  // the CLI call, since add-json is about to write exactly that payload.
  test('registerClaudeCode (CLI succeeds) returns "added" for a fresh registration', () => {
    execFileSync.mockImplementation(() => Buffer.from('')); // CLI "succeeds"
    const status = reg.registerClaudeCode();
    expect(status).toBe('added');
    expect(execFileSync).toHaveBeenCalledWith('claude', expect.arrayContaining(['add-json']), expect.anything());
  });

  test('registerClaudeCode (CLI succeeds) returns "unchanged" when the prior entry is identical', () => {
    fs.writeFileSync(path.join(tmpHome, '.claude.json'), JSON.stringify({
      mcpServers: { amicus: reg.MCP_CONFIG },
    }, null, 2));
    execFileSync.mockImplementation(() => Buffer.from(''));
    expect(reg.registerClaudeCode()).toBe('unchanged');
  });

  test('registerClaudeCode (CLI succeeds) returns "updated" when the prior entry differs', () => {
    fs.writeFileSync(path.join(tmpHome, '.claude.json'), JSON.stringify({
      mcpServers: { amicus: { command: 'npx', args: ['-y', 'amicus@1.0.0', 'mcp'] } },
    }, null, 2));
    execFileSync.mockImplementation(() => Buffer.from(''));
    expect(reg.registerClaudeCode()).toBe('updated');
  });

  // B13 proof at the claude-register.js level (the postinstall suite proves
  // it indirectly, through the re-export): a broken './legacy-mcp-migration'
  // require would throw MODULE_NOT_FOUND inside migrateLegacyMcp's try/catch
  // and silently log a "cleanup skipped" warning instead of doing anything —
  // assert that never happens.
  test('migrateLegacyMcp resolves ./legacy-mcp-migration correctly (B13) — no "cleanup skipped" warning', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      reg.migrateLegacyMcp();
    } finally {
      warnSpy.mockRestore();
    }
    const warnings = warnSpy.mock.calls.map((c) => c.join(' '));
    expect(warnings.some((w) => w.includes('cleanup skipped'))).toBe(false);
  });

  // B13 proof for the require fixed inside addMcpToConfigFile/registerClaudeCode
  // (isAmicusMcpConfig via './mcp-self-identity') PLUS the source-path fix
  // (SKILL_SOURCE now needs two '..' from src/utils/, not one from scripts/):
  // installSkill must still find and copy the real repo source.
  test('installSkill copies from the real skills/sidecar/ source into the (fake) home', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      reg.installSkill();
    } finally {
      logSpy.mockRestore();
    }
    expect(fs.existsSync(path.join(tmpHome, '.claude', 'skills', 'sidecar', 'SKILL.md'))).toBe(true);
  });

  test('installCouncilSkill copies from the real skills/second-opinion/ source into the (fake) home', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      reg.installCouncilSkill();
    } finally {
      logSpy.mockRestore();
    }
    expect(fs.existsSync(path.join(tmpHome, '.claude', 'skills', 'second-opinion', 'SKILL.md'))).toBe(true);
  });
});

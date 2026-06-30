// tests/cli-handlers-doctor.test.js
'use strict';
const { runDoctorChecks } = require('../src/cli-handlers-doctor');

const allGood = {
  nodeVersion: 'v20.0.0',
  readApiKeys: () => ({ openrouter: true, google: false, openai: false, anthropic: false, deepseek: false }),
  getConfigDir: () => '/cfg',
  resolveModel: () => 'openrouter/google/gemini-3.5-flash',
  readCache: () => ({ fetchedAt: Date.now(), models: [{ id: 'openrouter/google/gemini-3.5-flash' }] }),
  collectAliasSources: () => [{ alias: 'gemini', model: 'openrouter/google/gemini-3.5-flash', source: 'defaults' }],
  findStaleAliases: () => [],
  hasOpencodeBinary: () => true,
  getElectronPath: () => '/path/to/electron',
  discoverClaudeCodeMcps: () => ({ amicus: {} }),
  discoverCoworkMcps: () => ({ amicus: {} }),
  skillInstalled: () => true,
};

const byId = (checks) => Object.fromEntries(checks.map(c => [c.id, c]));

describe('runDoctorChecks', () => {
  test('all healthy → every check ok', () => {
    const checks = runDoctorChecks(allGood);
    for (const c of checks) { expect(c.status).toBe('ok'); }
    expect(byId(checks).keys.status).toBe('ok');
  });

  test('zero provider keys → keys is an error with the amicus key hint', () => {
    const checks = runDoctorChecks({ ...allGood,
      readApiKeys: () => ({ openrouter: false, google: false, openai: false, anthropic: false, deepseek: false }) });
    const keys = byId(checks).keys;
    expect(keys.status).toBe('error');
    expect(keys.hint).toMatch(/amicus key/);
  });

  test('missing OpenCode binary → error', () => {
    const checks = runDoctorChecks({ ...allGood, hasOpencodeBinary: () => false });
    expect(byId(checks)['opencode-bin'].status).toBe('error');
  });

  test('missing OpenCode binary hint includes transient-rollback retry guidance', () => {
    const checks = runDoctorChecks({ ...allGood, hasOpencodeBinary: () => false });
    const hint = byId(checks)['opencode-bin'].hint;
    expect(hint).toMatch(/transient/i);
    expect(hint).toMatch(/npm install -g amicus/);
    expect(hint).toMatch(/npm cache clean --force/);
  });

  test('missing Electron → warn only (headless still works)', () => {
    const checks = runDoctorChecks({ ...allGood, getElectronPath: () => null });
    expect(byId(checks).electron.status).toBe('warn');
  });

  test('stale catalog (older than 24h) → warn', () => {
    const checks = runDoctorChecks({ ...allGood,
      readCache: () => ({ fetchedAt: Date.now() - 25 * 60 * 60 * 1000, models: [{ id: 'x' }] }) });
    expect(byId(checks).catalog.status).toBe('warn');
  });

  test('a throwing helper degrades to an error line, never throws', () => {
    const checks = runDoctorChecks({ ...allGood, resolveModel: () => { throw new Error('no default'); } });
    expect(byId(checks)['default-model'].status).toBe('error');
    expect(() => runDoctorChecks({ ...allGood, readApiKeys: () => { throw new Error('boom'); } })).not.toThrow();
  });

  test('unregistered MCP → warn with install hint', () => {
    const checks = runDoctorChecks({ ...allGood, discoverClaudeCodeMcps: () => null });
    expect(byId(checks).mcp.status).toBe('warn');
  });
});

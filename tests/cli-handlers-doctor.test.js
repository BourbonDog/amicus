// tests/cli-handlers-doctor.test.js
'use strict';
const { runDoctorChecks } = require('../src/cli-handlers-doctor');
const HINTS = require('../src/utils/remediation-hints');

const allGood = {
  nodeVersion: 'v20.0.0',
  readApiKeys: () => ({ openrouter: true, google: false, openai: false, anthropic: false, deepseek: false }),
  readApiKeyValues: () => ({ openrouter: 'sk-or-good' }),
  checkOpenRouterCredit: () => Promise.resolve({ warning: null, isFreeTier: false, limitRemaining: 5, limit: 10, usage: 5 }),
  getCwd: () => 'C:\\Users\\me\\code\\amicus',
  readProjectMarkers: () => ({ hasGit: true, hasPackageJson: true, hasClaude: false }),
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
  test('all healthy → every check ok', async () => {
    const checks = await runDoctorChecks(allGood);
    for (const c of checks) { expect(c.status).toBe('ok'); }
    expect(byId(checks).keys.status).toBe('ok');
  });

  test('zero provider keys → keys is an error with the amicus key hint', async () => {
    const checks = await runDoctorChecks({ ...allGood,
      readApiKeys: () => ({ openrouter: false, google: false, openai: false, anthropic: false, deepseek: false }) });
    const keys = byId(checks).keys;
    expect(keys.status).toBe('error');
    expect(keys.hint).toMatch(/amicus key/);
  });

  test('missing OpenCode binary → error', async () => {
    const checks = await runDoctorChecks({ ...allGood, hasOpencodeBinary: () => false });
    expect(byId(checks)['opencode-bin'].status).toBe('error');
  });

  test('missing OpenCode binary hint includes transient-rollback retry guidance', async () => {
    const checks = await runDoctorChecks({ ...allGood, hasOpencodeBinary: () => false });
    const hint = byId(checks)['opencode-bin'].hint;
    expect(hint).toMatch(/transient/i);
    expect(hint).toMatch(/npm install -g amicus/);
    expect(hint).toMatch(/npm cache clean --force/);
  });

  test('missing Electron → warn only (headless still works)', async () => {
    const checks = await runDoctorChecks({ ...allGood, getElectronPath: () => null });
    expect(byId(checks).electron.status).toBe('warn');
  });

  test('stale catalog (older than 24h) → warn', async () => {
    const checks = await runDoctorChecks({ ...allGood,
      readCache: () => ({ fetchedAt: Date.now() - 25 * 60 * 60 * 1000, models: [{ id: 'x' }] }) });
    expect(byId(checks).catalog.status).toBe('warn');
  });

  test('a throwing helper degrades to an error line, never throws', async () => {
    const checks = await runDoctorChecks({ ...allGood, resolveModel: () => { throw new Error('no default'); } });
    expect(byId(checks)['default-model'].status).toBe('error');
    await expect(runDoctorChecks({ ...allGood, readApiKeys: () => { throw new Error('boom'); } })).resolves.toBeDefined();
  });

  test('unregistered MCP → warn with install hint', async () => {
    const checks = await runDoctorChecks({ ...allGood, discoverClaudeCodeMcps: () => null });
    expect(byId(checks).mcp.status).toBe('warn');
  });

  describe('OpenRouter credit check (#43)', () => {
    test('positive credit → ok', async () => {
      const checks = await runDoctorChecks(allGood);
      expect(byId(checks)['openrouter-credit'].status).toBe('ok');
    });

    test('no OpenRouter key set → skipped/ok (and credit fn not called)', async () => {
      let called = false;
      const checks = await runDoctorChecks({ ...allGood,
        readApiKeyValues: () => ({}),
        checkOpenRouterCredit: () => { called = true; return Promise.resolve({ warning: null }); } });
      const c = byId(checks)['openrouter-credit'];
      expect(c.status).toBe('ok');
      expect(c.message).toMatch(/no openrouter key|skip/i);
      expect(called).toBe(false);
    });

    test('free-tier key → warn', async () => {
      const checks = await runDoctorChecks({ ...allGood,
        checkOpenRouterCredit: () => Promise.resolve({ warning: 'OpenRouter key is free tier — only :free models will route', isFreeTier: true, limitRemaining: 1 }) });
      const c = byId(checks)['openrouter-credit'];
      expect(c.status).toBe('warn');
      expect(c.message).toMatch(/free tier/i);
    });

    test('zero-remaining credit → warn', async () => {
      const checks = await runDoctorChecks({ ...allGood,
        checkOpenRouterCredit: () => Promise.resolve({ warning: 'OpenRouter key has no remaining credit — paid models will fail (402).', isFreeTier: false, limitRemaining: 0 }) });
      const c = byId(checks)['openrouter-credit'];
      expect(c.status).toBe('warn');
      expect(c.message).toMatch(/no remaining credit|402/i);
    });

    test('credit fn throwing/rejecting never throws — degrades to a guarded line', async () => {
      await expect(runDoctorChecks({ ...allGood,
        checkOpenRouterCredit: () => Promise.reject(new Error('network down')) })).resolves.toBeDefined();
    });
  });

  describe('project-root sanity check (#43)', () => {
    test('a real repo cwd with markers → ok', async () => {
      const checks = await runDoctorChecks(allGood);
      expect(byId(checks)['project-root'].status).toBe('ok');
    });

    test('an AppData\\Local\\AnthropicClaude install dir → warn', async () => {
      const checks = await runDoctorChecks({ ...allGood,
        getCwd: () => 'C:\\Users\\me\\AppData\\Local\\AnthropicClaude\\app-1.2.3',
        readProjectMarkers: () => ({ hasGit: false, hasPackageJson: false, hasClaude: false }) });
      const c = byId(checks)['project-root'];
      expect(c.status).toBe('warn');
      expect(c.hint).toMatch(/project|cd/i);
    });

    test('a dir lacking project markers → warn', async () => {
      const checks = await runDoctorChecks({ ...allGood,
        getCwd: () => 'C:\\Users\\me\\Documents\\random',
        readProjectMarkers: () => ({ hasGit: false, hasPackageJson: false, hasClaude: false }) });
      expect(byId(checks)['project-root'].status).toBe('warn');
    });

    test('never throws if cwd resolution fails', async () => {
      await expect(runDoctorChecks({ ...allGood,
        getCwd: () => { throw new Error('cwd gone'); } })).resolves.toBeDefined();
    });
  });

  describe('remediation hints are sourced from the shared helper', () => {
    test('missing OpenCode binary renders the shared reinstallEngine hint', async () => {
      const checks = await runDoctorChecks({ ...allGood, hasOpencodeBinary: () => false });
      expect(byId(checks)['opencode-bin'].hint).toBe(HINTS.reinstallEngine);
    });

    test('missing Electron points at the converged doctor --fix self-heal hint (#56)', async () => {
      const checks = await runDoctorChecks({ ...allGood, getElectronPath: () => null });
      expect(byId(checks).electron.hint).toBe(HINTS.doctorFix);
    });

    test('unregistered MCP hint references the shared reinstall command', async () => {
      const checks = await runDoctorChecks({ ...allGood, discoverClaudeCodeMcps: () => null });
      expect(byId(checks).mcp.hint).toContain(HINTS.reinstall);
    });

    test('missing skills hint references the shared reinstall command', async () => {
      const checks = await runDoctorChecks({ ...allGood, skillInstalled: () => false });
      expect(byId(checks).skills.hint).toContain(HINTS.reinstall);
    });
  });
});

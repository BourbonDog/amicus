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
  // B14: hasAmicusRegistration (raw, unstripped read) is the PRIMARY 'mcp'
  // check signal — discoverClaudeCodeMcps can never produce { amicus: {} }
  // because it always strips the amicus entry (recursive-spawn guard).
  hasAmicusRegistration: () => true,
  discoverCoworkMcps: () => ({ amicus: {} }),
  inspectLegacyMcpEntries: () => [
    { target: 'Claude Code', status: 'absent' },
    { target: 'Claude Desktop', status: 'absent' },
  ],
  migrateLegacyMcpEntries: () => [],
  skillInstalled: () => true,
  // B15: deterministic fixture — without this the check would fall through to
  // the real config dir on whatever machine runs the suite (non-deterministic).
  listSessionIndexTmpFiles: () => [],
  // engine-mcp: deterministic scan — without it the check probes the real
  // machine's installs (non-deterministic). 'none' → the check reports ok.
  scanEngineInstalls: () => ({ installs: [], mcpLaunch: 'none' }),
  // engine self-heal (--fix): deterministic no-op unless a test overrides it.
  repairEngine: async () => ({ repaired: false }),
  // electron-mcp (#76): deterministic scan, same rationale as scanEngineInstalls.
  scanElectronInstalls: () => ({ installs: [], mcpLaunch: 'none' }),
  // M14: deterministic fixture — without this the local-providers check would
  // fall through to the real config dir (and, worse, fire a REAL probe against
  // it) on whatever machine runs this "pure" doctor suite. probeLocalProvider
  // must never be called with the empty map above.
  getLocalProviders: () => ({}),
  probeLocalProvider: jest.fn(),
  // v4.6.2 PR1: the anthropic-base-url check reads d.env (falling through to the
  // real process.env only when a caller omits it — see
  // src/utils/doctor-base-url-check.js). Pinning it empty here keeps this fixture
  // "healthy" deterministic regardless of the host/parent-process env, same
  // rationale as the M14 getLocalProviders() pin above (a dev or CI process that
  // happens to carry ANTHROPIC_BASE_URL, e.g. set by the Claude Code app itself,
  // must not turn this into a warn).
  env: {},
};

const byId = (checks) => Object.fromEntries(checks.map(c => [c.id, c]));

describe('runDoctorChecks', () => {
  test('all healthy → every check ok', async () => {
    const checks = await runDoctorChecks(allGood);
    for (const c of checks) { expect(c.status).toBe('ok'); }
    expect(byId(checks).keys.status).toBe('ok');
  });

  test('M14: local-providers check is injected via allGood — never falls through to the real probe', async () => {
    const checks = await runDoctorChecks(allGood);
    const c = byId(checks)['local-providers'];
    expect(c.status).toBe('ok');
    expect(c.message).toMatch(/none configured/i);
    // Proof of no real I/O: the stubbed probe is a jest.fn() that was never
    // called, because allGood.getLocalProviders() deterministically returns
    // {} — if runDoctorChecks ever fell through to realDeps() for either key,
    // this would either throw (real probe against real config) or this
    // assertion would need a real network round trip to satisfy.
    expect(allGood.probeLocalProvider).not.toHaveBeenCalled();
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

  test('missing OpenCode binary hint includes the AV/quarantine note', async () => {
    const checks = await runDoctorChecks({ ...allGood, hasOpencodeBinary: () => false });
    const hint = byId(checks)['opencode-bin'].hint;
    expect(hint).toMatch(/antivirus|quarantin|allow-list/i);
  });

  test('engine-mcp: a broken single npx-cache copy the MCP launches → error naming the path', async () => {
    const pkgDir = 'C:\\cache\\_npx\\h1\\node_modules\\amicus';
    const checks = await runDoctorChecks({ ...allGood,
      scanEngineInstalls: () => ({
        installs: [{ kind: 'npx', pkgDir, engineOk: false, roots: [pkgDir + '\\node_modules'] }],
        mcpLaunch: 'npx',
      }) });
    const engine = byId(checks)['engine-mcp'];
    expect(engine.status).toBe('error');
    expect(engine.message).toContain(pkgDir);
  });

  test('engine-mcp: healthy npx-cache copies → ok', async () => {
    const checks = await runDoctorChecks({ ...allGood,
      scanEngineInstalls: () => ({
        installs: [{ kind: 'npx', pkgDir: 'C:\\c\\amicus', engineOk: true, roots: [] }],
        mcpLaunch: 'npx',
      }) });
    expect(byId(checks)['engine-mcp'].status).toBe('ok');
  });

  test('engine-mcp --fix: a broken single npx copy is self-healed → ok', async () => {
    const healed = { v: false };
    const pkgDir = 'C:\\cache\\_npx\\h1\\node_modules\\amicus';
    const checks = await runDoctorChecks({ ...allGood,
      fix: true,
      scanEngineInstalls: () => ({
        installs: [{ kind: 'npx', pkgDir, engineOk: healed.v, roots: [pkgDir + '\\node_modules'] }],
        mcpLaunch: 'npx',
      }),
      repairEngine: async ({ destPkgDir }) => { healed.v = true; return { repaired: true, destPkgDir }; },
    });
    const engine = byId(checks)['engine-mcp'];
    expect(engine.status).toBe('ok');
    expect(engine.message).toMatch(/self-healed/i);
  });

  test('missing Electron → warn only (headless still works)', async () => {
    const checks = await runDoctorChecks({ ...allGood, getElectronPath: () => null });
    expect(byId(checks).electron.status).toBe('warn');
  });

  // #76: green-while-broken — the running copy's electron is fine, but the npx
  // copy the MCP launches from has the package with no binary. The dedicated
  // electron-mcp check must surface it while the running-copy check stays ok.
  test('electron-mcp: binary-missing npx copy → warn naming the copy, running-copy check unaffected', async () => {
    const pkgDir = 'C:\\cache\\_npx\\h1\\node_modules\\amicus';
    const electronDir = 'C:\\cache\\_npx\\h1\\node_modules\\electron';
    const checks = await runDoctorChecks({ ...allGood,
      scanElectronInstalls: () => ({
        installs: [{ kind: 'npx', pkgDir, electronDir, state: 'binary-missing' }],
        mcpLaunch: 'npx',
      }),
    });
    expect(byId(checks).electron.status).toBe('ok'); // running copy: still green
    const mcp = byId(checks)['electron-mcp'];
    expect(mcp.status).toBe('warn');
    expect(mcp.message).toMatch(/binary missing/i);
    expect(mcp.message).toContain(pkgDir);
  });

  test('electron-mcp --fix: heals the npx copy via repairElectron({electronDir, timeoutMs}) and reports self-healed', async () => {
    const healed = { v: false };
    const electronDir = 'C:\\cache\\_npx\\h1\\node_modules\\electron';
    const repairElectron = jest.fn(async () => { healed.v = true; return { repaired: true }; });
    const checks = await runDoctorChecks({ ...allGood,
      fix: true,
      scanElectronInstalls: () => ({
        installs: [{
          kind: 'npx', pkgDir: 'C:\\cache\\_npx\\h1\\node_modules\\amicus',
          electronDir, state: healed.v ? 'ok' : 'binary-missing',
        }],
        mcpLaunch: 'npx',
      }),
      repairElectron,
    });
    const mcp = byId(checks)['electron-mcp'];
    expect(mcp.status).toBe('ok');
    expect(mcp.message).toMatch(/self-healed/i);
    // The #56 never-hang guard must reach the npx-copy repair too.
    expect(repairElectron).toHaveBeenCalledWith(
      expect.objectContaining({ electronDir, timeoutMs: expect.any(Number) }),
    );
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
    const checks = await runDoctorChecks({ ...allGood, hasAmicusRegistration: () => false });
    expect(byId(checks).mcp.status).toBe('warn');
  });

  describe("mcp check false-negative fix (B14)", () => {
    test('registered in Claude Code (hasAmicusRegistration true) → ok, even though discoverCoworkMcps has no amicus', async () => {
      const checks = await runDoctorChecks({ ...allGood,
        hasAmicusRegistration: () => true,
        discoverCoworkMcps: () => null });
      const c = byId(checks).mcp;
      expect(c.status).toBe('ok');
      expect(c.message).toBe('registered: Claude Code');
    });

    test('registered in both Claude Code and Cowork/Desktop → ok, message names both', async () => {
      const checks = await runDoctorChecks({ ...allGood,
        hasAmicusRegistration: () => true,
        discoverCoworkMcps: () => ({ amicus: {} }) });
      const c = byId(checks).mcp;
      expect(c.status).toBe('ok');
      expect(c.message).toBe('registered: Claude Code, Cowork/Desktop');
    });

    test('not registered anywhere → warn, never crashes when discoverCoworkMcps is also null', async () => {
      const checks = await runDoctorChecks({ ...allGood,
        hasAmicusRegistration: () => false,
        discoverCoworkMcps: () => null });
      const c = byId(checks).mcp;
      expect(c.status).toBe('warn');
      expect(c.message).toBe('not registered in Claude Code');
    });

    test('a throwing hasAmicusRegistration degrades to an error line, never throws out of doctor', async () => {
      const checks = await runDoctorChecks({ ...allGood,
        hasAmicusRegistration: () => { throw new Error('boom'); } });
      expect(byId(checks).mcp.status).toBe('error');
    });
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
    test('missing OpenCode binary renders the shared reinstallEngineAv hint', async () => {
      const checks = await runDoctorChecks({ ...allGood, hasOpencodeBinary: () => false });
      expect(byId(checks)['opencode-bin'].hint).toBe(HINTS.reinstallEngineAv);
    });

    test('missing Electron points at the converged doctor --fix self-heal hint (#56)', async () => {
      const checks = await runDoctorChecks({ ...allGood, getElectronPath: () => null });
      expect(byId(checks).electron.hint).toBe(HINTS.doctorFix);
    });

    test('unregistered MCP hint references the shared reinstall command', async () => {
      const checks = await runDoctorChecks({ ...allGood, hasAmicusRegistration: () => false });
      expect(byId(checks).mcp.hint).toContain(HINTS.reinstall);
    });

    test('missing skills hint references the shared reinstall command', async () => {
      const checks = await runDoctorChecks({ ...allGood, skillInstalled: () => false });
      expect(byId(checks).skills.hint).toContain(HINTS.reinstall);
    });
  });
});

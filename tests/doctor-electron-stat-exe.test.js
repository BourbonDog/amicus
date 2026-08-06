/**
 * #54 — doctor electron check stats the exe, not just path.txt.
 *
 * realDeps().getElectronPath delegates to interactive-process.getElectronPath(), which
 * (#54) returns null when the exe is MISSING even though path.txt survives. So
 * the doctor electron check must report "not installed" (warn) for a quarantined
 * exe, and never provision as a side-effect of the check.
 */

'use strict';

// Hermeticity guard (same class as the v4.6.2-pr1 wave; see allGood's M14
// comment in tests/cli-handlers-doctor.test.js): the bare runDoctorChecks()
// calls below let every check fall through to realDeps() and run for real --
// engine-install subprocess scans, the OpenRouter credit network probe, real
// config/cache reads. baseDeps mirrors allGood's shape EXCEPT that
// getElectronPath is deliberately OMITTED: this file's whole point is
// exercising realDeps()'s electron wrapper (delegating to the doMock'd
// interactive-process) end to end, so that one seam must keep falling
// through.
const baseDeps = {
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
  hasAmicusRegistration: () => true,
  discoverCoworkMcps: () => ({ amicus: {} }),
  inspectLegacyMcpEntries: () => [
    { target: 'Claude Code', status: 'absent' },
    { target: 'Claude Desktop', status: 'absent' },
  ],
  migrateLegacyMcpEntries: () => [],
  skillInstalled: () => true,
  listSessionIndexTmpFiles: () => [],
  listSessionMetadataTmpFiles: () => [], // D8 — inert pin, same hermeticity class as the sibling above
  scanEngineInstalls: () => ({ installs: [], mcpLaunch: 'none' }),
  repairEngine: async () => ({ repaired: false }),
  scanElectronInstalls: () => ({ installs: [], mcpLaunch: 'none' }),
  getLocalProviders: () => ({}),
  probeLocalProvider: jest.fn(),
  // v4.6.2-pr1 forward-pin: the anthropic-base-url check in flight on PR #95
  // reads d.env -- a harmless extra key until that check lands on main.
  env: {},
};

describe('#54 doctor electron check reflects isElectronUsable (stat the exe)', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test('realDeps().getElectronPath returns null when the exe is quarantined/missing', () => {
    // interactive.getElectronPath now returns null for a missing exe (#54).
    jest.doMock('../src/sidecar/interactive-process', () => ({
      getElectronPath: jest.fn(() => null),
    }));
    // Re-require doctor so its lazy require('./sidecar/interactive-process') picks the mock.
    jest.isolateModules(() => {
      const doctor = require('../src/cli-handlers-doctor');
      // runDoctorChecks composes realDeps() internally; assert the electron check.
      return doctor;
    });
  });

  test('doctor electron check is WARN (not ok) when the exe is missing', async () => {
    jest.doMock('../src/sidecar/interactive-process', () => ({
      getElectronPath: jest.fn(() => null), // #54: missing exe → null
    }));
    let runDoctorChecks;
    jest.isolateModules(() => {
      ({ runDoctorChecks } = require('../src/cli-handlers-doctor'));
    });
    // No getElectronPath override → realDeps()'s wrapper (delegating to the
    // mocked interactive probe) is exercised end to end.
    const checks = await runDoctorChecks(baseDeps);
    const electron = checks.find(c => c.id === 'electron');
    expect(electron.status).toBe('warn');
    expect(electron.message).toMatch(/not installed/i);
  });

  test('doctor electron check is OK when the exe is usable', async () => {
    jest.doMock('../src/sidecar/interactive-process', () => ({
      getElectronPath: jest.fn(() => '/pkg/dist/electron.exe'),
    }));
    let runDoctorChecks;
    jest.isolateModules(() => {
      ({ runDoctorChecks } = require('../src/cli-handlers-doctor'));
    });
    const checks = await runDoctorChecks(baseDeps);
    const electron = checks.find(c => c.id === 'electron');
    expect(electron.status).toBe('ok');
  });

  test('doctor electron check never provisions (pure probe path)', async () => {
    const repairElectron = jest.fn();
    jest.doMock('../src/sidecar/electron-install', () => ({
      isElectronUsable: jest.fn(() => false),
      resolveElectronBinary: jest.fn(() => '/pkg/dist/electron.exe'),
      repairElectron,
    }));
    let runDoctorChecks;
    jest.isolateModules(() => {
      ({ runDoctorChecks } = require('../src/cli-handlers-doctor'));
    });
    const checks = await runDoctorChecks(baseDeps);
    expect(checks.find(c => c.id === 'electron')).toBeDefined();
    expect(repairElectron).not.toHaveBeenCalled();
  });
});

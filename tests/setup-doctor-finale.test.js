'use strict';

/**
 * M17 — the C8 wizard finale itself (v4.2 §4.7): both runReadlineSetup() and
 * the Electron-success path of runInteractiveSetup() must print the compact
 * summarizeDoctor() output at the end, and a doctor bug must never abort
 * setup (guarded, best-effort — see src/sidecar/setup.js's printDoctorFinale).
 *
 * cli-handlers-doctor is mocked wholesale per test (jest.doMock + resetModules)
 * so these tests control exactly what the "doctor" sees, without touching real
 * config/network. The rest of the wizard's own I/O (readline, Electron launch,
 * model catalog, local-provider probing) is stubbed the same way
 * tests/sidecar/setup.test.js already does it, so no real env/network is ever
 * touched (env isolation: AMICUS_CONFIG_DIR/AMICUS_ENV_DIR sandboxed below).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

jest.mock('../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// Default: Electron wizard "succeeds" so runInteractiveSetup takes its own
// success branch (the one Step 5 adds a finale print to) rather than falling
// back to runReadlineSetup (which would print its own finale instead).
jest.mock('../src/sidecar/setup-window', () => ({
  launchSetupWindow: jest.fn().mockResolvedValue({ success: true }),
}));

// Prevent real HTTPS fetches to openrouter.ai during seedCatalog().
jest.mock('../src/utils/model-catalog', () => ({
  getCatalog: jest.fn(async () => []),
  refreshCatalog: jest.fn(async () => []),
  readCache: jest.fn(() => null),
}));

// Prevent real network calls if the local-provider wizard branch is ever hit.
jest.mock('../src/utils/local-probe', () => ({
  probeLocalProvider: jest.fn(async () => ({ status: 'ok', models: ['ollama/llama3.3'] })),
  listLocalModels: jest.fn(async () => []),
}));

describe('C8: the wizard finale emits the compact doctor summary', () => {
  let tmpDir;
  let envDir;
  let originalEnv;

  beforeEach(() => {
    // ENV ISOLATION: both AMICUS_CONFIG_DIR and AMICUS_ENV_DIR sandboxed to a
    // fresh mkdtemp, real key env vars cleared — runReadlineSetup/
    // runInteractiveSetup touch config (loadConfig/saveConfig) and API-key
    // detection for real; nothing here may read/write the real user config.
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-doctor-finale-cfg-'));
    envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-doctor-finale-env-'));
    originalEnv = { ...process.env };
    process.env.AMICUS_CONFIG_DIR = tmpDir;
    process.env.AMICUS_ENV_DIR = envDir;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
    jest.restoreAllMocks();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(envDir, { recursive: true, force: true });
    } catch (_err) { /* ignore cleanup errors */ }
  });

  /** Stub readline per tests/sidecar/setup.test.js's pattern: always answer '1'
   * (declines the local-provider offer, picks standard mode, picks quick-pick #1)
   * so every call reaches the natural/happy end of the wizard, where the finale lives. */
  function stubReadlineAlways1() {
    const readline = require('readline');
    const mockInterface = { question: jest.fn(), close: jest.fn() };
    mockInterface.question.mockImplementation((_prompt, callback) => callback('1'));
    jest.spyOn(readline, 'createInterface').mockReturnValue(mockInterface);
  }

  function load(doctorFactory) {
    jest.resetModules();
    jest.doMock('../src/cli-handlers-doctor', doctorFactory);
    return require('../src/sidecar/setup');
  }

  const healthyWithOneWarn = () => ({
    runDoctorChecks: jest.fn().mockResolvedValue([
      { id: 'node', name: 'Node.js', status: 'ok' },
      { id: 'local-providers', name: 'Local providers', status: 'warn', message: 'ollama: unreachable @ http://127.0.0.1:11434/v1' },
    ]),
  });

  test('runReadlineSetup prints summarizeDoctor output at the end', async () => {
    stubReadlineAlways1();
    const setup = load(healthyWithOneWarn);
    const lines = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...a) => { lines.push(a.join(' ')); });
    await setup.runReadlineSetup();
    spy.mockRestore();
    expect(lines.join('\n')).toMatch(/1 error\(s\), 1 warning\(s\)|0 error\(s\), 1 warning\(s\)/);
    expect(lines.join('\n')).toMatch(/run `amicus doctor`/);
  });

  test('runInteractiveSetup (Electron-first) prints it too', async () => {
    stubReadlineAlways1();
    const setup = load(healthyWithOneWarn);
    const lines = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...a) => { lines.push(a.join(' ')); });
    await setup.runInteractiveSetup();
    spy.mockRestore();
    expect(lines.join('\n')).toMatch(/run `amicus doctor`/);
  });

  test('all-pass doctor still prints the compact "all N checks pass" line at the finale', async () => {
    stubReadlineAlways1();
    const setup = load(() => ({
      runDoctorChecks: jest.fn().mockResolvedValue([{ id: 'node', name: 'Node.js', status: 'ok' }]),
    }));
    const lines = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...a) => { lines.push(a.join(' ')); });
    await setup.runReadlineSetup();
    spy.mockRestore();
    expect(lines.join('\n')).toMatch(/doctor: all 1 checks pass/);
  });

  test('a doctor bug does not abort runReadlineSetup (guarded, best-effort)', async () => {
    stubReadlineAlways1();
    const setup = load(() => ({
      runDoctorChecks: jest.fn().mockRejectedValue(new Error('doctor exploded')),
    }));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    await expect(setup.runReadlineSetup()).resolves.toBeUndefined();
    // The wizard's own work (config save) still completed despite the doctor bug.
    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf-8'));
    expect(saved.default).toBeDefined();
  });

  test('a doctor bug does not abort runInteractiveSetup (guarded, best-effort)', async () => {
    stubReadlineAlways1();
    const setup = load(() => ({
      runDoctorChecks: jest.fn().mockRejectedValue(new Error('doctor exploded')),
    }));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    await expect(setup.runInteractiveSetup()).resolves.toBeUndefined();
  });
});

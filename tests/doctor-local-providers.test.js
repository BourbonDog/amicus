'use strict';

const { runDoctorChecks, handleDoctor } = require('../src/cli-handlers-doctor');

// Hermeticity guard (whole-branch review Fix A1): this file used to call
// runDoctorChecks with only { getLocalProviders, probeLocalProvider }
// injected. runDoctorChecks always computes the FULL check list -- not just
// 'local-providers' -- so every OTHER dep fell through to realDeps() and ran
// for real: a real authenticated HTTPS call to OpenRouter via
// checkOpenRouterCredit (reads the real ~/.config/amicus/.env), a real `npm
// root -g` subprocess via scanEngineInstalls, real PATH mutation via
// hasOpencodeBinary, etc. baseDeps below is the same full-deps shape as
// tests/cli-handlers-doctor.test.js's `allGood` fixture (see that file's M14
// comment for the original writeup of this exact hazard), minus
// getLocalProviders/probeLocalProvider -- each test in this file still
// supplies its own pair of those two to exercise the specific
// reachable/unreachable/none scenarios this file exists to test.
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
  getElectronPath: () => '/path/to/electron',
  hasAmicusRegistration: () => true,
  discoverCoworkMcps: () => ({ amicus: {} }),
  inspectLegacyMcpEntries: () => [
    { target: 'Claude Code', status: 'absent' },
    { target: 'Claude Desktop', status: 'absent' },
  ],
  migrateLegacyMcpEntries: () => [],
  skillInstalled: () => true,
  listSessionIndexTmpFiles: () => [],
  scanEngineInstalls: () => ({ installs: [], mcpLaunch: 'none' }),
  repairEngine: async () => ({ repaired: false }),
  // #76: electron-mcp's default scan shells out (`npm root -g`) exactly like
  // scanEngineInstalls — pin it for the same no-subprocess reason.
  scanElectronInstalls: () => ({ installs: [], mcpLaunch: 'none' }),
};

async function localCheck(deps) {
  // Full baseline UNDER the per-test local-providers overrides -- deps always
  // wins for getLocalProviders/probeLocalProvider, baseDeps covers everything
  // else so runDoctorChecks(...) never sees a gap that realDeps() could fill.
  const checks = await runDoctorChecks({ ...baseDeps, ...deps });
  return checks.find((c) => c.id === 'local-providers');
}

/** Mirrors tests/doctor-handler.test.js's capture() -- handleDoctor renders to
 * real stdout via process.stdout.write, so tests must trap it or the human-
 * readable report leaks into the Jest run's own console output. */
function capture(fn) {
  const out = [];
  const orig = process.stdout.write;
  process.stdout.write = (s) => { out.push(s); return true; };
  return Promise.resolve(fn()).then((code) => { process.stdout.write = orig; return { code, out: out.join('') }; })
    .catch((e) => { process.stdout.write = orig; throw e; });
}

describe('doctor: local-providers check', () => {
  // Fix A1 leak-closed proof: with baseDeps fully populated, nothing in this
  // file should ever reach the real child_process/https primitives realDeps()
  // would otherwise wire up (scanEngineInstalls' `npm root -g` and
  // checkOpenRouterCredit's OpenRouter HTTPS call, respectively). Spied for
  // the whole file and asserted after every test -- if a future edit here
  // ever drops a baseDeps key, this fails loudly instead of silently
  // re-opening the live-network hole.
  let execFileSyncSpy;
  let httpsGetSpy;
  let httpsRequestSpy;

  beforeAll(() => {
    execFileSyncSpy = jest.spyOn(require('child_process'), 'execFileSync');
    const https = require('https');
    httpsGetSpy = jest.spyOn(https, 'get');
    httpsRequestSpy = jest.spyOn(https, 'request');
  });

  afterEach(() => {
    expect(execFileSyncSpy).not.toHaveBeenCalled();
    expect(httpsGetSpy).not.toHaveBeenCalled();
    expect(httpsRequestSpy).not.toHaveBeenCalled();
  });

  afterAll(() => {
    execFileSyncSpy.mockRestore();
    httpsGetSpy.mockRestore();
    httpsRequestSpy.mockRestore();
  });

  test('none configured → ok "none configured"', async () => {
    const probe = jest.fn();
    const c = await localCheck({ getLocalProviders: () => ({}), probeLocalProvider: probe });
    expect(c.status).toBe('ok');
    expect(c.message).toMatch(/none configured/i);
    // Nothing configured → bounded probe must never fire (nothing to probe).
    expect(probe).not.toHaveBeenCalled();
  });

  test('reachable → ok with model count + baseURL', async () => {
    const c = await localCheck({
      getLocalProviders: () => ({ ollama: { id: 'ollama', baseURL: 'http://127.0.0.1:11434/v1', flavor: 'ollama' } }),
      probeLocalProvider: jest.fn().mockResolvedValue({ status: 'ok', models: ['ollama/a', 'ollama/b'] }),
    });
    expect(c.status).toBe('ok');
    expect(c.message).toMatch(/ollama.*2.*http:\/\/127\.0\.0\.1:11434\/v1/);
  });

  test('unreachable → WARN (never error — must not flip CI exit code)', async () => {
    const c = await localCheck({
      getLocalProviders: () => ({ lmstudio: { id: 'lmstudio', baseURL: 'http://127.0.0.1:1234/v1', flavor: 'lmstudio' } }),
      probeLocalProvider: jest.fn().mockResolvedValue({ status: 'unreachable', models: [] }),
    });
    expect(c.status).toBe('warn');
    expect(c.hint).toMatch(/LM Studio/i);
  });

  test('probes with a bounded 2s timeout — doctor must never introduce an unbounded wait', async () => {
    const probe = jest.fn().mockResolvedValue({ status: 'ok', models: [] });
    await localCheck({
      getLocalProviders: () => ({ ollama: { id: 'ollama', baseURL: 'http://127.0.0.1:11434/v1', flavor: 'ollama' } }),
      probeLocalProvider: probe,
    });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe.mock.calls[0][1]).toMatchObject({ timeoutMs: 2000 });
  });

  test('mixed reachable + unreachable across multiple providers → warn, message covers both, probed once each', async () => {
    const probe = jest.fn()
      .mockImplementation((entry) => (
        entry.id === 'ollama'
          ? Promise.resolve({ status: 'ok', models: ['ollama/a'] })
          : Promise.resolve({ status: 'unreachable', models: [] })
      ));
    const c = await localCheck({
      getLocalProviders: () => ({
        ollama: { id: 'ollama', baseURL: 'http://127.0.0.1:11434/v1', flavor: 'ollama' },
        vllm: { id: 'vllm', baseURL: 'http://127.0.0.1:8000/v1', flavor: 'vllm' },
      }),
      probeLocalProvider: probe,
    });
    // Any provider down → overall WARN, never error.
    expect(c.status).toBe('warn');
    expect(c.message).toMatch(/ollama/);
    expect(c.message).toMatch(/vllm/);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  test('unreachable, non-lmstudio flavor → generic "start the local server" hint (no false LM Studio mention)', async () => {
    const c = await localCheck({
      getLocalProviders: () => ({ ollama: { id: 'ollama', baseURL: 'http://127.0.0.1:11434/v1', flavor: 'ollama' } }),
      probeLocalProvider: jest.fn().mockResolvedValue({ status: 'unreachable', models: [] }),
    });
    expect(c.status).toBe('warn');
    expect(c.hint).not.toMatch(/LM Studio/i);
    expect(c.hint).toMatch(/ollama serve/i);
  });

  test('prototype-chain discipline: a provider literally named "constructor" is probed and reported correctly', async () => {
    const map = {};
    map.constructor = { id: 'constructor', baseURL: 'http://127.0.0.1:9999/v1', flavor: 'generic' };
    const c = await localCheck({
      getLocalProviders: () => map,
      probeLocalProvider: jest.fn().mockResolvedValue({ status: 'ok', models: ['constructor/x'] }),
    });
    expect(c.status).toBe('ok');
    expect(c.message).toMatch(/constructor: 1 models @ http:\/\/127\.0\.0\.1:9999\/v1/);
  });

  test('an unreachable local provider alone does not flip amicus doctor\'s exit code', async () => {
    const onlyLocalProvidersWarn = async () => ([
      { id: 'local-providers', name: 'Local providers', status: 'warn', message: 'lmstudio: unreachable @ http://127.0.0.1:1234/v1', hint: 'Start the LM Studio server (Developer → Start Server), or `ollama serve`.' },
    ]);
    const { code } = await capture(() => handleDoctor({ _: [] }, onlyLocalProvidersWarn));
    expect(code).toBe(0);
  });
});

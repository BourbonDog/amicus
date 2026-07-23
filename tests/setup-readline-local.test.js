'use strict';

/**
 * Task 12 (v4.2 §4.6): the readline setup wizard's local / self-hosted
 * provider add step. Two layers:
 *  - `addLocalProviderInteractive` (owning module: src/sidecar/setup-local.js,
 *    D14) unit tests — id/preset/URL collection, routed through the real
 *    `handleProvider` (D7), never hand-rolling validate/save/probe.
 *  - a wizard-wiring test (last in the file) proving `runReadlineSetup`'s own
 *    guard survives even a fully-broken setup-local module (house guarded-
 *    polish rule).
 *
 * ENV ISOLATION (mandatory): every test sandboxes BOTH AMICUS_CONFIG_DIR and
 * AMICUS_ENV_DIR directly to a fresh mkdtemp dir -- config.js/api-key-store.js
 * check these override vars FIRST, ahead of HOME/USERPROFILE (see
 * getConfigDir()/getEnvPath()), so pointing both at a throwaway dir makes it
 * impossible for a save to ever reach the real ~/.config/amicus, regardless of
 * what HOME happens to be set to by the host shell or another leaked suite in
 * the same jest worker. HOME/USERPROFILE are ALSO pointed at the same
 * disposable dir as a second layer. Fully restored + the tmp dir removed in
 * afterEach.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

const savedEnv = {
  AMICUS_CONFIG_DIR: process.env.AMICUS_CONFIG_DIR,
  AMICUS_ENV_DIR: process.env.AMICUS_ENV_DIR,
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
};
let tmpDir;

/** Sandbox config + env dirs to a fresh throwaway directory. @returns {string} the dir */
function tmpHome() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiz-local-'));
  process.env.AMICUS_CONFIG_DIR = tmpDir;
  process.env.AMICUS_ENV_DIR = tmpDir;
  process.env.HOME = tmpDir;
  process.env.USERPROFILE = tmpDir;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  return tmpDir;
}

afterEach(() => {
  jest.resetModules();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) { delete process.env[k]; } else { process.env[k] = v; }
  }
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
});

/** @param {string} dir @returns {object} parsed config.json (flat -- AMICUS_CONFIG_DIR points AT the dir, no nested .config/amicus) */
function readConfig(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf-8'));
}

/** A jest `ask` mock that serves queued answers in order, then '' forever. @param {string[]} answers */
function fifoAsk(answers) {
  const queue = [...answers];
  return jest.fn().mockImplementation(() => Promise.resolve(queue.length ? queue.shift() : ''));
}

/**
 * Fresh-require setup-local.js with local-probe mocked (no real network calls).
 * @param {Function} [probeImpl] override for probeLocalProvider
 */
function loadAddLocal(probeImpl) {
  jest.resetModules();
  // Defensive: a jest.doMock('../src/cli-handlers-provider', ...) registered by
  // an earlier test in this file (e.g. the call-args spy test below) persists
  // across resetModules() -- it is NOT cleared automatically. Explicitly
  // restore the real module so every test that wants the real D7 routing
  // actually gets it, regardless of test order.
  jest.dontMock('../src/cli-handlers-provider');
  jest.doMock('../src/utils/local-probe', () => ({
    probeLocalProvider:
      probeImpl || jest.fn().mockResolvedValue({ status: 'ok', models: ['ollama/llama3.3'] }),
    listLocalModels: jest.fn().mockResolvedValue([]),
  }));
  return require('../src/sidecar/setup-local').addLocalProviderInteractive;
}

describe('addLocalProviderInteractive (setup-local.js, Task 12 -- routes through handleProvider per D7)', () => {
  test('preset path: writes config.providers via the real handleProvider (LM Studio parity)', async () => {
    const dir = tmpHome();
    const addLocalProviderInteractive = loadAddLocal();
    const ask = fifoAsk(['lmstudio', 'lmstudio']); // id, then preset
    const out = [];
    await addLocalProviderInteractive(ask, (l) => out.push(l), {});
    const cfg = readConfig(dir);
    expect(cfg.providers.lmstudio.baseURL).toBe('http://127.0.0.1:1234/v1');
    expect(cfg.providers.lmstudio.flavor).toBe('lmstudio');
  });

  test('routes through handleProvider with the exact id + preset args (D7 -- not a hand-rolled write); ask/print are the injected params, not bare globals (B8)', async () => {
    tmpHome();
    jest.resetModules();
    const handleProvider = jest.fn().mockResolvedValue(0);
    jest.doMock('../src/cli-handlers-provider', () => ({ handleProvider }));
    const { addLocalProviderInteractive } = require('../src/sidecar/setup-local');
    const ask = fifoAsk(['ollama', 'ollama']);
    const print = jest.fn();
    await addLocalProviderInteractive(ask, print, {});
    expect(handleProvider).toHaveBeenCalledTimes(1);
    const [args, deps] = handleProvider.mock.calls[0];
    expect(args._).toEqual(['provider', 'add', 'ollama']);
    expect(args.preset).toBe('ollama');
    // Both print AND warn must be wired to the injected print fn, so a warning
    // handleProvider emits (e.g. "unreachable") surfaces through the wizard's
    // own output stream rather than silently going to realDeps' stderr.
    expect(deps.print).toBe(print);
    expect(deps.warn).toBe(print);
  });

  test('custom URL path: an unrecognized preset answer prompts for a base URL instead (D15)', async () => {
    const dir = tmpHome();
    const addLocalProviderInteractive = loadAddLocal();
    const ask = fifoAsk(['mylab', 'none', 'http://127.0.0.1:9999/v1']);
    await addLocalProviderInteractive(ask, () => {}, {});
    expect(ask).toHaveBeenCalledTimes(3);
    const cfg = readConfig(dir);
    expect(cfg.providers.mylab.baseURL).toBe('http://127.0.0.1:9999/v1');
    expect(cfg.providers.mylab.flavor).toBe('generic');
  });

  // Prototype-chain discipline (trap #6/#8): a preset literally named 'constructor'
  // must NOT resolve via a bare PRESETS[presetKey] (Object.prototype.constructor is
  // truthy) -- it must fall through to the URL prompt exactly like any other
  // unrecognized preset name. A bare-lookup regression would skip the URL prompt
  // (ask called only twice) and hand handleProvider a preset:'constructor' it then
  // rejects as "unknown --preset", so nothing would ever get written.
  test('prototype-chain: a preset literally named "constructor" is not treated as a valid preset', async () => {
    const dir = tmpHome();
    const addLocalProviderInteractive = loadAddLocal();
    const ask = fifoAsk(['ctorlab', 'constructor', 'http://127.0.0.1:8000/v1']);
    await addLocalProviderInteractive(ask, () => {}, {});
    expect(ask).toHaveBeenCalledTimes(3);
    const cfg = readConfig(dir);
    expect(cfg.providers.ctorlab.baseURL).toBe('http://127.0.0.1:8000/v1');
  });

  test('blank id bails without calling handleProvider (nothing written)', async () => {
    tmpHome();
    jest.resetModules();
    const handleProvider = jest.fn();
    jest.doMock('../src/cli-handlers-provider', () => ({ handleProvider }));
    const { addLocalProviderInteractive } = require('../src/sidecar/setup-local');
    const ask = fifoAsk(['   ']); // whitespace-only id
    await addLocalProviderInteractive(ask, () => {}, {});
    expect(handleProvider).not.toHaveBeenCalled();
  });

  test('a probe failure does not throw -- the entry still saves (air-gap rule) and the warning surfaces via the injected print', async () => {
    const dir = tmpHome();
    const addLocalProviderInteractive = loadAddLocal(
      jest.fn().mockResolvedValue({ status: 'unreachable', models: [] })
    );
    const ask = fifoAsk(['ollama', 'ollama']);
    const out = [];
    await expect(addLocalProviderInteractive(ask, (l) => out.push(l), {})).resolves.toBeUndefined();
    expect(readConfig(dir).providers.ollama).toBeDefined();
    expect(out.join('\n')).toMatch(/unreachable/i);
  });

  // Guarded polish: even a hard failure INSIDE handleProvider itself (not just an
  // unreachable probe) must never escape this function.
  test('guarded: a thrown/rejected handleProvider never propagates out', async () => {
    tmpHome();
    jest.resetModules();
    jest.doMock('../src/cli-handlers-provider', () => ({
      handleProvider: jest.fn().mockRejectedValue(new Error('boom')),
    }));
    const { addLocalProviderInteractive } = require('../src/sidecar/setup-local');
    const ask = fifoAsk(['ollama', 'ollama']);
    await expect(addLocalProviderInteractive(ask, () => {}, {})).resolves.toBeUndefined();
  });
});

// Kept LAST in the file: jest.doMock registrations for a given path persist for
// the rest of THIS file's execution (resetModules() clears the instantiated
// cache, not the mock registry), so a doMock of setup-local must not run ahead
// of the direct require('../src/sidecar/setup-local') calls above.
describe('runReadlineSetup wizard wiring -- outer guard (Task 12, guarded polish)', () => {
  test('a fully-broken local-provider step is swallowed by runReadlineSetup itself -- setup still completes', async () => {
    const dir = tmpHome();
    jest.resetModules();
    jest.doMock('../src/sidecar/setup-local', () => ({
      addLocalProviderInteractive: jest.fn().mockRejectedValue(new Error('boom')),
    }));
    const readline = require('readline');
    // wantLocal='y' (routes into the broken mock, caught) then mode='2' (free
    // council) short-circuits immediately with no OPENROUTER key -- avoids
    // needing to also stub the model catalog/quick-picks for this guard proof.
    const answers = ['y', '2'];
    const mockInterface = { question: jest.fn(), close: jest.fn() };
    mockInterface.question.mockImplementation((_prompt, callback) => callback(answers.shift() ?? ''));
    jest.spyOn(readline, 'createInterface').mockReturnValue(mockInterface);
    jest.spyOn(console, 'log').mockImplementation(() => {});

    const { runReadlineSetup } = require('../src/sidecar/setup');
    await expect(runReadlineSetup()).resolves.toBeUndefined();

    // The wizard reached the free-council branch's own early return afterward --
    // proof the broken local step didn't abort the rest of the run.
    expect(fs.existsSync(path.join(dir, 'config.json'))).toBe(false);
  });
});

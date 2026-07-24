'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');

// M6: the original tmpHome() set HOME/USERPROFILE and the afterEach only called
// jest.resetModules() — no snapshot, no restore, no rmSync. Jest reuses ONE OS process per
// worker across test FILES, so an unrestored HOME leaks into whichever suite runs next in
// that worker — including (post-Step-3) tests/cli-key.test.js, which never fakes HOME itself.
// Use the overrides getConfigDir()/getEnvPath() already check FIRST instead of touching HOME.
const dirs = [];
function tmpConfig(providers) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'key-'));
  dirs.push(dir);
  process.env.AMICUS_CONFIG_DIR = dir;
  process.env.AMICUS_ENV_DIR = dir;
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ providers }));
  return dir;
}

describe('handleKey: local providers', () => {
  const orig = { cfg: process.env.AMICUS_CONFIG_DIR, env: process.env.AMICUS_ENV_DIR };

  afterEach(() => {
    jest.resetModules();
    for (const [k, v] of [['AMICUS_CONFIG_DIR', orig.cfg], ['AMICUS_ENV_DIR', orig.env]]) {
      if (v === undefined) { delete process.env[k]; } else { process.env[k] = v; }
    }
    while (dirs.length) { fs.rmSync(dirs.pop(), { recursive: true, force: true }); }
  });

  test('amicus key <localId> <token> validates via probe and stores under apiKeyEnv', async () => {
    const dir = tmpConfig({ lab: { type: 'openai-compatible', baseURL: 'https://10.0.0.5:8000/v1', flavor: 'vllm', apiKeyEnv: 'LAB_API_KEY' } });
    jest.resetModules();
    jest.doMock('../src/utils/local-probe', () => ({ probeLocalProvider: jest.fn().mockResolvedValue({ status: 'ok', models: ['lab/m'] }) }));
    const { handleKey } = require('../src/cli-handlers');
    await handleKey({ _: ['key', 'lab', 'sk-token'], json: true });
    const env = fs.readFileSync(path.join(dir, '.env'), 'utf-8');
    expect(env).toContain('LAB_API_KEY=sk-token');
  });

  test('amicus key <localId> --remove clears the bearer', async () => {
    const dir = tmpConfig({ lab: { type: 'openai-compatible', baseURL: 'https://x/v1', flavor: 'vllm', apiKeyEnv: 'LAB_API_KEY' } });
    fs.writeFileSync(path.join(dir, '.env'), 'LAB_API_KEY=sk-token\n');
    jest.resetModules();
    const { handleKey } = require('../src/cli-handlers');
    await handleKey({ _: ['key', 'lab'], remove: true, json: true });
    const env = fs.existsSync(path.join(dir, '.env')) ? fs.readFileSync(path.join(dir, '.env'), 'utf-8') : '';
    expect(env).not.toContain('sk-token');
  });

  // B3 (whole-branch review, integration correctness): `key --remove` must fully
  // undo `key <token>` on a provider that started with NO apiKeyEnv (auto-stamped
  // by the add, not configured via `provider add --bearer-env`). If apiKeyEnv
  // stays stamped on config after the .env line is gone, gateway-router.js's
  // resolveLocal (`entry.apiKeyEnv && !entry.keyPresent`) permanently errors
  // no_local_key on every later launch of that provider -- bricked until the
  // user re-adds a key or removes/re-adds the whole provider. --remove must
  // revert it to the SAME no-auth state it was in before `amicus key <token>`.
  test('amicus key <localId> --remove reverts a no-auth provider to no-auth (undoes the apiKeyEnv stamp)', async () => {
    // No apiKeyEnv in the fixture: 'lab' starts genuinely keyless.
    tmpConfig({ lab: { type: 'openai-compatible', baseURL: 'http://127.0.0.1:8000/v1', flavor: 'vllm' } });
    jest.resetModules();
    jest.doMock('../src/utils/local-probe', () => ({ probeLocalProvider: jest.fn().mockResolvedValue({ status: 'ok', models: [] }) }));
    const { handleKey } = require('../src/cli-handlers');

    await handleKey({ _: ['key', 'lab', 'sk-secret'], json: true });
    const { getLocalProviders } = require('../src/utils/local-providers');
    expect(getLocalProviders().lab.apiKeyEnv).toBe('LAB_API_KEY'); // sanity: the add DID stamp it

    await handleKey({ _: ['key', 'lab'], remove: true, json: true });

    const freshEntry = getLocalProviders().lab;
    expect(freshEntry.apiKeyEnv).toBeUndefined(); // reverted to no-auth, not left dangling

    // Prove the ROUTE itself does not error no_local_key post-revert (not just
    // that the config field is gone) -- feed the fresh entry straight into the
    // pure router, exactly the shape resolveLocalRouteInputs would assemble.
    const { resolveRoute } = require('../src/utils/gateway-router');
    const result = resolveRoute({
      descriptor: 'lab/some-model',
      source: 'test',
      gatewayMode: 'auto',
      keys: {},
      catalogInfo: { models: [] },
      localProviders: { lab: { ...freshEntry, keyPresent: false } },
      localLive: { status: 'skipped', models: [] },
    });
    expect(result.kind).toBe('resolved');
  });

  // M12: saveRawEnv returns {success:false,error} for a malformed env-var name WITHOUT
  // throwing. Dropping that signal lets a bad --bearer-env "succeed" while nothing is written.
  test('a malformed apiKeyEnv is reported, not silently swallowed', async () => {
    tmpConfig({ lab: { type: 'openai-compatible', baseURL: 'https://x/v1', flavor: 'vllm', apiKeyEnv: 'not-a-valid-var' } });
    jest.resetModules();
    jest.doMock('../src/utils/local-probe', () => ({ probeLocalProvider: jest.fn().mockResolvedValue({ status: 'ok', models: [] }) }));
    const err = [];
    const spy = jest.spyOn(process.stderr, 'write').mockImplementation((s) => { err.push(s); return true; });
    const { handleKey } = require('../src/cli-handlers');
    await handleKey({ _: ['key', 'lab', 'sk-token'] });
    spy.mockRestore();
    expect(err.join('')).toMatch(/not-a-valid-var|invalid/i);
  });

  // Bite test: a missing token must not silently no-op or crash -- and must not
  // reach the network probe at all (no token to attach as a bearer).
  test('amicus key <localId> with no token and no --remove reports the usage error, never probes', async () => {
    tmpConfig({ lab: { type: 'openai-compatible', baseURL: 'https://x/v1', flavor: 'vllm', apiKeyEnv: 'LAB_API_KEY' } });
    jest.resetModules();
    const probeFn = jest.fn().mockResolvedValue({ status: 'ok', models: [] });
    jest.doMock('../src/utils/local-probe', () => ({ probeLocalProvider: probeFn }));
    const err = [];
    const spy = jest.spyOn(process.stderr, 'write').mockImplementation((s) => { err.push(s); return true; });
    const { handleKey } = require('../src/cli-handlers');
    await handleKey({ _: ['key', 'lab'] });
    spy.mockRestore();
    expect(err.join('')).toMatch(/bearer token/i);
    expect(probeFn).not.toHaveBeenCalled();
  });

  // Bite test: the list view must mask a configured local bearer (never print it raw)
  // and must label a key-less local provider as needing no key.
  test('amicus key (list) masks a configured local bearer and marks a keyless one "no key required"', async () => {
    const dir = tmpConfig({
      lab: { type: 'openai-compatible', baseURL: 'https://x/v1', flavor: 'vllm', apiKeyEnv: 'LAB_API_KEY' },
      free: { type: 'openai-compatible', baseURL: 'http://127.0.0.1:11434/v1', flavor: 'ollama' },
    });
    fs.writeFileSync(path.join(dir, '.env'), 'LAB_API_KEY=sk-super-secret-token\n');
    jest.resetModules();
    const { handleKey } = require('../src/cli-handlers');
    const out = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((s) => { out.push(s); });
    await handleKey({ _: ['key'] });
    spy.mockRestore();
    const text = out.join('\n');
    expect(text).toContain('lab');
    expect(text).toContain('free');
    expect(text).toContain('no key required');
    expect(text).toMatch(/sk-super•+/); // masked prefix (first 8 chars + bullets) IS shown
    expect(text).not.toContain('sk-super-secret-token'); // raw token is NEVER shown
  });

  // Bite test: an id that is neither a currently-configured local provider nor one of
  // the 5 direct vendors must still hit the pre-existing "Unknown provider" path, even
  // though config.providers is non-empty (proves the local-branch check doesn't
  // over-match / swallow ids it shouldn't).
  test('an id that is neither local nor a direct vendor still errors "Unknown provider"', async () => {
    tmpConfig({ lab: { type: 'openai-compatible', baseURL: 'https://x/v1', flavor: 'vllm', apiKeyEnv: 'LAB_API_KEY' } });
    jest.resetModules();
    const err = [];
    const errSpy = jest.spyOn(console, 'error').mockImplementation((s) => { err.push(s); });
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const { handleKey } = require('../src/cli-handlers');
    await expect(handleKey({ _: ['key', 'totally-unknown-id', 'sk-x'] })).rejects.toThrow('exit');
    errSpy.mockRestore();
    exitSpy.mockRestore();
    expect(err.join('')).toMatch(/Unknown provider/i);
  });

  // Bite test: the recurring v4.2 prototype-chain bug class -- a local provider id
  // literally named 'constructor' must save and remove exactly like any other id,
  // not be shadowed by (or fall through to) the inherited Object.prototype.constructor.
  test('a local provider named "constructor" saves and removes cleanly (prototype-chain guard)', async () => {
    const dir = tmpConfig({ constructor: { type: 'openai-compatible', baseURL: 'http://127.0.0.1:8000/v1', flavor: 'vllm' } });
    jest.resetModules();
    jest.doMock('../src/utils/local-probe', () => ({ probeLocalProvider: jest.fn().mockResolvedValue({ status: 'ok', models: [] }) }));
    const { handleKey } = require('../src/cli-handlers');

    await handleKey({ _: ['key', 'constructor', 'sk-ctor-token'], json: true });
    expect(fs.readFileSync(path.join(dir, '.env'), 'utf-8')).toContain('CONSTRUCTOR_API_KEY=sk-ctor-token');

    await handleKey({ _: ['key', 'constructor'], remove: true, json: true });
    const env = fs.existsSync(path.join(dir, '.env')) ? fs.readFileSync(path.join(dir, '.env'), 'utf-8') : '';
    expect(env).not.toContain('sk-ctor-token');
  });

  // Bite test: the OTHER half of the prototype-chain guard -- when 'constructor' is
  // NOT configured (config.providers has no own 'constructor' key), a bare
  // localProviders['constructor'] would read the INHERITED Object.prototype.constructor
  // (the Object function -- truthy) and misroute this into the local-provider branch.
  // It must fall through to the ordinary "Unknown provider" error instead.
  test('an UNCONFIGURED "constructor" id is not misrouted into the local-provider branch', async () => {
    tmpConfig({ lab: { type: 'openai-compatible', baseURL: 'https://x/v1', flavor: 'vllm', apiKeyEnv: 'LAB_API_KEY' } });
    jest.resetModules();
    const err = [];
    const errSpy = jest.spyOn(console, 'error').mockImplementation((s) => { err.push(s); });
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const { handleKey } = require('../src/cli-handlers');
    await expect(handleKey({ _: ['key', 'constructor', 'sk-x'] })).rejects.toThrow('exit');
    errSpy.mockRestore();
    exitSpy.mockRestore();
    expect(err.join('')).toMatch(/Unknown provider/i);
  });

  // B2 (whole-branch review, security consistency): `amicus key <localId> <token>`
  // must warn about cleartext transmission the same way `provider add`
  // (cli-handlers-provider.js's doAdd) and the Electron save handler
  // (electron/ipc-setup-local.js) already do -- using the SAME exact-hostname
  // check (isLoopbackUrl/isPlaintextRemote), not a new substring-based one.
  test('amicus key <localId> <token> warns when the provider baseURL is non-loopback http', async () => {
    tmpConfig({ lab: { type: 'openai-compatible', baseURL: 'http://10.0.0.5:8000/v1', flavor: 'vllm' } });
    jest.resetModules();
    jest.doMock('../src/utils/local-probe', () => ({ probeLocalProvider: jest.fn().mockResolvedValue({ status: 'ok', models: [] }) }));
    const err = [];
    const spy = jest.spyOn(process.stderr, 'write').mockImplementation((s) => { err.push(s); return true; });
    const { handleKey } = require('../src/cli-handlers');
    await handleKey({ _: ['key', 'lab', 'sk-secret'], json: true });
    spy.mockRestore();
    expect(err.join('')).toMatch(/cleartext|plain http/i);
  });

  test('amicus key <localId> <token> does NOT warn for a loopback http baseURL', async () => {
    tmpConfig({ lab: { type: 'openai-compatible', baseURL: 'http://127.0.0.1:8000/v1', flavor: 'vllm' } });
    jest.resetModules();
    jest.doMock('../src/utils/local-probe', () => ({ probeLocalProvider: jest.fn().mockResolvedValue({ status: 'ok', models: [] }) }));
    const err = [];
    const spy = jest.spyOn(process.stderr, 'write').mockImplementation((s) => { err.push(s); return true; });
    const { handleKey } = require('../src/cli-handlers');
    await handleKey({ _: ['key', 'lab', 'sk-secret'], json: true });
    spy.mockRestore();
    expect(err.join('')).not.toMatch(/cleartext|plain http/i);
  });

  test('amicus key <localId> <token> does NOT warn for an https baseURL even on a non-loopback host', async () => {
    tmpConfig({ lab: { type: 'openai-compatible', baseURL: 'https://10.0.0.5:8000/v1', flavor: 'vllm' } });
    jest.resetModules();
    jest.doMock('../src/utils/local-probe', () => ({ probeLocalProvider: jest.fn().mockResolvedValue({ status: 'ok', models: [] }) }));
    const err = [];
    const spy = jest.spyOn(process.stderr, 'write').mockImplementation((s) => { err.push(s); return true; });
    const { handleKey } = require('../src/cli-handlers');
    await handleKey({ _: ['key', 'lab', 'sk-secret'], json: true });
    spy.mockRestore();
    expect(err.join('')).not.toMatch(/cleartext|plain http/i);
  });

  // Task 10 hand-off proof (unit-level): saveRawEnv/removeRawEnv (env-raw-store.js,
  // consumed via api-key-store.js's re-export) must never write the raw token into
  // config.json -- only into the 0600 .env.
  test('the saved token is never written into config.json', async () => {
    const dir = tmpConfig({ lab: { type: 'openai-compatible', baseURL: 'https://x/v1', flavor: 'vllm', apiKeyEnv: 'LAB_API_KEY' } });
    jest.resetModules();
    jest.doMock('../src/utils/local-probe', () => ({ probeLocalProvider: jest.fn().mockResolvedValue({ status: 'ok', models: [] }) }));
    const { handleKey } = require('../src/cli-handlers');
    await handleKey({ _: ['key', 'lab', 'sk-token-not-in-config'], json: true });
    const config = fs.readFileSync(path.join(dir, 'config.json'), 'utf-8');
    expect(config).not.toContain('sk-token-not-in-config');
  });
});

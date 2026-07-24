'use strict';

/**
 * Tests for src/cli-handlers-provider.js (amicus provider add|list|test|remove).
 * DI-injected (print/emitJson/warn/readCache), so no TTY and no live server.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

function tmpHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prov-'));
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  // Force HOME-based resolution: no override env vars leaking in from other suites.
  delete process.env.AMICUS_CONFIG_DIR;
  delete process.env.AMICUS_ENV_DIR;
  fs.mkdirSync(path.join(dir, '.config', 'amicus'), { recursive: true });
  return dir;
}
const readConfig = (dir) =>
  JSON.parse(fs.readFileSync(path.join(dir, '.config', 'amicus', 'config.json'), 'utf-8'));

describe('handleProvider', () => {
  const savedEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  afterEach(() => {
    jest.resetModules();
    process.env.HOME = savedEnv.HOME;
    process.env.USERPROFILE = savedEnv.USERPROFILE;
  });

  function load(probe) {
    jest.resetModules();
    jest.doMock('../src/utils/local-probe', () => ({
      probeLocalProvider:
        probe ||
        jest.fn().mockResolvedValue({ status: 'ok', models: ['ollama/llama3.3', 'ollama/qwen3:14b'] }),
      listLocalModels: jest.fn().mockResolvedValue([]),
    }));
    return require('../src/cli-handlers-provider').handleProvider;
  }

  test('add --preset ollama writes the entry with the preset baseURL + flavor', async () => {
    const dir = tmpHome();
    const handleProvider = load();
    const code = await handleProvider(
      { _: ['provider', 'add', 'ollama'], preset: 'ollama', json: true },
      { print: () => {} }
    );
    const cfg = readConfig(dir);
    expect(cfg.providers.ollama.baseURL).toBe('http://127.0.0.1:11434/v1');
    expect(cfg.providers.ollama.flavor).toBe('ollama');
    expect(code).toBe(0);
  });

  test('add --preset lmstudio writes the LM Studio preset (parity)', async () => {
    const dir = tmpHome();
    const handleProvider = load();
    await handleProvider({ _: ['provider', 'add', 'lmstudio'], preset: 'lmstudio', json: true });
    expect(readConfig(dir).providers.lmstudio.baseURL).toBe('http://127.0.0.1:1234/v1');
    expect(readConfig(dir).providers.lmstudio.flavor).toBe('lmstudio');
  });

  // D15/M13: `--preset vllm` ALONE must work (the preset now carries port 8000).
  test('add --preset vllm works alone and uses vLLM default port 8000', async () => {
    const dir = tmpHome();
    const handleProvider = load();
    const code = await handleProvider({ _: ['provider', 'add', 'lab'], preset: 'vllm', json: true });
    expect(code).toBe(0);
    expect(readConfig(dir).providers.lab.baseURL).toBe('http://127.0.0.1:8000/v1');
    expect(readConfig(dir).providers.lab.flavor).toBe('vllm');
  });

  test('--url overrides a preset baseURL', async () => {
    const dir = tmpHome();
    const handleProvider = load();
    await handleProvider({
      _: ['provider', 'add', 'lab'],
      preset: 'vllm',
      url: 'http://127.0.0.1:9999/v1',
      json: true,
    });
    expect(readConfig(dir).providers.lab.baseURL).toBe('http://127.0.0.1:9999/v1');
    expect(readConfig(dir).providers.lab.flavor).toBe('vllm');
  });

  test('add rejects a reserved id with exit 1 and does not write it', async () => {
    const dir = tmpHome();
    const handleProvider = load();
    const warns = [];
    const code = await handleProvider(
      { _: ['provider', 'add', 'openai'], preset: 'ollama', json: true },
      { warn: (l) => warns.push(l) }
    );
    expect(code).toBe(1);
    expect(warns.join('\n')).toMatch(/reserved/i);
    expect(fs.existsSync(path.join(dir, '.config', 'amicus', 'config.json'))).toBe(false);
  });

  test('add rejects an id that fails ID_RE (D7 — CLI owns the id-format check)', async () => {
    tmpHome();
    const handleProvider = load();
    const code = await handleProvider({ _: ['provider', 'add', 'Bad Id'], preset: 'ollama', json: true });
    expect(code).toBe(1);
  });

  test('add rejects a non-http url (scheme allowlist, spec §4.10)', async () => {
    tmpHome();
    const handleProvider = load();
    const code = await handleProvider({ _: ['provider', 'add', 'lab'], url: 'ftp://x', json: true });
    expect(code).toBe(1);
  });

  test('add with a failed probe still SAVES the entry (air-gap rule) and warns', async () => {
    const dir = tmpHome();
    const handleProvider = load(jest.fn().mockResolvedValue({ status: 'unreachable', models: [] }));
    const warns = [];
    const code = await handleProvider(
      { _: ['provider', 'add', 'ollama'], preset: 'ollama', json: true },
      { warn: (l) => warns.push(l) }
    );
    expect(readConfig(dir).providers.ollama).toBeDefined();
    expect(code).toBe(0);
    expect(warns.join('\n')).toMatch(/unreachable/i);
  });

  // B7/D4 regression: a pre-server `provider add` must NOT corrupt config.default.
  // A bare 'ollama' default with no matching alias makes every later keyless
  // `amicus start`/`fanout`/`continue` throw the "not found in aliases" path forever.
  test('a failed-probe add never writes an unresolvable config.default (B7/D4)', async () => {
    const dir = tmpHome();
    const handleProvider = load(jest.fn().mockResolvedValue({ status: 'unreachable', models: [] }));
    await handleProvider({ _: ['provider', 'add', 'ollama'], preset: 'ollama', json: true });
    const cfg = readConfig(dir);
    expect(cfg.providers.ollama).toBeDefined(); // air-gap rule: the entry IS saved
    expect(cfg.default).toBeUndefined(); // applyProviderDefault is the SOLE writer
    const { resolveModel } = require('../src/utils/config');
    // Recoverable "run setup" message — NEVER the "not found in aliases" corruption path.
    expect(() => resolveModel(undefined)).toThrow(/No model specified and no default configured/);
    expect(() => resolveModel(undefined)).not.toThrow(/not found in aliases/);
  });

  // Complement to B7: a SUCCESSFUL probe seeds a RESOLVABLE default (alias + default,
  // via applyProviderDefault) so resolveModel works.
  test('a successful-probe add seeds a resolvable default (alias written before default)', async () => {
    const dir = tmpHome();
    const handleProvider = load();
    await handleProvider({ _: ['provider', 'add', 'ollama'], preset: 'ollama', json: true });
    const cfg = readConfig(dir);
    expect(cfg.default).toBe('ollama');
    expect(cfg.aliases.ollama).toMatch(/^ollama\//); // a real ollama/<model> id
    const { resolveModel } = require('../src/utils/config');
    expect(() => resolveModel(undefined)).not.toThrow();
  });

  test('add --bearer stores the token under the derived env var in .env, not config', async () => {
    const dir = tmpHome();
    const handleProvider = load();
    await handleProvider({
      _: ['provider', 'add', 'lab'],
      url: 'https://10.0.0.5:8000/v1',
      bearer: 'sk-secret',
      json: true,
    });
    const cfg = readConfig(dir);
    expect(cfg.providers.lab.apiKeyEnv).toBe('LAB_API_KEY');
    expect(JSON.stringify(cfg)).not.toContain('sk-secret');
    const env = fs.readFileSync(path.join(dir, '.config', 'amicus', '.env'), 'utf-8');
    expect(env).toContain('LAB_API_KEY=sk-secret');
  });

  // Security (spec §4.10): a bearer over non-loopback http:// warns in cleartext.
  test('plaintext-credential warning FIRES for non-loopback http + bearer', async () => {
    tmpHome();
    const handleProvider = load();
    const warns = [];
    await handleProvider(
      { _: ['provider', 'add', 'lab'], url: 'http://10.0.0.5:8000/v1', bearer: 'sk-x', json: true },
      { warn: (l) => warns.push(l) }
    );
    expect(warns.join('\n')).toMatch(/cleartext|plain http/i);
  });

  test('plaintext-credential warning does NOT fire for loopback http + bearer', async () => {
    tmpHome();
    const handleProvider = load();
    const warns = [];
    await handleProvider(
      { _: ['provider', 'add', 'lab'], url: 'http://127.0.0.1:8000/v1', bearer: 'sk-x', json: true },
      { warn: (l) => warns.push(l) }
    );
    expect(warns.join('\n')).not.toMatch(/cleartext|plain http/i);
  });

  // Shadow warning (decision 5): catalog-based, not a static blocklist.
  test('add warns when the cached catalog contains an openrouter/<id>/ namespace', async () => {
    tmpHome();
    const handleProvider = load();
    const warns = [];
    await handleProvider(
      { _: ['provider', 'add', 'qwen'], preset: 'ollama', json: true },
      { warn: (l) => warns.push(l), readCache: () => ({ models: [{ id: 'openrouter/qwen/qwen3-max' }] }) }
    );
    expect(warns.join('\n')).toMatch(/shadow/i);
  });

  test('add does NOT warn about shadowing when no matching catalog namespace exists (mutation of the above)', async () => {
    tmpHome();
    const handleProvider = load();
    const warns = [];
    await handleProvider(
      { _: ['provider', 'add', 'qwen'], preset: 'ollama', json: true },
      { warn: (l) => warns.push(l), readCache: () => ({ models: [{ id: 'openrouter/openai/gpt-5' }] }) }
    );
    expect(warns.join('\n')).not.toMatch(/shadow/i);
  });

  test('list --json returns the configured providers', async () => {
    tmpHome();
    const handleProvider = load();
    await handleProvider({ _: ['provider', 'add', 'ollama'], preset: 'ollama', json: true });
    const rows = [];
    await handleProvider({ _: ['provider', 'list'], json: true }, { emitJson: (o) => rows.push(o) });
    expect(rows[0].providers.map((p) => p.id)).toContain('ollama');
  });

  test('test <id> --json reports reachability without leaking Authorization', async () => {
    tmpHome();
    const handleProvider = load();
    await handleProvider({ _: ['provider', 'add', 'lab'], preset: 'vllm', json: true });
    const rows = [];
    const code = await handleProvider(
      { _: ['provider', 'test', 'lab'], json: true },
      { emitJson: (o) => rows.push(o) }
    );
    expect(code).toBe(0);
    expect(rows[0]).toMatchObject({ ok: true, id: 'lab', reachable: true });
    expect(JSON.stringify(rows[0])).not.toMatch(/Authorization/i);
  });

  test('test <id> for an unknown provider exits 1', async () => {
    tmpHome();
    const handleProvider = load();
    const code = await handleProvider({ _: ['provider', 'test', 'nope'], json: true });
    expect(code).toBe(1);
  });

  test('remove deletes the entry', async () => {
    const dir = tmpHome();
    const handleProvider = load();
    await handleProvider({ _: ['provider', 'add', 'ollama'], preset: 'ollama', json: true });
    await handleProvider({ _: ['provider', 'remove', 'ollama'], json: true });
    expect(readConfig(dir).providers.ollama).toBeUndefined();
  });

  test('remove of an unknown provider exits 1', async () => {
    tmpHome();
    const handleProvider = load();
    const code = await handleProvider({ _: ['provider', 'remove', 'nope'], json: true });
    expect(code).toBe(1);
  });

  // Flow-gap fix (post Task-11 review): `provider remove` used to delete the config
  // entry and then hint `amicus key <id> --remove` — a command that fails ("Unknown
  // provider") because that command derives local-id status from config.providers,
  // which is already gone by the time the hint prints. `provider remove` must clean
  // the bearer itself.
  test('remove deletes the .env bearer line itself (flow-gap fix)', async () => {
    const dir = tmpHome();
    const handleProvider = load();
    await handleProvider({
      _: ['provider', 'add', 'lab'],
      url: 'http://127.0.0.1:8000/v1',
      bearer: 'sk-secret',
      json: true,
    });
    let env = fs.readFileSync(path.join(dir, '.config', 'amicus', '.env'), 'utf-8');
    expect(env).toContain('LAB_API_KEY=sk-secret');

    const rows = [];
    const code = await handleProvider(
      { _: ['provider', 'remove', 'lab'], json: true },
      { emitJson: (o) => rows.push(o) }
    );
    expect(code).toBe(0);
    expect(readConfig(dir).providers.lab).toBeUndefined();
    env = fs.readFileSync(path.join(dir, '.config', 'amicus', '.env'), 'utf-8');
    expect(env).not.toContain('LAB_API_KEY');
    expect(rows[0]).toMatchObject({ ok: true, removed: 'lab', bearerRemoved: true });
  });

  // Sibling-sharing guard: two ids can point at the same apiKeyEnv via --bearer-env.
  // Removing one must NOT delete a bearer a surviving sibling still needs.
  test('remove KEEPS a .env bearer still referenced by a sibling provider', async () => {
    const dir = tmpHome();
    const handleProvider = load();
    await handleProvider({
      _: ['provider', 'add', 'lab1'],
      url: 'http://127.0.0.1:8000/v1',
      'bearer-env': 'SHARED_KEY',
      bearer: 'sk-shared',
      json: true,
    });
    await handleProvider({
      _: ['provider', 'add', 'lab2'],
      url: 'http://127.0.0.1:8001/v1',
      'bearer-env': 'SHARED_KEY',
      bearer: 'sk-shared',
      json: true,
    });

    const prints = [];
    const code = await handleProvider(
      { _: ['provider', 'remove', 'lab1'] },
      { print: (l) => prints.push(l) }
    );
    expect(code).toBe(0);
    expect(readConfig(dir).providers.lab1).toBeUndefined();
    expect(readConfig(dir).providers.lab2).toBeDefined(); // sibling untouched

    const env = fs.readFileSync(path.join(dir, '.config', 'amicus', '.env'), 'utf-8');
    expect(env).toContain('SHARED_KEY=sk-shared'); // NOT deleted -- lab2 still needs it
    expect(prints.join('\n')).toMatch(/kept|still used/i);
    expect(prints.join('\n')).toContain('lab2');
  });

  test('remove of a provider with no bearer never touches .env', async () => {
    const dir = tmpHome();
    const handleProvider = load();
    await handleProvider({ _: ['provider', 'add', 'ollama'], preset: 'ollama', json: true });
    expect(fs.existsSync(path.join(dir, '.config', 'amicus', '.env'))).toBe(false);

    const rows = [];
    const code = await handleProvider(
      { _: ['provider', 'remove', 'ollama'], json: true },
      { emitJson: (o) => rows.push(o) }
    );
    expect(code).toBe(0);
    expect(readConfig(dir).providers.ollama).toBeUndefined();
    expect(fs.existsSync(path.join(dir, '.config', 'amicus', '.env'))).toBe(false); // no spurious write
    expect(rows[0]).toMatchObject({ ok: true, removed: 'ollama', bearerRemoved: false });
  });

  // Prototype-chain discipline (trap #6) extended to the new "does another entry
  // share this apiKeyEnv" scan: a provider literally named 'constructor' must still
  // remove cleanly, using its own real entry, never Object.prototype.constructor.
  test("a provider named 'constructor' with a bearer removes cleanly (prototype-chain discipline)", async () => {
    const dir = tmpHome();
    const handleProvider = load();
    await handleProvider({
      _: ['provider', 'add', 'constructor'],
      url: 'http://127.0.0.1:8000/v1',
      bearer: 'sk-ctor',
      json: true,
    });
    let env = fs.readFileSync(path.join(dir, '.config', 'amicus', '.env'), 'utf-8');
    expect(env).toContain('CONSTRUCTOR_API_KEY=sk-ctor');

    const rows = [];
    const code = await handleProvider(
      { _: ['provider', 'remove', 'constructor'], json: true },
      { emitJson: (o) => rows.push(o) }
    );
    expect(code).toBe(0);
    expect(Object.prototype.hasOwnProperty.call(readConfig(dir).providers, 'constructor')).toBe(false);
    env = fs.readFileSync(path.join(dir, '.config', 'amicus', '.env'), 'utf-8');
    expect(env).not.toContain('CONSTRUCTOR_API_KEY');
    expect(rows[0]).toMatchObject({ ok: true, removed: 'constructor', bearerRemoved: true });
  });

  // Prototype-chain safety (trap #6): a provider literally named 'constructor' is a
  // valid, non-reserved id and MUST round-trip through add/list/test/remove without
  // any bare map[id] lookup fabricating a phantom entry off Object.prototype.
  test("a provider named 'constructor' works through add/list/test/remove", async () => {
    const dir = tmpHome();
    const handleProvider = load();

    expect(await handleProvider({ _: ['provider', 'add', 'constructor'], preset: 'ollama', json: true })).toBe(0);
    const added = readConfig(dir).providers;
    expect(Object.prototype.hasOwnProperty.call(added, 'constructor')).toBe(true);
    expect(added.constructor.flavor).toBe('ollama'); // own key shadows Object.prototype.constructor

    const listRows = [];
    await handleProvider({ _: ['provider', 'list'], json: true }, { emitJson: (o) => listRows.push(o) });
    expect(listRows[0].providers.map((p) => p.id)).toContain('constructor');

    const testRows = [];
    expect(
      await handleProvider({ _: ['provider', 'test', 'constructor'], json: true }, { emitJson: (o) => testRows.push(o) })
    ).toBe(0);
    expect(testRows[0].id).toBe('constructor');

    expect(await handleProvider({ _: ['provider', 'remove', 'constructor'], json: true })).toBe(0);
    // Own key gone. NB: `.constructor` here would read Object.prototype.constructor
    // (the very proto-walk trap #6 guards) — assert own-property absence instead.
    expect(Object.prototype.hasOwnProperty.call(readConfig(dir).providers, 'constructor')).toBe(false);
  });

  test('unknown subcommand exits 1', async () => {
    tmpHome();
    const handleProvider = load();
    expect(await handleProvider({ _: ['provider', 'frobnicate'], json: true })).toBe(1);
  });
});

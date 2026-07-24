'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('buildProviderModels: local providers', () => {
  const origConfigDir = process.env.AMICUS_CONFIG_DIR;
  afterEach(() => {
    jest.resetModules();
    if (origConfigDir === undefined) { delete process.env.AMICUS_CONFIG_DIR; }
    else { process.env.AMICUS_CONFIG_DIR = origConfigDir; }
  });

  function load(providers, aliases) {
    jest.resetModules();
    process.env.AMICUS_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bpm-'));
    jest.doMock('../src/utils/local-providers', () => ({
      getLocalProviders: () => providers,
      isLocalProvider: (id) => Object.prototype.hasOwnProperty.call(providers, id),
    }));
    // Deterministic aliases without touching disk. curated-models is the SOURCE of
    // DEFAULT_ALIASES, which getEffectiveAliases() always merges back in (B3).
    jest.doMock('../src/utils/curated-models', () => ({
      toDefaultAliases: () => aliases,
      toGatewayRoutes: () => ({}),
    }));
    return require('../src/utils/config');
  }

  test('emits npm + options.baseURL + a non-empty apiKey placeholder + a 300000ms timeout for a keyless local alias', () => {
    const config = load(
      { ollama: { id: 'ollama', baseURL: 'http://127.0.0.1:11434/v1', flavor: 'ollama', name: 'ollama' } },
      { ollama: 'ollama/llama3.3' });
    const providers = config.buildProviderModels(['ollama/llama3.3']);
    expect(providers.ollama.npm).toBe('@ai-sdk/openai-compatible');
    expect(providers.ollama.options.baseURL).toBe('http://127.0.0.1:11434/v1');
    // The @ai-sdk/openai-compatible adapter wants a non-empty apiKey string
    // even for servers that don't require auth (Ollama/LM Studio/llama.cpp
    // ignore it) -- no apiKeyEnv configured means the literal placeholder.
    expect(providers.ollama.options.apiKey).toBe('not-needed');
    // opencode's default request timeout is too short for cold local
    // prefill of a large agent prompt -- see LOCAL_REQUEST_TIMEOUT_MS.
    expect(providers.ollama.options.timeout).toBe(300000);
    expect(providers.ollama.models['llama3.3']).toEqual({});
    // No openrouter mirror for a local alias.
    expect(providers.openrouter).toBeUndefined();
  });

  test('emits {env:VAR} apiKey and a 300000ms timeout when apiKeyEnv is set (never the key value)', () => {
    const config = load(
      { lab: { id: 'lab', baseURL: 'https://10.0.0.5:8000/v1', flavor: 'vllm', name: 'Lab', apiKeyEnv: 'LAB_API_KEY' } },
      { lab: 'lab/mymodel' });
    const providers = config.buildProviderModels(['lab/mymodel']);
    expect(providers.lab.options.apiKey).toBe('{env:LAB_API_KEY}');
    expect(providers.lab.options.timeout).toBe(300000);
    expect(JSON.stringify(providers.lab)).not.toContain('secret');
  });

  // The placeholder-apiKey / timeout injection happens in the v4.2 §4.3
  // enrichment loop, which only touches provider ids matched in
  // getLocalProviders(). A cloud/direct provider block (built solely by the
  // alias/resolvedRoutes loops earlier in buildProviderModels) must come out
  // exactly as before -- no options object at all, let alone an injected
  // timeout or a fabricated apiKey.
  test('does not inject a timeout or placeholder apiKey into a cloud/direct provider block', () => {
    const config = load({}, { gpt: 'openai/gpt-5.5' });
    const providers = config.buildProviderModels(['openai/gpt-5.5']);
    expect(providers.openai.models['gpt-5.5']).toEqual({});
    expect(providers.openai.options).toBeUndefined();
    expect(providers.openai.npm).toBeUndefined();
  });

  // Finding (Task 6, while implementing the brief's Step 3 enrichment loop):
  // `providers` in buildProviderModels is a fresh `{}`, and `providerID` is an
  // UNVALIDATED vendor segment split off a model string supplied by user config
  // (aliases) or a resolved launch route (CLI/router). A vendor literally named
  // 'constructor' (a valid, non-reserved id per local-providers.js's ID_RE /
  // RESERVED_IDS) walks the prototype chain: `!providers['constructor']` reads
  // Object.prototype.constructor (the Object function -- truthy), so the guarded
  // init at config.js:292-294 is skipped and `providers.constructor.models[...] = {}`
  // throws `TypeError: Cannot set properties of undefined`. This is the fifth site
  // of the same prototype-chain bug class already fixed in gateway-router.js
  // (19aade4) and local-providers.js + route-suggestions.js (2cba73b).
  describe('prototype-chain guard: a "constructor" vendor id', () => {
    test('does not throw when a resolved route\'s vendor is literally "constructor"', () => {
      const config = load({}, {});
      expect(() => config.buildProviderModels(['constructor/some-model'])).not.toThrow();
    });

    // A second, independent prototype-chain trap lives in the brief's own Step 3
    // enrichment loop: `const entry = localAll[id];` is a bare bracket lookup on
    // `localAll` (getLocalProviders()'s return value). When no provider is
    // actually configured under the id 'constructor', `localAll` has no OWN
    // 'constructor' property, so the bare lookup resolves the INHERITED
    // Object.prototype.constructor (the Object function -- truthy). Unguarded,
    // that would fabricate a fake local-provider block: npm set, name:'Object'
    // (Function.prototype.name), options:{baseURL: undefined}. A "sane" block
    // for an unconfigured vendor is simply the plain, unenriched block every
    // other non-local provider gets.
    test('does not fabricate a local-provider block for an unconfigured "constructor" vendor', () => {
      const config = load({}, {});
      const providers = config.buildProviderModels(['constructor/some-model']);
      expect(providers.constructor).toEqual({ models: { 'some-model': {} } });
      expect(providers.constructor.npm).toBeUndefined();
      expect(providers.constructor.options).toBeUndefined();
    });
  });
});

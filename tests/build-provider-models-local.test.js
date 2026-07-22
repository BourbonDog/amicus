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

  test('emits npm + options.baseURL + models for a keyless local alias', () => {
    const config = load(
      { ollama: { id: 'ollama', baseURL: 'http://127.0.0.1:11434/v1', flavor: 'ollama', name: 'ollama' } },
      { ollama: 'ollama/llama3.3' });
    const providers = config.buildProviderModels(['ollama/llama3.3']);
    expect(providers.ollama.npm).toBe('@ai-sdk/openai-compatible');
    expect(providers.ollama.options.baseURL).toBe('http://127.0.0.1:11434/v1');
    expect(providers.ollama.options.apiKey).toBeUndefined();
    expect(providers.ollama.models['llama3.3']).toEqual({});
    // No openrouter mirror for a local alias.
    expect(providers.openrouter).toBeUndefined();
  });

  test('emits {env:VAR} apiKey when apiKeyEnv is set (never the value)', () => {
    const config = load(
      { lab: { id: 'lab', baseURL: 'https://10.0.0.5:8000/v1', flavor: 'vllm', name: 'Lab', apiKeyEnv: 'LAB_API_KEY' } },
      { lab: 'lab/mymodel' });
    const providers = config.buildProviderModels(['lab/mymodel']);
    expect(providers.lab.options.apiKey).toBe('{env:LAB_API_KEY}');
    expect(JSON.stringify(providers.lab)).not.toContain('secret');
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

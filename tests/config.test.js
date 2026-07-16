/**
 * Sidecar Config Module Tests
 *
 * Tests for config directory resolution, config file I/O,
 * and default alias definitions.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

describe('Sidecar Config Module', () => {
  let tempDir;
  let originalEnv;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-config-test-'));
    originalEnv = { ...process.env };
    process.env.AMICUS_CONFIG_DIR = tempDir;
    process.env.AMICUS_ENV_DIR = tempDir;
    // Clear API keys to ensure deterministic fallback behavior
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  /**
   * Helper: require the config module fresh (after jest.resetModules)
   */
  function loadModule() {
    return require('../src/utils/config');
  }

  describe('getConfigDir', () => {
    it('should return AMICUS_CONFIG_DIR when set', () => {
      const config = loadModule();
      expect(config.getConfigDir()).toBe(tempDir);
    });

    it('defaults to ~/.config/amicus when no env override and neither config dir exists', () => {
      delete process.env.AMICUS_CONFIG_DIR;
      // Point HOME at a fresh dir so the result is deterministic regardless of
      // whatever ~/.config dirs exist on the test machine (a clean CI runner has
      // neither; a dev box may have a leftover legacy ~/.config/sidecar). The
      // post-rebrand default is the amicus dir.
      const freshHome = path.join(tempDir, 'fresh-home');
      fs.mkdirSync(freshHome, { recursive: true });
      process.env.HOME = freshHome;
      process.env.USERPROFILE = freshHome;
      jest.resetModules();
      const config = loadModule();
      expect(config.getConfigDir()).toBe(path.join(freshHome, '.config', 'amicus'));
    });

    it('ignores the legacy ~/.config/sidecar dir even when amicus is absent (#19 absence pin)', () => {
      delete process.env.AMICUS_CONFIG_DIR;
      const legacyHome = path.join(tempDir, 'legacy-home');
      fs.mkdirSync(path.join(legacyHome, '.config', 'sidecar'), { recursive: true });
      process.env.HOME = legacyHome;
      process.env.USERPROFILE = legacyHome;
      jest.resetModules();
      const config = loadModule();
      expect(config.getConfigDir()).toBe(path.join(legacyHome, '.config', 'amicus'));
    });
  });

  describe('getConfigPath', () => {
    it('should return config.json inside config dir', () => {
      const config = loadModule();
      expect(config.getConfigPath()).toBe(path.join(tempDir, 'config.json'));
    });
  });

  describe('loadConfig', () => {
    it('should return null when config file does not exist', () => {
      const config = loadModule();
      expect(config.loadConfig()).toBeNull();
    });

    it('should return null when config file contains invalid JSON', () => {
      fs.writeFileSync(path.join(tempDir, 'config.json'), 'not json {{{');
      const config = loadModule();
      expect(config.loadConfig()).toBeNull();
    });

    it('should return parsed config when file is valid JSON', () => {
      const data = { default: 'gemini', aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' } };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      const config = loadModule();
      const result = config.loadConfig();
      expect(result).toEqual(data);
    });

    it('should return null for empty file', () => {
      fs.writeFileSync(path.join(tempDir, 'config.json'), '');
      const config = loadModule();
      expect(config.loadConfig()).toBeNull();
    });
  });

  describe('saveConfig', () => {
    it('should write config data as JSON to config path', () => {
      const config = loadModule();
      const data = { default: 'gemini', aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' } };
      config.saveConfig(data);

      const written = JSON.parse(fs.readFileSync(path.join(tempDir, 'config.json'), 'utf-8'));
      expect(written).toEqual(data);
    });

    it('should create the config directory if it does not exist', () => {
      const nestedDir = path.join(tempDir, 'nested', 'deep');
      process.env.AMICUS_CONFIG_DIR = nestedDir;
      jest.resetModules();
      const config = loadModule();

      const data = { default: 'gpt' };
      config.saveConfig(data);

      expect(fs.existsSync(path.join(nestedDir, 'config.json'))).toBe(true);
      const written = JSON.parse(fs.readFileSync(path.join(nestedDir, 'config.json'), 'utf-8'));
      expect(written).toEqual(data);
    });

    it('should overwrite existing config', () => {
      const config = loadModule();
      config.saveConfig({ default: 'old' });
      config.saveConfig({ default: 'new' });

      const written = JSON.parse(fs.readFileSync(path.join(tempDir, 'config.json'), 'utf-8'));
      expect(written.default).toBe('new');
    });

    it('should write formatted JSON (2-space indent)', () => {
      const config = loadModule();
      const data = { default: 'gemini' };
      config.saveConfig(data);

      const raw = fs.readFileSync(path.join(tempDir, 'config.json'), 'utf-8');
      expect(raw).toBe(JSON.stringify(data, null, 2));
    });
  });

  describe('getDefaultAliases', () => {
    it('should return an object with expected alias keys', () => {
      const config = loadModule();
      const aliases = config.getDefaultAliases();

      const expectedKeys = [
        'gemini', 'gemini-pro',
        'gpt', 'gpt-pro', 'codex',
        'claude', 'sonnet', 'opus', 'haiku',
        'deepseek',
        'qwen', 'qwen-coder', 'qwen-flash',
        'mistral', 'devstral',
        'glm', 'minimax', 'grok', 'kimi', 'seed'
      ];

      for (const key of expectedKeys) {
        // Use array path to avoid Jest interpreting dots as nested access
        expect(aliases).toHaveProperty([key]);
      }
    });

    // Task 8.1a: direct-capable vendors (openai/anthropic/google/deepseek)
    // resolve to the BARE canonical id (policy-routed, direct-first) rather
    // than the openrouter/ literal — see src/utils/curated-models.js.
    it('should map gemini to google/gemini-3.5-flash (bare, direct-capable)', () => {
      const config = loadModule();
      const aliases = config.getDefaultAliases();
      expect(aliases.gemini).toBe('google/gemini-3.5-flash');
    });

    it('should map claude to anthropic/claude-sonnet-5 (bare, direct-capable)', () => {
      const config = loadModule();
      const aliases = config.getDefaultAliases();
      expect(aliases.claude).toBe('anthropic/claude-sonnet-5');
    });

    it('should map opus to anthropic/claude-opus-4.8 (bare, direct-capable)', () => {
      const config = loadModule();
      const aliases = config.getDefaultAliases();
      expect(aliases.opus).toBe('anthropic/claude-opus-4.8');
    });

    it('should map gpt to openai/gpt-5.5 (bare, direct-capable)', () => {
      const config = loadModule();
      const aliases = config.getDefaultAliases();
      expect(aliases.gpt).toBe('openai/gpt-5.5');
    });

    it('should map deepseek to deepseek/deepseek-v4-pro (bare, direct-capable)', () => {
      const config = loadModule();
      const aliases = config.getDefaultAliases();
      expect(aliases.deepseek).toBe('deepseek/deepseek-v4-pro');
    });

    it('should map all qwen variants correctly', () => {
      const config = loadModule();
      const aliases = config.getDefaultAliases();
      expect(aliases.qwen).toBe('openrouter/qwen/qwen3.7-max');
      expect(aliases['qwen-coder']).toBe('openrouter/qwen/qwen3-coder-next');
      expect(aliases['qwen-flash']).toBe('openrouter/qwen/qwen3.6-flash');
    });

    it('should map mistral and devstral correctly', () => {
      const config = loadModule();
      const aliases = config.getDefaultAliases();
      expect(aliases.mistral).toBe('openrouter/mistralai/mistral-medium-3-5');
      expect(aliases.devstral).toBe('openrouter/mistralai/devstral-2512');
    });

    it('should map remaining aliases correctly', () => {
      const config = loadModule();
      const aliases = config.getDefaultAliases();
      expect(aliases.glm).toBe('openrouter/z-ai/glm-5.1');
      expect(aliases.minimax).toBe('openrouter/minimax/minimax-m2.7');
      expect(aliases.grok).toBe('openrouter/x-ai/grok-4.3');
      expect(aliases.kimi).toBe('openrouter/moonshotai/kimi-k2.6');
      expect(aliases.seed).toBe('openrouter/bytedance-seed/seed-2.0-lite');
    });
  });

  /**
   * Miscellaneous config tests
   * (merged from config-misc.test.js)
   */

  describe('getEffectiveAliases', () => {
    it('should return defaults when no config exists', () => {
      const config = loadModule();
      const aliases = config.getEffectiveAliases();
      expect(aliases.gemini).toBe('google/gemini-3.5-flash');
      expect(aliases.opus).toBe('anthropic/claude-opus-4.8');
    });

    it('should merge user aliases with defaults (user wins)', () => {
      const data = {
        default: 'gemini',
        aliases: {
          gemini: 'openrouter/google/custom-gemini',
          'my-model': 'openrouter/custom/model',
        },
      };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      const config = loadModule();
      const aliases = config.getEffectiveAliases();

      expect(aliases.gemini).toBe('openrouter/google/custom-gemini');
      expect(aliases['my-model']).toBe('openrouter/custom/model');
      expect(aliases.opus).toBe('anthropic/claude-opus-4.8');
    });
  });

  describe('formatAliasNames', () => {
    it('should return comma-separated alias names', () => {
      const config = loadModule();
      const names = config.formatAliasNames();
      expect(names).toContain('gemini');
      expect(names).toContain('opus');
      expect(names).toContain('codex');
      expect(names).toContain(', ');
    });
  });

  describe('tryResolveModel', () => {
    it('should return resolved model for valid alias', () => {
      const data = {
        default: 'gemini',
        aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' },
      };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      const config = loadModule();
      const result = config.tryResolveModel('gemini');
      expect(result.model).toBe('openrouter/google/gemini-3-flash-preview');
      expect(result.error).toBeUndefined();
    });

    it('should return error for invalid alias', () => {
      const data = {
        default: 'gemini',
        aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' },
      };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      const config = loadModule();
      const result = config.tryResolveModel('nonexistent');
      expect(result.model).toBeUndefined();
      expect(result.error).toContain('nonexistent');
      expect(result.error.toLowerCase()).toContain('amicus setup');
    });

    it('should return error when no model and no default', () => {
      const config = loadModule();
      const result = config.tryResolveModel(undefined);
      expect(result.model).toBeUndefined();
      expect(result.error).toBeDefined();
    });

    it('should return resolved for full model ID with slashes', () => {
      const config = loadModule();
      const result = config.tryResolveModel('openrouter/google/gemini-3-flash-preview');
      expect(result.model).toBe('openrouter/google/gemini-3-flash-preview');
    });
  });

  describe('Edge cases', () => {
    it('should handle resolveModel with full model path containing multiple slashes', () => {
      const config = loadModule();
      const result = config.resolveModel('openrouter/google/gemini-3-flash-preview');
      expect(result).toBe('openrouter/google/gemini-3-flash-preview');
    });

    it('should handle resolveModel with single slash in model arg', () => {
      const config = loadModule();
      const result = config.resolveModel('provider/model');
      expect(result).toBe('provider/model');
    });

    it('should handle computeConfigHash with large config file', () => {
      const largeAliases = {};
      for (let i = 0; i < 100; i++) {
        largeAliases[`alias${i}`] = `openrouter/provider/model-${i}`;
      }
      const data = { default: 'alias0', aliases: largeAliases };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data, null, 2));
      const config = loadModule();
      const hash = config.computeConfigHash();
      expect(hash).toMatch(/^[0-9a-f]{8}$/);
    });

    it('should handle saveConfig with special characters in values', () => {
      const config = loadModule();
      const data = {
        default: 'test',
        aliases: { test: 'provider/model-with-special_chars.v2' }
      };
      config.saveConfig(data);
      const loaded = config.loadConfig();
      expect(loaded.aliases.test).toBe('provider/model-with-special_chars.v2');
    });
  });

  describe('buildProviderModels', () => {
    // Task 8.1a: direct-capable default aliases (gemini/opus/gpt/codex/
    // deepseek/...) are now BARE canonical ids, so they group under their
    // own direct provider bucket rather than nested under openrouter.
    // Gateway-only aliases (grok, qwen, ...) are unaffected — still nested
    // under openrouter.
    it('should group aliases by provider with model IDs as keys', () => {
      const config = loadModule();
      const result = config.buildProviderModels();
      expect(result).toHaveProperty('openrouter');
      expect(result.openrouter).toHaveProperty('models');
      expect(result.openrouter.models['x-ai/grok-4.3']).toBeDefined();
      expect(result.google.models['gemini-3.5-flash']).toBeDefined();
    });

    it('should include all default alias models', () => {
      const config = loadModule();
      const result = config.buildProviderModels();
      expect(result.anthropic.models['claude-opus-4.8']).toBeDefined();
      expect(result.openai.models['gpt-5.3-codex']).toBeDefined();
      expect(result.deepseek.models['deepseek-v4-pro']).toBeDefined();
    });

    it('should include user-configured aliases', () => {
      const data = {
        aliases: { 'my-model': 'openrouter/custom/my-special-model' },
      };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      const config = loadModule();
      const result = config.buildProviderModels();
      expect(result.openrouter.models).toHaveProperty('custom/my-special-model');
    });

    it('should handle non-openrouter providers', () => {
      const data = {
        aliases: { 'direct-gemini': 'google/gemini-2.5-flash' },
      };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      const config = loadModule();
      const result = config.buildProviderModels();
      expect(result).toHaveProperty('google');
      expect(result.google.models['gemini-2.5-flash']).toBeDefined();
    });

    it('should deduplicate models pointed to by multiple aliases', () => {
      // claude and sonnet both resolve to the same bare anthropic id.
      const config = loadModule();
      const result = config.buildProviderModels();
      const modelKeys = Object.keys(result.anthropic.models);
      const sonnetCount = modelKeys.filter(k => k === 'claude-sonnet-5').length;
      expect(sonnetCount).toBe(1);
    });

    it('zero-arg call groups direct-capable aliases under their direct provider, gateway-only aliases under openrouter', () => {
      const config = loadModule();
      const result = config.buildProviderModels();
      expect(result).toHaveProperty('openrouter');
      expect(result.openrouter.models['x-ai/grok-4.3']).toBeDefined();
      // gpt/opus are bare canonical ids (Task 8.1a) — grouped under their own
      // direct provider, not nested inside openrouter.
      expect(result.anthropic.models['claude-opus-4.8']).toBeDefined();
      expect(result.openai).toBeDefined();
    });

    it('registers a resolved route even when no alias points at it', () => {
      const config = loadModule();
      const result = config.buildProviderModels(['openai/gpt-5.5']);
      expect(result.openai).toBeDefined();
      expect(result.openai.models['gpt-5.5']).toEqual({});
    });

    it('registers the resolved DIRECT route alongside a mismatched alias-derived provider', () => {
      const data = {
        aliases: { gpt: 'openrouter/openai/gpt-5.5' },
      };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      const config = loadModule();
      const result = config.buildProviderModels(['openai/gpt-5.5']);
      // Alias-derived: openrouter carries the nested openai/gpt-5.5 model id.
      expect(result.openrouter).toBeDefined();
      expect(result.openrouter.models['openai/gpt-5.5']).toEqual({});
      // Resolved-route-derived: openai carries the plain gpt-5.5 model id.
      expect(result.openai).toBeDefined();
      expect(result.openai.models['gpt-5.5']).toEqual({});
    });

    it('splits a multi-segment resolved route into provider + remaining model id', () => {
      const config = loadModule();
      const result = config.buildProviderModels(['openrouter/anthropic/claude-sonnet-4.6']);
      expect(result.openrouter).toBeDefined();
      expect(result.openrouter.models['anthropic/claude-sonnet-4.6']).toEqual({});
    });

    it('ignores falsy and single-segment entries in resolvedRoutes', () => {
      const config = loadModule();
      const before = config.buildProviderModels();
      const result = config.buildProviderModels([null, undefined, '', 'no-slash-model']);
      expect(result).toEqual(before);
    });

    // #61 whole-branch review, FIX 1: the MCP shared server registers
    // provider.models ONCE (alias-derived only) but then serves many
    // sessions over its life, each independently routed direct-or-OpenRouter
    // by the gateway router. A resolvedRoutes entry threaded at creation time
    // only covers the FIRST session's route, so the alias-derived catalog
    // must itself cover both possible routes for every direct-capable alias.
    it('registers BOTH the direct and openrouter form for a bare direct-capable default alias', () => {
      const config = loadModule();
      const result = config.buildProviderModels();
      // gpt is a bare canonical default (Task 8.1a) — registered under its
      // own direct provider...
      expect(result.openai.models['gpt-5.5']).toEqual({});
      // ...AND mirrored under openrouter, so whichever route a given
      // session's router picks is already registered on the shared server.
      expect(result.openrouter.models['openai/gpt-5.5']).toEqual({});
    });

    it('registers a gateway-only default alias only under openrouter (no direct-provider mirror)', () => {
      const config = loadModule();
      const result = config.buildProviderModels();
      // grok has no direct integration (x-ai isn't a direct-capable vendor) —
      // openrouter is its only route, already covered by the normal alias
      // loop; the broadening must not invent an 'x-ai' top-level bucket.
      expect(result.openrouter.models['x-ai/grok-4.3']).toEqual({});
      expect(result['x-ai']).toBeUndefined();
    });
  });
});

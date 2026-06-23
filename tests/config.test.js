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
    process.env.SIDECAR_CONFIG_DIR = tempDir;
    process.env.SIDECAR_ENV_DIR = tempDir;
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
    it('should return SIDECAR_CONFIG_DIR when set', () => {
      const config = loadModule();
      expect(config.getConfigDir()).toBe(tempDir);
    });

    it('should return ~/.config/sidecar when env var is not set', () => {
      delete process.env.SIDECAR_CONFIG_DIR;
      jest.resetModules();
      const config = loadModule();
      const homeDir = process.env.HOME || process.env.USERPROFILE;
      expect(config.getConfigDir()).toBe(path.join(homeDir, '.config', 'sidecar'));
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
      process.env.SIDECAR_CONFIG_DIR = nestedDir;
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

    it('should map gemini to openrouter/google/gemini-3.5-flash', () => {
      const config = loadModule();
      const aliases = config.getDefaultAliases();
      expect(aliases.gemini).toBe('openrouter/google/gemini-3.5-flash');
    });

    it('should map claude to openrouter/anthropic/claude-sonnet-4.6', () => {
      const config = loadModule();
      const aliases = config.getDefaultAliases();
      expect(aliases.claude).toBe('openrouter/anthropic/claude-sonnet-4.6');
    });

    it('should map opus to openrouter/anthropic/claude-opus-4.8', () => {
      const config = loadModule();
      const aliases = config.getDefaultAliases();
      expect(aliases.opus).toBe('openrouter/anthropic/claude-opus-4.8');
    });

    it('should map gpt to openrouter/openai/gpt-5.5', () => {
      const config = loadModule();
      const aliases = config.getDefaultAliases();
      expect(aliases.gpt).toBe('openrouter/openai/gpt-5.5');
    });

    it('should map deepseek to openrouter/deepseek/deepseek-v4-pro', () => {
      const config = loadModule();
      const aliases = config.getDefaultAliases();
      expect(aliases.deepseek).toBe('openrouter/deepseek/deepseek-v4-pro');
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
      expect(aliases.gemini).toBe('openrouter/google/gemini-3.5-flash');
      expect(aliases.opus).toBe('openrouter/anthropic/claude-opus-4.8');
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
      expect(aliases.opus).toBe('openrouter/anthropic/claude-opus-4.8');
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
    it('should group aliases by provider with model IDs as keys', () => {
      const config = loadModule();
      const result = config.buildProviderModels();
      expect(result).toHaveProperty('openrouter');
      expect(result.openrouter).toHaveProperty('models');
      expect(result.openrouter.models['x-ai/grok-4.3']).toBeDefined();
      expect(result.openrouter.models['google/gemini-3.5-flash']).toBeDefined();
    });

    it('should include all default alias models', () => {
      const config = loadModule();
      const result = config.buildProviderModels();
      const modelKeys = Object.keys(result.openrouter.models);
      expect(modelKeys).toContain('anthropic/claude-opus-4.8');
      expect(modelKeys).toContain('openai/gpt-5.3-codex');
      expect(modelKeys).toContain('deepseek/deepseek-v4-pro');
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
      const config = loadModule();
      const result = config.buildProviderModels();
      const modelKeys = Object.keys(result.openrouter.models);
      const sonnetCount = modelKeys.filter(k => k === 'anthropic/claude-sonnet-4.6').length;
      expect(sonnetCount).toBe(1);
    });
  });
});

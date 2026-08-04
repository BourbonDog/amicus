/**
 * Sidecar Config Module Tests - Model Resolution
 *
 * Tests for resolveModel. The old direct-API-fallback stripping heuristic
 * (applyDirectApiFallback) and its detectFallback companion were retired in
 * #61 Task 4.7 — the gateway router now owns the direct-vs-OpenRouter
 * decision on every launch path, so resolveModel returns an alias's stored
 * id verbatim regardless of which API keys are present. See
 * tests/config-fallback.test.js for the no-strip contract tests, and
 * tests/gateway-router.test.js / tests/route-launch.test.js for routing
 * behavior.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

describe('Sidecar Config Module - Model Resolution', () => {
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

  describe('resolveModel', () => {
    it('should return modelArg as-is when it contains a slash', () => {
      const config = loadModule();
      const result = config.resolveModel('openrouter/google/gemini-3-flash-preview');
      expect(result).toBe('openrouter/google/gemini-3-flash-preview');
    });

    it('should resolve an alias from config.aliases', () => {
      const data = {
        default: 'gemini',
        aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' }
      };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      const config = loadModule();
      const result = config.resolveModel('gemini');
      expect(result).toBe('openrouter/google/gemini-3-flash-preview');
    });

    it('should throw Error mentioning amicus setup for unknown alias', () => {
      const data = {
        default: 'gemini',
        aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' }
      };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      const config = loadModule();
      expect(() => config.resolveModel('unknownmodel')).toThrow(/amicus setup/i);
    });

    it('should resolve default alias when modelArg is undefined', () => {
      const data = {
        default: 'gemini',
        aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' }
      };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      const config = loadModule();
      const result = config.resolveModel(undefined);
      expect(result).toBe('openrouter/google/gemini-3-flash-preview');
    });

    it('should throw Error when modelArg is undefined and no default is configured', () => {
      const data = { aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' } };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      const config = loadModule();
      expect(() => config.resolveModel(undefined)).toThrow();
    });

    it('should throw Error when modelArg is undefined and no config exists', () => {
      const config = loadModule();
      expect(() => config.resolveModel(undefined)).toThrow();
    });

    it('should handle default that is itself a full model string with slashes', () => {
      const data = {
        default: 'openrouter/openai/gpt-5.2-chat',
        aliases: {}
      };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      const config = loadModule();
      // default contains slash, so it should be returned as-is
      const result = config.resolveModel(undefined);
      expect(result).toBe('openrouter/openai/gpt-5.2-chat');
    });

    it('should resolve default when default is an alias key', () => {
      const data = {
        default: 'gpt',
        aliases: { gpt: 'openrouter/openai/gpt-5.2-chat' }
      };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      const config = loadModule();
      const result = config.resolveModel(undefined);
      expect(result).toBe('openrouter/openai/gpt-5.2-chat');
    });

    it('should handle config with empty aliases object', () => {
      const data = { default: 'gemini', aliases: {} };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      const config = loadModule();
      // 'gemini' is in DEFAULT_ALIASES so should resolve even with empty user aliases
      const result = config.resolveModel('gemini');
      expect(result).toBe(config.getDefaultAliases().gemini);
    });

    it('should resolve default alias (grok) when not in user config but exists in defaults', () => {
      const data = { default: 'gemini', aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' } };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      const config = loadModule();
      const result = config.resolveModel('grok');
      expect(result).toBe('openrouter/x-ai/grok-4.3');
    });

    it('should resolve default alias (grok) with no config file at all', () => {
      const config = loadModule();
      const result = config.resolveModel('grok');
      expect(result).toBe('openrouter/x-ai/grok-4.3');
    });

    it('should resolve default from DEFAULT_ALIASES when user config default points to a built-in alias', () => {
      const data = { default: 'grok', aliases: {} };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      const config = loadModule();
      const result = config.resolveModel(undefined);
      expect(result).toBe('openrouter/x-ai/grok-4.3');
    });

    it('should still throw for truly unknown aliases not in defaults or user config', () => {
      const config = loadModule();
      expect(() => config.resolveModel('notamodel')).toThrow(/amicus setup/i);
    });
  });

  describe('resolveModel - all default aliases resolve without config file', () => {
    it.each(Object.entries(require('../src/utils/config').getDefaultAliases()))(
      'resolves "%s" → "%s"',
      (alias, expectedModel) => {
        const config = loadModule();
        // No config file written — relies entirely on DEFAULT_ALIASES fallback
        expect(config.resolveModel(alias)).toBe(expectedModel);
      }
    );
  });

  describe('resolveModel - no-strip contract (#61 Task 4.7)', () => {
    // applyDirectApiFallback (and detectFallback, its dispatch companion) are
    // retired — the gateway router now owns the direct-vs-OpenRouter decision
    // on every launch path. resolveModel must return an alias's stored id
    // verbatim regardless of which API keys are present in the environment.
    let stderrSpy;
    beforeEach(() => {
      stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    });
    afterEach(() => {
      stderrSpy.mockRestore();
    });

    // Task 8.1a: gemini/gpt/opus/deepseek are now bare canonical default
    // aliases (direct-capable vendors), so resolveModel returns the stored
    // bare id verbatim — the gateway router (not resolveModel) is what
    // decides direct-vs-OpenRouter for a bare id at launch time.
    it('returns the stored bare id unchanged when GOOGLE_GENERATIVE_AI_API_KEY is set but OPENROUTER_API_KEY is not', () => {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-gemini-key';
      jest.resetModules();
      const config = loadModule();
      const result = config.resolveModel('gemini');
      expect(result).toBe('google/gemini-3.6-flash');
    });

    it('returns the stored bare id unchanged when OPENAI_API_KEY is set but OPENROUTER_API_KEY is not', () => {
      process.env.OPENAI_API_KEY = 'test-openai-key';
      jest.resetModules();
      const config = loadModule();
      const result = config.resolveModel('gpt');
      expect(result).toBe('openai/gpt-5.6-terra');
    });

    it('returns the stored bare id unchanged when ANTHROPIC_API_KEY is set but OPENROUTER_API_KEY is not', () => {
      process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
      jest.resetModules();
      const config = loadModule();
      const result = config.resolveModel('opus');
      expect(result).toBe('anthropic/claude-opus-5');
    });

    it('returns the stored bare id unchanged when DEEPSEEK_API_KEY is set but OPENROUTER_API_KEY is not', () => {
      process.env.DEEPSEEK_API_KEY = 'test-deepseek-key';
      jest.resetModules();
      const config = loadModule();
      const result = config.resolveModel('deepseek');
      expect(result).toBe('deepseek/deepseek-v4-pro');
    });

    it('returns the stored bare id unchanged when both OPENROUTER_API_KEY and a direct key are set', () => {
      process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-gemini-key';
      jest.resetModules();
      const config = loadModule();
      const result = config.resolveModel('gemini');
      expect(result).toBe('google/gemini-3.6-flash');
    });

    it('returns the stored bare id unchanged when neither key is set', () => {
      const config = loadModule();
      const result = config.resolveModel('gemini');
      expect(result).toBe('google/gemini-3.6-flash');
    });

    it('returns explicit model strings with slash unchanged regardless of env keys', () => {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-gemini-key';
      jest.resetModules();
      const config = loadModule();
      const result = config.resolveModel('openrouter/google/gemini-3.1-flash-lite-preview');
      expect(result).toBe('openrouter/google/gemini-3.1-flash-lite-preview');
    });

    it('returns the stored openrouter/ id unchanged for providers without a direct key mapping', () => {
      const config = loadModule();
      const result = config.resolveModel('qwen');
      expect(result).toBe('openrouter/qwen/qwen3.7-max');
    });

    it('returns the stored bare id unchanged via default alias resolution', () => {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-gemini-key';
      const data = { default: 'gemini', aliases: {} };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      jest.resetModules();
      const config = loadModule();
      const result = config.resolveModel(undefined);
      expect(result).toBe('google/gemini-3.6-flash');
    });

    it('returns explicit default model strings unchanged regardless of env keys', () => {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-gemini-key';
      const data = { default: 'openrouter/google/gemini-3.5-flash', aliases: {} };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      jest.resetModules();
      const config = loadModule();
      const result = config.resolveModel(undefined);
      expect(result).toBe('openrouter/google/gemini-3.5-flash');
    });
  });
});

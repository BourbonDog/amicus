/**
 * Setup Wizard Tests
 *
 * Tests for the sidecar setup module: addAlias, createDefaultConfig,
 * detectApiKeys, and runInteractiveSetup.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

// Mock setup-window to prevent Electron spawn in tests
jest.mock('../../src/sidecar/setup-window', () => ({
  launchSetupWindow: jest.fn().mockResolvedValue({ success: true })
}));

// Mock model-catalog to prevent real HTTPS fetches to openrouter.ai during seedCatalog()
// readCache is included (Task 12): handleProvider's doAdd (routed through here by
// the new local-provider wizard branch) calls it BEFORE saveConfig, for the
// shadow-namespace warning -- a mock missing that export throws
// "readCache is not a function", which addLocalProviderInteractive's own
// guarded try/catch swallows, silently skipping the config write.
jest.mock('../../src/utils/model-catalog', () => ({
  getCatalog: jest.fn(async () => []),
  refreshCatalog: jest.fn(async () => []),
  readCache: jest.fn(() => null),
}));

// Mock local-probe to prevent real network calls when the Task 12 local-provider
// wizard branch below routes through the real handleProvider.
jest.mock('../../src/utils/local-probe', () => ({
  probeLocalProvider: jest.fn(async () => ({ status: 'ok', models: ['ollama/llama3.3'] })),
  listLocalModels: jest.fn(async () => []),
}));

describe('Setup Wizard', () => {
  let tmpDir;
  let envDir;
  let originalEnv;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-setup-test-'));
    envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-env-test-'));
    originalEnv = { ...process.env };
    process.env.AMICUS_CONFIG_DIR = tmpDir;
    process.env.AMICUS_ENV_DIR = envDir;
    // Clear API key env vars
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(envDir, { recursive: true, force: true });
    } catch (_err) {
      // Ignore cleanup errors
    }
  });

  describe('addAlias', () => {
    it('should add alias to existing config', () => {
      // Pre-create a config with an existing alias
      const existingConfig = {
        default: 'gemini',
        aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' }
      };
      fs.writeFileSync(
        path.join(tmpDir, 'config.json'),
        JSON.stringify(existingConfig, null, 2)
      );

      const { addAlias } = require('../../src/sidecar/setup');
      addAlias('my-model', 'openrouter/custom/model-v1');

      // Read back the config
      const saved = JSON.parse(
        fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf-8')
      );
      expect(saved.aliases['my-model']).toBe('openrouter/custom/model-v1');
      // Existing alias should still be there
      expect(saved.aliases.gemini).toBe('openrouter/google/gemini-3-flash-preview');
      // Default should be preserved
      expect(saved.default).toBe('gemini');
    });

    it('should create config when none exists', () => {
      // Ensure no config exists
      const configPath = path.join(tmpDir, 'config.json');
      expect(fs.existsSync(configPath)).toBe(false);

      const { addAlias } = require('../../src/sidecar/setup');
      addAlias('test-alias', 'openrouter/test/model');

      const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(saved.aliases['test-alias']).toBe('openrouter/test/model');
    });

    it('should overwrite existing alias with same name', () => {
      const existingConfig = {
        aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' }
      };
      fs.writeFileSync(
        path.join(tmpDir, 'config.json'),
        JSON.stringify(existingConfig, null, 2)
      );

      const { addAlias } = require('../../src/sidecar/setup');
      addAlias('gemini', 'openrouter/google/gemini-3-pro-preview');

      const saved = JSON.parse(
        fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf-8')
      );
      expect(saved.aliases.gemini).toBe('openrouter/google/gemini-3-pro-preview');
    });
  });

  describe('createDefaultConfig', () => {
    it('should create config with all default aliases and chosen default', () => {
      const { createDefaultConfig } = require('../../src/sidecar/setup');
      const cfg = createDefaultConfig('gemini');

      expect(cfg.default).toBe('gemini');
      expect(cfg.aliases).toBeDefined();
      expect(cfg.aliases.gemini).toBeDefined();
      expect(cfg.aliases['gemini-pro']).toBeDefined();
      expect(cfg.aliases.gpt).toBeDefined();
      expect(cfg.aliases.opus).toBeDefined();
      expect(cfg.aliases.deepseek).toBeDefined();

      // Verify it was saved to disk
      const saved = JSON.parse(
        fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf-8')
      );
      expect(saved.default).toBe('gemini');
      expect(saved.aliases).toEqual(cfg.aliases);
    });

    it('should have 20+ aliases', () => {
      const { createDefaultConfig } = require('../../src/sidecar/setup');
      const cfg = createDefaultConfig('gemini');

      const aliasCount = Object.keys(cfg.aliases).length;
      expect(aliasCount).toBeGreaterThanOrEqual(20);
    });

    it('should accept any string as default model', () => {
      const { createDefaultConfig } = require('../../src/sidecar/setup');
      const cfg = createDefaultConfig('openrouter/custom/my-model');

      expect(cfg.default).toBe('openrouter/custom/my-model');
    });
  });

  describe('detectApiKeys', () => {
    it('should detect OpenRouter key from .env file', () => {
      fs.writeFileSync(
        path.join(envDir, '.env'),
        'OPENROUTER_API_KEY=sk-or-test-key\n'
      );

      const { detectApiKeys } = require('../../src/sidecar/setup');
      const result = detectApiKeys();

      expect(result.openrouter).toBe(true);
      expect(result.google).toBe(false);
      expect(result.openai).toBe(false);
      expect(result.anthropic).toBe(false);
    });

    it('should detect Google key from .env file', () => {
      fs.writeFileSync(
        path.join(envDir, '.env'),
        'GOOGLE_GENERATIVE_AI_API_KEY=AIza-test-key\n'
      );

      const { detectApiKeys } = require('../../src/sidecar/setup');
      const result = detectApiKeys();

      expect(result.google).toBe(true);
    });

    it('should detect OpenAI key from .env file', () => {
      fs.writeFileSync(
        path.join(envDir, '.env'),
        'OPENAI_API_KEY=sk-test-key\n'
      );

      const { detectApiKeys } = require('../../src/sidecar/setup');
      const result = detectApiKeys();

      expect(result.openai).toBe(true);
    });

    it('should detect env var keys (OPENROUTER_API_KEY)', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-env-key';

      const { detectApiKeys } = require('../../src/sidecar/setup');
      const result = detectApiKeys();

      expect(result.openrouter).toBe(true);
    });

    it('should detect env var keys (GOOGLE_GENERATIVE_AI_API_KEY)', () => {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'AIza-env-key';

      const { detectApiKeys } = require('../../src/sidecar/setup');
      const result = detectApiKeys();

      expect(result.google).toBe(true);
    });

    it('should detect env var keys (OPENAI_API_KEY)', () => {
      process.env.OPENAI_API_KEY = 'sk-env-key';

      const { detectApiKeys } = require('../../src/sidecar/setup');
      const result = detectApiKeys();

      expect(result.openai).toBe(true);
    });

    it('should detect env var keys (ANTHROPIC_API_KEY)', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-env-key';

      const { detectApiKeys } = require('../../src/sidecar/setup');
      const result = detectApiKeys();

      expect(result.anthropic).toBe(true);
    });

    it('should return all false when no keys found', () => {
      const { detectApiKeys } = require('../../src/sidecar/setup');
      const result = detectApiKeys();

      expect(result.openrouter).toBe(false);
      expect(result.google).toBe(false);
      expect(result.openai).toBe(false);
      expect(result.anthropic).toBe(false);
    });

    it('should handle malformed .env file gracefully', () => {
      fs.writeFileSync(path.join(envDir, '.env'), 'not a valid env format without equals');

      const { detectApiKeys } = require('../../src/sidecar/setup');
      const result = detectApiKeys();

      expect(result.openrouter).toBe(false);
      expect(result.google).toBe(false);
    });

    it('should combine env vars and .env file keys', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-env';

      fs.writeFileSync(
        path.join(envDir, '.env'),
        'GOOGLE_GENERATIVE_AI_API_KEY=AIza-test\n'
      );

      const { detectApiKeys } = require('../../src/sidecar/setup');
      const result = detectApiKeys();

      expect(result.openrouter).toBe(true);
      expect(result.google).toBe(true);
    });
  });

  describe('runReadlineSetup', () => {
    it('should be an exported async function', () => {
      const { runReadlineSetup } = require('../../src/sidecar/setup');
      expect(typeof runReadlineSetup).toBe('function');
    });

    it('should create config when user picks option 1 (gemini)', async () => {
      const readline = require('readline');

      const mockInterface = {
        question: jest.fn(),
        close: jest.fn()
      };

      mockInterface.question.mockImplementation((_prompt, callback) => {
        callback('1');
      });

      jest.spyOn(readline, 'createInterface').mockReturnValue(mockInterface);

      const { runReadlineSetup } = require('../../src/sidecar/setup');
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      await runReadlineSetup();

      logSpy.mockRestore();
      readline.createInterface.mockRestore();

      const saved = JSON.parse(
        fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf-8')
      );
      expect(saved.default).toBe('gemini');
      expect(saved.aliases).toBeDefined();
    });

    it('should accept alias name as input (e.g., "opus")', async () => {
      const readline = require('readline');

      const mockInterface = {
        question: jest.fn(),
        close: jest.fn()
      };

      mockInterface.question.mockImplementation((_prompt, callback) => {
        callback('opus');
      });

      jest.spyOn(readline, 'createInterface').mockReturnValue(mockInterface);

      const { runReadlineSetup } = require('../../src/sidecar/setup');
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      await runReadlineSetup();

      logSpy.mockRestore();
      readline.createInterface.mockRestore();

      const saved = JSON.parse(
        fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf-8')
      );
      expect(saved.default).toBe('opus');
    });
  });

  describe('runReadlineSetup — per-provider default picker (Task 7, cost-aware defaults P2)', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('runs the shared per-provider picker once per keyed provider (detection order), seeds config.default from the FIRST, and preserves both vendor aliases through the final save', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
      process.env.DEEPSEEK_API_KEY = 'sk-deepseek-test-key';

      const { getCatalog } = require('../../src/utils/model-catalog');
      getCatalog.mockResolvedValueOnce([
        { id: 'anthropic/claude-cheap', name: 'Claude Cheap', contextLength: 100000, pricing: null },
        { id: 'openrouter/anthropic/claude-cheap', name: 'Claude Cheap', contextLength: 100000, pricing: { prompt: '0.000001' } },
        { id: 'deepseek/deepseek-cheap', name: 'DeepSeek Cheap', contextLength: 32000, pricing: null },
        { id: 'openrouter/deepseek/deepseek-cheap', name: 'DeepSeek Cheap', contextLength: 32000, pricing: { prompt: '0.0000005' } },
      ]);

      // Snapshotted the instant the mode prompt fires -- by construction this is
      // AFTER runProviderDefaultPickers has fully completed (both providers'
      // applyProviderDefault saves are on disk) but BEFORE the standard model
      // step's own save. Reading real on-disk state here (rather than spying on
      // config.js's exported saveConfig) sidesteps a CommonJS trap: setup.js and
      // provider-default-picker.js each destructure `saveConfig` from `require
      // ('./config')` at module-load time, so a `jest.spyOn(configModule,
      // 'saveConfig')` installed afterward would only intercept whichever of
      // those modules happened to load AFTER the spy -- order-dependent and
      // unreliable. A real fs read has no such gap.
      let midFlowConfig = null;
      const readline = require('readline');
      const mockInterface = { question: jest.fn(), close: jest.fn() };
      mockInterface.question.mockImplementation((prompt, callback) => {
        if (prompt.includes('Pick a number')) { callback(''); return; } // Enter -> accept preselected, per provider
        if (prompt.includes('Setup mode')) {
          try {
            midFlowConfig = JSON.parse(fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf-8'));
          } catch (_err) { midFlowConfig = null; }
          callback('1'); // standard mode
          return;
        }
        callback('1'); // standard model step -> picks[0] ('gemini')
      });
      jest.spyOn(readline, 'createInterface').mockReturnValue(mockInterface);

      const providerDefaultPrompt = require('../../src/utils/provider-default-prompt');
      const flowSpy = jest.spyOn(providerDefaultPrompt, 'runProviderDefaultFlow');

      jest.spyOn(console, 'log').mockImplementation(() => {});

      const { runReadlineSetup } = require('../../src/sidecar/setup');
      await runReadlineSetup();

      // Invoked once per keyed provider, in detection order (anthropic before deepseek --
      // readApiKeys()'s result object is always declared openrouter/google/openai/anthropic/deepseek).
      expect(flowSpy).toHaveBeenCalledTimes(2);
      expect(flowSpy.mock.calls[0][0]).toBe('anthropic');
      expect(flowSpy.mock.calls[1][0]).toBe('deepseek');

      // Mid-flow (right after the per-provider phase, before the standard step):
      // config.default is seeded from the FIRST keyed provider, and both vendor
      // aliases are already written.
      expect(midFlowConfig).not.toBeNull();
      expect(midFlowConfig.default).toBe('anthropic');
      expect(midFlowConfig.aliases.anthropic).toBe('anthropic/claude-cheap');
      expect(midFlowConfig.aliases.deepseek).toBe('deepseek/deepseek-cheap');

      // Final on-disk state: the standard model step's explicit choice legitimately
      // overrides config.default (deliberate, runs last) but must NOT clobber the
      // vendor aliases the per-provider phase already wrote.
      const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf-8'));
      expect(saved.aliases.anthropic).toBe('anthropic/claude-cheap');
      expect(saved.aliases.deepseek).toBe('deepseek/deepseek-cheap');
      expect(saved.default).toBe('gemini');
    });

    it('degrades gracefully (no crash, prints a soft notice, standard step still completes) when a keyed provider has no catalog rows', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
      // model-catalog mock (file-level) resolves to [] by default -- offline/empty.

      const readline = require('readline');
      const mockInterface = { question: jest.fn(), close: jest.fn() };
      mockInterface.question.mockImplementation((_prompt, callback) => callback('1'));
      jest.spyOn(readline, 'createInterface').mockReturnValue(mockInterface);

      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const { runReadlineSetup } = require('../../src/sidecar/setup');
      await runReadlineSetup(); // must not throw

      const printed = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
      expect(printed).toMatch(/Couldn't reach the model catalog for anthropic/);

      const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf-8'));
      expect(saved.default).toBe('gemini'); // standard step still ran normally
    });

    it('Fix 2: standard step selecting the quick-pick family that collides with a just-written vendor alias (deepseek) keeps the tier-chosen id -- does not clobber it with the curated flagship', async () => {
      process.env.DEEPSEEK_API_KEY = 'sk-deepseek-test-key';

      const { getCatalog } = require('../../src/utils/model-catalog');
      getCatalog.mockResolvedValueOnce([
        // 'balanced' tier (default cost tier) match for deepseek -- the
        // per-provider phase's tier-chosen pick.
        { id: 'deepseek/deepseek-v3', name: 'DeepSeek V3', contextLength: 64000, pricing: null },
        { id: 'openrouter/deepseek/deepseek-v3', name: 'DeepSeek V3', contextLength: 64000, pricing: { prompt: '0.0000005' } },
        // Newest/highest-version id -- what the standard step's quick-pick
        // family resolver (resolveQuickPicks) would treat as the curated
        // flagship for the 'deepseek' family alias.
        { id: 'deepseek/deepseek-v4-pro', name: 'DeepSeek V4 Pro', contextLength: 128000, pricing: null },
        { id: 'openrouter/deepseek/deepseek-v4-pro', name: 'DeepSeek V4 Pro', contextLength: 128000, pricing: { prompt: '0.00001' } },
      ]);

      const readline = require('readline');
      const mockInterface = { question: jest.fn(), close: jest.fn() };
      mockInterface.question.mockImplementation((prompt, callback) => {
        if (prompt.includes('Pick a number')) { callback(''); return; } // per-provider phase: accept preselected (tier-chosen)
        if (prompt.includes('Setup mode')) { callback('1'); return; } // standard mode
        callback('5'); // standard model step -> quick-pick families are
        // [gemini, gemini-pro, gpt, opus, deepseek] (curated-models.js
        // FAMILIES order) -> '5' selects the 'deepseek' family, whose alias
        // name collides with the vendor alias the per-provider phase just wrote.
      });
      jest.spyOn(readline, 'createInterface').mockReturnValue(mockInterface);

      jest.spyOn(console, 'log').mockImplementation(() => {});

      const { runReadlineSetup } = require('../../src/sidecar/setup');
      await runReadlineSetup();

      const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf-8'));
      // The standard step's explicit choice legitimately becomes config.default...
      expect(saved.default).toBe('deepseek');
      // ...but the alias's VALUE must stay the per-provider phase's tier
      // choice (deepseek-v3), NOT get overwritten with the curated flagship
      // (deepseek-v4-pro) the standard step would otherwise upgrade it to.
      expect(saved.aliases.deepseek).toBe('deepseek/deepseek-v3');
    });
  });

  describe('runReadlineSetup — local / self-hosted provider offer (Task 12, v4.2 §4.6)', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('answering "y" adds the local provider via the real handleProvider path (D7)', async () => {
      const readline = require('readline');
      const answers = ['y', 'ollama', 'ollama', '1', '1']; // wantLocal, id, preset, mode, pick
      const mockInterface = { question: jest.fn(), close: jest.fn() };
      mockInterface.question.mockImplementation((_prompt, callback) => callback(answers.shift() ?? ''));
      jest.spyOn(readline, 'createInterface').mockReturnValue(mockInterface);
      jest.spyOn(console, 'log').mockImplementation(() => {});

      const { runReadlineSetup } = require('../../src/sidecar/setup');
      await runReadlineSetup();

      const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf-8'));
      // Written by the real handleProvider/local-providers validation path, not
      // hand-rolled here -- proves the wizard is a second consumer of D7, not a
      // duplicate implementation.
      expect(saved.providers.ollama.baseURL).toBe('http://127.0.0.1:11434/v1');
      expect(saved.providers.ollama.flavor).toBe('ollama');
    });

    it('declining (any non-"y" answer) adds no local provider and does not disturb the rest of the wizard', async () => {
      const readline = require('readline');
      const mockInterface = { question: jest.fn(), close: jest.fn() };
      mockInterface.question.mockImplementation((_prompt, callback) => callback('1'));
      jest.spyOn(readline, 'createInterface').mockReturnValue(mockInterface);
      jest.spyOn(console, 'log').mockImplementation(() => {});

      const { runReadlineSetup } = require('../../src/sidecar/setup');
      await runReadlineSetup();

      const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf-8'));
      expect(saved.providers).toBeUndefined();
      expect(saved.default).toBe('gemini'); // rest of the wizard still ran normally
    });

    it('lists an already-configured local provider alongside detected keys', async () => {
      fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify({
        providers: { ollama: { type: 'openai-compatible', baseURL: 'http://127.0.0.1:11434/v1', flavor: 'ollama' } },
      }));

      const readline = require('readline');
      const mockInterface = { question: jest.fn(), close: jest.fn() };
      mockInterface.question.mockImplementation((_prompt, callback) => callback('1')); // decline local, pick 1 everywhere else
      jest.spyOn(readline, 'createInterface').mockReturnValue(mockInterface);
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const { runReadlineSetup } = require('../../src/sidecar/setup');
      await runReadlineSetup();

      const printed = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
      expect(printed).toMatch(/Local providers configured:.*ollama/);
    });
  });

  describe('runInteractiveSetup (Electron-first)', () => {
    it('should be an async function', () => {
      const { runInteractiveSetup } = require('../../src/sidecar/setup');
      expect(typeof runInteractiveSetup).toBe('function');
    });

    it('should attempt to launch Electron wizard first', async () => {
      const { launchSetupWindow } = require('../../src/sidecar/setup-window');
      launchSetupWindow.mockResolvedValue({
        success: true, default: 'gemini', keyCount: 1
      });

      const { runInteractiveSetup } = require('../../src/sidecar/setup');
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      await runInteractiveSetup();

      logSpy.mockRestore();

      expect(launchSetupWindow).toHaveBeenCalled();
    });

    it('should create config from Electron wizard result', async () => {
      const { launchSetupWindow } = require('../../src/sidecar/setup-window');
      launchSetupWindow.mockResolvedValue({
        success: true, default: 'gemini-pro', keyCount: 2
      });

      const { runInteractiveSetup } = require('../../src/sidecar/setup');
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      await runInteractiveSetup();

      logSpy.mockRestore();

      // Config should have been created with the wizard's chosen default
      const saved = JSON.parse(
        fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf-8')
      );
      expect(saved.default).toBe('gemini-pro');
    });

    it('should fall back to readline when Electron fails', async () => {
      const { launchSetupWindow } = require('../../src/sidecar/setup-window');
      launchSetupWindow.mockRejectedValue(new Error('Electron not available'));

      const readline = require('readline');
      const mockInterface = {
        question: jest.fn(),
        close: jest.fn()
      };
      mockInterface.question.mockImplementation((_prompt, callback) => {
        callback('3'); // pick gpt
      });
      jest.spyOn(readline, 'createInterface').mockReturnValue(mockInterface);

      const { runInteractiveSetup } = require('../../src/sidecar/setup');
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      await runInteractiveSetup();

      logSpy.mockRestore();
      readline.createInterface.mockRestore();

      const saved = JSON.parse(
        fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf-8')
      );
      expect(saved.default).toBe('gpt');
    });
  });
});

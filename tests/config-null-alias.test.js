/**
 * Null Alias Defense Tests
 *
 * Tests for multi-layer validation that prevents null model aliases
 * from causing silent headless failures.
 *
 * Layer 1: Input validation (addAlias rejects null)
 * Layer 2: Resolution validation (resolveModel handles null gracefully)
 * Layer 3: Auto-repair on load (loadConfig sanitizes null aliases)
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

jest.mock('../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

// Mock setup-window to prevent Electron spawn
jest.mock('../src/sidecar/setup-window', () => ({
  launchSetupWindow: jest.fn().mockResolvedValue({ success: true })
}));

describe('Null Alias Defense', () => {
  let tempDir;
  let originalEnv;
  let stderrSpy;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-null-alias-'));
    originalEnv = { ...process.env };
    process.env.AMICUS_CONFIG_DIR = tempDir;
    process.env.AMICUS_ENV_DIR = tempDir;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    stderrSpy.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function loadConfig() {
    return require('../src/utils/config');
  }

  function loadSetup() {
    return require('../src/sidecar/setup');
  }

  function writeConfig(data) {
    fs.writeFileSync(
      path.join(tempDir, 'config.json'),
      JSON.stringify(data, null, 2)
    );
  }

  function readConfig() {
    return JSON.parse(
      fs.readFileSync(path.join(tempDir, 'config.json'), 'utf-8')
    );
  }

  // ── Layer 1: Input Validation ──────────────────────────────

  describe('Layer 1: addAlias input validation', () => {
    it('should reject null modelString', () => {
      const { addAlias } = loadSetup();
      expect(() => addAlias('test', null)).toThrow(/invalid.*model/i);
    });

    it('should reject undefined modelString', () => {
      const { addAlias } = loadSetup();
      expect(() => addAlias('test', undefined)).toThrow(/invalid.*model/i);
    });

    it('should reject empty string modelString', () => {
      const { addAlias } = loadSetup();
      expect(() => addAlias('test', '')).toThrow(/invalid.*model/i);
    });

    it('should reject literal string "null"', () => {
      const { addAlias } = loadSetup();
      expect(() => addAlias('test', 'null')).toThrow(/invalid.*model/i);
    });

    it('should reject null alias name', () => {
      const { addAlias } = loadSetup();
      expect(() => addAlias(null, 'openrouter/test/model')).toThrow(/invalid.*alias/i);
    });

    it('should reject empty alias name', () => {
      const { addAlias } = loadSetup();
      expect(() => addAlias('', 'openrouter/test/model')).toThrow(/invalid.*alias/i);
    });

    it('should reject literal string "null" as alias name', () => {
      const { addAlias } = loadSetup();
      expect(() => addAlias('null', 'openrouter/test/model')).toThrow(/invalid.*alias/i);
    });

    it('should reject whitespace-only alias name', () => {
      const { addAlias } = loadSetup();
      expect(() => addAlias('   ', 'openrouter/test/model')).toThrow(/invalid.*alias/i);
    });

    it('should reject whitespace-only model string', () => {
      const { addAlias } = loadSetup();
      expect(() => addAlias('test', '   ')).toThrow(/invalid.*model/i);
    });

    it('should trim whitespace from name and model', () => {
      writeConfig({ aliases: {} });
      const { addAlias } = loadSetup();
      addAlias('  mymodel  ', '  openrouter/test/model-v1  ');
      const saved = readConfig();
      expect(saved.aliases.mymodel).toBe('openrouter/test/model-v1');
    });

    it('should still accept valid alias additions', () => {
      writeConfig({ aliases: {} });
      const { addAlias } = loadSetup();
      addAlias('mymodel', 'openrouter/test/model-v1');
      const saved = readConfig();
      expect(saved.aliases.mymodel).toBe('openrouter/test/model-v1');
    });
  });

  // ── Layer 2: Resolution Validation ─────────────────────────

  describe('Layer 2: resolveModel null alias handling', () => {
    it('should auto-repair null alias when default exists', () => {
      writeConfig({
        default: 'gemini',
        aliases: { gemini: null }
      });
      const config = loadConfig();
      const result = config.resolveModel('gemini');

      // Should resolve from DEFAULT_ALIASES
      expect(result).toBe(config.getDefaultAliases().gemini);
    });

    it('should throw clear error for null alias with no default available', () => {
      writeConfig({
        default: 'custom',
        aliases: { custom: null }
      });
      const config = loadConfig();
      expect(() => config.resolveModel('custom')).toThrow(/no model/i);
    });

    it('should auto-repair null default alias and resolve correctly', () => {
      // Default points to alias that is null, but DEFAULT_ALIASES has a value
      writeConfig({
        default: 'gemini-pro',
        aliases: { 'gemini-pro': null }
      });
      const config = loadConfig();
      const result = config.resolveModel(undefined);

      expect(result).toBe(config.getDefaultAliases()['gemini-pro']);
    });

    it('should warn to stderr when auto-repairing', () => {
      writeConfig({
        default: 'gemini',
        aliases: { gemini: null }
      });
      const config = loadConfig();
      config.resolveModel('gemini');

      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('Auto-repaired')
      );
    });
  });

  // ── Layer 3: saveConfig sanitization ───────────────────────

  describe('Layer 2b: an Object.prototype key on the AUTO-REPAIR path (SI-22.4 round 3, G-1)', () => {
    // ⚠️ This branch is NOT reachable through getEffectiveAliases, so none of
    // the round-2 pins cover it. `resolveModel:114`/`:145` hand `DEFAULT_ALIASES`
    // ITSELF to `alias-resolver.js :: autoRepairAlias`, whose gate is
    // `defaultAliases[alias]`. Before fix round 3 that map was built by
    // `curated-models.js :: toDefaultAliases` as a bare `{}`, so a null-valued
    // alias named `toString` "repaired" to Function.prototype.toString and
    // announced: Auto-repaired null alias 'toString' -> 'function toString()
    // { [native code] }'. Named mutant: preset-trim-mutants.js :: BUILDERPROTO.
    const INHERITED = ['toString', 'valueOf', 'constructor', 'hasOwnProperty'];

    it('throws instead of repairing a null alias to an inherited Function', () => {
      for (const key of INHERITED) {
        jest.resetModules();
        writeConfig({ default: 'gemini', aliases: { [key]: null } });
        const config = loadConfig();
        expect(() => config.resolveModel(key)).toThrow(/configured but has no model value/);
      }
    });

    it('never announces an auto-repair for one', () => {
      writeConfig({ default: 'gemini', aliases: { toString: null } });
      const config = loadConfig();
      try { config.resolveModel('toString'); } catch { /* expected */ }
      const said = stderrSpy.mock.calls.map(c => String(c[0])).join('');
      expect(said).not.toMatch(/Auto-repaired null alias 'toString'/);
      expect(said).not.toMatch(/native code/);
    });

    it('still repairs a REAL null alias, so the fix is surgical', () => {
      writeConfig({ default: 'gemini', aliases: { gemini: null } });
      const config = loadConfig();
      expect(typeof config.resolveModel('gemini')).toBe('string');
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Auto-repaired'));
    });

    it('the maps the repair path reads are null-prototype at the source', () => {
      const { toDefaultAliases, toGatewayRoutes } = require('../src/utils/curated-models');
      const { getDefaultAliases } = loadConfig();
      // getDefaultAliases spreads into a fresh literal, so it needs its OWN
      // seed — fixing the two builders alone does not reach it.
      for (const m of [toDefaultAliases(), toGatewayRoutes(), getDefaultAliases()]) {
        expect(Object.getPrototypeOf(m)).toBeNull();
        for (const k of INHERITED) { expect(m[k]).toBeUndefined(); }
      }
      expect(toDefaultAliases().gemini).toBeDefined();   // the tables still work
      expect(getDefaultAliases().gemini).toBeDefined();
    });
  });

  describe('Layer 3: saveConfig sanitization', () => {
    it('ANNOUNCES a `__proto__` alias instead of dropping it silently (round 3, G-5)', () => {
      // `cleaned[key] = value` hit Object.prototype's inherited `__proto__`
      // setter, which ignores a string — so the alias vanished with none of the
      // "Removing invalid alias" notices every other removal prints. No
      // pollution was possible (only strings reach that line, and the setter
      // ignores them), so this is an ANNOUNCEMENT fix, not a security one.
      const config = loadConfig();
      const cfg = {
        default: 'gemini',
        // JSON.parse, so `__proto__` is a genuine OWN property, not the setter.
        aliases: JSON.parse('{"__proto__":"openai/gpt-5","good":"openai/gpt-5"}'),
      };
      config.saveConfig(cfg);
      expect(Object.keys(cfg.aliases)).toEqual(['good']);
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining("Removing invalid alias '__proto__'"));
      expect(readConfig().aliases).toEqual({ good: 'openai/gpt-5' });
    });

    it('should strip null alias values on save', () => {
      const config = loadConfig();
      config.saveConfig({
        default: 'gemini',
        aliases: {
          gemini: 'openrouter/google/gemini-3.1-pro-preview',
          broken: null
        }
      });
      const saved = readConfig();
      expect(saved.aliases.broken).toBeUndefined();
    });

    it('should strip "null" string alias values on save', () => {
      const config = loadConfig();
      config.saveConfig({
        default: 'gemini',
        aliases: {
          gemini: 'openrouter/google/gemini-3.1-pro-preview',
          broken: 'null'
        }
      });
      const saved = readConfig();
      expect(saved.aliases.broken).toBeUndefined();
    });

    it('should remove alias entries with key "null"', () => {
      const config = loadConfig();
      config.saveConfig({
        default: 'gemini',
        aliases: {
          gemini: 'openrouter/google/gemini-3.1-pro-preview',
          'null': 'openrouter/some/model'
        }
      });
      const saved = readConfig();
      expect(saved.aliases['null']).toBeUndefined();
    });

    it('should warn to stderr when stripping invalid entries', () => {
      const config = loadConfig();
      config.saveConfig({
        default: 'gemini',
        aliases: {
          gemini: 'openrouter/google/gemini-3.1-pro-preview',
          broken: null
        }
      });
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('broken')
      );
    });

    it('should preserve valid aliases when stripping invalid ones', () => {
      const config = loadConfig();
      config.saveConfig({
        default: 'gemini',
        aliases: {
          gemini: 'openrouter/google/gemini-3.1-pro-preview',
          gpt: 'openrouter/openai/gpt-5.4',
          broken1: null,
          broken2: 'null',
          'null': null
        }
      });
      const saved = readConfig();
      expect(saved.aliases.gemini).toBe('openrouter/google/gemini-3.1-pro-preview');
      expect(saved.aliases.gpt).toBe('openrouter/openai/gpt-5.4');
      expect(Object.keys(saved.aliases)).toHaveLength(2);
    });

    it('should not modify config when all aliases are valid', () => {
      const config = loadConfig();
      config.saveConfig({
        default: 'gemini',
        aliases: {
          gemini: 'openrouter/google/gemini-3.1-pro-preview',
          gpt: 'openrouter/openai/gpt-5.4'
        }
      });
      const saved = readConfig();
      expect(saved.aliases.gemini).toBe('openrouter/google/gemini-3.1-pro-preview');
      expect(saved.aliases.gpt).toBe('openrouter/openai/gpt-5.4');
      expect(stderrSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Removing invalid')
      );
    });
  });
});

/**
 * Tests for src/utils/api-key-store.js
 *
 * API key persistence using .env files: reading, saving, validation,
 * and process.env integration.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  readApiKeys,
  saveApiKey,
  getEnvPath,
  PROVIDER_ENV_MAP
} = require('../src/utils/api-key-store');

describe('api-key-store', () => {
  let tmpDir;
  let originalEnv;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-apikey-'));
    originalEnv = { ...process.env };
    // Point env dir to temp for test isolation
    process.env.SIDECAR_ENV_DIR = tmpDir;
    // Clear relevant env vars so they don't leak between tests
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('PROVIDER_ENV_MAP', () => {
    it('should map provider IDs to env var names', () => {
      expect(PROVIDER_ENV_MAP.openrouter).toBe('OPENROUTER_API_KEY');
      expect(PROVIDER_ENV_MAP.google).toBe('GOOGLE_GENERATIVE_AI_API_KEY');
      expect(PROVIDER_ENV_MAP.openai).toBe('OPENAI_API_KEY');
      expect(PROVIDER_ENV_MAP.anthropic).toBe('ANTHROPIC_API_KEY');
      expect(PROVIDER_ENV_MAP.deepseek).toBe('DEEPSEEK_API_KEY');
    });

    it('should have exactly 5 providers', () => {
      expect(Object.keys(PROVIDER_ENV_MAP)).toHaveLength(5);
    });
  });

  describe('getEnvPath', () => {
    it('should return path inside SIDECAR_ENV_DIR when set', () => {
      const result = getEnvPath();
      expect(result).toBe(path.join(tmpDir, '.env'));
    });

    it('should default to ~/.config/amicus/.env', () => {
      delete process.env.SIDECAR_ENV_DIR;
      const result = getEnvPath();
      const homeDir = process.env.HOME || process.env.USERPROFILE;
      expect(result).toBe(path.join(homeDir, '.config', 'amicus', '.env'));
    });

    it('should return path inside AMICUS_ENV_DIR when set', () => {
      delete process.env.SIDECAR_ENV_DIR;
      const amicusTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-envdir-'));
      try {
        process.env.AMICUS_ENV_DIR = amicusTmpDir;
        const result = getEnvPath();
        expect(result).toBe(path.join(amicusTmpDir, '.env'));
      } finally {
        delete process.env.AMICUS_ENV_DIR;
        fs.rmSync(amicusTmpDir, { recursive: true, force: true });
      }
    });

    it('AMICUS_ENV_DIR wins over legacy SIDECAR_ENV_DIR', () => {
      const amicusTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-envdir-win-'));
      try {
        // Both set — AMICUS_ must win
        process.env.SIDECAR_ENV_DIR = tmpDir;
        process.env.AMICUS_ENV_DIR = amicusTmpDir;
        const result = getEnvPath();
        expect(result).toBe(path.join(amicusTmpDir, '.env'));
      } finally {
        delete process.env.AMICUS_ENV_DIR;
        fs.rmSync(amicusTmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('readApiKeys', () => {
    it('should return all false when .env does not exist', () => {
      const result = readApiKeys();
      expect(result).toEqual({
        openrouter: false,
        google: false,
        openai: false,
        anthropic: false,
        deepseek: false
      });
    });

    it('should detect keys from .env file', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.env'),
        'OPENROUTER_API_KEY=sk-or-test-123\nGOOGLE_GENERATIVE_AI_API_KEY=AIza-test\n'
      );

      const result = readApiKeys();
      expect(result.openrouter).toBe(true);
      expect(result.google).toBe(true);
      expect(result.openai).toBe(false);
      expect(result.anthropic).toBe(false);
    });

    it('should detect keys from process.env', () => {
      process.env.OPENAI_API_KEY = 'sk-test-from-env';

      const result = readApiKeys();
      expect(result.openai).toBe(true);
    });

    it('should combine .env file and process.env', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.env'),
        'OPENROUTER_API_KEY=sk-or-test\n'
      );
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

      const result = readApiKeys();
      expect(result.openrouter).toBe(true);
      expect(result.anthropic).toBe(true);
      expect(result.google).toBe(false);
      expect(result.openai).toBe(false);
    });

    it('should handle empty .env file', () => {
      fs.writeFileSync(path.join(tmpDir, '.env'), '');
      const result = readApiKeys();
      expect(result).toEqual({
        openrouter: false,
        google: false,
        openai: false,
        anthropic: false,
        deepseek: false
      });
    });

    it('should ignore comments and blank lines in .env', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.env'),
        '# Sidecar API Keys\n\nOPENROUTER_API_KEY=sk-or-test\n\n# More comments\n'
      );

      const result = readApiKeys();
      expect(result.openrouter).toBe(true);
      expect(result.google).toBe(false);
    });

    it('should detect deepseek key from process.env', () => {
      process.env.DEEPSEEK_API_KEY = 'sk-deepseek-test-key';

      const result = readApiKeys();
      expect(result.deepseek).toBe(true);
    });

    it('should ignore keys with empty values', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.env'),
        'OPENROUTER_API_KEY=\n'
      );

      const result = readApiKeys();
      expect(result.openrouter).toBe(false);
    });
  });

  describe('saveApiKey', () => {
    it('should create .env file with the key', () => {
      saveApiKey('openrouter', 'sk-or-test-456');
      const content = fs.readFileSync(path.join(tmpDir, '.env'), 'utf-8');
      expect(content).toContain('OPENROUTER_API_KEY=sk-or-test-456');
    });

    it('should create directory if it does not exist', () => {
      const nestedDir = path.join(tmpDir, 'nested', 'dir');
      process.env.SIDECAR_ENV_DIR = nestedDir;
      saveApiKey('openrouter', 'sk-or-test-789');
      const envPath = path.join(nestedDir, '.env');
      expect(fs.existsSync(envPath)).toBe(true);
      const content = fs.readFileSync(envPath, 'utf-8');
      expect(content).toContain('OPENROUTER_API_KEY=sk-or-test-789');
    });

    it('should preserve existing keys when adding a new provider', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.env'),
        'GOOGLE_GENERATIVE_AI_API_KEY=goog-key\n'
      );

      saveApiKey('openrouter', 'sk-or-new');
      const content = fs.readFileSync(path.join(tmpDir, '.env'), 'utf-8');
      expect(content).toContain('GOOGLE_GENERATIVE_AI_API_KEY=goog-key');
      expect(content).toContain('OPENROUTER_API_KEY=sk-or-new');
    });

    it('should overwrite existing key for same provider', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.env'),
        'OPENROUTER_API_KEY=old-key\n'
      );

      saveApiKey('openrouter', 'new-key');
      const content = fs.readFileSync(path.join(tmpDir, '.env'), 'utf-8');
      expect(content).toContain('OPENROUTER_API_KEY=new-key');
      expect(content).not.toContain('old-key');
    });

    // POSIX-only: NTFS ignores Unix mode bits, so fs reports 0o666 (438) on Windows.
    // The source still writes { mode: 0o600 } (a harmless no-op on Windows). Real
    // Windows ACL hardening of the key file is a deferred security backlog item.
    const itPosix = process.platform === 'win32' ? it.skip : it;
    itPosix('should set file permissions to 0o600 (POSIX only)', () => {
      saveApiKey('openrouter', 'sk-or-perms');
      const envPath = path.join(tmpDir, '.env');
      const stats = fs.statSync(envPath);
      // Check owner read+write only (0o600 = 384 decimal, masked to lower 9 bits)
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o600);
    });

    it('should set process.env after saving', () => {
      saveApiKey('openrouter', 'sk-or-env-set');
      expect(process.env.OPENROUTER_API_KEY).toBe('sk-or-env-set');
    });

    it('should return success result', () => {
      const result = saveApiKey('openrouter', 'sk-or-result');
      expect(result).toEqual({ success: true });
    });

    it('should preserve comments in .env file', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.env'),
        '# Sidecar API Keys\nOPENROUTER_API_KEY=old-key\n'
      );

      saveApiKey('openrouter', 'new-key');
      const content = fs.readFileSync(path.join(tmpDir, '.env'), 'utf-8');
      expect(content).toContain('# Sidecar API Keys');
      expect(content).toContain('OPENROUTER_API_KEY=new-key');
    });

    it('should map provider to correct env var name', () => {
      saveApiKey('google', 'AIza-test');
      const content = fs.readFileSync(path.join(tmpDir, '.env'), 'utf-8');
      expect(content).toContain('GOOGLE_GENERATIVE_AI_API_KEY=AIza-test');
    });

    it('should save deepseek key with correct env var name', () => {
      const result = saveApiKey('deepseek', 'sk-deepseek-test-456');
      expect(result).toEqual({ success: true });

      const content = fs.readFileSync(path.join(tmpDir, '.env'), 'utf-8');
      expect(content).toContain('DEEPSEEK_API_KEY=sk-deepseek-test-456');
      expect(process.env.DEEPSEEK_API_KEY).toBe('sk-deepseek-test-456');
    });
  });

  describe('legacy key migration', () => {
    it('should auto-migrate GEMINI_API_KEY to GOOGLE_GENERATIVE_AI_API_KEY', () => {
      // Write .env with the old key name
      fs.writeFileSync(
        path.join(tmpDir, '.env'),
        'GEMINI_API_KEY=AIza-legacy-key\n'
      );

      // readApiKeys triggers loadEnvEntries which auto-migrates
      const result = readApiKeys();
      expect(result.google).toBe(true);

      // File should be rewritten with the new key name
      const content = fs.readFileSync(path.join(tmpDir, '.env'), 'utf-8');
      expect(content).toContain('GOOGLE_GENERATIVE_AI_API_KEY=AIza-legacy-key');
      expect(content).not.toContain('GEMINI_API_KEY');
    });

    it('should not migrate when new key already exists', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.env'),
        'GEMINI_API_KEY=old-key\nGOOGLE_GENERATIVE_AI_API_KEY=new-key\n'
      );

      const result = readApiKeys();
      expect(result.google).toBe(true);

      // File should be unchanged (new key takes precedence)
      const content = fs.readFileSync(path.join(tmpDir, '.env'), 'utf-8');
      expect(content).toContain('GOOGLE_GENERATIVE_AI_API_KEY=new-key');
      expect(content).toContain('GEMINI_API_KEY=old-key');
    });
  });

});

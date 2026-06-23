/**
 * Secret Detection Script Tests
 *
 * Tests the scanForSecrets function that detects API keys,
 * tokens, and private key material in file contents.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scanForSecrets, scanAll } = require('../../scripts/check-secrets');

describe('check-secrets', () => {
  describe('scanForSecrets', () => {
    it('detects OpenRouter API keys', () => {
      const content = 'const key = "sk-or-v1-abc123def456";';
      const results = scanForSecrets(content, 'test.js');
      expect(results).toHaveLength(1);
      expect(results[0].pattern).toBe('sk-or-');
    });

    it('detects Anthropic API keys', () => {
      const content = 'ANTHROPIC_KEY=sk-ant-abc123';
      const results = scanForSecrets(content, '.env');
      expect(results).toHaveLength(1);
      expect(results[0].pattern).toBe('sk-ant-');
    });

    it('detects AWS access keys', () => {
      const content = 'aws_key = "AKIAIOSFODNN7EXAMPLE"';
      const results = scanForSecrets(content, 'config.js');
      expect(results).toHaveLength(1);
      expect(results[0].pattern).toBe('AKIA');
    });

    it('detects GitHub personal access tokens', () => {
      const content = 'token: "ghp_abc123def456ghi789"';
      const results = scanForSecrets(content, 'config.js');
      expect(results).toHaveLength(1);
      expect(results[0].pattern).toBe('ghp_');
    });

    it('detects private key blocks', () => {
      const content = '-----BEGIN RSA PRIVATE KEY-----\nMIIE...';
      const results = scanForSecrets(content, 'key.pem');
      expect(results).toHaveLength(1);
      expect(results[0].pattern).toMatch(/BEGIN.*KEY/);
    });

    it('returns empty array for clean content', () => {
      const content = 'const x = 42;\nfunction hello() { return "world"; }';
      const results = scanForSecrets(content, 'clean.js');
      expect(results).toHaveLength(0);
    });

    it('detects multiple secrets in one file', () => {
      const content = 'const a = "sk-or-v1-abc";\nconst b = "ghp_xyz123abcdef456ghi789jkl012mno345pqr678";';
      const results = scanForSecrets(content, 'bad.js');
      expect(results).toHaveLength(2);
    });

    it('skips allowlisted patterns in test files', () => {
      const content = 'const mockKey = "sk-or-v1-mock-test-key";';
      const results = scanForSecrets(content, 'tests/mock.test.js', {
        allowlistPaths: ['tests/**']
      });
      expect(results).toHaveLength(0);
    });

    it('detects .env file patterns', () => {
      const content = 'OPENROUTER_API_KEY=sk-or-v1-realkey123';
      const results = scanForSecrets(content, '.env');
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('detects Google AI API keys', () => {
      const results = scanForSecrets('KEY=' + 'AIza' + 'B'.repeat(35), '.env');
      expect(results.some(r => r.pattern === 'AIza')).toBe(true);
    });

    it('detects OpenAI project keys', () => {
      const results = scanForSecrets('OPENAI=' + 'sk-proj-' + 'a'.repeat(40), '.env');
      expect(results.some(r => r.pattern === 'sk-proj-')).toBe(true);
      expect(results.some(r => r.pattern === 'sk-')).toBe(false);
    });

    it('detects OpenAI-legacy / DeepSeek bare sk- keys', () => {
      const legacy = scanForSecrets('OPENAI=' + 'sk-' + 'a'.repeat(48), '.env');
      expect(legacy.some(r => r.pattern === 'sk-')).toBe(true);
      const deepseek = scanForSecrets('DEEPSEEK=' + 'sk-' + 'b'.repeat(32), '.env');
      expect(deepseek.some(r => r.pattern === 'sk-')).toBe(true);
    });

    it('does NOT cross-match sk-or- / sk-ant- as bare sk- keys', () => {
      const orRes = scanForSecrets('K=sk-or-v1-abc123def456ghijkl', '.env');
      expect(orRes.some(r => r.pattern === 'sk-or-')).toBe(true);
      expect(orRes.some(r => r.pattern === 'sk-')).toBe(false);

      const orLong = scanForSecrets('K=sk-or-v1-' + 'a'.repeat(40), '.env');
      expect(orLong.some(r => r.pattern === 'sk-or-')).toBe(true);
      expect(orLong.some(r => r.pattern === 'sk-')).toBe(false);

      const antRes = scanForSecrets('K=sk-ant-' + 'a'.repeat(40), '.env');
      expect(antRes.some(r => r.pattern === 'sk-ant-')).toBe(true);
      expect(antRes.some(r => r.pattern === 'sk-')).toBe(false);
    });
  });

  describe('scanAll', () => {
    let tmpDir;
    let tmpFile;

    afterEach(() => {
      // Clean up the temp file and directory after each test
      try {
        if (tmpFile && fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
        if (tmpDir && fs.existsSync(tmpDir)) fs.rmdirSync(tmpDir);
      } catch {
        // best-effort cleanup
      }
      tmpDir = null;
      tmpFile = null;
    });

    it('returns an array', () => {
      // Minimal smoke-test: scanAll with an empty list is always an array
      expect(Array.isArray(scanAll([]))).toBe(true);
    });

    it('detects a secret in a temp file outside the allowlist', () => {
      // Create a temp directory OUTSIDE the repo (os.tmpdir() is never under tests/**)
      // so the allowlist does NOT exempt it — this proves scanAll reads and scans files.
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-scanall-'));
      tmpFile = path.join(tmpDir, 'secrets.env');
      // Write a fake OpenRouter key (matches /sk-or-[\w-]{3,}/g)
      fs.writeFileSync(tmpFile, `OPENROUTER_KEY=sk-or-v1-${'a'.repeat(40)}\n`, 'utf-8');

      const findings = scanAll([tmpFile]);

      expect(Array.isArray(findings)).toBe(true);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings[0].file).toBe(tmpFile);
      expect(findings[0].secrets.length).toBeGreaterThan(0);
      expect(findings[0].secrets[0].pattern).toBe('sk-or-');
    });

    it('returns [] when the injected file list is clean', () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-scanall-'));
      tmpFile = path.join(tmpDir, 'clean.env');
      fs.writeFileSync(tmpFile, 'PORT=3000\nNODE_ENV=production\n', 'utf-8');

      const findings = scanAll([tmpFile]);
      expect(findings).toEqual([]);
    });
  });
});

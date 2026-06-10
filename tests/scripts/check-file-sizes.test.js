/**
 * File Size Enforcement Script Tests
 *
 * Tests the checkFileSize, checkFiles, and matchesPattern functions that
 * enforce the 300-line maximum file size limit for src/ files, plus the
 * CONFIG include/exclude patterns the pre-commit hook filters with.
 */

const {
  checkFileSize,
  checkFiles,
  matchesPattern,
  CONFIG,
} = require('../../scripts/check-file-sizes');

describe('check-file-sizes', () => {
  describe('checkFileSize', () => {
    it('passes for files under the limit', () => {
      const content = 'line\n'.repeat(100);
      const result = checkFileSize(content, 'src/small.js', 300);
      expect(result).toBeNull();
    });

    it('fails for files over the limit', () => {
      const content = 'line\n'.repeat(350);
      const result = checkFileSize(content, 'src/big.js', 300);
      expect(result).not.toBeNull();
      expect(result.file).toBe('src/big.js');
      expect(result.lines).toBe(350);
      expect(result.limit).toBe(300);
    });

    it('passes for files exactly at the limit', () => {
      const content = 'line\n'.repeat(300);
      const result = checkFileSize(content, 'src/exact.js', 300);
      expect(result).toBeNull();
    });
  });

  describe('checkFiles', () => {
    it('returns empty array when all files pass', () => {
      const files = [
        { path: 'src/a.js', content: 'line\n'.repeat(50) },
        { path: 'src/b.js', content: 'line\n'.repeat(100) },
      ];
      const results = checkFiles(files, 300);
      expect(results).toHaveLength(0);
    });

    it('returns violations for files over limit', () => {
      const files = [
        { path: 'src/ok.js', content: 'line\n'.repeat(50) },
        { path: 'src/big.js', content: 'line\n'.repeat(400) },
      ];
      const results = checkFiles(files, 300);
      expect(results).toHaveLength(1);
      expect(results[0].file).toBe('src/big.js');
    });

    it('catches multiple violations', () => {
      const files = [
        { path: 'src/a.js', content: 'line\n'.repeat(301) },
        { path: 'src/b.js', content: 'line\n'.repeat(500) },
      ];
      const results = checkFiles(files, 300);
      expect(results).toHaveLength(2);
    });
  });

  describe('matchesPattern', () => {
    it('matches top-level src files with src/**/*.js (zero directories)', () => {
      expect(matchesPattern('src/headless.js', ['src/**/*.js'])).toBe(true);
    });

    it('matches files in src subdirectories', () => {
      expect(matchesPattern('src/utils/config.js', ['src/**/*.js'])).toBe(true);
    });

    it('matches deeply nested files', () => {
      expect(matchesPattern('src/a/b/c/deep.js', ['src/**/*.js'])).toBe(true);
    });

    it('does not match files outside src', () => {
      expect(matchesPattern('tests/foo.js', ['src/**/*.js'])).toBe(false);
      expect(matchesPattern('scripts/check-file-sizes.js', ['src/**/*.js'])).toBe(false);
    });

    it('treats the dot in .js as literal, not any-character', () => {
      expect(matchesPattern('src/notes.md', ['src/**/*.js'])).toBe(false);
      expect(matchesPattern('src/utils/foojs', ['src/**/*.js'])).toBe(false);
    });
  });

  describe('CONFIG', () => {
    const isChecked = (f) =>
      matchesPattern(f, CONFIG.include) && !matchesPattern(f, CONFIG.exclude);

    it('checks compliant src files at every depth', () => {
      expect(isChecked('src/index.js')).toBe(true);
      expect(isChecked('src/conflict.js')).toBe(true);
      expect(isChecked('src/sidecar/start.js')).toBe(true);
    });

    it('grandfathers top-level files that were over the limit before the glob fix', () => {
      const grandfathered = [
        'src/cli.js',
        'src/headless.js',
        'src/mcp-server.js',
        'src/mcp-tools.js',
        'src/opencode-client.js',
        'src/session-manager.js',
      ];
      for (const file of grandfathered) {
        expect(isChecked(file)).toBe(false);
        expect(matchesPattern(file, CONFIG.include)).toBe(true);
      }
    });

    it('keeps the pre-existing src/utils/config.js exclusion', () => {
      expect(isChecked('src/utils/config.js')).toBe(false);
    });
  });
});

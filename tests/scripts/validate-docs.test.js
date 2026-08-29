/**
 * CLAUDE.md Drift Detection Script Tests
 *
 * Tests the validate-docs functions that detect when CLAUDE.md
 * is out of sync with the actual codebase structure.
 */

const {
  checkStagedFilesDrift,
} = require('../../scripts/validate-docs');

describe('validate-docs', () => {
  describe('checkStagedFilesDrift', () => {
    it('warns when src/ files changed but CLAUDE.md not staged', () => {
      const stagedFiles = ['src/new-module.js'];
      const result = checkStagedFilesDrift(stagedFiles);
      expect(result.warn).toBe(true);
      expect(result.changedFiles).toContain('src/new-module.js');
    });

    it('does not warn when CLAUDE.md is also staged', () => {
      const stagedFiles = ['src/new-module.js', 'CLAUDE.md'];
      const result = checkStagedFilesDrift(stagedFiles);
      expect(result.warn).toBe(false);
    });

    it('does not warn when the generated architecture map is staged', () => {
      const stagedFiles = ['src/new-module.js', 'docs/architecture-map.md'];
      const result = checkStagedFilesDrift(stagedFiles);
      expect(result.warn).toBe(false);
    });

    it('does not warn for non-tracked directories', () => {
      const stagedFiles = ['tests/new-test.js', 'docs/readme.md'];
      const result = checkStagedFilesDrift(stagedFiles);
      expect(result.warn).toBe(false);
    });

    it('tracks bin/ and scripts/ changes', () => {
      const stagedFiles = ['bin/new-cli.js'];
      const result = checkStagedFilesDrift(stagedFiles);
      expect(result.warn).toBe(true);
    });
  });
});

/**
 * Model Validator Tests — normalizeModelId
 *
 * Tests for model ID normalization. (The headless-error-output and
 * promptModelSelection-save behaviors that exercised this indirectly via
 * validateDirectModel were removed along with validateDirectModel — dead
 * code after #61's MCP refactor. See model-validator.js.)
 */

describe('Model Validator — normalize', () => {
  let normalizeModelId;

  beforeEach(() => {
    jest.resetModules();

    const validator = require('../src/utils/model-validator');
    normalizeModelId = validator.normalizeModelId;
  });

  describe('normalizeModelId', () => {
    it('should prepend provider when id lacks prefix', () => {
      expect(normalizeModelId('google', 'gemini-3-flash')).toBe('google/gemini-3-flash');
    });

    it('should return as-is when id already has provider prefix', () => {
      expect(normalizeModelId('google', 'google/gemini-3-flash')).toBe('google/gemini-3-flash');
    });

    it('should handle nested model ids (provider/org/model)', () => {
      expect(normalizeModelId('openai', 'openai/gpt-4o')).toBe('openai/gpt-4o');
    });

    it('should prepend provider for bare model name', () => {
      expect(normalizeModelId('anthropic', 'claude-sonnet-4.6')).toBe('anthropic/claude-sonnet-4.6');
    });
  });
});

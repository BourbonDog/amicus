/**
 * Model Validator Tests
 *
 * Tests for direct-API model filtering. (validateDirectModel was removed as
 * dead code after #61's MCP refactor — model resolution/routing now lives in
 * mcp-server.js / route-launch.js. See model-validator.js's module docstring.)
 */

const MOCK_GOOGLE_MODELS = [
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
  { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
  { id: 'google/gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
  { id: 'google/gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
  { id: 'google/text-embedding-004', name: 'Text Embedding 004' },
];

const MOCK_OPENAI_MODELS = [
  { id: 'openai/gpt-4o', name: 'gpt-4o' },
  { id: 'openai/gpt-4-turbo', name: 'gpt-4-turbo' },
  { id: 'openai/o3-mini', name: 'o3-mini' },
];

describe('Model Validator', () => {
  let filterRelevantModels;

  beforeEach(() => {
    jest.resetModules();

    const validator = require('../src/utils/model-validator');
    filterRelevantModels = validator.filterRelevantModels;
  });

  describe('filterRelevantModels', () => {
    it('should filter google models by gemini alias', () => {
      const result = filterRelevantModels(MOCK_GOOGLE_MODELS, 'gemini');
      expect(result.every(m => m.id.includes('gemini'))).toBe(true);
      expect(result.length).toBe(4);
    });

    it('should filter openai models by gpt alias', () => {
      const result = filterRelevantModels(MOCK_OPENAI_MODELS, 'gpt');
      expect(result.every(m => m.id.includes('gpt'))).toBe(true);
      expect(result.length).toBe(2);
    });

    it('should return all models when alias has no matches', () => {
      const result = filterRelevantModels(MOCK_GOOGLE_MODELS, 'unknownalias');
      expect(result.length).toBe(MOCK_GOOGLE_MODELS.length);
    });

    it('should sort results by name', () => {
      const result = filterRelevantModels(MOCK_GOOGLE_MODELS, 'gemini');
      for (let i = 1; i < result.length; i++) {
        expect(result[i].name.localeCompare(result[i - 1].name)).toBeGreaterThanOrEqual(0);
      }
    });

    it('should limit results to 15', () => {
      const manyModels = Array.from({ length: 30 }, (_, i) => ({
        id: `google/gemini-model-${i}`, name: `Gemini Model ${i}`
      }));
      const result = filterRelevantModels(manyModels, 'gemini');
      expect(result.length).toBe(15);
    });

    it('should use alias search term mapping for opus → claude', () => {
      const anthropicModels = [
        { id: 'anthropic/claude-opus-4.6', name: 'Claude Opus 4.6' },
        { id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6' },
        { id: 'anthropic/some-other-model', name: 'Other Model' },
      ];
      const result = filterRelevantModels(anthropicModels, 'opus');
      expect(result.every(m => m.id.includes('claude'))).toBe(true);
    });
  });
});

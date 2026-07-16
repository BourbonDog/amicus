'use strict';

// Model resolution is intentionally NOT covered here (#61 Task 6.2):
// validateStartInputs no longer resolves/validates models — that moved to
// mcp-server.js's amicus_start handler, which routes through
// resolveRouteForLaunch and renders a `model_route_error` on failure. See
// tests/mcp-model-validation.test.js for that coverage.

describe('validateStartInputs', () => {
  let validateStartInputs;

  beforeAll(() => {
    ({ validateStartInputs } = require('../src/utils/validators'));
  });

  describe('prompt validation', () => {
    test('rejects empty prompt', () => {
      const result = validateStartInputs({ prompt: '', model: 'gemini' });
      expect(result.valid).toBe(false);
      expect(result.error.field).toBe('prompt');
    });

    test('rejects whitespace-only prompt', () => {
      const result = validateStartInputs({ prompt: '   ', model: 'gemini' });
      expect(result.valid).toBe(false);
      expect(result.error.field).toBe('prompt');
    });

    test('rejects undefined prompt', () => {
      const result = validateStartInputs({ model: 'gemini' });
      expect(result.valid).toBe(false);
      expect(result.error.field).toBe('prompt');
    });

    test('accepts a valid prompt regardless of model field (model is not validated here)', () => {
      const result = validateStartInputs({ prompt: 'test', model: 'not-a-real-model' });
      expect(result.valid).toBe(true);
      expect(result.resolvedModel).toBeUndefined();
    });
  });

  describe('timeout validation', () => {
    test('rejects negative timeout', () => {
      const result = validateStartInputs({ prompt: 'test', model: 'gemini', timeout: -5 });
      expect(result.valid).toBe(false);
      expect(result.error.field).toBe('timeout');
    });

    test('rejects zero timeout', () => {
      const result = validateStartInputs({ prompt: 'test', model: 'gemini', timeout: 0 });
      expect(result.valid).toBe(false);
      expect(result.error.field).toBe('timeout');
    });

    test('rejects timeout exceeding 60 minutes', () => {
      const result = validateStartInputs({ prompt: 'test', model: 'gemini', timeout: 999 });
      expect(result.valid).toBe(false);
      expect(result.error.field).toBe('timeout');
    });

    test('accepts valid timeout', () => {
      const result = validateStartInputs({ prompt: 'test', model: 'gemini', timeout: 15 });
      expect(result.valid).toBe(true);
    });

    test('accepts omitted timeout', () => {
      const result = validateStartInputs({ prompt: 'test', model: 'gemini' });
      expect(result.valid).toBe(true);
    });
  });

  describe('agent + headless validation', () => {
    test('accepts chat agent with noUi (handler auto-converts to build)', () => {
      // Chat + noUi is allowed because the MCP handler converts Chat -> Build
      // for headless mode. The Zod schema also defaults agent to Chat.
      const result = validateStartInputs({
        prompt: 'test', model: 'gemini', agent: 'Chat', noUi: true,
      });
      expect(result.valid).toBe(true);
    });

    test('accepts build agent with noUi', () => {
      const result = validateStartInputs({
        prompt: 'test', model: 'gemini', agent: 'Build', noUi: true,
      });
      expect(result.valid).toBe(true);
    });

    test('accepts chat agent without noUi', () => {
      const result = validateStartInputs({
        prompt: 'test', model: 'gemini', agent: 'Chat', noUi: false,
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('error format', () => {
    test('error has type field', () => {
      const result = validateStartInputs({ prompt: '' });
      expect(result.error.type).toBe('validation_error');
    });

    test('error has field field', () => {
      const result = validateStartInputs({ prompt: '' });
      expect(result.error.field).toBeDefined();
    });

    test('error has message field', () => {
      const result = validateStartInputs({ prompt: '' });
      expect(result.error.message).toBeDefined();
    });

    test('error is JSON-serializable for MCP response', () => {
      const result = validateStartInputs({ prompt: '', timeout: -5 });
      expect(result.valid).toBe(false);
      const json = JSON.stringify(result.error);
      const parsed = JSON.parse(json);
      expect(parsed.type).toBe('validation_error');
      expect(parsed.field).toBe('prompt');
      expect(typeof parsed.message).toBe('string');
    });

    test('timeout error includes the offending value in its message', () => {
      const result = validateStartInputs({ prompt: 'test', timeout: 999 });
      expect(result.error.message).toContain('999');
    });
  });
});

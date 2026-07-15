// tests/route-error.test.js
'use strict';

const { routeError, selectionRequired } = require('../src/utils/model-descriptor');
const {
  toStructuredError,
  toCliMessage,
  REASON_TEXT,
  ROUTE_ERROR_REASONS,
  SELECTION_REQUIRED_REASON,
} = require('../src/utils/route-error');

describe('route-error renderer (#61 Task 6.1)', () => {
  test('ROUTE_ERROR_REASONS is exactly the closed 7-reason set', () => {
    expect(ROUTE_ERROR_REASONS.slice().sort()).toEqual([
      'gateway_conflict',
      'invalid_descriptor',
      'model_not_found',
      'no_direct_integration',
      'no_direct_key',
      'no_key_for_vendor',
      'no_openrouter_key',
    ]);
  });

  test.each(ROUTE_ERROR_REASONS)('reason "%s": stable structured shape + non-empty CLI guidance', (reason) => {
    const result = routeError({
      field: 'model',
      requested: 'acme/some-model',
      reason,
      preferredGateway: 'direct',
      suggestions: [],
    });

    const structured = toStructuredError(result);
    expect(structured).toEqual({
      type: 'model_route_error',
      field: 'model',
      requested: 'acme/some-model',
      reason,
      preferredGateway: 'direct',
      suggestions: [],
    });

    // REASON_TEXT covers every reason with non-empty guidance text.
    expect(typeof REASON_TEXT[reason]).toBe('string');
    expect(REASON_TEXT[reason].length).toBeGreaterThan(0);

    const message = toCliMessage(result);
    expect(typeof message).toBe('string');
    expect(message.length).toBeGreaterThan(0);
    // The CLI message must actually surface the reason's guidance text, not
    // just be some unrelated non-empty string.
    expect(message).toContain(REASON_TEXT[reason]);
  });

  test('defaults field to "model" and suggestions to [] when the router omits them', () => {
    const result = routeError({
      requested: 'acme/some-model',
      reason: 'model_not_found',
      preferredGateway: 'direct',
    });
    // model-descriptor's routeError() already defaults field/suggestions, but
    // pin the renderer's own normalization too (pass-through/normalize contract).
    delete result.field;
    delete result.suggestions;

    const structured = toStructuredError(result);
    expect(structured.field).toBe('model');
    expect(structured.suggestions).toEqual([]);
  });

  test('suggestions render as a "Did you mean" list in the CLI message', () => {
    const result = routeError({
      requested: 'acme/some-model',
      reason: 'model_not_found',
      preferredGateway: 'direct',
      suggestions: [
        { model: 'acme/some-model-v2', gateway: 'direct', note: 'closest name match' },
        { model: 'openrouter/acme/some-model', gateway: 'openrouter' },
      ],
    });

    const message = toCliMessage(result);
    expect(message).toMatch(/did you mean/i);
    expect(message).toContain('acme/some-model-v2');
    expect(message).toContain('closest name match');
    expect(message).toContain('openrouter/acme/some-model');
  });

  test('selection_required renders a structured error and a CLI message with its suggestions', () => {
    const result = selectionRequired({
      requested: 'gemini',
      suggestions: [
        { model: 'google/gemini-2.5-pro', gateway: 'direct' },
        { model: 'google/gemini-2.5-flash', gateway: 'direct' },
      ],
    });

    const structured = toStructuredError(result);
    expect(structured.type).toBe('model_route_error');
    expect(structured.requested).toBe('gemini');
    expect(structured.reason).toBe(SELECTION_REQUIRED_REASON);
    expect(structured.suggestions).toHaveLength(2);
    // reason stays inside a documented constant set (not ad hoc).
    expect(typeof REASON_TEXT[SELECTION_REQUIRED_REASON]).toBe('string');
    expect(REASON_TEXT[SELECTION_REQUIRED_REASON].length).toBeGreaterThan(0);

    const message = toCliMessage(result);
    expect(typeof message).toBe('string');
    expect(message).toContain('google/gemini-2.5-pro');
    expect(message).toContain('google/gemini-2.5-flash');
  });

  test('toStructuredError is pure (no mutation of the input result)', () => {
    const result = routeError({
      requested: 'acme/some-model',
      reason: 'no_direct_key',
      preferredGateway: 'direct',
      suggestions: [{ model: 'acme/other', gateway: 'direct' }],
    });
    const before = JSON.parse(JSON.stringify(result));
    toStructuredError(result);
    toCliMessage(result);
    expect(result).toEqual(before);
  });
});

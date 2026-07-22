'use strict';

const { toCliMessage, toStructuredError, toErrorDocFields, REASON_TEXT, ROUTE_ERROR_REASONS } = require('../src/utils/route-error');

const mk = (reason, requested) => ({ kind: 'error', type: 'model_route_error', field: 'model', requested, reason, suggestions: [] });

describe('route-error: local reasons', () => {
  test('the three new reasons have REASON_TEXT entries', () => {
    expect(REASON_TEXT.no_openrouter_route).toMatch(/OpenRouter/);
    expect(REASON_TEXT.no_local_key).toMatch(/bearer/i);
    expect(REASON_TEXT.local_endpoint_unreachable).toMatch(/didn't respond|endpoint/i);
  });

  test('ROUTE_ERROR_REASONS stays the frozen base-7 (new reasons NOT added)', () => {
    expect(ROUTE_ERROR_REASONS).toHaveLength(7);
    expect(ROUTE_ERROR_REASONS).not.toContain('no_local_key');
  });

  test('toCliMessage renders reason + fix hint for a local reason', () => {
    const msg = toCliMessage(mk('no_local_key', 'mylab/model'));
    expect(msg).toContain('bearer');
    expect(msg).toContain('amicus key');
    expect(msg).toContain('mylab/model');
  });

  test('toStructuredError passes the reason through (MCP parity)', () => {
    const s = toStructuredError(mk('local_endpoint_unreachable', 'ollama/x'));
    expect(s.reason).toBe('local_endpoint_unreachable');
    expect(s.type).toBe('model_route_error');
  });

  // D1/M2: the per-flavor hint Task 4 stamps on the RouteResult must actually reach
  // the user. Without this, `e.hint = localHint(...)` is write-only dead code and
  // CLI/MCP always print the generic FIX_HINTS text.
  test('toCliMessage prefers the instance hint over the generic FIX_HINTS entry', () => {
    const generic = toCliMessage(mk('local_endpoint_unreachable', 'ollama/x'));
    expect(generic).toContain('--no-validate-model');           // the FIX_HINTS fallback still renders
    const withHint = toCliMessage({ ...mk('local_endpoint_unreachable', 'ollama/x'),
      hint: 'Is Ollama running? `ollama serve`' });
    expect(withHint).toMatch(/ollama serve/i);
    const lms = toCliMessage({ ...mk('local_endpoint_unreachable', 'lmstudio/x'),
      hint: 'Start the LM Studio server (Developer → Start Server).' });
    expect(lms).toMatch(/LM Studio/i);                          // LOCKED parity
  });

  test('toErrorDocFields prefers the instance hint too', () => {
    const f = toErrorDocFields({ ...mk('model_not_found', 'ollama/ghost'),
      hint: 'Model not pulled — `ollama pull ghost`.' });
    expect(f.hint).toMatch(/ollama pull/i);
  });

  // D12/M3: KEY_REASONS decides MISSING_KEY vs BAD_MODEL for --json and MCP.
  test('no_local_key maps to MISSING_KEY (parity with no_direct_key/no_openrouter_key)', () => {
    const { ERROR_CODES } = require('../src/utils/error-doc');
    expect(toErrorDocFields(mk('no_local_key', 'mylab/model')).code).toBe(ERROR_CODES.MISSING_KEY);
    expect(toErrorDocFields(mk('local_endpoint_unreachable', 'ollama/x')).code).toBe(ERROR_CODES.BAD_MODEL);
  });
});

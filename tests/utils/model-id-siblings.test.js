// tests/utils/model-id-siblings.test.js
'use strict';
const { parsePin, compareVersions, newestSibling } = require('../../src/utils/model-id-siblings');

const CATALOG = [
  'openrouter/z-ai/glm-5.1', 'openrouter/z-ai/glm-5.2', 'openrouter/z-ai/glm-5.2:free',
  'openrouter/z-ai/glm-5.3', 'openrouter/z-ai/glm-5-turbo', 'openrouter/~z-ai/glm-latest',
  'openrouter/openai/gpt-5.6-terra', 'openrouter/openai/gpt-5.6-sol', 'openrouter/openai/gpt-5.7-terra',
  'openrouter/moonshotai/kimi-k3', 'openrouter/moonshotai/kimi-k2.7-code',
];

describe('model-id-siblings (lifted from scripts/check-ci-alias-pins.js, #238 D7)', () => {
  test('parsePin splits vendor / prefix / version / suffix and rejects floating ids', () => {
    expect(parsePin('openrouter/z-ai/glm-5.3')).toEqual({ vendor: 'openrouter/z-ai', prefix: 'glm-', version: [5, 3], suffix: '' });
    expect(parsePin('openrouter/~z-ai/glm-latest')).toBeNull();
    expect(parsePin('no-slash')).toBeNull();
    expect(parsePin(42)).toBeNull();
  });
  test('compareVersions is numeric per segment, missing segments read as 0', () => {
    expect(compareVersions([5, 3], [5, 2])).toBeGreaterThan(0);
    expect(compareVersions([5], [5, 0])).toBe(0);
    expect(compareVersions([4, 9], [5])).toBeLessThan(0);
  });
  test('newestSibling never crosses a tier or variant suffix', () => {
    expect(newestSibling('openrouter/z-ai/glm-5.1', CATALOG)).toBe('openrouter/z-ai/glm-5.3');
    expect(newestSibling('openrouter/openai/gpt-5.6-terra', CATALOG)).toBe('openrouter/openai/gpt-5.7-terra');
    expect(newestSibling('openrouter/openai/gpt-5.6-sol', CATALOG)).toBeNull();     // sol never sees terra
    expect(newestSibling('openrouter/moonshotai/kimi-k3', CATALOG)).toBeNull();     // k2.7-code is a variant
    expect(newestSibling('openrouter/z-ai/glm-5.3', CATALOG)).toBeNull();           // already newest
  });
  test('the CI checker still exports the same three functions (its own test is the contract)', () => {
    const script = require('../../scripts/check-ci-alias-pins');
    expect(script.parsePin).toBe(parsePin);
    expect(script.newestSibling).toBe(newestSibling);
    expect(script.compareVersions).toBe(compareVersions);
  });
});

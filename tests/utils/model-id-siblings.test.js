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

  // R2 (#249 r2 B2): a numeric run glued to a following ASCII letter is a
  // size/variant token (`20b`, `8x22b`, `4o`), never a version -- MEASURED
  // against a 638-id live catalog cache, 129 ids carry one. Mutant
  // GLUEDVERSION (drop the glued-letter skip in parsePin) turns the
  // gpt-oss/gpt-4o/glm-4.5v cases below into non-null parses and the
  // newestSibling(gpt-oss-20b) case into 'openrouter/openai/gpt-oss-120b'.
  describe('R2: a size/variant token glued to a number is never read as a version', () => {
    test('parsePin: glued runs (b/o/v) never parse -- a preceding letter is unaffected', () => {
      expect(parsePin('openrouter/openai/gpt-oss-20b')).toBeNull();
      expect(parsePin('openrouter/openai/gpt-4o')).toBeNull();
      expect(parsePin('openrouter/z-ai/glm-4.5v')).toBeNull();
      // Preceded-by-letter runs keep parsing exactly as before (unaffected --
      // only the character AFTER a run is ever examined).
      expect(parsePin('openrouter/moonshotai/kimi-k3')).toEqual({ vendor: 'openrouter/moonshotai', prefix: 'kimi-k', version: [3], suffix: '' });
      expect(parsePin('openrouter/x/deepseek-v4-pro')).toEqual({ vendor: 'openrouter/x', prefix: 'deepseek-v', version: [4], suffix: '-pro' });
      expect(parsePin('openrouter/x/qwen3.8-max')).toEqual({ vendor: 'openrouter/x', prefix: 'qwen', version: [3, 8], suffix: '-max' });
    });
    test('parsePin: a glued run is skipped in favour of the next, un-glued, numeric-dotted run', () => {
      expect(parsePin('openrouter/mistralai/mixtral-8x7b-instruct-v0.1'))
        .toEqual({ vendor: 'openrouter/mistralai', prefix: 'mixtral-8x7b-instruct-v', version: [0, 1], suffix: '' });
      expect(parsePin('openrouter/mistralai/mistral-small-3.2-24b-instruct'))
        .toEqual({ vendor: 'openrouter/mistralai', prefix: 'mistral-small-', version: [3, 2], suffix: '-24b-instruct' });
    });
    test('newestSibling: a differently-sized variant is never offered as a "newer" sibling', () => {
      expect(newestSibling('openrouter/openai/gpt-oss-20b', [...CATALOG, 'openrouter/openai/gpt-oss-120b'])).toBeNull();
    });
    test('newestSibling: same prefix/version-shape/suffix still finds the real newer sibling, a different size is still excluded by the suffix check', () => {
      const catalog = [
        ...CATALOG,
        'openrouter/mistralai/mistral-small-3.3-24b-instruct', // same suffix (-24b-instruct), newer version -> the sibling
        'openrouter/mistralai/mistral-small-3.3-70b-instruct', // different suffix (-70b-instruct) -> excluded, not a size upgrade
      ];
      expect(newestSibling('openrouter/mistralai/mistral-small-3.2-24b-instruct', catalog))
        .toBe('openrouter/mistralai/mistral-small-3.3-24b-instruct');
    });
  });
});

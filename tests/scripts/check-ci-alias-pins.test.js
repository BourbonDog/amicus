// tests/scripts/check-ci-alias-pins.test.js
'use strict';
const {
  parsePin, compareVersions, newestSibling, auditPins,
} = require('../../scripts/check-ci-alias-pins');

// Why this gate exists at all: `amicus models --check` compares a curated
// FAMILY entry against whatever its idPattern resolves to live. The bench
// aliases (glm/qwen/kimi) are flat CARDLESS entries with NO pattern, so all
// that audit can ask is whether the pinned id still EXISTS — and it does,
// which is how `glm` sat pinned at 5.1 while 5.2 and 5.3 both shipped and
// every gate stayed green. These cases are drawn from that real catalog.
const CATALOG = [
  'openrouter/z-ai/glm-4.7', 'openrouter/z-ai/glm-5', 'openrouter/z-ai/glm-5-turbo',
  'openrouter/z-ai/glm-5.1', 'openrouter/z-ai/glm-5.2', 'openrouter/z-ai/glm-5.2:free',
  'openrouter/z-ai/glm-5.3', 'openrouter/z-ai/glm-4.5v', 'openrouter/z-ai/glm-5v-turbo',
  'openrouter/~z-ai/glm-latest',
  'openrouter/qwen/qwen3.7-max', 'openrouter/qwen/qwen3.8-max', 'openrouter/qwen/qwen3.8-27b',
  'openrouter/moonshotai/kimi-k2.6', 'openrouter/moonshotai/kimi-k3',
  'openrouter/moonshotai/kimi-k2.7-code', 'openrouter/moonshotai/kimi-k2-thinking',
  'openrouter/deepseek/deepseek-v4-pro', 'openrouter/deepseek/deepseek-v4-pro-0813',
  'openrouter/deepseek/deepseek-v4-flash',
  'openrouter/openai/gpt-5.6-terra', 'openrouter/openai/gpt-5.6-terra-pro',
  'openrouter/openai/gpt-5.6-sol',
];

describe('check-ci-alias-pins', () => {
  describe('parsePin', () => {
    test('splits vendor / prefix / version / suffix', () => {
      expect(parsePin('openrouter/z-ai/glm-5.3')).toEqual({
        vendor: 'openrouter/z-ai', prefix: 'glm-', version: [5, 3], suffix: '',
      });
      // The version is embedded in the stem here, not after a dash.
      expect(parsePin('openrouter/qwen/qwen3.8-max')).toEqual({
        vendor: 'openrouter/qwen', prefix: 'qwen', version: [3, 8], suffix: '-max',
      });
    });

    test('rejects floating pointers and unversioned ids', () => {
      // `~vendor/x-latest` names no concrete release — see the map's comment.
      expect(parsePin('openrouter/~z-ai/glm-latest')).toBeNull();
      expect(parsePin('openrouter/some/model')).toBeNull();
      expect(parsePin(null)).toBeNull();
    });
  });

  describe('compareVersions', () => {
    test('orders by numeric segment, not lexically', () => {
      // The whole point: '5.10' must beat '5.9', which string compare reverses.
      expect(compareVersions([5, 10], [5, 9])).toBeGreaterThan(0);
      expect(compareVersions([5, 3], [5, 3])).toBe(0);
      expect(compareVersions([5], [5, 1])).toBeLessThan(0);
    });
  });

  describe('newestSibling', () => {
    test('finds the newer release the existing audit cannot see', () => {
      expect(newestSibling('openrouter/z-ai/glm-5.1', CATALOG))
        .toBe('openrouter/z-ai/glm-5.3');
      expect(newestSibling('openrouter/moonshotai/kimi-k2.6', CATALOG))
        .toBe('openrouter/moonshotai/kimi-k3');
      expect(newestSibling('openrouter/qwen/qwen3.7-max', CATALOG))
        .toBe('openrouter/qwen/qwen3.8-max');
    });

    test('is silent on a current pin', () => {
      for (const id of ['openrouter/z-ai/glm-5.3', 'openrouter/qwen/qwen3.8-max',
        'openrouter/moonshotai/kimi-k3', 'openrouter/deepseek/deepseek-v4-pro',
        'openrouter/openai/gpt-5.6-terra']) {
        expect(newestSibling(id, CATALOG)).toBeNull();
      }
    });

    // Council finding D3: a blanket `:` skip meant a pin that is ITSELF a
    // billing variant could never find its own sibling and went unwatched.
    // Suffix equality already keeps the variant lines apart, so the skip was
    // redundant AND blinding.
    test('a billing-variant pin still finds its own variant sibling', () => {
      const variants = CATALOG.concat([
        'openrouter/z-ai/glm-5.3:free', 'openrouter/z-ai/glm-5.1:batch',
      ]);
      expect(newestSibling('openrouter/z-ai/glm-5.2:free', variants))
        .toBe('openrouter/z-ai/glm-5.3:free');
      // ...and a plain pin is still never bumped onto a variant.
      expect(newestSibling('openrouter/z-ai/glm-5.1', variants))
        .toBe('openrouter/z-ai/glm-5.3');
    });

    test('never crosses a tier or variant line', () => {
      // Each of these would be a WRONG bump: -turbo/-code/-thinking/-27b are
      // different products, `-pro-0813` is a dated snapshot, `sol` is another
      // price tier, and `:free` is a billing variant of the same release.
      const glm = newestSibling('openrouter/z-ai/glm-5.1', CATALOG);
      expect(glm).not.toContain('turbo');
      expect(glm).not.toContain(':');
      expect(newestSibling('openrouter/openai/gpt-5.6-terra', CATALOG)).toBeNull();
      expect(newestSibling('openrouter/deepseek/deepseek-v4-pro', CATALOG)).toBeNull();
      expect(newestSibling('openrouter/qwen/qwen3.8-max', CATALOG)).toBeNull();
    });
  });

  describe('auditPins', () => {
    test('reports drift and delisting separately', () => {
      const { drift, missing } = auditPins({
        glm: 'openrouter/z-ai/glm-5.1',
        kimi: 'openrouter/moonshotai/kimi-k3',
        gone: 'openrouter/z-ai/glm-9.9',
      }, CATALOG);
      expect(drift).toEqual([{
        alias: 'glm', pinned: 'openrouter/z-ai/glm-5.1', newer: 'openrouter/z-ai/glm-5.3',
      }]);
      expect(missing).toEqual([{ alias: 'gone', pinned: 'openrouter/z-ai/glm-9.9' }]);
    });

    test('the shipped map is clean against its own catalog snapshot', () => {
      const map = require('../../.github/amicus-ci-aliases.json');
      const { drift, missing } = auditPins(map.aliases, CATALOG.concat(
        Object.values(map.aliases)));
      expect(missing).toEqual([]);
      expect(drift).toEqual([]);
    });
  });
});

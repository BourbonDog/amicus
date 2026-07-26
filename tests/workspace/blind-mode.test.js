'use strict';

const { buildNamePairs, labelFor, pairFor } = require('../../src/workspace/blind-mode');

const LABEL_MAP = { 'Review A': 'gemini', 'Review B': 'gpt', 'Review C': 'qwen' };

describe('blind-mode mapping', () => {
  test('buildNamePairs is label-sorted with model+label on every entry', () => {
    expect(buildNamePairs(LABEL_MAP)).toEqual([
      { label: 'Review A', model: 'gemini' },
      { label: 'Review B', model: 'gpt' },
      { label: 'Review C', model: 'qwen' },
    ]);
  });

  test('labelFor inverts the map; unknown model → null (ids stay label-space)', () => {
    expect(labelFor('gpt', LABEL_MAP)).toBe('Review B');
    expect(labelFor('deepseek', LABEL_MAP)).toBeNull();
  });

  test('pairFor always carries both spellings; degenerate maps do not throw', () => {
    expect(pairFor('qwen', LABEL_MAP)).toEqual({ model: 'qwen', label: 'Review C' });
    expect(pairFor('x', null)).toEqual({ model: 'x', label: null });
    expect(buildNamePairs(undefined)).toEqual([]);
  });
});

'use strict';
const { getDefaultAliases } = require('../src/utils/config');

describe('codex alias (#18)', () => {
  test('resolves to a concrete codex model id (bare, direct-capable — Task 8.1a)', () => {
    const codex = getDefaultAliases().codex;
    expect(codex).toBe('openai/gpt-5.3-codex');
  });

  test('every default alias is a fully-qualified provider/model string', () => {
    for (const [name, model] of Object.entries(getDefaultAliases())) {
      expect(typeof model).toBe('string');
      expect(model.split('/').length).toBeGreaterThanOrEqual(2);
      expect(model.endsWith('/')).toBe(false);
      expect(name).toBeTruthy();
    }
  });
});

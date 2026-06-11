'use strict';
const { buildKeysStepHTML, PROVIDERS } = require('../../electron/setup-ui-keys');

describe('PROVIDERS', () => {
  test('deepseek provider is in the list', () => {
    const ds = PROVIDERS.find(p => p.id === 'deepseek');
    expect(ds).toBeDefined();
    expect(ds.name).toBe('DeepSeek');
    expect(ds.placeholder).toMatch(/^sk-/);
    expect(ds.helpUrl).toContain('deepseek');
    expect(ds.recommended).toBe(false);
  });

  test('PROVIDERS has exactly 5 entries', () => {
    expect(PROVIDERS).toHaveLength(5);
  });
});

describe('buildKeysStepHTML', () => {
  test('renders deepseek provider button', () => {
    const html = buildKeysStepHTML(PROVIDERS);
    expect(html).toContain('data-provider="deepseek"');
    expect(html).toContain('DeepSeek');
  });
});

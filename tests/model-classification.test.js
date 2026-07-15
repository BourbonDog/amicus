const { classifyModel } = require('../src/utils/model-classification');

const catalog = (models, extra = {}) => ({ models, fetchedAt: 1, lastRefreshError: null, ...extra });

describe('classifyModel', () => {
  test('empty catalog -> unknown (never blocks)', () => {
    expect(classifyModel('openai/gpt-5.5', 'direct', catalog([]))).toBe('unknown');
  });

  test('present in direct namespace -> valid', () => {
    const c = catalog([{ id: 'openai/gpt-5.5' }, { id: 'openrouter/openai/gpt-5.5' }]);
    expect(classifyModel('openai/gpt-5.5', 'direct', c)).toBe('valid');
  });

  test('present in openrouter namespace -> valid', () => {
    const c = catalog([{ id: 'openrouter/openai/gpt-5.5' }]);
    expect(classifyModel('openrouter/openai/gpt-5.5', 'openrouter', c)).toBe('valid');
  });

  test('absent but namespace populated -> invalid', () => {
    const c = catalog([{ id: 'openai/gpt-5.5' }, { id: 'openai/gpt-4.1' }]);
    expect(classifyModel('openai/gpt-9', 'direct', c)).toBe('invalid');
  });

  test('namespace empty though catalog non-empty -> unknown', () => {
    // catalog has openrouter rows but no direct openai rows (openai key absent)
    const c = catalog([{ id: 'openrouter/openai/gpt-5.5' }]);
    expect(classifyModel('openai/gpt-5.5', 'direct', c)).toBe('unknown');
  });

  test('refresh failed + namespace empty -> unknown', () => {
    const c = catalog([], { lastRefreshError: 'network-error: all providers unreachable' });
    expect(classifyModel('openai/gpt-5.5', 'direct', c)).toBe('unknown');
  });
});

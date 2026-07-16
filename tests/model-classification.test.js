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

  test('anthropic floor present does not mask a missing direct vendor -> unknown', () => {
    const c = catalog([
      { id: 'anthropic/claude-opus-4-6' },      // hardcoded floor, always present
      { id: 'openrouter/openai/gpt-5.5' },       // OR rows present
      // NOTE: no direct openai/* rows (OpenAI fetch stale/failed)
    ]);
    expect(classifyModel('openai/gpt-5.5', 'direct', c)).toBe('unknown');
  });

  // #61 Task 4.3 (closes the carry-forward noted in task-4-report.md "Whole-branch
  // fix" section): the anthropic hardcoded floor is a stale, synthesized list, not
  // a confirmed model roster (see model-fetcher.js ANTHROPIC_MODELS / the
  // fetchModelsFromProvider('anthropic', key) no-key and live-fetch-failure
  // fallback paths). model-fetcher.js now tags every floor-fallback row
  // `authoritative: false`. A miss against a namespace where EVERY matched row is
  // non-authoritative can no longer be trusted as a confirmed absence, so it
  // returns 'unknown' instead of 'invalid' — never hard-blocking a launch on a
  // stale floor. Rows without the flag are authoritative (real live-fetched data),
  // so a genuine miss there still returns 'invalid' (see the next test).
  test('anthropic id absent from a non-authoritative floor -> unknown (never blocks)', () => {
    const c = catalog([{ id: 'anthropic/claude-opus-4-6', authoritative: false }]); // floor-fallback row
    expect(classifyModel('anthropic/claude-opus-4-8', 'direct', c)).toBe('unknown');
  });

  test('anthropic id absent from an authoritative (live-fetched) row -> invalid', () => {
    const c = catalog([{ id: 'anthropic/claude-opus-4-6' }]); // no flag => authoritative
    expect(classifyModel('anthropic/claude-opus-4-8', 'direct', c)).toBe('invalid');
  });
});

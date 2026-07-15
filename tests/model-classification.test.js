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

  // Judgment call (see task-4-report.md "Whole-branch fix" section): a query for
  // an anthropic id not in the hardcoded floor list correctly returns 'invalid',
  // not 'unknown', under per-vendor namespace matching. The anthropic rows are
  // synthesized in-process unconditionally (never live-fetched — see
  // model-fetcher.js ANTHROPIC_MODELS / model-catalog.js refreshCatalog()), so
  // the anthropic namespace is never "empty" the way a failed-fetch vendor's
  // namespace is. Per-vendor scoping fixes the described masking bug (another
  // vendor's empty namespace being hidden behind the floor); it does not — and
  // structurally cannot, without a floor-provenance flag not present in
  // catalogInfo — distinguish "stale hardcoded floor" from "confirmed absent"
  // for anthropic's own namespace. That is a pre-existing, orthogonal property
  // of the hardcoded floor, unchanged by this fix.
  test('anthropic id absent from the hardcoded floor -> invalid (floor is never "empty")', () => {
    const c = catalog([{ id: 'anthropic/claude-opus-4-6' }]); // hardcoded floor
    expect(classifyModel('anthropic/claude-opus-4-8', 'direct', c)).toBe('invalid');
  });
});

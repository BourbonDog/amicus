'use strict';

describe('validateAgainstCatalog', () => {
  beforeEach(() => jest.resetModules());

  function mockCatalog(models) {
    jest.doMock('../src/utils/model-catalog', () => ({ getCatalog: jest.fn().mockResolvedValue(models) }));
  }

  test('passes a model present in the catalog', async () => {
    mockCatalog([{ id: 'openrouter/openai/gpt-5.3-codex', name: 'codex' }]);
    const { validateAgainstCatalog } = require('../src/utils/model-validator');
    const out = await validateAgainstCatalog('openrouter/openai/gpt-5.3-codex', 'codex', { headless: true });
    expect(out).toBe('openrouter/openai/gpt-5.3-codex');
  });

  test('throws with suggestions when an openrouter model is absent (headless)', async () => {
    mockCatalog([{ id: 'openrouter/openai/gpt-5.4', name: 'gpt' }]);
    const { validateAgainstCatalog } = require('../src/utils/model-validator');
    await expect(
      validateAgainstCatalog('openrouter/openai/ghost-model', 'gpt', { headless: true })
    ).rejects.toThrow(/not found in the OpenRouter catalog/);
  });

  test('is graceful (returns model) when the catalog is empty', async () => {
    mockCatalog([]);
    const { validateAgainstCatalog } = require('../src/utils/model-validator');
    const out = await validateAgainstCatalog('openrouter/openai/anything', 'gpt', { headless: true });
    expect(out).toBe('openrouter/openai/anything');
  });

  test('is graceful when the catalog has no openrouter entries (fetch unavailable)', async () => {
    mockCatalog([{ id: 'anthropic/claude-sonnet-4-6', name: 'Sonnet' }]);
    const { validateAgainstCatalog } = require('../src/utils/model-validator');
    const out = await validateAgainstCatalog('openrouter/openai/anything', 'gpt', { headless: true });
    expect(out).toBe('openrouter/openai/anything');
  });

  test('ignores non-openrouter models (handled by direct-API path)', async () => {
    mockCatalog([{ id: 'openrouter/openai/gpt-5.4', name: 'gpt' }]);
    const { validateAgainstCatalog } = require('../src/utils/model-validator');
    const out = await validateAgainstCatalog('openai/gpt-5.4', 'gpt', { headless: true });
    expect(out).toBe('openai/gpt-5.4');
  });

  test('handles an absent model with no alias (uses model tail as filter)', async () => {
    mockCatalog([{ id: 'openrouter/openai/gpt-5.4', name: 'gpt' }]);
    const { validateAgainstCatalog } = require('../src/utils/model-validator');
    await expect(
      validateAgainstCatalog('openrouter/openai/ghost-model', undefined, { headless: true })
    ).rejects.toThrow(/not found in the OpenRouter catalog/);
  });
});

// validateFallbackModel + resolveModelFromArgs (start-helpers.js) and their
// detectFallback dispatch (config.js) were retired in #61 Task 4.7 — zero
// production callers remained once continue migrated to resolveLaunchModel
// (Task 7.3). resolveLaunchModel's own behavior is covered by
// tests/start-helpers-routing.test.js.

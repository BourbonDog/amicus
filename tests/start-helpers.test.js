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
});

describe('validateFallbackModel default-on', () => {
  beforeEach(() => jest.resetModules());

  test('--no-validate-model short-circuits (no catalog call)', async () => {
    const getCatalog = jest.fn();
    jest.doMock('../src/utils/model-catalog', () => ({ getCatalog }));
    const { validateFallbackModel } = require('../src/utils/start-helpers');
    const out = await validateFallbackModel(
      { model: 'openrouter/openai/whatever', 'no-validate-model': true, 'no-ui': true }, 'gpt');
    expect(out).toBe('openrouter/openai/whatever');
    expect(getCatalog).not.toHaveBeenCalled();
  });

  test('validates against the catalog by default', async () => {
    jest.doMock('../src/utils/model-catalog', () => ({
      getCatalog: jest.fn().mockResolvedValue([{ id: 'openrouter/openai/gpt-5.4', name: 'gpt' }]),
    }));
    const { validateFallbackModel } = require('../src/utils/start-helpers');
    const out = await validateFallbackModel(
      { model: 'openrouter/openai/gpt-5.4', 'no-ui': true }, 'gpt');
    expect(out).toBe('openrouter/openai/gpt-5.4');
  });
});

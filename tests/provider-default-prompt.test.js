// tests/provider-default-prompt.test.js
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const { runProviderDefaultFlow } = require('../src/utils/provider-default-prompt');

/**
 * Fixture: a vendor with no per-vendor tier table (model-tiers.js) and no
 * gateway-only curated alias, so `resolveTier` returns null and
 * `buildProviderDefaultChoices` falls back to the cheapest priced row.
 * Cheapest -> model-b ($0.5/M), so preselectedId = 'testvendor/model-b' and
 * rows sort as [model-b (preselected), model-a ($2), model-c ($9)].
 */
const catalog = [
  { id: 'testvendor/model-a', name: 'Model A', contextLength: 1000, pricing: null },
  { id: 'openrouter/testvendor/model-a', name: 'Model A', contextLength: 1000, pricing: { prompt: '0.000002' } },
  { id: 'testvendor/model-b', name: 'Model B', contextLength: 1000, pricing: null },
  { id: 'openrouter/testvendor/model-b', name: 'Model B', contextLength: 1000, pricing: { prompt: '0.0000005' } },
  { id: 'testvendor/model-c', name: 'Model C', contextLength: 1000, pricing: null },
  { id: 'openrouter/testvendor/model-c', name: 'Model C', contextLength: 1000, pricing: { prompt: '0.000009' } },
];

describe('runProviderDefaultFlow', () => {
  let tempDir;
  let originalEnv;
  let loadConfig;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-provider-prompt-test-'));
    originalEnv = { ...process.env };
    process.env.AMICUS_CONFIG_DIR = tempDir;
    ({ loadConfig } = require('../src/utils/config'));
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('non-interactive: applies preselectedId silently and writes the alias', async () => {
    const result = await runProviderDefaultFlow('testvendor', { interactive: false, catalog });

    expect(result.chosenId).toBe('testvendor/model-b');
    expect(result.setAsDefault).toBe(true);
    expect(result.summaryLine).toContain('testvendor/model-b');

    const cfg = loadConfig();
    expect(cfg.aliases.testvendor).toBe('testvendor/model-b');
    expect(cfg.default).toBe('testvendor');
  });

  test('interactive: injected ask returning "2" applies row index 2\'s id', async () => {
    const ask = jest.fn().mockResolvedValue('2');
    const print = jest.fn();

    const result = await runProviderDefaultFlow('testvendor', { interactive: true, ask, catalog, print });

    // Rows sorted [model-b (preselected), model-a, model-c] -> "2" = model-a.
    expect(result.chosenId).toBe('testvendor/model-a');
    expect(ask).toHaveBeenCalledTimes(1);

    const cfg = loadConfig();
    expect(cfg.aliases.testvendor).toBe('testvendor/model-a');
  });

  test('interactive: empty/Enter input falls back to preselected', async () => {
    const ask = jest.fn().mockResolvedValue('');
    const print = jest.fn();

    const result = await runProviderDefaultFlow('testvendor', { interactive: true, ask, catalog, print });

    expect(result.chosenId).toBe('testvendor/model-b');
    const cfg = loadConfig();
    expect(cfg.aliases.testvendor).toBe('testvendor/model-b');
  });

  test('interactive: invalid entry re-prompts once then falls back to preselected', async () => {
    const ask = jest.fn()
      .mockResolvedValueOnce('nope')
      .mockResolvedValueOnce('');
    const print = jest.fn();

    const result = await runProviderDefaultFlow('testvendor', { interactive: true, ask, catalog, print });

    expect(ask).toHaveBeenCalledTimes(2);
    expect(result.chosenId).toBe('testvendor/model-b');
    expect(print).toHaveBeenCalledWith(expect.stringContaining('Invalid choice'));
  });

  test('empty catalog: graceful summaryLine, no throw, no config write', async () => {
    const result = await runProviderDefaultFlow('testvendor', { interactive: false, catalog: [] });

    expect(result.chosenId).toBeNull();
    expect(result.setAsDefault).toBe(false);
    expect(result.summaryLine).toEqual(expect.any(String));
    expect(result.summaryLine.length).toBeGreaterThan(0);

    expect(fs.existsSync(path.join(tempDir, 'config.json'))).toBe(false);
  });

  test('empty catalog in interactive mode never calls ask (no hang)', async () => {
    const ask = jest.fn();
    const result = await runProviderDefaultFlow('testvendor', { interactive: true, ask, catalog: [] });

    expect(ask).not.toHaveBeenCalled();
    expect(result.chosenId).toBeNull();
  });
});

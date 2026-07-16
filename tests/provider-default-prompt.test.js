// tests/provider-default-prompt.test.js
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const { runProviderDefaultFlow, formatPrice, formatRow } = require('../src/utils/provider-default-prompt');

/**
 * Fixture: a real DIRECT vendor ('openai' -- must be a registered direct
 * provider per `provider-registry.isDirectProvider` now that
 * `runProviderDefaultFlow` gates on it, Fix 1) whose model ids here
 * ('model-a'/'model-b'/'model-c') don't match any of openai's per-vendor
 * tier regexes (model-tiers.js), so `resolveTier` returns null and
 * `buildProviderDefaultChoices` falls back to the cheapest priced row.
 * Cheapest -> model-b ($0.5/M), so preselectedId = 'openai/model-b' and
 * rows sort as [model-b (preselected), model-a ($2), model-c ($9)].
 */
const catalog = [
  { id: 'openai/model-a', name: 'Model A', contextLength: 1000, pricing: null },
  { id: 'openrouter/openai/model-a', name: 'Model A', contextLength: 1000, pricing: { prompt: '0.000002' } },
  { id: 'openai/model-b', name: 'Model B', contextLength: 1000, pricing: null },
  { id: 'openrouter/openai/model-b', name: 'Model B', contextLength: 1000, pricing: { prompt: '0.0000005' } },
  { id: 'openai/model-c', name: 'Model C', contextLength: 1000, pricing: null },
  { id: 'openrouter/openai/model-c', name: 'Model C', contextLength: 1000, pricing: { prompt: '0.000009' } },
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
    const result = await runProviderDefaultFlow('openai', { interactive: false, catalog });

    expect(result.chosenId).toBe('openai/model-b');
    expect(result.setAsDefault).toBe(true);
    expect(result.summaryLine).toContain('openai/model-b');

    const cfg = loadConfig();
    expect(cfg.aliases.openai).toBe('openai/model-b');
    expect(cfg.default).toBe('openai');
  });

  test('interactive: injected ask returning "2" applies row index 2\'s id', async () => {
    const ask = jest.fn().mockResolvedValue('2');
    const print = jest.fn();

    const result = await runProviderDefaultFlow('openai', { interactive: true, ask, catalog, print });

    // Rows sorted [model-b (preselected), model-a, model-c] -> "2" = model-a.
    expect(result.chosenId).toBe('openai/model-a');
    expect(ask).toHaveBeenCalledTimes(1);

    const cfg = loadConfig();
    expect(cfg.aliases.openai).toBe('openai/model-a');
  });

  test('interactive: empty/Enter input falls back to preselected', async () => {
    const ask = jest.fn().mockResolvedValue('');
    const print = jest.fn();

    const result = await runProviderDefaultFlow('openai', { interactive: true, ask, catalog, print });

    expect(result.chosenId).toBe('openai/model-b');
    const cfg = loadConfig();
    expect(cfg.aliases.openai).toBe('openai/model-b');
  });

  test('interactive: invalid entry re-prompts once then falls back to preselected', async () => {
    const ask = jest.fn()
      .mockResolvedValueOnce('nope')
      .mockResolvedValueOnce('');
    const print = jest.fn();

    const result = await runProviderDefaultFlow('openai', { interactive: true, ask, catalog, print });

    expect(ask).toHaveBeenCalledTimes(2);
    expect(result.chosenId).toBe('openai/model-b');
    expect(print).toHaveBeenCalledWith(expect.stringContaining('Invalid choice'));
  });

  test('empty catalog: graceful summaryLine, no throw, no config write', async () => {
    const result = await runProviderDefaultFlow('openai', { interactive: false, catalog: [] });

    expect(result.chosenId).toBeNull();
    expect(result.setAsDefault).toBe(false);
    expect(result.summaryLine).toEqual(expect.any(String));
    expect(result.summaryLine.length).toBeGreaterThan(0);

    expect(fs.existsSync(path.join(tempDir, 'config.json'))).toBe(false);
  });

  test('empty catalog in interactive mode never calls ask (no hang)', async () => {
    const ask = jest.fn();
    const result = await runProviderDefaultFlow('openai', { interactive: true, ask, catalog: [] });

    expect(ask).not.toHaveBeenCalled();
    expect(result.chosenId).toBeNull();
  });

  test('interactive: a "clean-integer-only" non-empty entry like "2abc" is invalid -- re-prompts once then falls back to preselected', async () => {
    const ask = jest.fn()
      .mockResolvedValueOnce('2abc')
      .mockResolvedValueOnce('');
    const print = jest.fn();

    const result = await runProviderDefaultFlow('openai', { interactive: true, ask, catalog, print });

    expect(ask).toHaveBeenCalledTimes(2);
    expect(result.chosenId).toBe('openai/model-b'); // preselected fallback
    expect(print).toHaveBeenCalledWith(expect.stringContaining('Invalid choice: "2abc"'));
  });

  test('interactive: a non-integer decimal like "2.9" is invalid -- re-prompts once then falls back to preselected', async () => {
    const ask = jest.fn()
      .mockResolvedValueOnce('2.9')
      .mockResolvedValueOnce('');
    const print = jest.fn();

    const result = await runProviderDefaultFlow('openai', { interactive: true, ask, catalog, print });

    expect(ask).toHaveBeenCalledTimes(2);
    expect(result.chosenId).toBe('openai/model-b');
    expect(print).toHaveBeenCalledWith(expect.stringContaining('Invalid choice: "2.9"'));
  });

  test('openrouter (gateway, not a vendor): graceful no-op -- no alias written, chosenId null, no throw', async () => {
    // A multi-vendor catalog is exactly the shape that used to make
    // buildProviderDefaultChoices('openrouter', ...) match every OR-namespaced
    // row and produce a nonsensical alias -- confirm the gateway short-circuit
    // never even reaches that path.
    const multiVendorCatalog = [
      { id: 'anthropic/claude-cheap', name: 'Claude Cheap', contextLength: 100000, pricing: null },
      { id: 'openrouter/anthropic/claude-cheap', name: 'Claude Cheap', contextLength: 100000, pricing: { prompt: '0.000001' } },
      { id: 'openai/gpt-cheap', name: 'GPT Cheap', contextLength: 128000, pricing: null },
      { id: 'openrouter/openai/gpt-cheap', name: 'GPT Cheap', contextLength: 128000, pricing: { prompt: '0.000002' } },
    ];

    const result = await runProviderDefaultFlow('openrouter', { interactive: false, catalog: multiVendorCatalog });

    expect(result.chosenId).toBeNull();
    expect(result.setAsDefault).toBe(false);
    expect(result.summaryLine).toEqual(expect.any(String));
    expect(result.summaryLine.length).toBeGreaterThan(0);
    expect(result.summaryLine).toMatch(/OpenRouter/);

    // No config.json should have been created at all -- no aliases, no default.
    expect(fs.existsSync(path.join(tempDir, 'config.json'))).toBe(false);
  });

  test('openrouter: also a no-op in interactive mode -- never calls ask (no hang, no picker rendered)', async () => {
    const ask = jest.fn();
    const result = await runProviderDefaultFlow('openrouter', { interactive: true, ask, catalog });

    expect(ask).not.toHaveBeenCalled();
    expect(result.chosenId).toBeNull();
    expect(fs.existsSync(path.join(tempDir, 'config.json'))).toBe(false);
  });
});

describe('formatPrice / formatRow', () => {
  test('formatPrice renders a $/M-input string for a priced row', () => {
    expect(formatPrice(2.5)).toBe('$2.50/M in');
  });

  test('formatPrice renders "n/a" for null/undefined pricing', () => {
    expect(formatPrice(null)).toBe('n/a');
    expect(formatPrice(undefined)).toBe('n/a');
  });

  test('formatRow includes the price string for a priced row and no recommended marker when not preselected', () => {
    const row = { id: 'v/a', name: 'Model A', contextLength: 128000, pricePerMInput: 2.5, isPreselected: false };
    const line = formatRow(row, 1);
    expect(line).toContain('Model A');
    expect(line).toContain('$2.50/M in');
    expect(line).not.toContain('(recommended)');
  });

  test('formatRow shows "n/a" for an unpriced row', () => {
    const row = { id: 'v/b', name: 'Model B', contextLength: null, pricePerMInput: null, isPreselected: false };
    const line = formatRow(row, 2);
    expect(line).toContain('n/a');
  });

  test('formatRow marks the preselected row as "(recommended)"', () => {
    const row = { id: 'v/c', name: 'Model C', contextLength: 32000, pricePerMInput: 0.5, isPreselected: true };
    const line = formatRow(row, 3);
    expect(line).toContain('(recommended)');
  });
});

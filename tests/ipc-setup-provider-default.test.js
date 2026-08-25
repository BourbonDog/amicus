'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Capture handlers registered on ipcMain (F2e virtual-mock pattern, mirrors
// ipc-setup-save-config.test.js / ipc-setup-fetch-free-models.test.js).
const handlers = {};
jest.mock('electron', () => ({
  ipcMain: { handle: (channel, fn) => { handlers[channel] = fn; } },
  BrowserWindow: { fromWebContents: jest.fn() },
}), { virtual: true });

jest.mock('../src/utils/api-key-store', () => ({
  saveApiKey: jest.fn(),
}));

/**
 * Anthropic direct + OpenRouter-twin rows (mirrors
 * tests/provider-default-picker.test.js's anthropicCatalog fixture) so
 * buildProviderDefaultChoices runs for REAL against real catalog shapes —
 * only saveApiKey/getCatalog are mocked, per the task brief.
 */
const ANTHROPIC_CATALOG = [
  { id: 'anthropic/claude-haiku-4-5', name: 'Claude Haiku 4.5', contextLength: 200000, pricing: null },
  {
    id: 'openrouter/anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5', contextLength: 200000,
    pricing: { prompt: '0.0000008', completion: '0.000004' },
  },
  { id: 'anthropic/claude-sonnet-5', name: 'Claude Sonnet 5', contextLength: 200000, pricing: null },
  {
    id: 'openrouter/anthropic/claude-sonnet-5', name: 'Claude Sonnet 5', contextLength: 200000,
    pricing: { prompt: '0.000003', completion: '0.000015' },
  },
];

jest.mock('../src/utils/model-catalog', () => ({
  getCatalog: jest.fn(async () => ANTHROPIC_CATALOG),
  refreshCatalog: jest.fn(async () => []),
}));

const { saveApiKey } = require('../src/utils/api-key-store');
const { registerSetupHandlers } = require('../electron/ipc-setup');

// Real config.js (not mocked) pointed at a temp dir per test — both
// buildProviderDefaultChoices's tier read and applyProviderDefault's
// read-modify-write go through it, so this keeps every test hermetic
// (never touches the developer's real ~/.config/amicus/config.json).
let tempDir;
let originalEnv;

beforeAll(() => { registerSetupHandlers(() => null); });

beforeEach(() => {
  jest.clearAllMocks();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-ipc-provider-default-'));
  originalEnv = { ...process.env };
  process.env.AMICUS_CONFIG_DIR = tempDir;
});

afterEach(() => {
  process.env = originalEnv;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const saveKey = (...args) => handlers['sidecar:save-key']({}, ...args);
const setProviderDefault = (...args) => handlers['sidecar:set-provider-default']({}, ...args);

describe('sidecar:save-key — providerDefault (Task 8)', () => {
  test('direct vendor (anthropic): returns priced choices built from the real catalog', async () => {
    saveApiKey.mockReturnValue({ success: true });
    const result = await saveKey('anthropic', 'sk-ant-test');
    expect(result.success).toBe(true);
    expect(result.providerDefault).not.toBeNull();
    expect(Array.isArray(result.providerDefault.rows)).toBe(true);
    expect(result.providerDefault.rows.length).toBeGreaterThan(0);
    expect(typeof result.providerDefault.preselectedId).toBe('string');
    // exactly one row marked preselected, matching its own preselectedId
    const preselected = result.providerDefault.rows.filter(r => r.isPreselected);
    expect(preselected).toHaveLength(1);
    expect(preselected[0].id).toBe(result.providerDefault.preselectedId);
  });

  test('gateway (openrouter): providerDefault is null — never built, never an aliases.openrouter write', async () => {
    saveApiKey.mockReturnValue({ success: true });
    const result = await saveKey('openrouter', 'sk-or-test');
    expect(result.success).toBe(true);
    expect(result.providerDefault).toBeNull();
  });

  test('failed save: providerDefault is not computed at all', async () => {
    saveApiKey.mockReturnValue({ success: false, error: 'bad key' });
    const result = await saveKey('anthropic', 'bad');
    expect(result.success).toBe(false);
    expect(result.providerDefault).toBeUndefined();
  });

  test('direct vendor with an empty/offline catalog: providerDefault is a graceful empty choice list, not a throw', async () => {
    const { getCatalog } = require('../src/utils/model-catalog');
    getCatalog.mockResolvedValueOnce([]);
    saveApiKey.mockReturnValue({ success: true });
    const result = await saveKey('anthropic', 'sk-ant-test');
    expect(result.success).toBe(true);
    expect(result.providerDefault).toEqual({ preselectedId: null, rows: [] });
  });
});

describe('sidecar:set-provider-default (Task 8)', () => {
  test('applies the chosen id: writes aliases.<vendor> and seeds config.default on first use', async () => {
    const { loadConfig } = require('../src/utils/config');
    const result = await setProviderDefault('anthropic', 'anthropic/claude-sonnet-5');
    expect(result).toEqual({ alias: 'anthropic', setAsDefault: true });

    const cfg = loadConfig();
    expect(cfg.aliases.anthropic).toBe('anthropic/claude-sonnet-5');
    expect(cfg.default).toBe('anthropic');
  });

  test('read-modify-write: an existing default and other aliases are never clobbered', async () => {
    const { loadConfig, saveConfig } = require('../src/utils/config');
    saveConfig({ default: 'gpt', aliases: { gpt: 'openai/gpt-5.5' } });

    const result = await setProviderDefault('anthropic', 'anthropic/claude-sonnet-5');
    expect(result).toEqual({ alias: 'anthropic', setAsDefault: false });

    const cfg = loadConfig();
    expect(cfg.default).toBe('gpt');
    expect(cfg.aliases.gpt).toBe('openai/gpt-5.5');
    expect(cfg.aliases.anthropic).toBe('anthropic/claude-sonnet-5');
  });

  // Issue 195: a non-divergent vendor's chosenId can now arrive OpenRouter-
  // prefixed too (buildProviderDefaultChoices only synthesizes a bare id
  // when the catalog can't prove it invalid). The handler must fetch the
  // catalog and hand it to applyProviderDefault so the SAME guard is applied
  // here -- otherwise it would silently re-strip the prefix the picker
  // deliberately kept and persist the fabricated id anyway.
  test('non-divergent vendor: fetches the catalog and does not re-strip an OpenRouter-only chosenId', async () => {
    const { loadConfig } = require('../src/utils/config');
    const { getCatalog } = require('../src/utils/model-catalog');
    getCatalog.mockResolvedValueOnce([
      { id: 'google/gemini-3.7-flash', name: 'Gemini 3.7 Flash', contextLength: 1000000, pricing: null },
      { id: 'openrouter/google/gemini-3.7-flash', name: 'Gemini 3.7 Flash', contextLength: 1000000,
        pricing: { prompt: '0.0000003' } },
      { id: 'openrouter/google/gemma-4-31b-it:free', name: 'Gemma 4 31B IT (free)', contextLength: 8192,
        pricing: { prompt: '0' } },
    ]);

    const result = await setProviderDefault('google', 'openrouter/google/gemma-4-31b-it:free');
    expect(result).toEqual({ alias: 'google', setAsDefault: true });

    const cfg = loadConfig();
    expect(cfg.aliases.google).toBe('openrouter/google/gemma-4-31b-it:free');
    expect(cfg.aliases.google).not.toBe('google/gemma-4-31b-it:free'); // fabricated id must never be persisted
  });

  test('catalog fetch failure degrades gracefully: still applies the choice (pre-195 unconditional-strip fallback), never aborts', async () => {
    const { loadConfig } = require('../src/utils/config');
    const { getCatalog } = require('../src/utils/model-catalog');
    getCatalog.mockRejectedValueOnce(new Error('network unreachable'));

    const result = await setProviderDefault('openai', 'openrouter/openai/gpt-5.5');
    expect(result).toEqual({ alias: 'openai', setAsDefault: true });

    const cfg = loadConfig();
    expect(cfg.aliases.openai).toBe('openai/gpt-5.5');
  });
});

'use strict';

jest.mock('../src/utils/quick-picks', () => ({
  ...jest.requireActual('../src/utils/quick-picks'),
  resolveQuickPicks: jest.fn(() => ([
    { alias: 'gemini', label: 'Gemini Flash-class', blurb: 'fast, large context',
      vendorPath: 'google',
      source: 'live', routes: { openrouter: 'openrouter/google/gemini-9.9-flash' } },
  ])),
  toLiveSeedAliases: jest.fn(() => ({ gemini: 'openrouter/google/gemini-9.9-flash' })),
}));
jest.mock('../src/utils/model-catalog', () => ({
  getCatalog: jest.fn(async () => [{ id: 'openrouter/google/gemini-9.9-flash' }]),
  refreshCatalog: jest.fn(async () => []),
}));
jest.mock('../src/utils/config', () => {
  const real = jest.requireActual('../src/utils/config');
  return { ...real, loadConfig: jest.fn(), saveConfig: jest.fn(), getConfigDir: jest.fn(() => 'X:/cfg') };
});
// Task 7 (cost-aware defaults P2): default to NO keyed providers so the new
// per-provider picker phase (runProviderDefaultPickers) is a no-op for every
// pre-existing test below -- they exercise the mode-prompt/standard-model-step
// path only and never intended to drive the per-provider picker. Coverage for
// the per-provider picker itself lives in tests/sidecar/setup.test.js, which
// uses the real config.js against an isolated temp dir (this file fully mocks
// config.js, and provider-default-picker.js's `getCostTier()` reads config via
// an internal closure that a config.js mock can't intercept -- see that file
// for the full explanation).
jest.mock('../src/utils/api-key-store', () => ({
  readApiKeys: jest.fn(() => ({ openrouter: false, google: false, openai: false, anthropic: false, deepseek: false })),
}));

function mockReadline(answer) {
  jest.doMock('readline', () => ({
    createInterface: () => ({
      question: (_q, cb) => cb(answer),
      close: jest.fn(),
    }),
  }));
}

describe('runReadlineSetup (live picks, no clobber)', () => {
  beforeEach(() => { jest.resetModules(); jest.clearAllMocks(); });

  test('numbered pick on an existing config: sets default AND upgrades only that alias', async () => {
    mockReadline('1');
    const { loadConfig, saveConfig } = require('../src/utils/config');
    loadConfig.mockReturnValue({ default: 'qwen', aliases: { qwen: 'user/qwen', gemini: 'user/old-gemini' } });
    const { runReadlineSetup } = require('../src/sidecar/setup');
    await runReadlineSetup();
    const written = saveConfig.mock.calls[0][0];
    expect(written.default).toBe('gemini');
    // touched: upgraded to bare canonical (direct-capable vendor 'google' —
    // Task 8.1a setup-seeding fix strips the openrouter/ prefix here too).
    expect(written.aliases.gemini).toBe('google/gemini-9.9-flash');
    expect(written.aliases.qwen).toBe('user/qwen');                            // untouched: preserved
  });

  test('free-form model id (contains /) becomes the default without touching aliases', async () => {
    mockReadline('openrouter/x-ai/grok-4.3');
    const { loadConfig, saveConfig } = require('../src/utils/config');
    loadConfig.mockReturnValue({ default: 'qwen', aliases: { qwen: 'user/qwen' } });
    const { runReadlineSetup } = require('../src/sidecar/setup');
    await runReadlineSetup();
    const written = saveConfig.mock.calls[0][0];
    expect(written.default).toBe('openrouter/x-ai/grok-4.3');
    expect(written.aliases).toEqual({ qwen: 'user/qwen' });
  });

  test('first run (no config) seeds live aliases', async () => {
    mockReadline('1');
    const { loadConfig, saveConfig } = require('../src/utils/config');
    loadConfig.mockReturnValue(null);
    const { runReadlineSetup } = require('../src/sidecar/setup');
    await runReadlineSetup();
    const written = saveConfig.mock.calls[0][0];
    // Chosen-alias write always runs through toCanonicalDefault (Task 8.1a
    // setup-seeding fix), regardless of whether toLiveSeedAliases (mocked
    // here) seeded the fresh config — bare canonical for direct-capable 'google'.
    expect(written.aliases.gemini).toBe('google/gemini-9.9-flash');
    expect(written.default).toBe('gemini');
  });

  test('invalid input does not write config', async () => {
    mockReadline('xyz');
    const { loadConfig, saveConfig } = require('../src/utils/config');
    loadConfig.mockReturnValue({ default: 'gemini', aliases: {} });
    const { runReadlineSetup } = require('../src/sidecar/setup');
    await runReadlineSetup();
    expect(saveConfig).not.toHaveBeenCalled();
  });

  test('no API keys detected → guidance points at amicus doctor', async () => {
    mockReadline('xyz'); // invalid mode/pick → no config write; we only assert the printed guidance
    const { readApiKeys } = require('../src/utils/api-key-store');
    readApiKeys.mockReturnValue({ openrouter: false, google: false, openai: false, anthropic: false, deepseek: false });
    const { loadConfig } = require('../src/utils/config');
    loadConfig.mockReturnValue({ default: 'gemini', aliases: {} });
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const { runReadlineSetup } = require('../src/sidecar/setup');
    await runReadlineSetup();
    const printed = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    logSpy.mockRestore();
    expect(printed).toMatch(/amicus doctor/);
  });

  test('offline catalog (getCatalog rejects) still serves picks from fallbacks', async () => {
    mockReadline('1');
    const { getCatalog } = require('../src/utils/model-catalog');
    getCatalog.mockRejectedValueOnce(new Error('network down'));
    const { loadConfig, saveConfig } = require('../src/utils/config');
    loadConfig.mockReturnValue(null);
    const { runReadlineSetup } = require('../src/sidecar/setup');
    await runReadlineSetup();
    const written = saveConfig.mock.calls[0][0];
    expect(written.default).toBe('gemini');
    expect(saveConfig).toHaveBeenCalledTimes(1);
  });
});

'use strict';

/**
 * #38 — the readline setup wizard surfaces a NON-BLOCKING warning when the
 * detected OpenRouter key is zero-credit / free-tier. Warning only — setup
 * still completes and config is still saved.
 */

jest.mock('../src/utils/quick-picks', () => ({
  resolveQuickPicks: jest.fn(() => ([
    { alias: 'gemini', label: 'Gemini Flash-class', blurb: 'fast, large context',
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
jest.mock('../src/utils/api-key-store', () => ({
  readApiKeys: jest.fn(() => ({ openrouter: true, google: false, openai: false, anthropic: false, deepseek: false })),
  readApiKeyValues: jest.fn(() => ({ openrouter: 'sk-or-zero' })),
}));
jest.mock('../src/utils/api-key-validation', () => ({
  checkOpenRouterCredit: jest.fn(),
}));

function mockReadline(answer) {
  jest.doMock('readline', () => ({
    createInterface: () => ({
      question: (_q, cb) => cb(answer),
      close: jest.fn(),
    }),
  }));
}

describe('runReadlineSetup OpenRouter credit warning (#38)', () => {
  let logSpy;
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => { logSpy.mockRestore(); });

  test('prints a warning when the OpenRouter key is zero-credit (non-blocking)', async () => {
    mockReadline('1');
    const { loadConfig, saveConfig } = require('../src/utils/config');
    loadConfig.mockReturnValue({ default: 'gemini', aliases: { gemini: 'user/old' } });
    const { checkOpenRouterCredit } = require('../src/utils/api-key-validation');
    checkOpenRouterCredit.mockResolvedValue({
      warning: 'OpenRouter key has no remaining credit — paid models will fail.',
      isFreeTier: false, limitRemaining: 0,
    });

    const { runReadlineSetup } = require('../src/sidecar/setup');
    await runReadlineSetup();

    // Warning surfaced
    const printed = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(printed).toMatch(/no remaining credit|paid models will fail/i);
    // Non-blocking: config still saved
    expect(saveConfig).toHaveBeenCalled();
  });

  test('does NOT print a credit warning when the key has positive credit', async () => {
    mockReadline('1');
    const { loadConfig } = require('../src/utils/config');
    loadConfig.mockReturnValue({ default: 'gemini', aliases: { gemini: 'user/old' } });
    const { checkOpenRouterCredit } = require('../src/utils/api-key-validation');
    checkOpenRouterCredit.mockResolvedValue({ warning: null, isFreeTier: false, limitRemaining: 8 });

    const { runReadlineSetup } = require('../src/sidecar/setup');
    await runReadlineSetup();

    const printed = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(printed).not.toMatch(/no remaining credit|paid models will fail/i);
  });
});

'use strict';

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
    expect(written.aliases.gemini).toBe('openrouter/google/gemini-9.9-flash'); // touched: upgraded
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
    expect(written.aliases.gemini).toBe('openrouter/google/gemini-9.9-flash');
    expect(written.default).toBe('gemini');
  });
});

'use strict';

// Capture handlers registered on ipcMain (F2e virtual-mock pattern).
const handlers = {};
jest.mock('electron', () => ({
  ipcMain: { handle: (channel, fn) => { handlers[channel] = fn; } },
  BrowserWindow: { fromWebContents: jest.fn() },
}), { virtual: true });

jest.mock('../src/utils/config', () => ({
  loadConfig: jest.fn(),
  saveConfig: jest.fn(),
}));
jest.mock('../src/utils/quick-picks', () => ({
  toLiveSeedAliases: jest.fn(() => ({ gemini: 'live/gemini', qwen: 'live/qwen' })),
}));
jest.mock('../src/utils/model-catalog', () => ({
  getCatalog: jest.fn(async () => []),
  // issue 214: the seeding path reads getCatalogInfo now -- it PERSISTS routes, so
  // it must see which namespaces were rejected, not just the surviving rows.
  getCatalogInfo: jest.fn(async () => ({ models: [], providerFailures: [] })),
}));

const { loadConfig, saveConfig } = require('../src/utils/config');
const { registerSetupHandlers } = require('../electron/ipc-setup');

beforeAll(() => { registerSetupHandlers(() => null); });
beforeEach(() => { jest.clearAllMocks(); });

const save = (...args) => handlers['sidecar:save-config']({}, ...args);

describe('sidecar:save-config (read-modify-write)', () => {
  test('REGRESSION (2026-06-11 gemini downgrade): untouched aliases are never rewritten', async () => {
    loadConfig.mockReturnValue({
      default: 'gemini',
      aliases: { gemini: 'google/gemini-3.5-flash', qwen: 'openrouter/qwen/qwen3.7-max' },
    });
    await save('deepseek', { deepseek: 'deepseek/deepseek-chat' });
    const written = saveConfig.mock.calls[0][0];
    expect(written.aliases.gemini).toBe('google/gemini-3.5-flash'); // untouched → byte-identical
    expect(written.aliases.qwen).toBe('openrouter/qwen/qwen3.7-max');
    expect(written.aliases.deepseek).toBe('deepseek/deepseek-chat');
    expect(written.default).toBe('deepseek');
  });

  test('null alias write deletes; deleted aliases do not resurrect', async () => {
    loadConfig.mockReturnValue({ default: 'gemini', aliases: { gemini: 'g', dead: 'x' } });
    await save('gemini', { dead: null });
    const written = saveConfig.mock.calls[0][0];
    expect(written.aliases).toEqual({ gemini: 'g' });
  });

  test('unknown config keys survive the round-trip', async () => {
    loadConfig.mockReturnValue({ default: 'gemini', aliases: {}, futureKey: { a: 1 } });
    await save('gemini', {});
    expect(saveConfig.mock.calls[0][0].futureKey).toEqual({ a: 1 });
  });

  test('null/missing default leaves the existing default alone', async () => {
    loadConfig.mockReturnValue({ default: 'gemini', aliases: {} });
    await save(null, {});
    expect(saveConfig.mock.calls[0][0].default).toBe('gemini');
  });

  test('first run (no config) seeds aliases live', async () => {
    loadConfig.mockReturnValue(null);
    await save('gemini', {});
    const written = saveConfig.mock.calls[0][0];
    expect(written.aliases).toEqual({ gemini: 'live/gemini', qwen: 'live/qwen' });
    expect(written.default).toBe('gemini');
  });

  test('first run with getCatalog rejection still seeds (pinned via empty catalog)', async () => {
    const { getCatalogInfo } = require('../src/utils/model-catalog');
    getCatalogInfo.mockRejectedValueOnce(new Error('offline'));
    loadConfig.mockReturnValue(null);
    await save('gemini', {});
    const { toLiveSeedAliases } = require('../src/utils/quick-picks');
    // issue 214: the seed now receives catalogInfo, not a bare models array --
    // it PERSISTS these routes, so it must see rejected namespaces. getCatalogInfo
    // rejected here, so ipc-setup falls back to its empty-evidence shape.
    expect(toLiveSeedAliases).toHaveBeenCalledWith({ models: [] });
    expect(saveConfig).toHaveBeenCalled();
  });
});

describe('sidecar:save-config (council picks)', () => {
  test('councilPicks seeds councils.free and free-* aliases', async () => {
    loadConfig.mockReturnValue({ default: 'gemini', aliases: { gemini: 'g' } });
    const written = [];
    saveConfig.mockImplementation(c => written.push(JSON.parse(JSON.stringify(c))));
    await save('gemini', {}, ['openrouter/deepseek/deepseek-r1:free', 'openrouter/qwen/qwen3-coder:free']);
    const final = written[written.length - 1];
    expect(final.councils.free).toHaveLength(2);
    const ids = final.councils.free.map(a => final.aliases[a]);
    expect(ids).toEqual(expect.arrayContaining([
      'openrouter/deepseek/deepseek-r1:free', 'openrouter/qwen/qwen3-coder:free',
    ]));
    expect(final.default).toBe('gemini'); // council never overrides default
  });

  test('no councilPicks → behaves exactly as before (no councils key added)', async () => {
    loadConfig.mockReturnValue({ default: 'gemini', aliases: { gemini: 'g' } });
    const written = [];
    saveConfig.mockImplementation(c => written.push(JSON.parse(JSON.stringify(c))));
    await save('gemini', {});
    expect(written[written.length - 1].councils).toBeUndefined();
  });
});

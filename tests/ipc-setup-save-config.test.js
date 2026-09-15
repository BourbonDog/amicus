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
jest.mock('../src/utils/model-catalog', () => ({
  getCatalog: jest.fn(async () => []),
  getCatalogInfo: jest.fn(async () => ({ models: [], providerFailures: [] })),
}));
jest.mock('../electron/ipc-aliases', () => ({
  registerAliasHandlers: jest.fn(),
  recordDismissals: jest.fn(() => 0),
}));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
const { recordDismissals } = require('../electron/ipc-aliases');

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

  test('first run (no config) writes an empty alias map — nothing is seeded (#238 Q9)', async () => {
    loadConfig.mockReturnValue(null);
    await save('gemini', {});
    const written = saveConfig.mock.calls[0][0];
    expect(written.aliases).toEqual({});
    expect(written.default).toBe('gemini');
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

// recordDismissals is a shared jest.fn: clearAllMocks resets call history, not implementations, so per-test behaviour is one-shot.
describe('sidecar:save-config (issue 238 D9: staged dismissals ride the 4th argument)', () => {
  test('dismissals are recorded AFTER the alias writes are saved', async () => {
    loadConfig.mockReturnValue({ default: 'gemini', aliases: { glm: 'openrouter/z-ai/glm-5.3' } });
    const order = [];
    saveConfig.mockImplementation(() => order.push('save'));
    recordDismissals.mockImplementationOnce((keys) => { order.push('dismiss:' + keys.join(',')); return keys.length; });
    await save('gemini', { glm: 'openrouter/z-ai/glm-5.4' }, [], ['glm@openrouter/z-ai/glm-5.4']);
    expect(order).toEqual(['save', 'dismiss:glm@openrouter/z-ai/glm-5.4']);
  });

  test('no 4th argument: recordDismissals still runs with undefined (records nothing) — the old 3-argument call keeps working', async () => {
    loadConfig.mockReturnValue({ default: 'gemini', aliases: {} });
    await save('gemini', {}, []);
    expect(recordDismissals).toHaveBeenCalledWith(undefined);
    expect(saveConfig).toHaveBeenCalledTimes(1);
  });

  test('a dismissal failure rejects the invoke (the renderer re-enables Finish) — after the aliases were saved', async () => {
    loadConfig.mockReturnValue({ default: 'gemini', aliases: {} });
    recordDismissals.mockImplementationOnce(() => { throw new Error('bad key'); });
    await expect(save('gemini', {}, [], ['bad'])).rejects.toThrow('bad key');
    expect(saveConfig).toHaveBeenCalledTimes(1);
  });
});

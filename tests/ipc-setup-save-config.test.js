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
  applyDismissals: jest.fn(() => 0),
}));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
const { applyDismissals } = require('../electron/ipc-aliases');

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

// applyDismissals is a shared jest.fn: clearAllMocks resets call history, not
// implementations, so per-test behaviour is one-shot. Council review of PR 253
// (B1/C4/A5/D3): Finish is ONE write — the dismissals are stamped into the
// object saveConfig receives, BEFORE it runs, so a rejected Finish has written
// nothing (the old order recorded them in a second write after the save).
describe('sidecar:save-config (issue 238 D9: staged dismissals ride the 4th argument, into the same save)', () => {
  test('the dismissals are stamped into the object saveConfig receives — one write (mutant PARTIALCOMMIT: record after the save)', async () => {
    loadConfig.mockReturnValue({ default: 'gemini', aliases: { glm: 'openrouter/z-ai/glm-5.3' } });
    const key = 'glm@openrouter/z-ai/glm-5.4';
    const snapshots = [];                                                // what saveConfig SAW, frozen at call time
    saveConfig.mockImplementation(c => snapshots.push(JSON.parse(JSON.stringify(c))));
    applyDismissals.mockImplementationOnce((cfg, keys) => { cfg.aliasReview = { dismissed: { [keys[0]]: 'T' } }; return keys.length; });
    await save('gemini', { glm: 'openrouter/z-ai/glm-5.4' }, [], [key]);
    expect(applyDismissals).toHaveBeenCalledTimes(1);
    expect(applyDismissals.mock.calls[0][1]).toEqual([key]);
    expect(saveConfig).toHaveBeenCalledTimes(1);
    expect(applyDismissals.mock.calls[0][0]).toBe(saveConfig.mock.calls[0][0]);   // the SAME object
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].aliasReview.dismissed).toEqual({ [key]: 'T' });          // PARTIALCOMMIT dies here: stamped BEFORE the save
    expect(snapshots[0].aliases.glm).toBe('openrouter/z-ai/glm-5.4');
  });

  test('no 4th argument: applyDismissals still runs with (cfg, undefined) (stamps nothing) — the old 3-argument call keeps working', async () => {
    loadConfig.mockReturnValue({ default: 'gemini', aliases: {} });
    await save('gemini', {}, []);
    expect(applyDismissals).toHaveBeenCalledTimes(1);
    expect(applyDismissals.mock.calls[0][1]).toBeUndefined();
    expect(applyDismissals.mock.calls[0][0]).toBe(saveConfig.mock.calls[0][0]);
    expect(saveConfig).toHaveBeenCalledTimes(1);
  });

  test('a malformed dismissal rejects the invoke (the renderer re-enables Finish) and saveConfig was NEVER called — nothing reached disk (mutant PARTIALCOMMIT)', async () => {
    loadConfig.mockReturnValue({ default: 'gemini', aliases: {} });
    applyDismissals.mockImplementationOnce(() => { throw new Error('bad key'); });
    await expect(save('gemini', { glm: 'openrouter/z-ai/glm-5.4' }, [], ['bad'])).rejects.toThrow('bad key');
    expect(saveConfig).not.toHaveBeenCalled();                          // PARTIALCOMMIT dies here
  });
});

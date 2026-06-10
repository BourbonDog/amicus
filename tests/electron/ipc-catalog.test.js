/** F5: catalog IPC for the wizard picker + warm refresh after key save. */

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

function registerWithFakes({ catalogInfo, refreshImpl, saveImpl } = {}) {
  jest.resetModules();
  jest.doMock('../../src/utils/model-catalog', () => ({
    getCatalogInfo: jest.fn(async () => catalogInfo || { models: [], fetchedAt: null }),
    refreshCatalog: refreshImpl || jest.fn(async () => []),
  }));
  jest.doMock('../../src/utils/api-key-store', () => ({
    saveApiKey: saveImpl || jest.fn(() => ({ success: true })),
    validateApiKey: jest.fn(),
    removeApiKey: jest.fn(),
    readApiKeys: jest.fn(() => ({})),
    readApiKeyHints: jest.fn(() => ({})),
    readApiKeyValues: jest.fn(() => ({})),
  }));
  const handlers = {};
  const fakeIpc = { handle: (name, fn) => { handlers[name] = fn; } };
  const { registerSetupHandlers } = require('../../electron/ipc-setup');
  registerSetupHandlers(fakeIpc, () => null);
  return handlers;
}

describe('catalog IPC', () => {
  it('sidecar:get-catalog returns models + fetchedAt from the cache layer', async () => {
    const rows = [{ id: 'openrouter/a/b', name: 'B', contextLength: 1, pricing: null }];
    const handlers = registerWithFakes({ catalogInfo: { models: rows, fetchedAt: 42 } });
    expect(await handlers['sidecar:get-catalog']({})).toEqual({ models: rows, fetchedAt: 42 });
  });

  it('sidecar:get-catalog degrades to empty on error', async () => {
    jest.resetModules();
    jest.doMock('../../src/utils/model-catalog', () => ({
      getCatalogInfo: jest.fn(async () => { throw new Error('boom'); }),
      refreshCatalog: jest.fn(),
    }));
    const handlers = {};
    const { registerSetupHandlers } = require('../../electron/ipc-setup');
    registerSetupHandlers({ handle: (n, f) => { handlers[n] = f; } }, () => null);
    expect(await handlers['sidecar:get-catalog']({})).toEqual({ models: [], fetchedAt: null });
  });

  it('sidecar:refresh-catalog forces a refresh and returns the fresh info', async () => {
    const rows = [{ id: 'openrouter/a/b', name: 'B', contextLength: null, pricing: null }];
    const refresh = jest.fn(async () => rows);
    const handlers = registerWithFakes({
      catalogInfo: { models: rows, fetchedAt: 99 }, refreshImpl: refresh
    });
    const res = await handlers['sidecar:refresh-catalog']({});
    expect(refresh).toHaveBeenCalled();
    expect(res).toEqual({ models: rows, fetchedAt: 99 });
  });

  it('sidecar:save-key fires a warm catalog refresh after a successful save', async () => {
    const refresh = jest.fn(async () => []);
    const handlers = registerWithFakes({ refreshImpl: refresh });
    await handlers['sidecar:save-key']({}, 'openrouter', 'sk-x');
    await new Promise(r => setImmediate(r));
    expect(refresh).toHaveBeenCalled();
  });

  it('sidecar:save-key does NOT refresh when the save failed', async () => {
    const refresh = jest.fn(async () => []);
    const handlers = registerWithFakes({
      refreshImpl: refresh, saveImpl: jest.fn(() => ({ success: false, error: 'nope' }))
    });
    await handlers['sidecar:save-key']({}, 'openrouter', 'bad');
    await new Promise(r => setImmediate(r));
    expect(refresh).not.toHaveBeenCalled();
  });
});

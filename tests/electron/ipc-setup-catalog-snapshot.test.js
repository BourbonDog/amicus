/**
 * V17 / council A4: single catalog snapshot across the two setup IPC
 * handlers. save-key builds the provider-default offer from one catalog
 * fetch; set-provider-default must apply against THAT snapshot — never a
 * re-fetch that could return a different catalog than the offer was built
 * from (the TOCTOU: applyProviderDefault's directFormIfProven evidence
 * would then differ from what the picker offered).
 *
 * PR 199 council B1/D2, as re-ruled after review F1: snapshot lifetime =
 * the OFFER SESSION. The wizard auto-applies on render and re-applies on
 * every radio change, so every apply while the offer is on screen must see
 * the offer's own catalog (a one-shot delete-on-read handed every human
 * pick a fresh fetch — the original A4 race). Staleness is bounded by the
 * session instead: a re-offer (second save-key) overwrites the entry, and
 * setup-done clears the map.
 */

'use strict';

// Capture handlers registered on ipcMain (F2e virtual-mock pattern, mirrors
// tests/ipc-setup-provider-default.test.js).
const handlers = {};
jest.mock('electron', () => ({
  ipcMain: { handle: (channel, fn) => { handlers[channel] = fn; } },
  BrowserWindow: { fromWebContents: jest.fn() },
}), { virtual: true });

jest.mock('../../src/utils/api-key-store', () => ({
  saveApiKey: jest.fn(() => ({ success: true })),
}));

jest.mock('../../src/utils/model-catalog', () => ({
  getCatalog: jest.fn(),
  refreshCatalog: jest.fn(async () => []),
}));

// Picker core stubbed so the assertions can be about catalog object
// IDENTITY (which snapshot reached the apply), not picker behavior.
jest.mock('../../src/utils/provider-default-picker', () => ({
  buildProviderDefaultChoices: jest.fn(() => ({ preselectedId: 'anthropic/claude-sonnet-5', rows: [] })),
  applyProviderDefault: jest.fn(() => ({ alias: 'anthropic', setAsDefault: true })),
}));

const { getCatalog } = require('../../src/utils/model-catalog');
const { buildProviderDefaultChoices, applyProviderDefault } =
  require('../../src/utils/provider-default-picker');
const { registerSetupHandlers } = require('../../electron/ipc-setup');

const CATALOG_1 = [
  { id: 'anthropic/claude-sonnet-5', name: 'Claude Sonnet 5', contextLength: 200000, pricing: null },
];
const CATALOG_2 = [
  { id: 'anthropic/claude-sonnet-6', name: 'Claude Sonnet 6', contextLength: 200000, pricing: null },
];

beforeAll(() => { registerSetupHandlers(() => null); });
beforeEach(() => { jest.clearAllMocks(); });

describe('catalog snapshot across save-key → set-provider-default (V17 / A4)', () => {
  test('the apply consumes the SAME catalog the offer was built from — no re-fetch', async () => {
    getCatalog.mockResolvedValueOnce(CATALOG_1).mockResolvedValue(CATALOG_2);

    await handlers['sidecar:save-key']({}, 'anthropic', 'sk-ant-test');
    expect(buildProviderDefaultChoices).toHaveBeenCalledTimes(1);
    expect(buildProviderDefaultChoices.mock.calls[0][1].catalog).toBe(CATALOG_1);

    await handlers['sidecar:set-provider-default']({}, 'anthropic', 'anthropic/claude-sonnet-5');
    expect(applyProviderDefault).toHaveBeenCalledTimes(1);
    // Identity, not deep equality: the apply must see the offer's snapshot,
    // not a second fetch that happens to look similar.
    expect(applyProviderDefault.mock.calls[0][2].catalog).toBe(CATALOG_1);
    expect(getCatalog).toHaveBeenCalledTimes(1); // the offer build's fetch is the ONLY fetch
  });

  test('offer session (B1/D2 re-ruled): EVERY apply within one offer reuses the offer snapshot — auto-apply then a human re-pick see the same catalog', async () => {
    getCatalog.mockResolvedValueOnce(CATALOG_1).mockResolvedValue(CATALOG_2);

    await handlers['sidecar:save-key']({}, 'anthropic', 'sk-ant-test');
    expect(buildProviderDefaultChoices.mock.calls[0][1].catalog).toBe(CATALOG_1);

    // The wizard auto-applies the preselected id on render...
    await handlers['sidecar:set-provider-default']({}, 'anthropic', 'anthropic/claude-sonnet-5');
    // ...and re-applies when the user picks another row. BOTH must see the
    // catalog the visible rows were built from — identity, not a re-fetch.
    await handlers['sidecar:set-provider-default']({}, 'anthropic', 'anthropic/claude-sonnet-6');
    expect(applyProviderDefault).toHaveBeenCalledTimes(2);
    expect(applyProviderDefault.mock.calls[0][2].catalog).toBe(CATALOG_1);
    expect(applyProviderDefault.mock.calls[1][2].catalog).toBe(CATALOG_1);
    expect(getCatalog).toHaveBeenCalledTimes(1); // the offer build's fetch is the ONLY fetch
  });

  test('setup-done ends the offer session: a later apply fetches fresh instead of reusing the closed offer', async () => {
    getCatalog.mockResolvedValueOnce(CATALOG_1).mockResolvedValue(CATALOG_2);

    await handlers['sidecar:save-key']({}, 'anthropic', 'sk-ant-test');
    // Wizard finishes; the sender is not a tracked window in this harness,
    // which exercises only the session-teardown side effect under test.
    await handlers['sidecar:setup-done']({ sender: {} }, 'anthropic', 1);

    await handlers['sidecar:set-provider-default']({}, 'anthropic', 'anthropic/claude-sonnet-6');
    expect(applyProviderDefault).toHaveBeenCalledTimes(1);
    expect(applyProviderDefault.mock.calls[0][2].catalog).toBe(CATALOG_2);
    expect(getCatalog).toHaveBeenCalledTimes(2); // offer build + the post-session fresh fetch
  });

  test('re-offer refreshes the snapshot: a second save-key OVERWRITES the prior entry', async () => {
    getCatalog.mockResolvedValueOnce(CATALOG_1).mockResolvedValueOnce(CATALOG_2);

    await handlers['sidecar:save-key']({}, 'anthropic', 'sk-ant-test');
    await handlers['sidecar:save-key']({}, 'anthropic', 'sk-ant-test-2');
    expect(buildProviderDefaultChoices).toHaveBeenCalledTimes(2);
    expect(buildProviderDefaultChoices.mock.calls[1][1].catalog).toBe(CATALOG_2);

    // The apply sees the SECOND offer's snapshot, and fetches nothing itself.
    await handlers['sidecar:set-provider-default']({}, 'anthropic', 'anthropic/claude-sonnet-6');
    expect(applyProviderDefault.mock.calls[0][2].catalog).toBe(CATALOG_2);
    expect(getCatalog).toHaveBeenCalledTimes(2); // both fetches were offer builds
  });

  test('no snapshot (apply without a prior offer): falls back to a fresh fetch (issue 195 path)', async () => {
    getCatalog.mockResolvedValue(CATALOG_2);

    await handlers['sidecar:set-provider-default']({}, 'google', 'openrouter/google/gemma-4-31b-it:free');
    expect(applyProviderDefault).toHaveBeenCalledTimes(1);
    expect(applyProviderDefault.mock.calls[0][2].catalog).toBe(CATALOG_2);
    expect(getCatalog).toHaveBeenCalledTimes(1);
  });
});

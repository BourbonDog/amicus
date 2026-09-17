/**
 * Key IPC handlers — electron/ipc-keys.js (issue #212).
 *
 * The defect: `sidecar:save-key` persisted whatever it was handed. Validation
 * lived in a SIBLING handler (`sidecar:validate-key`) that only the renderer
 * called, so the wizard's validate-then-save order was renderer discipline,
 * not enforcement — anything with renderer access (notably a CDP automation
 * session on AMICUS_DEBUG_PORT, which is how the GUI smoke runs are driven)
 * could invoke save-key directly and land an arbitrary unvalidated string in
 * the real ~/.config/amicus/.env.
 *
 * The contract pinned here is the CLI's, mirrored rather than reinvented
 * (src/cli-handlers.js :: handleKey): only a 401 blocks a save. 403 (disabled
 * API, quota, a region/bot block), 429, any 5xx, an unexpected status, or no
 * status at all because the probe never got an answer all say something about
 * the REQUEST, not the key — the CLI warns and saves, and so must this.
 *
 * Nothing here reaches the network: api-key-store (which re-exports
 * validateApiKey) is mocked in every registration.
 */

'use strict';

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

const CATALOG = [
  { id: 'anthropic/claude-sonnet-5', name: 'Claude Sonnet 5', contextLength: 200000, pricing: null },
];

/**
 * Register the key handlers against a fake ipcMain and a real offer session.
 * @param {object} [opts]
 * @param {object|Error} [opts.validation] resolved value of validateApiKey, or an Error to throw
 * @param {object} [opts.saveResult] return value of saveApiKey
 * @param {Array} [opts.catalog] catalog getCatalog resolves to
 */
function registerKeys({ validation, saveResult, catalog } = {}) {
  jest.resetModules();
  const handlers = {};
  const saveApiKey = jest.fn(() => saveResult || { success: true });
  const validateApiKey = jest.fn(async () => {
    if (validation instanceof Error) { throw validation; }
    return validation === undefined ? { valid: true, status: 200 } : validation;
  });
  const refreshCatalog = jest.fn(async () => []);
  const getCatalog = jest.fn(async () => catalog || CATALOG);
  const buildProviderDefaultChoices = jest.fn(() => ({ preselectedId: 'anthropic/claude-sonnet-5', rows: [] }));

  jest.doMock('../../src/utils/api-key-store', () => ({
    saveApiKey, validateApiKey,
    removeApiKey: jest.fn(),
    readApiKeys: jest.fn(() => ({})),
    readApiKeyHints: jest.fn(() => ({})),
    readApiKeyValues: jest.fn(() => ({})),
  }));
  jest.doMock('../../src/utils/model-catalog', () => ({
    getCatalog, refreshCatalog,
    getCatalogInfo: jest.fn(async () => ({ models: [], fetchedAt: null })),
  }));
  jest.doMock('../../src/utils/provider-default-picker', () => ({
    buildProviderDefaultChoices,
    applyProviderDefault: jest.fn(),
  }));

  const { registerKeyHandlers } = require('../../electron/ipc-keys');
  const { createOfferSessions } = require('../../electron/offer-session');
  const offerCatalogs = createOfferSessions();
  registerKeyHandlers({
    ipcMain: { handle: (channel, fn) => { handlers[channel] = fn; } },
    offerCatalogs,
  });
  return { handlers, offerCatalogs, saveApiKey, validateApiKey, refreshCatalog, getCatalog, buildProviderDefaultChoices };
}

/** Let the fire-and-forget catalog warm-up (setImmediate) run. */
const drainImmediates = () => new Promise((r) => setImmediate(r));

describe('registerKeyHandlers', () => {
  it('registers exactly the two key channels on the injected ipcMain', () => {
    const { handlers } = registerKeys();
    expect(Object.keys(handlers).sort()).toEqual(['sidecar:save-key', 'sidecar:validate-key']);
  });
});

describe('sidecar:validate-key', () => {
  it('returns the validation verbatim', async () => {
    const { handlers } = registerKeys({ validation: { valid: false, status: 403, error: 'nope' } });
    expect(await handlers['sidecar:validate-key']({}, 'openai', 'sk-x'))
      .toEqual({ valid: false, status: 403, error: 'nope' });
  });

  it('degrades to { valid: false } when the probe throws', async () => {
    const { handlers } = registerKeys({ validation: new Error('socket hang up') });
    expect(await handlers['sidecar:validate-key']({}, 'openai', 'sk-x'))
      .toEqual({ valid: false, error: 'socket hang up' });
  });
});

describe('sidecar:save-key validates in the MAIN process before persisting (#212)', () => {
  it('a 401 key is never persisted — no saveApiKey, no catalog warm, no providerDefault', async () => {
    const { handlers, saveApiKey, validateApiKey, refreshCatalog, buildProviderDefaultChoices } =
      registerKeys({ validation: { valid: false, status: 401, error: 'Invalid API key (401)' } });

    const result = await handlers['sidecar:save-key']({}, 'deepseek', 'sk-deepseek-test-456');
    await drainImmediates();

    expect(validateApiKey).toHaveBeenCalledWith('deepseek', 'sk-deepseek-test-456');
    expect(saveApiKey).not.toHaveBeenCalled();
    expect(refreshCatalog).not.toHaveBeenCalled();
    expect(buildProviderDefaultChoices).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid API key (401)');
    expect(result.validation).toEqual({ valid: false, status: 401, error: 'Invalid API key (401)' });
    expect(result.providerDefault).toBeUndefined();
  });

  it('a refused save arms no offer session — set-provider-default must not see a snapshot', async () => {
    const { handlers, offerCatalogs } =
      registerKeys({ validation: { valid: false, status: 401, error: 'Invalid API key (401)' } });
    await handlers['sidecar:save-key']({}, 'anthropic', 'sk-bad');
    expect(offerCatalogs.get({}, 'anthropic')).toBeUndefined();
  });

  it('a validation that throws refuses the save rather than falling through to it', async () => {
    const { handlers, saveApiKey } = registerKeys({ validation: new Error('socket hang up') });
    const result = await handlers['sidecar:save-key']({}, 'openai', 'sk-x');
    expect(saveApiKey).not.toHaveBeenCalled();
    expect(result).toEqual({ success: false, error: 'socket hang up' });
  });

  // An EMPTY key validates to { valid: false, status: null } (api-key-validation.js
  // :: validateApiKey), and null is not in BLOCKS_SAVE — so the 401 gate alone waves
  // it through to saveApiKey, whose upsertEnvLine rewrites a stored
  // `ANTHROPIC_API_KEY=<real key>` line as `ANTHROPIC_API_KEY=`. That WIPES the
  // credential and still returns { success: true }, so the wizard reports "Saved".
  // The CLI never gets there: `if (!keyArg) { … process.exit(1); }` refuses a missing
  // key before it validates anything. The renderer trims and returns early too, so
  // this is reachable only by a direct IPC call — the bypass issue 212 is about.
  it.each([
    ['an empty string', ''],
    ['undefined (a caller that omitted the argument)', undefined],
    ['null', null],
  ])('%s is refused before validating — nothing is probed, nothing is written', async (_label, key) => {
    const { handlers, saveApiKey, validateApiKey, refreshCatalog } = registerKeys();

    const result = await handlers['sidecar:save-key']({}, 'anthropic', key);
    await drainImmediates();

    expect(result).toEqual({ success: false, error: 'API key is required' });
    expect(saveApiKey).not.toHaveBeenCalled();
    expect(validateApiKey).not.toHaveBeenCalled();
    expect(refreshCatalog).not.toHaveBeenCalled();
  });

  it('a valid key is persisted and warms the catalog (pre-#212 behaviour, unchanged)', async () => {
    const { handlers, saveApiKey, refreshCatalog } = registerKeys({ validation: { valid: true, status: 200 } });
    const result = await handlers['sidecar:save-key']({}, 'openrouter', 'sk-or-good');
    await drainImmediates();
    expect(saveApiKey).toHaveBeenCalledWith('openrouter', 'sk-or-good');
    expect(refreshCatalog).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('a save that fails downstream still skips the warm-up and the picker', async () => {
    const { handlers, refreshCatalog, buildProviderDefaultChoices } = registerKeys({
      validation: { valid: true, status: 200 }, saveResult: { success: false, error: 'nope' },
    });
    const result = await handlers['sidecar:save-key']({}, 'openrouter', 'sk-or-good');
    await drainImmediates();
    expect(refreshCatalog).not.toHaveBeenCalled();
    expect(buildProviderDefaultChoices).not.toHaveBeenCalled();
    expect(result).toEqual({ success: false, error: 'nope' });
  });
});

describe('the CLI rule is mirrored, not reinvented (src/cli-handlers.js :: handleKey)', () => {
  // `const BLOCKS_SAVE = new Set([401]);` — an ALLOWLIST of what blocks,
  // deliberately. Everything below is a failed probe the CLI warns about and
  // saves anyway, so the IPC must save it too: refusing here would be the
  // false ALARM (a working key rejected because the machine was offline, or
  // because a WAF answered 403) that the doctor classifier stopped raising.
  const SAVES_ANYWAY = [
    ['403 — disabled API / quota / region block', { valid: false, status: 403, error: 'Forbidden (403) — …' }],
    ['429 — rate limited', { valid: false, status: 429, error: 'Server error (429)' }],
    ['500 — provider outage', { valid: false, status: 500, error: 'Server error (500)' }],
    ['404 — moved endpoint', { valid: false, status: 404, error: 'Unexpected response (404)' }],
    ['no status — offline, timed out, or the probe never answered', { valid: false, status: null, error: 'Request timed out' }],
  ];

  test.each(SAVES_ANYWAY)('%s still persists', async (_label, validation) => {
    const { handlers, saveApiKey } = registerKeys({ validation });
    const result = await handlers['sidecar:save-key']({}, 'openai', 'sk-maybe-fine');
    expect(saveApiKey).toHaveBeenCalledWith('openai', 'sk-maybe-fine');
    expect(result.success).toBe(true);
  });

  test('401 is the ONLY status that blocks', async () => {
    const { blocksSave } = require('../../electron/ipc-keys');
    expect(blocksSave({ valid: false, status: 401 })).toBe(true);
    expect(blocksSave({ valid: false, status: 403 })).toBe(false);
    expect(blocksSave({ valid: false, status: null })).toBe(false);
    // A valid key with a 401 status cannot happen, but `valid` is the field
    // the CLI reads first — honour it.
    expect(blocksSave({ valid: true, status: 401 })).toBe(false);
    expect(blocksSave({ valid: true, status: 200 })).toBe(false);
  });
});

describe('providerDefault (Task 8) survives the move verbatim', () => {
  it('direct vendor: builds the picker choices from the offer catalog and arms the session', async () => {
    const { handlers, buildProviderDefaultChoices, offerCatalogs, getCatalog } =
      registerKeys({ validation: { valid: true, status: 200 } });

    const result = await handlers['sidecar:save-key']({}, 'anthropic', 'sk-ant-good');

    expect(getCatalog).toHaveBeenCalledTimes(1);
    expect(buildProviderDefaultChoices).toHaveBeenCalledWith('anthropic', { catalog: CATALOG });
    expect(result.providerDefault).toEqual({ preselectedId: 'anthropic/claude-sonnet-5', rows: [] });
    // Identity: the apply must later see the SAME snapshot the offer was built from (V17/A4).
    expect(offerCatalogs.get({}, 'anthropic')).toBe(CATALOG);
  });

  it('gateway (openrouter): providerDefault is null and nothing is built', async () => {
    const { handlers, buildProviderDefaultChoices, getCatalog } =
      registerKeys({ validation: { valid: true, status: 200 } });
    const result = await handlers['sidecar:save-key']({}, 'openrouter', 'sk-or-good');
    expect(result.providerDefault).toBeNull();
    expect(buildProviderDefaultChoices).not.toHaveBeenCalled();
    expect(getCatalog).not.toHaveBeenCalled();
  });

  it('a picker failure degrades to providerDefault: null, never a thrown save', async () => {
    const { handlers, buildProviderDefaultChoices } = registerKeys({ validation: { valid: true, status: 200 } });
    buildProviderDefaultChoices.mockImplementationOnce(() => { throw new Error('picker boom'); });
    const result = await handlers['sidecar:save-key']({}, 'anthropic', 'sk-ant-good');
    expect(result.success).toBe(true);
    expect(result.providerDefault).toBeNull();
  });
});

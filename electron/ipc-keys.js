/**
 * Key IPC handlers for the setup window: `sidecar:validate-key` and
 * `sidecar:save-key`.
 *
 * Split out of electron/ipc-setup.js for issue 212. That file was at 294 of
 * the 300-line gate, and issue 212's fix — save-key validating in the MAIN
 * process before it persists — does not fit there. The two handlers are the
 * pair the issue is about, so they move together rather than being carved
 * arbitrarily.
 * Everything here arrived VERBATIM from electron/ipc-setup.js@3cc8cbe7:33-84
 * (channel names, return shapes, the F5 catalog warm-up and the Task 8
 * providerDefault picker logic are unchanged); the validation gate below is
 * the only addition.
 *
 * Registered on the SAME (possibly injected) ipcMain as the rest of the setup
 * handlers — mirrors ipc-setup-local.js / ipc-aliases.js.
 */

'use strict';

const { logger: defaultLogger } = require('../src/utils/logger');

/**
 * The statuses that BLOCK a save, mirroring the CLI (src/cli-handlers.js ::
 * handleKey) rather than inventing a second rule for the same credential
 * store — the asymmetry between the two entry points IS issue 212.
 *
 * An ALLOWLIST of what blocks, deliberately: 401 is the only status that
 * means "this credential is not accepted". 403 (a disabled API, a quota, a
 * region/bot block), 429, any 5xx, a 404 from a moved endpoint, or no status
 * at all because the machine is offline all say something about the REQUEST,
 * not the key. Refusing on those would be the false ALARM the doctor
 * classifier stopped raising.
 */
const BLOCKS_SAVE = new Set([401]);

/**
 * Would the CLI refuse to persist this key?
 * @param {{valid: boolean, status: number|null}} validation validateApiKey's result
 * @returns {boolean}
 */
function blocksSave(validation) {
  return !validation.valid && BLOCKS_SAVE.has(validation.status);
}

/**
 * Register the setup window's key handlers.
 * @param {object} deps
 * @param {object} deps.ipcMain Electron ipcMain, or a test double exposing .handle
 * @param {object} deps.offerCatalogs offer-session store (electron/offer-session.js)
 * @param {object} [deps.logger] structured logger (injectable for tests)
 */
function registerKeyHandlers({ ipcMain, offerCatalogs, logger = defaultLogger }) {
  ipcMain.handle('sidecar:validate-key', async (_event, provider, key) => {
    try {
      const { validateApiKey } = require('../src/utils/api-key-store');
      return await validateApiKey(provider, key);
    } catch (err) {
      logger.error('validate-key handler error', { error: err.message });
      return { valid: false, error: err.message };
    }
  });

  ipcMain.handle('sidecar:save-key', async (_event, provider, key) => {
    try {
      // A FAST PATH for the falsy case, not the rule itself. A blank key is a
      // WIPE, not a save: it validates to { valid: false, status: null }, null
      // is NOT in BLOCKS_SAVE, so the 401 gate below would wave it through and
      // upsertEnvLine (env-raw-store.js) would rewrite a stored
      // `ANTHROPIC_API_KEY=<real key>` line with a blank value while still
      // returning success. Reachable only by a direct IPC call (the renderer
      // trims and returns early), which is the bypass issue 212 is about.
      //
      // The AUTHORITATIVE refusal is at the store boundary —
      // api-key-store.js :: saveApiKey refuses anything empty after trim, via
      // env-raw-store.js's isBlankSecret — which is the same check `amicus key`
      // goes through, so the two entry points cannot drift. That is why this
      // one does not trim: it would be a second, parallel definition of
      // "blank". It exists only to answer a null/empty call without a network
      // probe. Council review of PR 262, round 1.
      if (!key) { return { success: false, error: 'API key is required' }; }
      const { saveApiKey, validateApiKey } = require('../src/utils/api-key-store');
      // Issue 212: validate HERE, in the main process, before anything is written.
      // sidecar:validate-key is a sibling handler the RENDERER calls first
      // (setup-ui-keys-script.js), which made the wizard's validate-then-save
      // order discipline rather than enforcement: anything with renderer
      // access -- notably a CDP automation session on AMICUS_DEBUG_PORT, how
      // the GUI smoke runs are driven -- could invoke this channel directly
      // and land an arbitrary unvalidated string in the real
      // ~/.config/amicus/.env. That is the demonstrated bypass in issue 212,
      // and it fits the fixture-shaped deepseek key found in a real key store.
      const validation = await validateApiKey(provider, key);
      if (blocksSave(validation)) {
        logger.warn('save-key refused: the provider rejected the credential', {
          provider, status: validation.status,
        });
        return { success: false, error: validation.error || 'Invalid API key', validation };
      }
      const result = saveApiKey(provider, key);
      // F5: warm the model catalog as soon as a key lands so the Step 2
      // picker renders instantly. Fire-and-forget; failures are silent
      // (a failed warm-up never clobbers the cache; Step 2's get-catalog or
      // the refresh button retry it).
      if (result && result.success !== false) {
        setImmediate(() => {
          try {
            require('../src/utils/model-catalog').refreshCatalog().catch(() => {});
          } catch { /* best-effort */ }
        });
        // Task 8: per-provider default picker choices for the key step.
        // Per-provider defaults only make sense for DIRECT model vendors --
        // openrouter is the GATEWAY, not a vendor, so it's skipped entirely
        // (mirrors provider-default-prompt.js's runProviderDefaultFlow gate;
        // this path calls the picker core directly instead of that
        // readline-oriented helper, so it re-checks isDirectProvider itself).
        const { isDirectProvider } = require('../src/utils/provider-registry');
        if (isDirectProvider(provider)) {
          try {
            const { getCatalog } = require('../src/utils/model-catalog');
            const { buildProviderDefaultChoices } = require('../src/utils/provider-default-picker');
            const catalog = await getCatalog();
            result.providerDefault = buildProviderDefaultChoices(provider, { catalog });
            offerCatalogs.set(_event, provider, catalog);
          } catch (err) {
            logger.error('save-key providerDefault error', { error: err.message });
            result.providerDefault = null;
          }
        } else {
          result.providerDefault = null;
        }
      }
      return result;
    } catch (err) {
      logger.error('save-key handler error', { error: err.message });
      return { success: false, error: err.message };
    }
  });
}

module.exports = { registerKeyHandlers, blocksSave, BLOCKS_SAVE };

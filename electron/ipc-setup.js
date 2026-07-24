/**
 * IPC Setup Handlers
 *
 * Extracted from main.js to keep file sizes under 300 lines.
 * Registers all setup-mode IPC handlers: validate-key, save-key,
 * remove-key, setup-done, save-config, get-config, get-api-keys,
 * get-catalog, and refresh-catalog.
 * (sidecar:fetch-models was retired in B33/#12 — Step 3's alias editor now
 * shares the TTL-cached get-catalog data Step 2 loads instead of a second,
 * uncached live fetch.)
 */

const { logger } = require('../src/utils/logger');
const { registerLocalProviderHandlers } = require('./ipc-setup-local');

/**
 * Register all setup-related IPC handlers
 * @param {function} getMainWindow - Returns the current main BrowserWindow
 * @param {object} [injected] - DI overrides
 * @param {object} [injected.ipcMain] - Electron ipcMain (or a test double exposing
 *   .handle). Defaults to the real `require('electron').ipcMain` — production call
 *   sites (electron/main.js) pass none. Task 13 / C9: this parameter shadows what
 *   used to be a module-level `const { ipcMain } = require('electron');`, which is
 *   removed rather than left dead now that every ipcMain.handle(...) call below
 *   resolves through this local binding instead.
 */
function registerSetupHandlers(getMainWindow, { ipcMain = require('electron').ipcMain } = {}) {
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
      const { saveApiKey } = require('../src/utils/api-key-store');
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

  // Task 8: apply a per-provider default picker choice. Read-modify-write,
  // no-clobber -- applyProviderDefault only ever writes aliases[vendor] and
  // seeds config.default when absent (see provider-default-picker.js).
  ipcMain.handle('sidecar:set-provider-default', (_event, provider, chosenId) => {
    try {
      const { applyProviderDefault } = require('../src/utils/provider-default-picker');
      return applyProviderDefault(provider, chosenId, { seedDefaultIfAbsent: true });
    } catch (err) {
      logger.error('set-provider-default handler error', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('sidecar:remove-key', async (_event, provider) => {
    try {
      const { removeApiKey } = require('../src/utils/api-key-store');
      const { removeFromAuthJson } = require('../src/utils/auth-json');
      const result = removeApiKey(provider);
      // Always clean auth.json too — prevents auto-import from re-adding the key
      if (result.alsoInAuthJson) {
        removeFromAuthJson(provider);
        result.alsoInAuthJson = false;
      }
      return result;
    } catch (err) {
      logger.error('remove-key handler error', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('sidecar:remove-from-opencode', async (_event, provider) => {
    try {
      const { removeFromAuthJson } = require('../src/utils/auth-json');
      removeFromAuthJson(provider);
      return { success: true };
    } catch (err) {
      logger.error('remove-from-opencode handler error', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('sidecar:setup-done', (_event, defaultModel, keyCount) => {
    const { BrowserWindow } = require('electron');
    const senderWindow = BrowserWindow.fromWebContents(_event.sender);
    const mainWin = getMainWindow();

    // If sent from main window → stdout + close (CLI setup flow)
    // If sent from child window → just close it (settings flow)
    if (senderWindow === mainWin) {
      const result = JSON.stringify({
        status: 'complete',
        default: defaultModel || undefined,
        keyCount: keyCount || undefined
      });
      process.stdout.write(result + '\n');
      if (mainWin) { mainWin.close(); }
    } else if (senderWindow) {
      senderWindow.close();
    }
  });

  // Read-modify-write: never rewrite an alias the renderer didn't send.
  // aliasWrites values: string = set, null = delete. First run seeds live.
  // councilPicks (optional): when length >= 2, seeds the free council via seedFreeCouncil.
  ipcMain.handle('sidecar:save-config', async (_event, defaultModel, aliasWrites, councilPicks) => {
    try {
      const { loadConfig, saveConfig } = require('../src/utils/config');
      let cfg = loadConfig();
      if (!cfg) {
        const { toLiveSeedAliases } = require('../src/utils/quick-picks');
        let catalog = [];
        try {
          catalog = await require('../src/utils/model-catalog').getCatalog();
        } catch (_err) { /* offline: pinned seeds */ }
        cfg = { aliases: toLiveSeedAliases(catalog) };
      }
      if (!cfg.aliases) { cfg.aliases = {}; }
      if (defaultModel) { cfg.default = defaultModel; }
      if (aliasWrites && typeof aliasWrites === 'object') {
        for (const [alias, model] of Object.entries(aliasWrites)) {
          if (model === null) { delete cfg.aliases[alias]; }
          // empty string: ignore (use null to delete)
          else if (typeof model === 'string' && model) { cfg.aliases[alias] = model; }
        }
      }
      saveConfig(cfg);
      if (Array.isArray(councilPicks) && councilPicks.length >= 2) {
        require('../src/sidecar/setup').seedFreeCouncil(councilPicks);
      }
      return { success: true };
    } catch (err) {
      logger.error('save-config handler error', { error: err.message });
      throw err; // renderer invoke() rejects; its catch re-enables Finish
    }
  });

  ipcMain.handle('sidecar:get-config', () => {
    const { loadConfig } = require('../src/utils/config');
    return loadConfig();
  });

  ipcMain.handle('sidecar:get-api-keys', () => {
    try {
      const { readApiKeys, readApiKeyHints, saveApiKey } = require('../src/utils/api-key-store');
      const { importFromAuthJson } = require('../src/utils/auth-json');
      const status = readApiKeys();
      const hints = readApiKeyHints();

      // Auto-import keys from auth.json that sidecar doesn't have yet
      const { imported } = importFromAuthJson(status);
      for (const entry of imported) {
        const result = saveApiKey(entry.provider, entry.key);
        if (result && result.success !== false) {
          status[entry.provider] = true;
          const visible = entry.key.slice(0, 8);
          hints[entry.provider] = visible + '\u2022'.repeat(Math.max(0, Math.min(entry.key.length - 8, 12)));
        }
      }

      return { status, hints, imported: imported.map(e => e.provider) };
    } catch (err) {
      logger.error('get-api-keys handler error', { error: err.message });
      return { status: {}, hints: {}, imported: [] };
    }
  });

  // F5: wizard Step 2 reads the catalog CACHE (self-refreshing when stale).
  ipcMain.handle('sidecar:get-catalog', async () => {
    try {
      const { getCatalogInfo } = require('../src/utils/model-catalog');
      return await getCatalogInfo();
    } catch (err) {
      logger.error('get-catalog handler error', { error: err.message });
      return { models: [], fetchedAt: null };
    }
  });

  ipcMain.handle('sidecar:refresh-catalog', async () => {
    try {
      const { refreshCatalog, getCatalogInfo } = require('../src/utils/model-catalog');
      await refreshCatalog();
      // maxAgeMs: Infinity — report whatever the cache now holds without
      // re-triggering a second fetch when the refresh just failed.
      return await getCatalogInfo({ maxAgeMs: Number.POSITIVE_INFINITY });
    } catch (err) {
      logger.error('refresh-catalog handler error', { error: err.message });
      return { models: [], fetchedAt: null };
    }
  });

  // Free OpenRouter council: returns all free models from the catalog,
  // marking those in the vendor-diverse suggested set with suggested:true.
  ipcMain.handle('sidecar:fetch-free-models', async () => {
    try {
      const { getCatalog } = require('../src/utils/model-catalog');
      const { listFreeModels, suggestFreeCouncil } = require('../src/utils/free-models');
      const catalog = await getCatalog();
      const free = listFreeModels(catalog);
      const suggested = new Set(suggestFreeCouncil(free, 3).map(r => r.id));
      return free.map(r => ({
        id: r.id,
        suggested: suggested.has(r.id),
        name: r.name,
        vendor: r.id.split('/')[1] || '',
      }));
    } catch (_err) { return []; }
  });

  // Task 13 (v4.2 §4.6): Electron wizard "Local server" card — probe + save.
  // Extracted to ipc-setup-local.js to keep this file under the size gate (see its
  // header comment); registered on the SAME (possibly injected) ipcMain as above.
  registerLocalProviderHandlers(ipcMain);
}

module.exports = { registerSetupHandlers };

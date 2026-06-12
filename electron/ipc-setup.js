/**
 * IPC Setup Handlers
 *
 * Extracted from main.js to keep file sizes under 300 lines.
 * Registers all setup-mode IPC handlers: validate-key, save-key,
 * remove-key, setup-done, save-config, get-config, get-api-keys,
 * fetch-models, get-catalog, and refresh-catalog.
 */

const { ipcMain } = require('electron');
const { logger } = require('../src/utils/logger');

/**
 * Register all setup-related IPC handlers
 * @param {function} getMainWindow - Returns the current main BrowserWindow
 */
function registerSetupHandlers(getMainWindow) {
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
      }
      return result;
    } catch (err) {
      logger.error('save-key handler error', { error: err.message });
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
  ipcMain.handle('sidecar:save-config', async (_event, defaultModel, aliasWrites) => {
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

  ipcMain.handle('sidecar:fetch-models', async () => {
    try {
      const { readApiKeyValues } = require('../src/utils/api-key-store');
      const { fetchAllModels, groupModelsByFamily } = require('../src/utils/model-fetcher');
      const keys = readApiKeyValues();
      const models = await fetchAllModels(keys);
      return groupModelsByFamily(models);
    } catch (err) {
      logger.error('fetch-models handler error', { error: err.message });
      return [];
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
}

module.exports = { registerSetupHandlers };

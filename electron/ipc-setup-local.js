/**
 * IPC handlers for the Electron wizard's "Local server" card (Task 13, v4.2 §4.6).
 *
 * Split out of ipc-setup.js purely to keep that file under the 300-line size gate
 * (mirrors RULING D14's extraction of src/sidecar/setup-local.js out of setup.js for
 * the identical reason). registerLocalProviderHandlers is called from
 * registerSetupHandlers with the same (possibly test-injected) ipcMain, so these two
 * channels are registered on exactly the instance the rest of the setup-mode IPC
 * surface uses — this split changes no behavior, only file layout.
 *
 * setup:probe-local reuses Task 2's probeLocalProvider (the same reachability check
 * `amicus provider test` and the readline wizard's handleProvider already share) and
 * deliberately returns only a model COUNT — never the model list or the
 * bearer/Authorization header — so nothing sensitive crosses the preload bridge
 * beyond what the renderer asked for.
 *
 * setup:save-local-provider reuses the same validateProviderEntry/deriveKeyEnv
 * (Task 1) and saveRawEnv (api-key-store.js) the CLI's `amicus provider add` uses,
 * so a bearer always lands in the 0600 .env under its derived env-var NAME and
 * config.json only ever carries that name (never the secret). Per B7/D4,
 * applyProviderDefault (provider-default-picker.js) remains the SOLE writer of
 * config.default — this handler never seeds it, even on a successful save.
 */
'use strict';

const { logger } = require('../src/utils/logger');

/**
 * Exact-hostname loopback + scheme check (mirrors cli-handlers-provider.js's
 * isLoopbackUrl/isPlaintextRemote pair). Duplicated locally rather than imported —
 * leaf-module convention (see local-providers.js's RESERVED_IDS comment) — since
 * those helpers are private to the CLI-oriented module.
 * @param {string} baseURL
 * @returns {boolean} true when a bearer sent here would travel in cleartext
 */
function isPlaintextRemoteBearer(baseURL) {
  try {
    const u = new URL(baseURL);
    const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(u.hostname);
    return u.protocol === 'http:' && !loopback;
  } catch { return false; }
}

/**
 * @param {object} ipcMain - electron's ipcMain, or the test double
 *   registerSetupHandlers was called with — same instance the rest of
 *   ipc-setup.js's handlers are registered on.
 */
function registerLocalProviderHandlers(ipcMain) {
  // Probe handler (Test connection button): gated through validateProviderEntry
  // first so an invalid-input vs. unreachable-server distinction never depends on
  // the network layer.
  ipcMain.handle('setup:probe-local', async (_event, entry) => {
    try {
      const { validateProviderEntry } = require('../src/utils/local-providers');
      const v = validateProviderEntry({ type: 'openai-compatible', baseURL: entry.baseURL, flavor: entry.flavor });
      if (!v.ok) { return { ok: false, error: v.error }; }
      const { probeLocalProvider } = require('../src/utils/local-probe');
      const probe = await probeLocalProvider({ ...v.normalized, id: 'probe' }, { timeoutMs: 2000, bearer: entry.bearer });
      return probe.status === 'ok' ? { ok: true, count: probe.models.length } : { ok: false, error: 'unreachable' };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // Save handler (Save button): validate -> persist bearer to .env (if any) ->
  // write config.providers[id]. Reserved/malformed ids are rejected here because
  // validateProviderEntry is id-agnostic (the map key carries the id).
  ipcMain.handle('setup:save-local-provider', async (_event, entry) => {
    try {
      const { validateProviderEntry, deriveKeyEnv, RESERVED_IDS, ID_RE } = require('../src/utils/local-providers');
      const id = entry && typeof entry.id === 'string' ? entry.id.trim() : '';
      if (!ID_RE.test(id) || RESERVED_IDS.includes(id)) {
        return { ok: false, error: `Invalid or reserved provider id: '${id}'` };
      }
      const draft = { type: 'openai-compatible', baseURL: entry.baseURL, flavor: entry.flavor };
      if (entry.pricing) { draft.pricing = entry.pricing; }
      const v = validateProviderEntry(draft);
      if (!v.ok) { return { ok: false, error: v.error }; }
      const normalized = v.normalized;
      // Bearer: value -> .env under the derived env var; config carries the NAME only.
      if (entry.bearer) {
        const envVar = deriveKeyEnv(id);
        const { saveRawEnv } = require('../src/utils/api-key-store');
        const saved = saveRawEnv(envVar, entry.bearer);
        if (!saved.success) { return { ok: false, error: saved.error }; }
        normalized.apiKeyEnv = envVar;
      }
      const { loadConfig, saveConfig } = require('../src/utils/config');
      const config = loadConfig() || {};
      config.providers = config.providers || {};
      config.providers[id] = normalized; // undefined name/apiKeyEnv keys are dropped by JSON.stringify
      // B7/D4: applyProviderDefault is the SOLE writer of config.default. A bare id with no
      // matching config.aliases[id] is unresolvable by resolveModel() and permanently breaks
      // every later keyless launch. Do NOT seed it here.
      saveConfig(config);
      const result = { ok: true, id, bearer: !!entry.bearer };
      // Security posture parity with the CLI (cli-handlers-provider.js's doAdd):
      // warn, never block, a bearer headed over plain http to a non-loopback host.
      if (entry.bearer && isPlaintextRemoteBearer(entry.baseURL)) {
        result.warning = 'Sending a bearer token over plain http:// to a non-loopback host transmits it in cleartext.';
      }
      return result;
    } catch (err) {
      logger.error('save-local-provider handler error', { error: err.message });
      return { ok: false, error: err.message };
    }
  });
}

module.exports = { registerLocalProviderHandlers, isPlaintextRemoteBearer };

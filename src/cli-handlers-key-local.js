/**
 * amicus key <localId> — bearer lifecycle for a config-defined local /
 * OpenAI-compatible provider (v4.2 §4.6, Task 11). Split out of
 * cli-handlers.js to keep that file under the 300-line gate (mirrors the
 * cli-handlers-abort.js extraction). Local ids never touch PROVIDER_ENV_MAP
 * or VALIDATION_ENDPOINTS — they're config-defined (local-providers.js) and
 * validated with a bearer-attached reachability probe instead.
 *
 * Errors here write to stderr and RETURN rather than process.exit(1): the
 * malformed-env-var case is exercised by a test that spies on
 * process.stderr.write without mocking process.exit, and a real exit() call
 * tears down the whole Jest worker (confirmed while TDD'ing this file — the
 * pre-Task-11 "Unknown provider" path really does kill an unmocked test run).
 */
'use strict';

/**
 * Mask a raw secret the same way api-key-store's readApiKeyHints does: first
 * 8 chars visible, the rest replaced with bullets. Never returns the full value.
 * @param {string} key
 * @returns {string}
 */
function maskKey(key) {
  const visible = key.slice(0, 8);
  return visible + '•'.repeat(Math.max(0, Math.min(key.length - 8, 12)));
}

/**
 * Render the 'Local providers:' block appended to 'amicus key' (no-args list
 * view). A provider with no apiKeyEnv needs no bearer at all; one with
 * apiKeyEnv shows a masked hint (never the raw token) or 'not set'.
 * @param {Object<string,object>} localProviders id -> normalized entry (getLocalProviders())
 * @param {Map<string,string>} envEntries file-backed env values (api-key-store's loadEnvEntries())
 * @returns {string[]} lines to print (empty when there are no local providers)
 */
function formatLocalKeyList(localProviders, envEntries) {
  const ids = Object.keys(localProviders);
  if (ids.length === 0) { return []; }
  const lines = ['', 'Local providers:'];
  for (const id of ids) {
    const entry = localProviders[id];
    let status;
    if (!entry.apiKeyEnv) {
      status = 'no key required';
    } else {
      const raw = envEntries.get(entry.apiKeyEnv) || process.env[entry.apiKeyEnv] || '';
      status = raw ? `✓  ${maskKey(raw)}` : '✗  not set';
    }
    lines.push(`  ${id.padEnd(12)} ${status}`);
  }
  return lines;
}

/**
 * amicus key <localId> [<token>|--remove]. Called only after the caller has
 * already confirmed `provider` is an own key of getLocalProviders() (never a
 * bare map[id] — a provider named 'constructor' must resolve to its real
 * entry, not the inherited Object.prototype.constructor).
 * @param {object} entry normalized local-provider entry (getLocalProviders()[provider])
 * @param {string} provider the local id
 * @param {object} args parsed CLI args (args._[2] = token, args.remove, args.json)
 */
async function handleLocalKey(entry, provider, args) {
  const { saveRawEnv, removeRawEnv } = require('./utils/api-key-store');
  const { deriveKeyEnv } = require('./utils/local-providers');
  const envVar = entry.apiKeyEnv || deriveKeyEnv(provider);

  if (args.remove) {
    removeRawEnv(envVar);
    if (args.json) { process.stdout.write(`${JSON.stringify({ ok: true, removed: provider })}\n`); }
    else { process.stdout.write(`Removed bearer for '${provider}'.\n`); }
    return;
  }

  const token = args._[2];
  if (!token) {
    process.stderr.write(`This local provider needs a bearer token: amicus key ${provider} <token>\n`);
    return;
  }

  const { probeLocalProvider } = require('./utils/local-probe');
  const probe = await probeLocalProvider(entry, { timeoutMs: 2000, bearer: token });

  // M12: saveRawEnv validates envVar against /^[A-Z][A-Z0-9_]*$/ and returns
  // {success:false, error} WITHOUT throwing — bail BEFORE stamping apiKeyEnv
  // onto config, mirroring the direct-vendor check in cli-handlers.js.
  const saved = saveRawEnv(envVar, token);
  if (saved && saved.success === false) {
    process.stderr.write(`${saved.error}\n`);
    return;
  }

  // If the entry had no apiKeyEnv yet, stamp it so buildProviderModels interpolates it.
  if (!entry.apiKeyEnv) {
    const { loadConfig, saveConfig } = require('./utils/config');
    const config = loadConfig() || {};
    if (config.providers && Object.prototype.hasOwnProperty.call(config.providers, provider)) {
      config.providers[provider].apiKeyEnv = envVar;
      saveConfig(config);
    }
  }

  const msg = probe.status === 'ok'
    ? `Bearer saved for '${provider}' (${probe.models.length} model(s) reachable).`
    : `Bearer saved for '${provider}' (endpoint unreachable — check the server).`;
  if (args.json) { process.stdout.write(`${JSON.stringify({ ok: true, provider, reachable: probe.status === 'ok' })}\n`); }
  else { process.stdout.write(`${msg}\n`); }
}

module.exports = { handleLocalKey, formatLocalKeyList, maskKey };

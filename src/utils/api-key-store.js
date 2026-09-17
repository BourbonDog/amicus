/**
 * API Key Store — reading, saving, and validating API keys.
 * Keys stored in ~/.config/amicus/.env with 0o600 permissions.
 */
const fs = require('fs');
const path = require('path');
const { validateApiKey, validateOpenRouterKey, VALIDATION_ENDPOINTS } = require('./api-key-validation');
const { PROVIDER_ENV_MAP } = require('./provider-registry');
// v4.2 (B2/D3): the .env line-merge logic lives once in env-raw-store.js. saveApiKey/
// removeApiKey below reuse it via upsertEnvLine/deleteEnvLine; saveRawEnv/removeRawEnv
// (arbitrary-name local-provider bearer writes) are re-exported so every documented
// `require('./api-key-store').saveRawEnv` call site keeps working. No load-time cycle:
// env-raw-store requires THIS module only lazily, inside its functions.
// Issue 212's test-run write guard and the blank-secret predicate live in
// env-raw-store.js too, beside upsertEnvLine/deleteEnvLine — the chokepoint every
// .env writer funnels through (council review of PR 262, A2/D4). Re-exported
// below so `require('./api-key-store').isTestWriteToRealKeyStore` keeps working.
const {
  saveRawEnv, removeRawEnv, upsertEnvLine, deleteEnvLine,
  isBlankSecret, isTestWriteToRealKeyStore, assertNotTestWriteToRealKeyStore,
} = require('./env-raw-store');

/** Legacy key names that have been renamed (old -> new) */
const LEGACY_KEY_NAMES = {
  'GEMINI_API_KEY': 'GOOGLE_GENERATIVE_AI_API_KEY'
};

/** Get the path to the .env file */
function getEnvPath() {
  const envDir = process.env.AMICUS_ENV_DIR;
  if (envDir) {
    const resolved = path.resolve(envDir);
    if (resolved.includes('\0')) {
      throw new Error('Invalid ENV_DIR: null bytes not allowed');
    }
    return path.join(resolved, '.env');
  }
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  return path.join(homeDir, '.config', 'amicus', '.env');
}

/** Parse a .env file into a key-value map (comments/blanks excluded) */
function parseEnvContent(content) {
  const entries = new Map();
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, eqIndex);
    const value = trimmed.slice(eqIndex + 1);
    entries.set(key, value);
  }
  return entries;
}

/**
 * Migrate a legacy key name in a .env file (best-effort, one-time).
 *
 * ⚠️ This writes with fs.writeFileSync and does NOT go through
 * upsertEnvLine/deleteEnvLine, so the chokepoint guard does not reach it — it
 * asserts for itself (issue 212 / council review of PR 262, A2/D4). The throw
 * lands in this function's own best-effort catch, so a refused migration is a
 * SKIPPED migration: inside a test run against the real store, not rewriting it
 * is the outcome we want, and the read path above still serves the legacy value.
 * @param {string} envPath
 * @param {string} oldName
 * @param {string} newName
 * @param {object} [deps] see isTestWriteToRealKeyStore
 */
function migrateEnvFileKey(envPath, oldName, newName, deps) {
  try {
    assertNotTestWriteToRealKeyStore(envPath, deps);
    const content = fs.readFileSync(envPath, 'utf-8');
    const re = new RegExp(`^${oldName}=`, 'm');
    const updated = content.replace(re, `${newName}=`);
    if (updated !== content) {
      fs.writeFileSync(envPath, updated, { mode: 0o600 });
      // Re-assert 0600 on the existing secrets file (writeFileSync mode is create-only).
      try { fs.chmodSync(envPath, 0o600); } catch (_err) { /* perms best-effort */ }
    }
  } catch (_err) {
    // Best effort
  }
}

/**
 * Load .env file entries (auto-migrates legacy key names).
 * @param {object} [deps] forwarded to the migration's issue-212 write guard
 */
function loadEnvEntries(deps) {
  const envPath = getEnvPath();
  let fileEntries = new Map();
  try {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      fileEntries = parseEnvContent(content);
      // Auto-migrate legacy key names
      for (const [oldName, newName] of Object.entries(LEGACY_KEY_NAMES)) {
        if (fileEntries.has(oldName) && !fileEntries.has(newName)) {
          fileEntries.set(newName, fileEntries.get(oldName));
          fileEntries.delete(oldName);
          migrateEnvFileKey(envPath, oldName, newName, deps);
        }
      }
    }
  } catch (_err) {
    // Ignore read errors
  }
  return fileEntries;
}

/** Resolve key value: file entry takes precedence over process.env */
function resolveKeyValue(fileEntries, envVar) {
  const fromFile = fileEntries.get(envVar);
  if (fromFile && fromFile.length > 0) { return fromFile; }
  const fromEnv = process.env[envVar];
  if (fromEnv && fromEnv.length > 0) { return fromEnv; }
  return '';
}

/**
 * Read API key availability from .env file and process.env
 * @returns {{openrouter: boolean, google: boolean, openai: boolean, anthropic: boolean, deepseek: boolean}}
 */
function readApiKeys() {
  const result = { openrouter: false, google: false, openai: false, anthropic: false, deepseek: false };
  const entries = loadEnvEntries();
  for (const [provider, envVar] of Object.entries(PROVIDER_ENV_MAP)) {
    if (resolveKeyValue(entries, envVar)) { result[provider] = true; }
  }
  return result;
}

/**
 * Read API key hints (masked prefixes) for UI display
 * @returns {{openrouter: string|false, google: string|false, openai: string|false, anthropic: string|false, deepseek: string|false}}
 */
function readApiKeyHints() {
  const result = { openrouter: false, google: false, openai: false, anthropic: false, deepseek: false };
  const entries = loadEnvEntries();
  for (const [provider, envVar] of Object.entries(PROVIDER_ENV_MAP)) {
    const key = resolveKeyValue(entries, envVar);
    if (key) {
      const visible = key.slice(0, 8);
      result[provider] = visible + '\u2022'.repeat(Math.max(0, Math.min(key.length - 8, 12)));
    }
  }
  return result;
}

/**
 * Read actual API key strings for configured providers.
 * Used by model-fetcher to authenticate against provider APIs.
 * @returns {Object<string, string>} Map of provider → key string (only set providers)
 */
function readApiKeyValues() {
  const result = {};
  const entries = loadEnvEntries();
  for (const [provider, envVar] of Object.entries(PROVIDER_ENV_MAP)) {
    const value = resolveKeyValue(entries, envVar);
    if (value) { result[provider] = value; }
  }
  return result;
}

/**
 * Save an API key for a provider to the .env file
 * @param {string} provider
 * @param {string} key
 * @param {object} [deps] injected for tests — see isTestWriteToRealKeyStore
 */
function saveApiKey(provider, key, deps) {
  const envVar = PROVIDER_ENV_MAP[provider];
  if (!envVar) {
    return { success: false, error: `Unknown provider: ${provider}` };
  }
  // Council #262 r1 (C1/D1/B4): an empty-after-trim key is a WIPE, not a save —
  // upsertEnvLine rewrites the stored `<ENVVAR>=<real key>` line with a blank
  // value and reports success. Refused at the FUNCTION boundary, not only in the
  // callers, so `amicus key <provider> "   "`, the save-key IPC and every future
  // caller are covered by one check. (The issue-212 test-run guard lives one
  // level down, in upsertEnvLine.)
  if (isBlankSecret(key)) {
    return { success: false, error: 'API key is required' };
  }
  // Shared merge helper (preserves comments/other lines, dedups, 0600, trailing NL;
  // strips CR/LF and returns the cleaned value). It carries issue 212's test-run
  // write guard, which THROWS before any write.
  const clean = upsertEnvLine(getEnvPath(), envVar, key, deps);
  // Also set process.env so the key is immediately available (sanitized to match disk)
  process.env[envVar] = clean;
  return { success: true };
}

/**
 * Remove an API key for a provider from the .env file
 * @param {string} provider
 * @param {object} [deps] injected for tests — see isTestWriteToRealKeyStore
 */
function removeApiKey(provider, deps) {
  const envVar = PROVIDER_ENV_MAP[provider];
  if (!envVar) {
    return { success: false, error: `Unknown provider: ${provider}` };
  }

  // Shared merge helper (no-op when the file is absent; preserves other lines,
  // 0600). Carries issue 212's test-run write guard, which THROWS before any write.
  deleteEnvLine(getEnvPath(), envVar, deps);
  delete process.env[envVar];

  // Check if key also exists in auth.json (caller decides whether to clean)
  const { checkAuthJson } = require('./auth-json');
  return { success: true, alsoInAuthJson: checkAuthJson(provider) };
}

module.exports = {
  getEnvPath,
  isTestWriteToRealKeyStore,
  loadEnvEntries,
  readApiKeys,
  readApiKeyHints,
  readApiKeyValues,
  saveApiKey,
  removeApiKey,
  saveRawEnv,
  removeRawEnv,
  validateApiKey,
  validateOpenRouterKey,
  PROVIDER_ENV_MAP,
  LEGACY_KEY_NAMES,
  VALIDATION_ENDPOINTS
};

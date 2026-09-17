/**
 * API Key Store — reading, saving, and validating API keys.
 * Keys stored in ~/.config/amicus/.env with 0o600 permissions.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { validateApiKey, validateOpenRouterKey, VALIDATION_ENDPOINTS } = require('./api-key-validation');
const { PROVIDER_ENV_MAP } = require('./provider-registry');
// v4.2 (B2/D3): the .env line-merge logic lives once in env-raw-store.js. saveApiKey/
// removeApiKey below reuse it via upsertEnvLine/deleteEnvLine; saveRawEnv/removeRawEnv
// (arbitrary-name local-provider bearer writes) are re-exported so every documented
// `require('./api-key-store').saveRawEnv` call site keeps working. No load-time cycle:
// env-raw-store requires THIS module only lazily, inside its functions.
const { saveRawEnv, removeRawEnv, upsertEnvLine, deleteEnvLine } = require('./env-raw-store');

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

/**
 * The REAL user's home, immune to a redirected HOME/USERPROFILE.
 *
 * ⚠️ NOT os.homedir(): libuv reads HOME (POSIX) / USERPROFILE (Windows) before
 * it asks the OS, so os.homedir() follows exactly the redirect a test performs
 * — measured, both platforms' code paths. os.userInfo() reads the account
 * record instead (getpwuid_r / GetUserProfileDirectoryW) and does not move.
 * Returns null when there is no account record to read (containers without a
 * passwd entry); the caller then declines to guard rather than guessing, since
 * this is a backstop and a false refusal would break honest writes.
 * @returns {string|null}
 */
function realHomedir() {
  try {
    const home = os.userInfo().homedir;
    return typeof home === 'string' && home.length > 0 ? home : null;
  } catch (_err) {
    return null;
  }
}

/** True when `child` is `parent` or lives inside it (case/separator-normalised). */
function isWithin(child, parent) {
  const rel = path.relative(parent, child);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Would this write land in the REAL user's amicus key store from inside a
 * test run? Issue #212: a fixture-shaped key reached a real
 * ~/.config/amicus/.env, and "a test suite should never be ABLE to write a
 * real key store" is half the ask (the other half is the save-key IPC gate in
 * electron/ipc-keys.js). Converting invisible credential data loss into a loud
 * throw is the whole point, so this is deliberately narrow — it must never
 * refuse an honest write.
 *
 * Three conditions, all required:
 *   1. inside jest (JEST_WORKER_ID);
 *   2. AMICUS_ENV_DIR unset — tests/setup/hermetic-config-dir.js sets it for
 *      every unit file, so the guard only has work to do where a test DELETED
 *      it (several in tests/api-key-store.test.js do, to exercise the HOME
 *      fallback) and then reached a write;
 *   3. the resolved path is in the real home's `.config/amicus` directory.
 *
 * ⚠️ Condition 3 is the amicus CONFIG DIR, not the home dir. On Windows
 * os.tmpdir() is C:\Users\<user>\AppData\Local\Temp — inside the real home —
 * so "is it under the home dir" would refuse every legitimately
 * HOME-redirected test on that platform. Measured, not assumed.
 *
 * @param {string} envPath the .env path the write would target
 * @param {object} [deps] injected for tests — never touch the real home in one
 * @param {object} [deps.env] environment to read (default process.env)
 * @param {function(): (string|null)} [deps.homedir] the real home (default realHomedir)
 * @returns {boolean}
 */
function isTestWriteToRealKeyStore(envPath, { env = process.env, homedir = realHomedir } = {}) {
  if (!env.JEST_WORKER_ID) { return false; }
  if (env.AMICUS_ENV_DIR) { return false; }
  const home = homedir();
  if (!home) { return false; }
  return isWithin(path.resolve(envPath), path.join(home, '.config', 'amicus'));
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

/** Migrate a legacy key name in a .env file (best-effort, one-time) */
function migrateEnvFileKey(envPath, oldName, newName) {
  try {
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

/** Load .env file entries (auto-migrates legacy key names) */
function loadEnvEntries() {
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
          migrateEnvFileKey(envPath, oldName, newName);
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
  const envPath = getEnvPath();
  // #212: never write the real key store from inside a test run. THROWS rather
  // than returning { success: false } on purpose — the failure this replaces
  // was a silent overwrite of a user credential that masqueraded as a missing
  // product feature for an unknown period.
  if (isTestWriteToRealKeyStore(envPath, deps)) {
    const err = new Error(
      `Refusing to write the real API key store from a test run: ${envPath}. `
      + 'Set AMICUS_ENV_DIR to a temp dir (tests/setup/hermetic-config-dir.js does '
      + 'this for every unit file) before calling saveApiKey. See issue #212.'
    );
    err.code = 'TEST_ENV_WRITE_REFUSED';
    throw err;
  }
  // Shared merge helper (preserves comments/other lines, dedups, 0600, trailing NL;
  // strips CR/LF and returns the cleaned value).
  const clean = upsertEnvLine(envPath, envVar, key);
  // Also set process.env so the key is immediately available (sanitized to match disk)
  process.env[envVar] = clean;
  return { success: true };
}

/** Remove an API key for a provider from the .env file */
function removeApiKey(provider) {
  const envVar = PROVIDER_ENV_MAP[provider];
  if (!envVar) {
    return { success: false, error: `Unknown provider: ${provider}` };
  }

  // Shared merge helper (no-op when the file is absent; preserves other lines, 0600).
  deleteEnvLine(getEnvPath(), envVar);
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

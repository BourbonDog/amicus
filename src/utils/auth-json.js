/**
 * Auth JSON Reader
 *
 * Read-only interface to OpenCode's auth.json (~/.local/share/opencode/auth.json).
 * Used for one-time key import into sidecar's .env and optional cleanup on delete.
 * Sidecar never writes keys TO auth.json -- only reads and optionally removes.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { logger } = require('./logger');

/**
 * Ordered, de-duplicated candidate locations for OpenCode's auth.json, most
 * specific first. OpenCode uses XDG-style data dirs; on Windows it still writes
 * to ~/.local/share/opencode (verified), so that path stays FIRST after XDG.
 * Mirrors the cross-platform precedence pattern in src/sidecar/electron-cache.js.
 * @param {NodeJS.ProcessEnv} [env] - Environment (injectable for tests)
 * @returns {string[]}
 */
function authJsonCandidates(env = process.env) {
  const home = os.homedir();
  const candidates = [];
  if (env.XDG_DATA_HOME) { candidates.push(path.join(env.XDG_DATA_HOME, 'opencode', 'auth.json')); }
  candidates.push(path.join(home, '.local', 'share', 'opencode', 'auth.json'));
  if (process.platform === 'win32') {
    const appData = env.APPDATA || path.join(home, 'AppData', 'Roaming');
    candidates.push(path.join(appData, 'opencode', 'auth.json'));
  }
  return [...new Set(candidates)];
}

/**
 * Resolve the auth.json path to use: first existing candidate, else the primary
 * (~/.local/share) path so callers/writers have a stable default.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
function resolveAuthJsonPath(env = process.env) {
  const candidates = authJsonCandidates(env);
  for (const c of candidates) {
    if (fs.existsSync(c)) { return c; }
  }
  const localShare = path.join('.local', 'share');
  return candidates.find((c) => c.includes(localShare)) || candidates[0];
}

// Backward-compat export: the resolved path at module load time.
const AUTH_JSON_PATH = resolveAuthJsonPath();

/** Known provider IDs that map to sidecar's PROVIDER_ENV_MAP */
const KNOWN_PROVIDERS = ['openrouter', 'google', 'openai', 'anthropic', 'deepseek'];

/**
 * Extract key value from an auth.json provider entry.
 * Checks both .key and .apiKey fields (OpenCode uses both formats).
 * @param {object} entry - Provider entry from auth.json
 * @returns {string|undefined} Key string, or undefined if not found
 */
function extractKey(entry) {
  if (!entry || typeof entry !== 'object') { return undefined; }
  const fromKey = entry.key;
  if (typeof fromKey === 'string' && fromKey.length > 0) { return fromKey; }
  const fromApiKey = entry.apiKey;
  if (typeof fromApiKey === 'string' && fromApiKey.length > 0) { return fromApiKey; }
  return undefined;
}

/**
 * Read and parse auth.json into a normalized provider-key map.
 * Only returns keys for known providers (openrouter, google, openai, anthropic, deepseek).
 * @returns {Object<string, string>} Map of provider -> key string (only providers with keys)
 */
function readAuthJsonKeys() {
  const authPath = resolveAuthJsonPath();
  if (!fs.existsSync(authPath)) { return {}; }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
  } catch (_err) {
    logger.debug('auth.json is malformed, skipping import');
    return {};
  }
  if (!parsed || typeof parsed !== 'object') { return {}; }

  const result = {};
  for (const provider of KNOWN_PROVIDERS) {
    const key = extractKey(parsed[provider]);
    if (key) { result[provider] = key; }
  }
  return result;
}

/**
 * Find keys in auth.json that are not already in sidecar's .env.
 * @param {Object<string, boolean>} existingKeys - Which providers already have keys in sidecar
 * @returns {{ imported: Array<{provider: string, key: string}> }}
 */
function importFromAuthJson(existingKeys) {
  const authKeys = readAuthJsonKeys();
  const imported = [];
  for (const [provider, key] of Object.entries(authKeys)) {
    if (!existingKeys[provider]) {
      imported.push({ provider, key });
    }
  }
  return { imported };
}

/**
 * Check if a provider has a key in auth.json.
 * @param {string} provider - Provider ID
 * @returns {boolean}
 */
function checkAuthJson(provider) {
  if (!KNOWN_PROVIDERS.includes(provider)) { return false; }
  const keys = readAuthJsonKeys();
  return !!keys[provider];
}

/**
 * Remove a provider entry from auth.json.
 * Best-effort: does not throw on errors.
 * @param {string} provider - Provider ID to remove
 */
function removeFromAuthJson(provider) {
  try {
    const authPath = resolveAuthJsonPath();
    if (!fs.existsSync(authPath)) { return; }
    const parsed = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
    if (!parsed[provider]) { return; }
    delete parsed[provider];
    fs.writeFileSync(authPath, JSON.stringify(parsed, null, 2), 'utf-8');
  } catch (_err) {
    logger.debug('Failed to remove provider from auth.json', { provider });
  }
}

module.exports = {
  readAuthJsonKeys,
  importFromAuthJson,
  checkAuthJson,
  removeFromAuthJson,
  AUTH_JSON_PATH,
  KNOWN_PROVIDERS,
  resolveAuthJsonPath,
  authJsonCandidates
};

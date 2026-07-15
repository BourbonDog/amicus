/**
 * Route-launch views (#61 gateway routing integration, Task 4.2).
 *
 * Additive, read-only helpers consumed by Task 4.4's resolveRouteForLaunch
 * (not wired into any launch path yet). Pure-ish: all I/O goes through the
 * stubbable api-key-store / auth-json / model-catalog modules.
 */
'use strict';

const { readApiKeys } = require('./api-key-store');
const { readAuthJsonKeys } = require('./auth-json');
const { KNOWN_PROVIDERS } = require('./provider-registry');

/**
 * Per-provider key presence across BOTH sources: env/.env (readApiKeys) and
 * OpenCode's auth.json (readAuthJsonKeys). True if either source has a key
 * for that provider (Foundation carry-forward, Decision 5).
 * @returns {Object<string,boolean>} map of provider id -> key present
 */
function buildLaunchKeys() {
  const env = readApiKeys(); // {openrouter:bool, google:bool, openai:bool, anthropic:bool, deepseek:bool}
  const authKeys = readAuthJsonKeys(); // {provider:string,...} (only providers with keys)
  const out = {};
  for (const p of KNOWN_PROVIDERS) {
    out[p] = !!env[p] || !!authKeys[p];
  }
  return out;
}

/**
 * Thin wrapper over model-catalog.getCatalogInfo() for route-resolution
 * callers that only need the models list and the last-refresh error, not the
 * full cache metadata. Never throws: a catalog error resolves to an empty
 * list with a sentinel error string.
 * @returns {Promise<{models: Array, lastRefreshError: string|null}>}
 */
async function getRouteCatalogInfo() {
  // Lazy-required so jest.doMock('./model-catalog', ...) can intercept it
  // per-test, matching the pattern model-catalog.js itself uses for its deps.
  const { getCatalogInfo } = require('./model-catalog');
  try {
    const info = await getCatalogInfo();
    return { models: info.models || [], lastRefreshError: info.lastRefreshError || null };
  } catch {
    return { models: [], lastRefreshError: 'catalog-unavailable' };
  }
}

module.exports = { buildLaunchKeys, getRouteCatalogInfo };

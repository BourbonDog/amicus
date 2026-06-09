/**
 * OpenRouter model catalog cache (F3 #18 / F5 foundation).
 *
 * Caches the combined provider model list to ~/.config/amicus/model-catalog.json
 * with a TTL so model validation doesn't hit the network on every launch.
 * Degrades gracefully: a failed/empty refresh falls back to stale cache, and
 * callers treat an empty catalog as "cannot validate" (never block a launch).
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Lazy-load these so jest.doMock() in tests can intercept them after
// this module is first required (the test pattern re-mocks mid-test).
function _getConfigDir() { return require('./config').getConfigDir(); }
function _readApiKeyValues() { return require('./api-key-store').readApiKeyValues(); }
async function _fetchAllModels(keys) { return require('./model-fetcher').fetchAllModels(keys); }

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

/** @returns {string} Absolute path to the catalog cache file */
function catalogPath() {
  return path.join(_getConfigDir(), 'model-catalog.json');
}

/** @returns {{fetchedAt: number, models: Array}|null} */
function readCache() {
  try {
    const raw = fs.readFileSync(catalogPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.models)) { return parsed; }
  } catch { /* missing/corrupt */ }
  return null;
}

/** Write the cache. Best-effort; never throws. @param {Array} models */
function writeCache(models) {
  try {
    fs.mkdirSync(_getConfigDir(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(catalogPath(), JSON.stringify({ fetchedAt: Date.now(), models }, null, 2), { mode: 0o600 });
  } catch { /* best-effort */ }
}

/**
 * Force a refresh from the provider APIs and update the cache.
 * @returns {Promise<Array<{id,name}>>} the fetched models (may be [] offline)
 */
async function refreshCatalog() {
  const keys = _readApiKeyValues();
  const models = await _fetchAllModels(keys);
  if (models && models.length > 0) { writeCache(models); }
  return models || [];
}

/**
 * Get the catalog, refreshing if the cache is missing or older than maxAgeMs.
 * Graceful: on an empty refresh, returns stale cache if present, else [].
 * @param {{maxAgeMs?: number}} [opts]
 * @returns {Promise<Array<{id,name}>>}
 */
async function getCatalog(opts = {}) {
  const maxAgeMs = opts.maxAgeMs === undefined ? DEFAULT_MAX_AGE_MS : opts.maxAgeMs;
  const cache = readCache();
  // A future fetchedAt (clock skew / hand-edited file) reads as indefinitely
  // fresh; acceptable for a model catalog.
  const fresh = cache && (Date.now() - cache.fetchedAt) <= maxAgeMs;
  if (fresh) { return cache.models; }

  const refreshed = await refreshCatalog();
  if (refreshed.length > 0) { return refreshed; }
  return cache ? cache.models : []; // stale fallback / empty
}

module.exports = { getCatalog, refreshCatalog, catalogPath };

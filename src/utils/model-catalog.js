/**
 * OpenRouter model catalog cache (F3 #18 / F5 foundation).
 *
 * Caches the combined provider model list to ~/.config/amicus/model-catalog.json
 * with a TTL so model validation doesn't hit the network on every launch.
 * Schema v2: enriched rows ({id, name, contextLength, pricing}) written at every
 * refresh; v1 caches (no schemaVersion) are treated as stale and refreshed, but
 * remain usable as a graceful-degradation fallback when the refresh returns empty.
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
const CATALOG_SCHEMA_VERSION = 2;

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

/** Write the cache atomically (tmp+rename). Best-effort; never throws. @param {Array} models */
function writeCache(models) {
  const target = catalogPath();
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(_getConfigDir(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(tmp, JSON.stringify({ schemaVersion: CATALOG_SCHEMA_VERSION, fetchedAt: Date.now(), models }, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, target);
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* best-effort */ }
  }
}

/**
 * Force a refresh from the provider APIs and update the cache.
 * @returns {Promise<Array<{id,name}>>} the fetched models (may be [] offline)
 */
async function refreshCatalog() {
  const keys = _readApiKeyValues();
  const models = await _fetchAllModels(keys);
  // The anthropic rows are a hardcoded zero-network floor: a result containing
  // ONLY them means every network provider failed. Treat that as a failed
  // refresh — never clobber a previously-good cache with the floor (the
  // "stale cache stands" contract).
  const networkRows = (models || []).filter(m => m && typeof m.id === 'string' && !m.id.startsWith('anthropic/'));
  if (networkRows.length === 0) { return []; }
  writeCache(models);
  return models;
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
  // fresh; acceptable for a model catalog. v1 caches (no schemaVersion) always
  // read as stale so they get refreshed to v2 on next access.
  const fresh = cache && cache.schemaVersion === CATALOG_SCHEMA_VERSION &&
    (Date.now() - cache.fetchedAt) <= maxAgeMs;
  if (fresh) { return cache.models; }

  const refreshed = await refreshCatalog();
  if (refreshed.length > 0) { return refreshed; }
  return cache ? cache.models : []; // stale fallback / empty
}

/**
 * Catalog rows plus cache timestamp (for UI display).
 * @returns {Promise<{models: Array, fetchedAt: number|null}>}
 */
async function getCatalogInfo(opts = {}) {
  const models = await getCatalog(opts);
  const cache = readCache();
  return { models, fetchedAt: cache ? cache.fetchedAt : null };
}

module.exports = { getCatalog, refreshCatalog, catalogPath, getCatalogInfo, readCache, CATALOG_SCHEMA_VERSION };

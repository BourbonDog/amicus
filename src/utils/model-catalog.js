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
async function _fetchAllModels(keys) { return require('./model-fetcher').fetchAllModelsDetailed(keys); }
async function _enrichCeilings(rows) { return require('./model-ceilings-modelsdev').enrichCeilings(rows); }

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

/**
 * Raw cache-doc read for refresh-outcome fields only (#13). Unlike readCache(),
 * this does NOT require a `models` array — a fresh machine whose first refresh
 * attempt failed writes a doc with only {lastRefreshAttempt, lastRefreshError}
 * and no models/fetchedAt, and that outcome still needs to be readable.
 * @returns {{lastRefreshAttempt?: number, lastRefreshError?: string}|null}
 */
function readCacheDocLoose() {
  try {
    const raw = fs.readFileSync(catalogPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') { return parsed; }
  } catch { /* missing/corrupt */ }
  return null;
}

/** Write the cache atomically (tmp+rename). Best-effort; never throws. @param {object} doc full cache document */
function writeCacheDoc(doc) {
  const target = catalogPath();
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(_getConfigDir(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, target);
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* best-effort */ }
  }
}

/**
 * Write a successful fetch: fresh models/fetchedAt, outcome fields cleared.
 * @param {Array} models
 * @param {Array} [providerFailures]
 * @param {object|null} [ceilingEnrichment] #218 P3 outcome for THESE rows (model-ceilings-modelsdev.js)
 */
function writeCache(models, providerFailures, ceilingEnrichment) {
  writeCacheDoc({
    schemaVersion: CATALOG_SCHEMA_VERSION,
    fetchedAt: Date.now(),
    models,
    // #209: which providers were ATTEMPTED and REJECTED for this fetch. Persisted
    // alongside the rows because it describes THESE rows -- a cache served later
    // is still a catalog whose deepseek namespace is empty for a reason.
    providerFailures: Array.isArray(providerFailures) ? providerFailures : [],
    ceilingEnrichment: ceilingEnrichment || null,
  });
}

/**
 * Record a failed refresh attempt (#13): stamps lastRefreshAttempt/lastRefreshError
 * onto the existing cache document WITHOUT touching models/fetchedAt — the good
 * data (if any) stays byte-authoritative. With no prior cache, writes a doc that
 * carries only the outcome fields (no models/fetchedAt to report).
 * @param {string} reason short error-class string
 */
function writeRefreshFailure(reason, providerFailures) {
  const existing = readCache() || { schemaVersion: CATALOG_SCHEMA_VERSION };
  const doc = { ...existing, lastRefreshAttempt: Date.now(), lastRefreshError: reason };
  // Council C1 (PR 215): a TOTAL outage is exactly when the per-provider
  // breakdown matters most, and this path used to discard the failures the
  // refresh had just computed. Only overwrite when this attempt produced some --
  // an attempt that learned nothing must not erase a previous attempt's detail.
  if (Array.isArray(providerFailures) && providerFailures.length > 0) {
    doc.providerFailures = providerFailures;
  }
  writeCacheDoc(doc);
}

/**
 * Force a refresh from the provider APIs and update the cache.
 * @returns {Promise<Array<{id,name}>>} the fetched models (may be [] offline)
 */
async function refreshCatalog() {
  const keys = _readApiKeyValues();
  const { rows: models, failures: providerFailures } = await _fetchAllModels(keys);
  // The anthropic rows are a hardcoded zero-network floor: a result containing
  // ONLY them means every network provider failed. Treat that as a failed
  // refresh — never clobber a previously-good cache with the floor (the
  // "stale cache stands" contract). v4.2 §4.4: local rows (local:true) are
  // ALSO excluded here — a localhost-only refresh (offline except loopback)
  // must not be counted as a successful network refresh, or it would clobber
  // a previously-good OpenRouter cache with a local-only catalog.
  const networkRows = (models || []).filter(m =>
    m && typeof m.id === 'string' && !m.id.startsWith('anthropic/') && m.local !== true);
  if (networkRows.length === 0) {
    const reason = (models || []).length > 0
      ? 'floor-only: all providers returned no network rows'
      : 'network-error: all providers unreachable';
    writeRefreshFailure(reason, providerFailures);
    return [];
  }
  // #218 P3: fill direct-provider ceilings from models.dev AFTER the floor-only
  // check (a failed refresh is never enriched, so "stale cache stands" holds)
  // and IN PLACE on the fresh row objects, so `authoritative`/`local` ride
  // through untouched. enrichCeilings never rejects; the belt-and-braces catch
  // keeps a bug there from failing a refresh that already succeeded.
  let ceilingEnrichment;
  try {
    ceilingEnrichment = await _enrichCeilings(models);
  } catch (err) {
    ceilingEnrichment = { source: 'models.dev', failure: { reason: 'exception', detail: err.message }, filled: 0 };
  }
  writeCache(models, providerFailures, ceilingEnrichment);
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
 * #13: also threads the last-refresh outcome so callers can tell "current"
 * apart from "stale because refreshing keeps failing" — null/null when the
 * last attempt on record succeeded (or none has happened yet).
 * @returns {Promise<{models: Array, fetchedAt: number|null, lastRefreshAttempt: number|null, lastRefreshError: string|null, providerFailures: Array, ceilingEnrichment: object|null}>}
 */
async function getCatalogInfo(opts = {}) {
  const models = await getCatalog(opts);
  const cache = readCache();
  const doc = readCacheDocLoose(); // outcome fields survive even a models-less doc
  return {
    models,
    fetchedAt: cache ? cache.fetchedAt : null,
    lastRefreshAttempt: (doc && doc.lastRefreshAttempt) || null,
    lastRefreshError: (doc && doc.lastRefreshError) || null,
    // #209: namespace-level fetch outcomes for the CACHED rows above.
    providerFailures: (doc && Array.isArray(doc.providerFailures)) ? doc.providerFailures : [],
    // #218 P3: where the direct-provider ceilings came from, or why they did not.
    ceilingEnrichment: (doc && doc.ceilingEnrichment) || null,
  };
}

module.exports = { getCatalog, refreshCatalog, catalogPath, getCatalogInfo, readCache, CATALOG_SCHEMA_VERSION, DEFAULT_MAX_AGE_MS };

/**
 * @module utils/alias-store
 * The write sinks the alias review flow needs beyond `setup.js :: addAlias`
 * (#238 §2). Every write is read-modify-write through `saveConfig` (which
 * normalizes, D6) and preserves every other key — the no-clobber contract of
 * `provider-default-picker.js :: applyProviderDefault`.
 *
 * `removeAlias` is BOTH "unpin" (a curated name resurrects from the defaults)
 * and "delete" (a user-invented name is gone) — the meaning is decided by
 * whether the name is curated, not by this module (D1).
 *
 * Dismissals are keyed `alias@proposedId` (Q5): permanent for that pair, and a
 * newer proposed id for the same alias is a new key that asks again.
 */

'use strict';

const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/**
 * @param {string} alias
 * @returns {boolean} true when a key was removed and the config saved
 */
function removeAlias(alias) {
  if (typeof alias === 'string') { alias = alias.trim(); }
  if (!alias || typeof alias !== 'string' || alias === 'null') {
    throw new Error(`Invalid alias name: '${alias}'. Alias name must be a non-empty string.`);
  }
  const { loadConfig, saveConfig } = require('./config');
  const config = loadConfig();
  if (!config || !config.aliases || typeof config.aliases !== 'object' || !own(config.aliases, alias)) { return false; }
  delete config.aliases[alias];
  saveConfig(config);
  return true;
}

/** @returns {Object<string,string>} null-prototype copy of aliasReview.dismissed */
function readDismissals() {
  const { loadConfig } = require('./config');
  const config = loadConfig();
  const out = { __proto__: null };
  const d = config && config.aliasReview && typeof config.aliasReview === 'object' ? config.aliasReview.dismissed : null;
  if (d && typeof d === 'object') {
    for (const [k, v] of Object.entries(d)) { if (typeof v === 'string') { out[k] = v; } }
  }
  return out;
}

/**
 * @param {string} dismissKey `alias@proposedId`
 * @param {Date} [now]
 */
function recordDismissal(dismissKey, now = new Date()) {
  if (typeof dismissKey !== 'string' || !dismissKey || !dismissKey.includes('@')) {
    throw new Error(`Invalid dismissKey '${dismissKey}': expected alias@proposedId`);
  }
  const { loadConfig, saveConfig } = require('./config');
  const config = loadConfig() || {};
  if (!config.aliasReview || typeof config.aliasReview !== 'object') { config.aliasReview = {}; }
  if (!config.aliasReview.dismissed || typeof config.aliasReview.dismissed !== 'object') { config.aliasReview.dismissed = {}; }
  config.aliasReview.dismissed[dismissKey] = now.toISOString();
  saveConfig(config);
}

module.exports = { removeAlias, readDismissals, recordDismissal };

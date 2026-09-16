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
 * `stampDismissal` is the PURE half of `recordDismissal` — it validates the
 * key and stamps it into a config object it is handed — so a caller already
 * holding a config it is about to save (the wizard's Finish,
 * electron/ipc-aliases.js :: applyDismissals) can fold dismissals into that
 * same save instead of a second read-modify-write after it.
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
 * Stamp one dismissal into `config` (no I/O): validates the key, ensures
 * `aliasReview.dismissed`, writes the ISO time. Throws BEFORE touching the
 * object on a malformed key, so a caller can reject a whole batch untouched.
 * @param {object} config the config object to stamp (mutated and returned)
 * @param {string} dismissKey `alias@proposedId`
 * @param {Date} [now]
 * @returns {object} the same `config`
 * @throws {Error} `Invalid dismissKey …` when the key is not `alias@proposedId`
 */
function stampDismissal(config, dismissKey, now = new Date()) {
  if (typeof dismissKey !== 'string' || !dismissKey || !dismissKey.includes('@')) {
    throw new Error(`Invalid dismissKey '${dismissKey}': expected alias@proposedId`);
  }
  if (!config.aliasReview || typeof config.aliasReview !== 'object') { config.aliasReview = {}; }
  if (!config.aliasReview.dismissed || typeof config.aliasReview.dismissed !== 'object') { config.aliasReview.dismissed = {}; }
  config.aliasReview.dismissed[dismissKey] = now.toISOString();
  return config;
}

/**
 * Read-modify-write of one dismissal: `stampDismissal` over the loaded config.
 * @param {string} dismissKey `alias@proposedId`
 * @param {Date} [now]
 */
function recordDismissal(dismissKey, now = new Date()) {
  const { loadConfig, saveConfig } = require('./config');
  saveConfig(stampDismissal(loadConfig() || {}, dismissKey, now));
}

module.exports = { removeAlias, readDismissals, stampDismissal, recordDismissal };

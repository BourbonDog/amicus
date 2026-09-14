/**
 * @module utils/alias-state
 * Following-vs-pinned state for model aliases (#238 D1) and the normalization
 * that keeps config.json truthful (D6).
 *
 * A curated alias FOLLOWS the shipped pin when its name is ABSENT from
 * `config.aliases` — `config.js :: getEffectiveAliases` already merges
 * `{...DEFAULT_ALIASES, ...userAliases}`, so absence resolves to the shipped
 * id on every consumer. A present key is a PIN. Downgrade-safe in the narrow
 * sense: an older amicus reads a normalized config without error and
 * honours every present key (a pin) unchanged; the aliases that FOLLOW
 * resolve to that older binary's shipped pins — following means tracking
 * whichever binary runs.
 *
 * Normalization drops any key whose value equals the shipped default, with one
 * Notice per key. It runs inside `saveConfig` (so every write converges) and on
 * entry to `amicus aliases`. It is idempotent and never a startup write.
 *
 * Own keys only, everywhere: a `toString`/`constructor` name in a user
 * config is a plain custom alias, never a curated one; a `__proto__` key
 * gets no row at all — `saveConfig` can never persist it.
 */

'use strict';

const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/** @param {string} alias @param {object} defaults @returns {boolean} */
function isCurated(alias, defaults) {
  return !!defaults && typeof alias === 'string' && own(defaults, alias);
}

/**
 * @param {object} aliases user `config.aliases`
 * @param {object} defaults the shipped map (`DEFAULT_ALIASES`)
 * @param {(line: string) => void} [notify] one call per removed key
 * @returns {{aliases: object, removed: Array<{alias: string, id: string}>}}
 */
function normalizeAliases(aliases, defaults, notify) {
  // Null-prototype (not plain `{}`): `out['__proto__'] = value` on a plain
  // object hits the inherited accessor setter and is silently LOST -- the
  // same footgun `saveConfig`'s pre-existing stripper documents for `cleaned`.
  // Not reachable from `saveConfig` today (that stripper rejects `__proto__`
  // before this function ever sees it), but this module is also entered
  // directly from `amicus aliases` on raw config, so `out` must be safe on
  // its own. `JSON.stringify` serializes a null-prototype object's own keys
  // exactly like a plain one, so returning it as-is is safe for saveConfig.
  const out = { __proto__: null };
  const removed = [];
  if (!aliases || typeof aliases !== 'object') { return { aliases: out, removed }; }
  for (const [alias, value] of Object.entries(aliases)) {
    if (typeof value === 'string' && isCurated(alias, defaults) && defaults[alias] === value) {
      removed.push({ alias, id: value });
      if (typeof notify === 'function') {
        notify(`Notice: alias '${alias}' matches the shipped recommendation (${value}) — now following\n`);
      }
      continue;
    }
    out[alias] = value;
  }
  return { aliases: out, removed };
}

/**
 * @param {object|null} userAliases
 * @param {object} defaults
 * @returns {Array<{alias:string,id:string,state:'following'|'pinned',curated:boolean,shipped:string|null}>}
 */
function listAliasRows(userAliases, defaults) {
  const user = (userAliases && typeof userAliases === 'object') ? userAliases : {};
  const rows = [];
  for (const alias of Object.keys(defaults || {})) {
    const pinned = own(user, alias) && typeof user[alias] === 'string';
    rows.push({ alias, id: pinned ? user[alias] : defaults[alias], state: pinned ? 'pinned' : 'following',
      curated: true, shipped: defaults[alias] });
  }
  for (const alias of Object.keys(user)) {
    // #249 r1 R8b: '__proto__' can never be persisted (saveConfig's own
    // stripper rejects it, config.js :: saveConfig) -- a row for it here
    // would show state the user can never actually reach, so it gets no
    // row and no proposal.
    if (alias === '__proto__' || isCurated(alias, defaults) || typeof user[alias] !== 'string') { continue; }
    rows.push({ alias, id: user[alias], state: 'pinned', curated: false, shipped: null });
  }
  return rows;
}

module.exports = { normalizeAliases, listAliasRows, isCurated };

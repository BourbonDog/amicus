/**
 * @module utils/curated-pins
 * The shipped pin set (#238 D8) — `src/utils/curated-pins.json`: one entry per
 * curated alias (`pins`: per-gateway `routes`, the `verifiedOn` date, an
 * optional owner `ruling`, `gatewayOnly` where the openrouter-only route is a
 * deliberate choice), the aliases deliberately dropped (`retired`, with the
 * date and the ruling — neither the sibling scan nor the notable list can
 * resurrect one, and `amicus aliases` tells a user who still pins one what
 * happened), and the owner-curated `notable` list (D7's editorial half).
 * curated-models.js keeps the MATCH RULES and reads the pins from here;
 * `amicus aliases --review --owner` (sidecar/aliases-owner.js) writes here,
 * and `git diff` is the review surface — a pin reaches users only after a
 * human accepted it and committed the JSON.
 *
 * The shipped file is loaded with `require`, not `fs.readFileSync`, on
 * purpose: it is reached at LOAD time through config.js (DEFAULT_ALIASES is
 * computed at require), and 22 unit suites mock `fs` wholesale. MEASURED
 * 2026-09-14 on main @ cd6b8cfb: a `readFileSync` at curated-models load
 * reddened tests/headless-output-length.test.js (the mocked read threw inside
 * `require('./utils/config')`, headless.js swallowed it, the output budget
 * became undefined and a leg's error text changed); a `require` of the same
 * bytes passed every one of the 22. `require` rides the module loader's own
 * file access, immune to those mocks. It is also cached for the process —
 * fine, because the one writer (owner mode) keeps working from its own
 * in-memory document and never re-reads. An explicit `filePath` (tests, temp
 * copies) reads fresh through fs instead.
 *
 * Every read validates (`validateCuratedPins`, fail-closed: the first defect
 * is named) and returns a deep copy, so a caller mutating what it got back
 * can never leak into the next builder call.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/** @type {string} absolute path to the shipped curated-pins.json (T2's saveCuratedPins default; owner-mode messages). */
const CURATED_PINS_PATH = path.join(__dirname, 'curated-pins.json');
const SHIPPED = require('./curated-pins.json');
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PIN_KEYS = new Set(['routes', 'verifiedOn', 'ruling', 'gatewayOnly']);
const TOP_KEYS = new Set(['version', 'pins', 'retired', 'notable']);
const NOTABLE_KEYS = new Set(['id', 'suggestedAlias', 'note']);
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const fail = (msg) => { throw new Error(`curated-pins.json: ${msg}`); };

/** @param {*} name an alias or route key @param {string} where names the site for the message */
function checkName(name, where) {
  if (typeof name !== 'string' || name.length === 0 || name.trim() !== name
      || name === '__proto__' || name === 'constructor' || name === 'prototype') {
    fail(`${where}: '${name}' is not a valid name`);
  }
}

/** @param {string} id @param {string} provider @returns {boolean} true when `id` is `<provider>/<something>` */
function inNamespace(id, provider) {
  return typeof id === 'string' && id.startsWith(`${provider}/`) && id.length > provider.length + 1;
}

function validatePin(alias, pin) {
  checkName(alias, 'pins');
  if (!isPlainObject(pin)) { fail(`pin '${alias}' is not an object`); }
  for (const k of Object.keys(pin)) { if (!PIN_KEYS.has(k)) { fail(`pin '${alias}' has an unknown field '${k}'`); } }
  if (!isPlainObject(pin.routes) || Object.keys(pin.routes).length === 0) { fail(`pin '${alias}' has no routes`); }
  if (!own(pin.routes, 'openrouter')) { fail(`pin '${alias}' has no openrouter route`); }
  for (const [provider, id] of Object.entries(pin.routes)) {
    checkName(provider, `pin '${alias}' routes`);
    if (!inNamespace(id, provider)) { fail(`pin '${alias}' route '${provider}' must be a '${provider}/…' id (got ${JSON.stringify(id)})`); }
  }
  if (typeof pin.verifiedOn !== 'string' || !DATE_RE.test(pin.verifiedOn)) { fail(`pin '${alias}' needs verifiedOn as YYYY-MM-DD`); }
  if (own(pin, 'ruling') && (typeof pin.ruling !== 'string' || pin.ruling.length === 0)) { fail(`pin '${alias}' ruling must be a non-empty string`); }
  if (own(pin, 'gatewayOnly') && pin.gatewayOnly !== true) { fail(`pin '${alias}' gatewayOnly may only be true (omit it otherwise)`); }
}

function validateRetired(alias, r, pins) {
  checkName(alias, 'retired');
  if (own(pins, alias)) { fail(`'${alias}' is both pinned and retired`); }
  if (!isPlainObject(r) || Object.keys(r).some(k => k !== 'on' && k !== 'ruling')) { fail(`retired '${alias}' must have exactly on + ruling`); }
  if (typeof r.on !== 'string' || !DATE_RE.test(r.on)) { fail(`retired '${alias}' needs on as YYYY-MM-DD`); }
  if (typeof r.ruling !== 'string' || r.ruling.length === 0) { fail(`retired '${alias}' needs a ruling`); }
}

function validateNotable(n, i, doc) {
  if (!isPlainObject(n) || typeof n.id !== 'string' || !n.id.includes('/')) { fail(`notable[${i}] needs a provider/model id`); }
  checkName(n.suggestedAlias, `notable[${i}] suggestedAlias`);
  if (own(doc.pins, n.suggestedAlias) || own(doc.retired, n.suggestedAlias)) { fail(`notable[${i}] suggestedAlias '${n.suggestedAlias}' is already a pin or retired`); }
  if (own(n, 'note') && typeof n.note !== 'string') { fail(`notable[${i}] note must be a string`); }
  for (const k of Object.keys(n)) { if (!NOTABLE_KEYS.has(k)) { fail(`notable[${i}] has an unknown field '${k}'`); } }
}

/**
 * @param {*} doc a parsed document
 * @throws {Error} `curated-pins.json: <the first defect found>`
 */
function validateCuratedPins(doc) {
  if (!isPlainObject(doc)) { fail('document is not an object'); }
  for (const k of Object.keys(doc)) { if (!TOP_KEYS.has(k)) { fail(`unknown top-level field '${k}'`); } }
  if (doc.version !== 1) { fail(`unsupported version ${JSON.stringify(doc.version)} (expected 1)`); }
  if (!isPlainObject(doc.pins) || Object.keys(doc.pins).length === 0) { fail('pins must be a non-empty object'); }
  for (const [alias, pin] of Object.entries(doc.pins)) { validatePin(alias, pin); }
  if (!isPlainObject(doc.retired)) { fail('retired must be an object'); }
  for (const [alias, r] of Object.entries(doc.retired)) { validateRetired(alias, r, doc.pins); }
  if (!Array.isArray(doc.notable)) { fail('notable must be an array'); }
  doc.notable.forEach((n, i) => validateNotable(n, i, doc));
}

/**
 * @param {string} [filePath] read THIS file fresh through fs; omitted = the
 *   shipped file through `require` (see the module docblock for why)
 * @returns {{version: 1, pins: object, retired: object, notable: Array}} a
 *   validated deep copy
 * @throws {Error} on a missing/unparsable file or any validation defect
 */
function loadCuratedPins(filePath) {
  const raw = filePath === undefined ? SHIPPED : JSON.parse(fs.readFileSync(filePath, 'utf8'));
  validateCuratedPins(raw);
  return JSON.parse(JSON.stringify(raw));
}

module.exports = { loadCuratedPins, validateCuratedPins, CURATED_PINS_PATH };

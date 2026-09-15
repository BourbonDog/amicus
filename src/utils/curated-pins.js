/**
 * @module utils/curated-pins
 * The shipped pin set (#238 D8): src/utils/curated-pins.json, loaded, validated and written here.
 * One entry per curated alias (`pins`: per-gateway `routes`, the `verifiedOn` date, an
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
 * The shipped file is loaded with `require`, not `fs.readFileSync`: it is
 * reached at LOAD time through config.js (DEFAULT_ALIASES is computed at
 * require) and 22 unit suites mock `fs` wholesale — MEASURED 2026-09-14 on
 * main @ cd6b8cfb, a `readFileSync` at load reddened one of them, a `require`
 * passed all 22 (immune: it rides the module loader's own file access). Also
 * cached for the process — fine, since the one writer (owner mode) works from
 * its own in-memory document and never re-reads. An explicit `filePath`
 * (tests, temp copies) reads fresh through fs instead. A JSON syntax error in
 * the shipped file is a loud, named failure AT LOAD TIME, by design (#238
 * council r1 F2): fail-closed, never a silent empty pin set — every alias
 * resolution depends on DEFAULT_ALIASES.
 *
 * Every read validates (`validateCuratedPins`, fail-closed: the first defect
 * is named) and returns a deep copy, so a caller mutating what it got back
 * can never leak into the next builder call.
 *
 * The two edits owner mode makes are PURE functions over a document
 * (`setPinRoute`, `setPinRuling` — each returns a deep copy); `saveCuratedPins`
 * validates again and writes atomically (utils/atomic-write.js) in the ONE
 * canonical format, `JSON.stringify(doc, null, 2)` + LF, so an owner session
 * that changes nothing leaves no diff. A write never happens on an invalid
 * document, so the shipped file can never be left unloadable.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('./atomic-write');
const { collapseExcerpt } = require('./text-sanitize');
const { isDirectProvider } = require('./provider-registry');

/** @type {string} absolute path to the shipped curated-pins.json (T2's saveCuratedPins default). */
const CURATED_PINS_PATH = path.join(__dirname, 'curated-pins.json');
let SHIPPED;
try {
  SHIPPED = require('./curated-pins.json');
} catch (err) {
  throw new Error(`curated-pins.json: ${CURATED_PINS_PATH}: ${err.message} — the shipped pin file failed to parse; fix the JSON by hand; in a source checkout, git checkout -- src/utils/curated-pins.json restores it, and an installed copy is restored by reinstalling amicus`);
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PIN_KEYS = new Set(['routes', 'verifiedOn', 'ruling', 'gatewayOnly']);
const TOP_KEYS = new Set(['version', 'pins', 'retired', 'notable']);
const NOTABLE_KEYS = new Set(['id', 'suggestedAlias', 'note']);
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const fail = (msg) => { throw new Error(`curated-pins.json: ${msg}`); };

/** F6: `DATE_RE`'s shape check alone admits an impossible calendar date (`2026-02-31`) -- round-trip through UTC `Date` and require the ISO date unchanged. @param {*} s @returns {boolean} */
function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) { return false; }
  const d = new Date(s + 'T00:00:00Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// G3 (#238 council r2 A1): an accepted catalog id has the same biography as a
// typed ruling (F5) — third-party bytes, chosen through the interactive
// picker (which renders every candidate through safeFragment), rendered back
// raw by `models --check` as trusted "house bytes". Charset-restrict at the
// ONE function both validatePin (the file) and setPinRoute (an accept) call,
// so the owner's eyeball approval and the stored bytes are the same bytes.
const ROUTE_ID_RE = /^[A-Za-z0-9._:/-]+$/; // printable id charset; every shipped id passes; `:free`/`:batch` need `:`
const NAME_RE = /^[A-Za-z0-9._-]+$/; // every shipped alias/provider name passes

/** @param {*} name an alias or route key @param {string} where names the site for the message */
function checkName(name, where) {
  if (typeof name !== 'string' || name.length === 0 || name.trim() !== name
      || name === '__proto__' || name === 'constructor' || name === 'prototype'
      || !NAME_RE.test(name)) {
    fail(`${where}: '${name}' is not a valid name`);
  }
}

/**
 * @param {string} id @param {string} provider
 * @returns {boolean} true when `id` matches `ROUTE_ID_RE` and starts with
 *   `<provider>/` with every segment non-empty: `openrouter` must be exactly
 *   3 segments (`openrouter/<vendor>/<model>` — `curated-models.js ::
 *   vendorOf` parses the vendor segment positionally, so a 2-segment id
 *   would be silently mis-parsed rather than refused); every other provider
 *   needs only 2+, since a direct provider's own model id may itself contain
 *   `/` (e.g. `togetherai/meta-llama/llama-4`, `fireworks-ai/accounts/...`).
 */
function inNamespace(id, provider) {
  if (typeof id !== 'string' || !ROUTE_ID_RE.test(id)) { return false; }
  const segments = id.split('/');
  if (segments[0] !== provider || !segments.every(s => s.length > 0)) { return false; }
  return provider === 'openrouter' ? segments.length === 3 : segments.length >= 2;
}

function validatePin(alias, pin) {
  checkName(alias, 'pins');
  if (!isPlainObject(pin)) { fail(`pin '${alias}' is not an object`); }
  for (const k of Object.keys(pin)) { if (!PIN_KEYS.has(k)) { fail(`pin '${alias}' has an unknown field '${k}'`); } }
  if (!isPlainObject(pin.routes) || Object.keys(pin.routes).length === 0) { fail(`pin '${alias}' has no routes`); }
  if (!own(pin.routes, 'openrouter')) { fail(`pin '${alias}' has no openrouter route`); }
  for (const [provider, id] of Object.entries(pin.routes)) {
    checkName(provider, `pin '${alias}' routes`);
    // F7: a route key must name a real gateway/provider, or a typo (`anthropc`) ships as an inert, never-matched route.
    if (provider !== 'openrouter' && !isDirectProvider(provider)) { fail(`pin '${alias}' route '${provider}' is not a known provider (openrouter or a direct provider)`); }
    // Owner ruling (#238 council r2 review item 1): a following alias must
    // resolve to a STATIC pin (spec D2) -- model-id-siblings.js :: parsePin
    // cannot watch a moving `~vendor/…-latest` pointer, and the CI alias map
    // is a different pin set. Named BEFORE the charset test (ROUTE_ID_RE
    // would otherwise refuse it too, but with the generic, misleading
    // "not in the namespace" reason).
    if (typeof id === 'string' && id.includes('~')) { fail(`pin '${alias}' route '${provider}' must name a concrete release — OpenRouter's ~vendor/…-latest floating pointers are not pinnable (got ${JSON.stringify(id)})`); }
    if (!inNamespace(id, provider)) { fail(`pin '${alias}' route '${provider}' must be a '${provider}/…' id (got ${JSON.stringify(id)})`); }
  }
  if (!isValidDate(pin.verifiedOn)) { fail(`pin '${alias}' needs verifiedOn as YYYY-MM-DD`); }
  if (own(pin, 'ruling') && (typeof pin.ruling !== 'string' || pin.ruling.length === 0)) { fail(`pin '${alias}' ruling must be a non-empty string`); }
  if (own(pin, 'gatewayOnly') && pin.gatewayOnly !== true) { fail(`pin '${alias}' gatewayOnly may only be true (omit it otherwise)`); }
}

function validateRetired(alias, r, pins) {
  checkName(alias, 'retired');
  if (own(pins, alias)) { fail(`'${alias}' is both pinned and retired`); }
  if (!isPlainObject(r) || Object.keys(r).some(k => k !== 'on' && k !== 'ruling')) { fail(`retired '${alias}' must have exactly on + ruling`); }
  if (!isValidDate(r.on)) { fail(`retired '${alias}' needs on as YYYY-MM-DD`); }
  if (typeof r.ruling !== 'string' || r.ruling.length === 0) { fail(`retired '${alias}' needs a ruling`); }
}

function validateNotable(n, i, doc) {
  if (!isPlainObject(n)) { fail(`notable[${i}] needs a provider/model id`); }
  for (const k of Object.keys(n)) { if (!NOTABLE_KEYS.has(k)) { fail(`notable[${i}] has an unknown field '${k}'`); } }
  if (typeof n.id !== 'string' || !n.id.includes('/')) { fail(`notable[${i}] needs a provider/model id`); }
  // F8: a MISSING suggestedAlias used to fall through to checkName(undefined, …) -- "'undefined' is not a valid name".
  if (!own(n, 'suggestedAlias')) { fail(`notable[${i}] needs a suggestedAlias`); }
  checkName(n.suggestedAlias, `notable[${i}] suggestedAlias`);
  if (own(doc.pins, n.suggestedAlias) || own(doc.retired, n.suggestedAlias)) { fail(`notable[${i}] suggestedAlias '${n.suggestedAlias}' is already a pin or retired`); }
  if (own(n, 'note') && typeof n.note !== 'string') { fail(`notable[${i}] note must be a string`); }
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
 * @throws {Error} `curated-pins.json: <filePath>: <reason>` on a missing or
 *   unparsable explicit file, or `curated-pins.json: <defect>` on any
 *   validation defect (shipped or explicit path alike)
 */
function loadCuratedPins(filePath) {
  let raw;
  if (filePath === undefined) {
    raw = SHIPPED;
  } else {
    try {
      raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
      fail(`${filePath}: ${err.message}`);
    }
  }
  validateCuratedPins(raw);
  return JSON.parse(JSON.stringify(raw));
}

/**
 * @param {object} doc a document `validateCuratedPins` accepts
 * @param {string} [filePath] defaults to the shipped file
 * @throws {Error} a validation defect (nothing written) or the write error
 */
function saveCuratedPins(doc, filePath = CURATED_PINS_PATH) {
  validateCuratedPins(doc);
  writeFileAtomic(filePath, JSON.stringify(doc, null, 2) + '\n');
}

/**
 * Replace ONE route of ONE pin and stamp it verified today (#238 D8 owner
 * sink). Pure: the input is untouched and a deep copy is returned.
 * @param {object} doc
 * @param {string} alias a pin name
 * @param {string} provider the route key being replaced — must already exist on the pin
 * @param {string} id the new executable id, `<provider>/<model>`
 * @param {string} today `YYYY-MM-DD`
 * @returns {object} the new document
 */
function setPinRoute(doc, alias, provider, id, today) {
  if (!isPlainObject(doc) || !isPlainObject(doc.pins) || !own(doc.pins, alias)) { fail(`'${alias}' is not a shipped pin`); }
  const routes = isPlainObject(doc.pins[alias].routes) ? doc.pins[alias].routes : {};
  if (!own(routes, provider)) { fail(`'${alias}' has no ${provider} route to replace (routes: ${Object.keys(routes).join(', ')})`); }
  // Owner ruling (#238 council r2 review item 1): named ahead of the charset
  // test -- see validatePin's identical check for the rationale.
  if (typeof id === 'string' && id.includes('~')) { fail(`'${id}' is a floating pointer (~) — the shipped pins name concrete releases`); }
  if (!inNamespace(id, provider)) { fail(`'${id}' is not in the ${provider}/ namespace`); }
  if (!isValidDate(today)) { fail(`verifiedOn must be YYYY-MM-DD (got '${today}')`); }
  const next = JSON.parse(JSON.stringify(doc));
  next.pins[alias].routes[provider] = id;
  next.pins[alias].verifiedOn = today;
  return next;
}

/**
 * F5(a): a ruling is free text typed at an interactive prompt and rendered
 * back on every future review -- sanitized at this INPUT boundary
 * (`collapseExcerpt`, uncapped: one line, ANSI/bidi/control stripped) so a
 * stored ruling can never forge a line or reorder a screen, then trimmed.
 * @param {object} doc
 * @param {string} alias a pin name
 * @param {string} ruling free text; sanitized and trimmed, must be non-empty
 * @returns {object} a deep copy with `pins[alias].ruling` replaced
 */
function setPinRuling(doc, alias, ruling) {
  if (!isPlainObject(doc) || !isPlainObject(doc.pins) || !own(doc.pins, alias)) { fail(`'${alias}' is not a shipped pin`); }
  // Review residual: collapseExcerpt coerces any value via String(), so a non-string (e.g. {}) would otherwise silently become "[object Object]" instead of being refused.
  if (typeof ruling !== 'string') { fail(`ruling for '${alias}' must be a non-empty string`); }
  const text = collapseExcerpt(ruling, Number.POSITIVE_INFINITY).trim();
  if (!text) { fail(`ruling for '${alias}' must be a non-empty string`); }
  const next = JSON.parse(JSON.stringify(doc));
  next.pins[alias].ruling = text;
  return next;
}

module.exports = { loadCuratedPins, validateCuratedPins, saveCuratedPins, setPinRoute, setPinRuling };

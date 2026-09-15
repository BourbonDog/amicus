/**
 * @module sidecar/aliases-review-gate
 * Pure §5-gate helpers for `amicus aliases --review` (#249 r1 R2/R3), split
 * into their own module rather than grown onto aliases-review-render.js (it
 * was already at five exports) or aliases-review.js (it was already at the
 * 300-line wall). Every export here takes plain data and returns a string or
 * a classification — no I/O, no config reads/writes, no `ask`.
 *
 * #249 r2 C4: a typed id is user input rendered straight to a terminal, so
 * both line-builders below quote it through `safeFragment` (the house
 * sanitizer, `utils/text-sanitize.js`) — the fragment, not the composed
 * line, per `alias-shadow.js :: formatAliasShadow`'s rule.
 */

'use strict';

const { ageLabel } = require('./aliases-review-render');
const { safeFragment } = require('../utils/text-sanitize');
const { DEFAULT_MAX_AGE_MS } = require('../utils/model-catalog');

/**
 * The §5 WRITE gate (mirrors doctor-alias-check.js's unexported
 * `isCatalogFresh`). R3: `age >= 0` is required too, so a future `fetchedAt`
 * (clock skew) is explicitly not fresh rather than indefinitely so.
 * @returns {boolean} true when `fetchedAt` is a number, not in the future, and no older than 24h
 */
function isFresh(fetchedAt, now) {
  return typeof fetchedAt === 'number' && (now - fetchedAt) >= 0 && (now - fetchedAt) <= DEFAULT_MAX_AGE_MS;
}

/**
 * Classifies a typed "choose another" model id against the §5 display gate
 * (R2): a bare/unknown id is a different failure from a real catalog row the
 * engine would never have offered — `alias-proposals.js :: gatedCatalogIds`
 * is the same rule the numbered menu's own candidates are built from, so a
 * typed id can never bypass it.
 * @param {string} id
 * @param {Set<string>} allCatalogIds every id the raw catalog carries
 * @param {Set<string>} gatedIds ids the §5 display gate allows as a candidate
 * @returns {'unknown'|'ungated'|'ok'}
 */
function classifyTypedId(id, allCatalogIds, gatedIds) {
  if (!id.includes('/') || !allCatalogIds.has(id)) { return 'unknown'; }
  if (!gatedIds.has(id)) { return 'ungated'; }
  return 'ok';
}

/** @returns {string} the line for an id absent from the catalog entirely */
function notInCatalogLine(id) {
  return `  not in the catalog — try: amicus models --search ${safeFragment(id).split('/').pop()}\n`;
}

/** @returns {string} the line for an id present in the catalog but excluded by the §5 display gate */
function notVerifiedLine(id) {
  return `  ${safeFragment(id)} is in the catalog but was not verified this run (floor row or rejected provider) — refresh and try again\n`;
}

/**
 * The §5 write-gate banner for a not-fresh catalog (R3). Never called with a
 * fresh one — callers gate on `isFresh` first. A future `fetchedAt` (clock
 * skew) gets its own line instead of a negative age reaching `ageLabel`.
 * @param {number|null} fetchedAt
 * @param {number} now
 * @returns {string}
 */
function staleCatalogBanner(fetchedAt, now) {
  if (typeof fetchedAt === 'number' && fetchedAt > now) {
    return '  catalog timestamp is in the future (clock skew?) — proposals are shown, but accepting is disabled until `amicus models --refresh` succeeds\n';
  }
  if (typeof fetchedAt === 'number') {
    return `  catalog is ${ageLabel(fetchedAt, now)} old and could not be refreshed — proposals are shown, but accepting is disabled until \`amicus models --refresh\` succeeds\n`;
  }
  return '  no catalog cache and it could not be fetched — proposals are shown, but accepting is disabled until `amicus models --refresh` succeeds\n';
}

module.exports = { isFresh, classifyTypedId, notInCatalogLine, notVerifiedLine, staleCatalogBanner };

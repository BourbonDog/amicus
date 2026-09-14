/**
 * @module sidecar/aliases-review-gate
 * Pure §5-gate helpers for `amicus aliases --review` (#249 r1 R2/R3), split
 * into their own module rather than grown onto aliases-review-render.js (it
 * was already at five exports) or aliases-review.js (it was already at the
 * 300-line wall). Every export here takes plain data and returns a string or
 * a classification — no I/O, no config reads/writes, no `ask`.
 */

'use strict';

const { ageLabel } = require('./aliases-review-render');

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
  return `  not in the catalog — try: amicus models --search ${id.split('/').pop()}\n`;
}

/** @returns {string} the line for an id present in the catalog but excluded by the §5 display gate */
function notVerifiedLine(id) {
  return `  ${id} is in the catalog but was not verified this run (floor row or rejected provider) — refresh and try again\n`;
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

module.exports = { classifyTypedId, notInCatalogLine, notVerifiedLine, staleCatalogBanner };

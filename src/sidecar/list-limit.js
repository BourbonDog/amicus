/**
 * @module sidecar/list-limit
 * The `--limit` core behind `amicus list` (v4.7 PR3 rider).
 * Split out of read.js on the same relief-extraction rule that produced
 * list-search.js (T6 review) — read.js was at 293/300 with this inline.
 * Re-exported from src/sidecar/read.js; nothing outside it needs this file.
 *
 * WHY --limit EXISTS. D14 made `--all` real (cross-project via the advisory
 * sessions-index) with no output cap. Measured on the dev machine at merge
 * time: 21,145 rows in 8.3s. An unbounded dump is not a listing.
 */

'use strict';

/**
 * Normalize `--limit` into a row cap.
 *
 * Absent → 0 (unlimited), which keeps an un-limited `list` byte-identical to
 * its pre-rider output. `0` is also the explicit "no cap" spelling, so a
 * scripted caller can opt out without omitting the flag.
 *
 * @param {number|string|boolean|undefined|null} limit
 * @returns {number} 0 for unlimited, else a positive integer
 * @throws {Error} on a valueless, non-integer, or negative value — silently
 *   listing everything after a typo'd `--limit` is exactly the
 *   accepted-but-ignored failure src/utils/known-flags.js exists to prevent.
 */
function normalizeLimit(limit) {
  // parseArgs sets `true` for a valueless flag; mirrors models.js:279-281.
  if (limit === true) { throw new Error('--limit requires a value'); }
  if (limit === undefined || limit === null || limit === '') { return 0; }
  const n = Number(limit);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`--limit must be a non-negative integer (got "${limit}"); 0 means unlimited`);
  }
  return n;
}

/**
 * The no-silent-caps notice. Names the real total and how to see it all.
 *
 * @param {number} cap the applied limit
 * @param {number} total row count BEFORE slicing
 * @returns {string}
 */
function truncationNotice(cap, total) {
  return `Showing ${cap} of ${total} sessions (--limit ${cap}). Use --limit 0 for all.`;
}

module.exports = { normalizeLimit, truncationNotice };

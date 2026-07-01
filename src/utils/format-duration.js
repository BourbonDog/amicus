// src/utils/format-duration.js
'use strict';

/**
 * @module utils/format-duration
 * Single ms->human duration formatter shared by the fanout and council
 * renderers. Rolls minutes up ("1m5s" / "42s") and lets each caller pick its
 * own null placeholder ("-" for fanout stdout, "—" for the council report).
 */

/**
 * Format a millisecond duration as "1m5s" / "42s".
 * @param {number|null|undefined} ms - Duration in milliseconds.
 * @param {string} [empty='-'] - Placeholder for null/undefined input.
 * @returns {string}
 */
function formatDuration(ms, empty = '-') {
  if (ms === null || ms === undefined) { return empty; }
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m${s % 60}s` : `${s}s`;
}

module.exports = { formatDuration };

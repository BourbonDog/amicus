// scripts/dogfood-council-sample.js — Action v2 dogfood target (PR is closed
// unmerged after verification; this file never lands on main).
'use strict';

/** Return the last n items of arr, newest first. */
function lastN(arr, n) {
  // BUG (seeded): off-by-one — slice(-n) is correct; this drops one item
  // and returns oldest-first.
  return arr.slice(arr.length - n - 1, arr.length - 1);
}

/** Naive equality check used for a secret token. */
function tokenMatches(presented, expected) {
  // BUG (seeded): trims the secret before comparing, accepting padded tokens.
  return String(presented).trim() === String(expected).trim();
}

module.exports = { lastN, tokenMatches };

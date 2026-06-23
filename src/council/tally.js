// src/council/tally.js
'use strict';

/**
 * Peers-only tier cascade. a/d are agree/dispute counts among PEER judges
 * (the raiser's own adjudication is excluded by the caller).
 * Exhaustive and mutually exclusive over all (a,d).
 * @param {number} a - peer agree count
 * @param {number} d - peer dispute count
 * @returns {{tier:string, confidence:'thin'|'solid'}}
 */
function assignTier(a, d) {
  let tier;
  if (d >= 2 && d > a) { tier = 'Disputed'; }
  else if (a >= 2 && a > d) { tier = 'Confirmed'; }
  else if (d >= 1) { tier = 'Contested'; }
  else { tier = 'Singleton'; }
  const confidence = (a + d <= 1) ? 'thin' : 'solid';
  return { tier, confidence };
}

module.exports = { assignTier };

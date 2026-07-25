'use strict';

/**
 * @module error-classify
 * Conservative classification of an OpenCode leg-error string into a trigger
 * class (spec 6.2). Fallback substitution fires ONLY on capacity signals
 * (rate-limit|overload). timeout is excluded (resolved Q3: a slow model on a
 * heavy task is not a capacity signal — --retry-failed covers it); auth /
 * validation never substitute. Misclassification cost is bounded either way:
 * one extra cheaper attempt, or status quo.
 */

const RATE_LIMIT = /429|rate ?limit|too many requests|quota|resource exhausted/i;
const OVERLOAD = /529|503|overload|capacity|server busy|service unavailable/i;
const AUTH = /401|403|unauthorized|forbidden|invalid api key|authentication/i;
const TIMEOUT = /timed? ?out|timeout|deadline exceeded/i;

/** @param {string} message @returns {'rate-limit'|'overload'|'auth'|'timeout'|'other'} */
function classifyLegError(message) {
  const m = String(message || '');
  if (RATE_LIMIT.test(m)) { return 'rate-limit'; }
  if (OVERLOAD.test(m)) { return 'overload'; }
  if (AUTH.test(m)) { return 'auth'; }
  if (TIMEOUT.test(m)) { return 'timeout'; }
  return 'other';
}

/** Only capacity signals trigger a cheaper-model substitution. */
function isRetryable(cls) { return cls === 'rate-limit' || cls === 'overload'; }

module.exports = { classifyLegError, isRetryable };

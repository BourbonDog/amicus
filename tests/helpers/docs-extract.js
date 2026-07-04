'use strict';
/**
 * Null-guards for docs/skill-prose test extraction.
 *
 * Plain `text.match(regex)[i]` throws a bare TypeError ("Cannot read
 * properties of null") when a prose edit removes/renames the thing being
 * matched — useless for tracking down what actually broke. These wrappers
 * throw a readable error naming the pattern and the caller-supplied label
 * instead, so a future docs/skill rewording fails loudly and specifically.
 */

/**
 * Match `text` against `regex` or throw a readable error.
 * @returns {RegExpMatchArray} the match array (same shape as text.match(regex))
 */
function mustMatch(text, regex, label) {
  const m = text.match(regex);
  if (!m) {
    throw new Error(`${label}: pattern ${regex} not found`);
  }
  return m;
}

/** Convenience: mustMatch(...)[0] — the full matched section/string. */
function mustSection(text, regex, label) {
  return mustMatch(text, regex, label)[0];
}

/**
 * Guarded text.indexOf: throws a readable error instead of silently
 * returning -1 (which would slice from the end of the string, or from
 * the whole string if the second indexOf is used as a slice-end).
 * @returns {number} the index (always >= 0)
 */
function mustIndexOf(text, needle, label) {
  const i = text.indexOf(needle);
  if (i === -1) {
    throw new Error(`${label}: needle ${JSON.stringify(needle)} not found`);
  }
  return i;
}

module.exports = { mustMatch, mustSection, mustIndexOf };

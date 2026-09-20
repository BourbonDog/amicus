// tests/helpers/code-only.js
'use strict';

/**
 * codeOnly(src) -> string
 *
 * Strips comments from a JS source string so a source-text NEGATIVE pin
 * (`expect(codeOnly(src)).not.toContain('…')`) inspects CODE, not comments
 * (#257 R-X41). A raw `expect(src).not.toContain(...)` reds the moment a
 * legitimate design comment quotes the forbidden phrase while explaining why
 * it was withdrawn — that is documentation working as intended, not the
 * behavior reappearing. `codeOnly` removes comments first so only an actual
 * re-introduction (executable code, not prose about it) can still fail.
 *
 * Two passes, applied in this order:
 *   1. Block comments — `/\/\*[\s\S]*?\*\//g`
 *   2. Whole-line `//` comments (a line that, after leading whitespace,
 *      starts with `//`) — `/^[ \t]*\/\/.*$/gm`
 *
 * KNOWN LIMITATION, BY DESIGN (pinned in code-only.test.js): a trailing `//`
 * AFTER code on the same line is never treated as a comment opener. This is
 * deliberate, not an oversight — the whole-line regex only matches a `//`
 * that owns its line from the first non-blank column, so a `//` that appears
 * inside a string or URL literal (`https://…`) is never mistaken for one and
 * swallowed along with the rest of the line. The tradeoff this buys: a
 * genuine trailing `// note` comment after code also survives untouched.
 * codeOnly only strips a comment that is the whole line (or a block
 * comment), never a same-line trailing one.
 *
 * @param {string} src
 * @returns {string} `src` with block comments and whole-line `//` comments
 *   removed; trailing `//` comments and `//` inside string/URL literals are
 *   left in place (see the limitation above).
 */
function codeOnly(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

module.exports = { codeOnly };

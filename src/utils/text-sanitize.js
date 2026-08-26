/**
 * @module utils/text-sanitize
 * One third-party string, safe to render: no escapes, no bidi, one short line.
 *
 * EXTRACTED from src/utils/engine-log-parse.js (v4.9 W10 round 3). It was built
 * there for the engine-log excerpt (round-2 review B2), but reviews B1+C2 put a
 * SECOND caller on it — `utils/engine-skew.js` runs server-reported version
 * strings through the same pass before they reach the stderr notice and the
 * death-report clause. Leaving it in the parse module meant the skew detector
 * had to depend on the log parser to sanitize a version number, which is a
 * dependency edge that says nothing true about either module. Here, neither
 * caller owns it and both just use it.
 *
 * `engine-log-parse.js` RE-EXPORTS both names, so every existing import path
 * stays valid and the extraction pins can assert these are the SAME function
 * objects rather than a second copy — the same shape as the round-2 splits.
 *
 * THE RULE, in one line: this is the ONLY sanitizer. A second implementation
 * would be a second set of holes, and the holes are the point — every finding
 * that has landed here (ANSI in round 2, bidi in round 3) was a class the
 * previous pass could not see.
 *
 * PURE: no I/O, no throwing paths, no state.
 */

'use strict';

/** One short line: long enough for a real engine error, short enough to ride
 *  inside an error string that already carries the backstop's own sentence. */
const MAX_EXCERPT_CHARS = 200;

/** An ANSI escape sequence: CSI (`ESC [ … final`), OSC (`ESC ] … BEL/ST`), or a
 *  bare two-character escape. */
// eslint-disable-next-line no-control-regex
const ANSI_SEQUENCE = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[@-_])/g;
/** C0 and C1 control characters, DEL included. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR = /[\u0000-\u001f\u007f-\u009f]/g;
/**
 * Unicode BIDI controls: the embedding/override set, the isolates, the marks.
 *
 * Round-3 review A2. PRINTABLE-range code points, so the C0/C1 sweep above never
 * saw them — and each reorders the characters that follow, letting a third
 * party's error string rewrite the sentence it is quoted into (a RIGHT-TO-LEFT
 * OVERRIDE renders the rest of the line backwards). Formatting, so DROPPED.
 */
const BIDI_CONTROL = /[\u202a-\u202e\u2066-\u2069\u200e\u200f\u061c]/g;

/**
 * One line, no control characters, no bidi controls, at most `maxChars`.
 *
 * SANITIZED, not just collapsed (round-2 review B2). This is quoted verbatim
 * from a third party's text into output that reaches terminals and MCP
 * surfaces; engine lines can embed provider output, colour codes and all.
 * Escape sequences and bidi controls are DROPPED (formatting: removing them
 * keeps `<esc>[31mred<esc>[0m` as `red`, not as spaced-out text); every
 * remaining control byte becomes a space, which the collapse below tidies.
 *
 * THE CAP IS A PARAMETER because this is the house sanitizer for any
 * third-party string we render, not only log excerpts: `utils/engine-skew.js`
 * runs SERVER-SUPPLIED version strings through it at a shorter cap before they
 * enter the stderr notice and the death-report clause (round-3 reviews B1+C2).
 * One sanitizer, one dialect — a second implementation is a second set of holes.
 * @param {*} text
 * @param {number} [maxChars]
 * @returns {string}
 */
function collapseExcerpt(text, maxChars = MAX_EXCERPT_CHARS) {
  const oneLine = String(text === undefined || text === null ? '' : text)
    .replace(ANSI_SEQUENCE, '')
    .replace(BIDI_CONTROL, '')
    .replace(CONTROL_CHAR, ' ')
    .replace(/\s+/g, ' ').trim();
  if (oneLine.length <= maxChars) { return oneLine; }
  return `${oneLine.slice(0, maxChars - 1)}…`;
}

module.exports = {
  collapseExcerpt,
  MAX_EXCERPT_CHARS,
};

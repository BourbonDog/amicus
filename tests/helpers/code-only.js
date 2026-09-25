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
 * Contract: comments removed; code and string contents are byte-preserved;
 * line structure is preserved where possible (a removed block comment is
 * replaced by exactly the newlines it contained, nothing else, so a failure
 * assertion built on the result still points near the right source line).
 *
 * IMPLEMENTATION (fix round 1, #257 R-X41 refined — replaces the round-0
 * regex pair, `/\/\*[\s\S]*?\*\//g` + `/^[ \t]*\/\/.*$/gm`, which the review
 * measured as WRONG): a small STRING-AWARE character walker, not a regex. It
 * scans `src` one character at a time, tracking whether it is currently
 * inside a single-quoted string, a double-quoted string, or a template
 * literal (backtick to backtick — a `${…}` interpolation is NOT descended
 * into; see the note below). Inside any of those three, a backslash escapes
 * the next character (so an escaped quote never ends the string) and a
 * comment-opening sequence is just ordinary text. Only OUTSIDE a string does
 * the walker treat two slashes as opening a line comment (stripped up to,
 * not including, the next newline) or a slash-star as opening a block
 * comment (stripped through its closing delimiter, interior newlines
 * preserved, everything else discarded).
 *
 * WHY THE REGEX PAIR WAS WRONG (round-0 review, Finding IMP1 point 2,
 * reproduced against the shipped round-0 helper and recorded in
 * round4-fixG5-report.md's "Fix round 1" section): the old block-comment
 * regex had no idea a slash-star could sit INSIDE a string literal. A glob
 * like `'**` + `/*.js'` (a realistic, unremarkable string — this very
 * codebase's `run-one.js` takes test-path arguments shaped just like it)
 * opens what the old regex read as an unterminated block comment; it then
 * swallowed everything — including genuinely reintroduced, pin-worthy CODE —
 * up to the next real close-comment delimiter anywhere later in the file.
 * That is a false NEGATIVE: it can hide reintroduced code from a pin,
 * defeating the pin's entire purpose in the more dangerous direction. The
 * walker fixes this because a string's contents, glob or otherwise, are
 * never scanned for comment openers.
 *
 * THE OTHER FAILURE MODE THE ROUND-0 REVIEW RAISED, AND WHY IT IS NOT FIXED
 * (Finding IMP1 point 1, REFUTED by the language, not "fixed" here): could a
 * legitimate block comment's own prose, quoting a code example that happens
 * to contain the two-character close-comment sequence, get truncated early?
 * No — in JavaScript there is no way to escape that sequence inside a block
 * comment; wherever it appears, it ends the comment, full stop. A source
 * file whose block-comment "prose" contains a bare close-comment sequence
 * does not parse as a comment at all — the characters after it are read as
 * code, and (since they will essentially never happen to form valid
 * JavaScript by accident) the file fails to parse as a module at all, which
 * every consumer of `codeOnly` already requires (`fs.readFileSync` a real
 * `.js` file). So this scenario cannot occur in a valid module `codeOnly` is
 * ever actually handed; there is nothing to harden against.
 *
 * KNOWN LIMITATION, BY DESIGN (pinned in code-only.test.js): regular-
 * expression LITERALS are not specially recognized. The walker has no
 * concept of "this slash opens a regex, not division or a comment" (that
 * needs knowing the preceding token is an operator/keyword/open-paren, which
 * a character-only walker does not track). A slash inside a regex literal is
 * scanned exactly like a slash in ordinary code: if it happens to sit
 * directly next to another slash or a star INSIDE the regex source (e.g. a
 * character class like a slash, open-bracket, slash, star, close-bracket,
 * slash), the walker misreads the adjacent pair as a comment opener and
 * consumes forward from there, possibly past real code, until it finds the
 * next close-comment delimiter or end of line. `code-only.test.js` pins this
 * exact shape so the limitation is measured and known, not silently missed
 * by a future reader. Every pin `codeOnly` is actually used on today reads
 * plain source/prose text, not regex literals, so this has not been observed
 * to matter in practice — but a future consumer scanning a file with a
 * character-class-shaped regex literal should expect this.
 *
 * A NOTE ON TEMPLATE LITERALS: a `${…}` interpolation's contents are part of
 * the one string span from the opening backtick to the matching closing
 * backtick — the walker does not parse or descend into them. A comment-
 * shaped substring inside an interpolation expression survives untouched,
 * same as anywhere else inside the template literal; this is the intended,
 * simpler behavior (a JS expression inside `${…}` could itself contain
 * nested template literals, making a fully correct recursive descent much
 * more than this helper's job warrants for a test-only tool).
 *
 * @param {string} src
 * @returns {string} `src` with every comment OUTSIDE a string removed (line
 *   comments up to their newline, block comments including their
 *   delimiters, interior newlines preserved); string and template-literal
 *   contents are always byte-preserved, in full, regardless of what they
 *   contain. See the regex-literal limitation above.
 */
function codeOnly(src) {
  const s = String(src);
  const n = s.length;
  let out = '';
  let i = 0;

  while (i < n) {
    const c = s[i];

    // A string or template-literal span: copy verbatim, honouring backslash
    // escapes, until the matching (unescaped) closing quote or end of input.
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      let j = i + 1;
      while (j < n) {
        if (s[j] === '\\') { j += 2; continue; }
        if (s[j] === quote) { j += 1; break; }
        j += 1;
      }
      out += s.slice(i, Math.min(j, n));
      i = j;
      continue;
    }

    // A line comment, outside any string: strip up to (not including) the
    // next newline, which the next loop iteration copies through untouched.
    if (c === '/' && s[i + 1] === '/') {
      let j = i;
      while (j < n && s[j] !== '\n') { j += 1; }
      i = j;
      continue;
    }

    // A block comment, outside any string: strip the delimiters and content,
    // preserving only the newlines it contained so later line numbers hold.
    if (c === '/' && s[i + 1] === '*') {
      let j = i + 2;
      while (j < n && !(s[j] === '*' && s[j + 1] === '/')) { j += 1; }
      const end = j < n ? j + 2 : n; // include the closing delimiter, or run to EOF
      const removed = s.slice(i, end);
      for (let k = 0; k < removed.length; k += 1) {
        if (removed[k] === '\n') { out += '\n'; }
      }
      i = end;
      continue;
    }

    out += c;
    i += 1;
  }

  return out;
}

module.exports = { codeOnly };

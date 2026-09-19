// tests/council/promoted.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const { isPromotedLeg, promotedFacts, tokenSplit, reasoningOnlyClause } = require('../../src/council/promoted');

describe('council/promoted — the one vocabulary for a promoted leg (#257)', () => {
  test('isPromotedLeg admits only the literal true', () => {
    expect(isPromotedLeg({ promoted: true })).toBe(true);
    for (const bad of [{ promoted: 'true' }, { promoted: 1 }, { promoted: false }, {}, null, undefined, { promoted: null }]) {
      expect(isPromotedLeg(bad)).toBe(false);
    }
  });

  test('promotedFacts reads the leg usage tokens and finish, defaulting to 0 / null', () => {
    expect(promotedFacts({ promoted: true, usage: { tokens: { reasoning: 40332, output: 1 } }, finish: 'stop' }))
      .toEqual({ reasoning: 40332, output: 1, finish: 'stop' });
    expect(promotedFacts({ promoted: true })).toEqual({ reasoning: 0, output: 0, finish: null });
    expect(promotedFacts({ promoted: true, usage: null, finish: 42 })).toEqual({ reasoning: 0, output: 0, finish: null });
  });

  test('promotedFacts is null for a leg that is not promoted', () => {
    expect(promotedFacts({ status: 'complete', summary: 'x' })).toBeNull();
    expect(promotedFacts(null)).toBeNull();
  });

  /**
   * Council r1 (Nit, repo rule #219): `finish` is PROVIDER text and every reader
   * interpolates it RAW into prose — the five Stage-1 announcements, and
   * verdict.json's `seatLoss.reason`, which CI renders into a sticky PR comment.
   * It is bounded HERE, at the one producer, so no reader has to remember to.
   * Named mutant FINISHUNBOUNDED: return the raw string. Red set: the length
   * assertion below.
   *
   * Council r2 made that bound an ALLOWLIST. A printable-ASCII strip keeps every
   * Markdown-active character, so a provider-controlled `finish` of
   * `[click](http://x)` would reach that sticky comment as a LINK. Only the
   * characters a finish is actually spelled with survive now: A-Z a-z 0-9 and
   * `_ . : -`. Named mutant FINISHMARKDOWN: restore the strip. Red set: the
   * Markdown assertions below.
   */
  test('promotedFacts BOUNDS the provider finish before anyone interpolates it (#219)', () => {
    const finishOf = f => promotedFacts({ promoted: true, finish: f }).finish;
    // Every shipped value is untouched — the allowlist IS the alphabet a real
    // finish is spelled with, so the bound is a ceiling, not a rewrite.
    for (const real of ['stop', 'length', 'end_turn', 'tool_calls', 'content-filter', 'stop:1']) {
      expect(finishOf(real)).toBe(real);
    }
    expect(finishOf('a_b-c.d:e')).toBe('a_b-c.d:e');
    // 40 characters, the same ceiling schemas/run.schema.json puts on `backstop.status`.
    expect(finishOf('x'.repeat(200))).toBe('x'.repeat(40));
    expect(finishOf('x'.repeat(200)).length).toBe(40);
    // Anything outside the allowlist is DROPPED: C0 controls, DEL, an ANSI
    // escape's introducer, a bidi override, and non-ASCII letters.
    expect(finishOf('sto\x00p')).toBe('stop');
    expect(finishOf('sto\x7fp')).toBe('stop');
    expect(finishOf('\x1b[31mstop\x1b[0m')).toBe('31mstop0m');
    expect(finishOf('\u202estop')).toBe('stop');
    expect(finishOf('stop\u00e9\u4f60')).toBe('stop');
    // …and so is every Markdown-active character, so a hostile finish cannot
    // open a link, a code span, emphasis, a tag or a table cell in the sticky PR
    // comment CI renders verdict.json's seatLoss.reason into.
    expect(finishOf('[stop](http://x)')).toBe('stophttp:x');
    expect(finishOf('*_~`')).toBe('_');
    expect(finishOf('`code`')).toBe('code');
    expect(finishOf('<b>stop</b>')).toBe('bstopb');
    expect(finishOf('stop now')).toBe('stopnow');
    expect(finishOf('stop\nnow')).toBe('stopnow');
    // One character at a time, so a widened allowlist cannot slip through on a
    // compound fixture. `_ - . :` are deliberately absent from this list: they are
    // IN the allowlist, because real provider values are spelled with them.
    for (const ch of ['[', ']', '(', ')', '*', '~', '`', '<', '>', ' ', '!', '#', '|', '\\', '/', '\n', "'", '"', '&', ';']) {
      expect(finishOf(`a${ch}b`)).toBe('ab');
    }
    // Nothing survived — indistinguishable from an absent finish.
    expect(finishOf('\x00\x07\x7f')).toBeNull();
    expect(finishOf('\u202e\u4f60')).toBeNull();
    expect(finishOf('[](){}')).toBeNull();
    expect(finishOf('')).toBeNull();
  });

  test('reasoningOnlyClause is the EMPTY STRING for anything but a facts object (byte-identity guard)', () => {
    for (const x of [null, undefined, '', 0, false, [], 'facts']) { expect(reasoningOnlyClause(x)).toBe(''); }
  });

  test('reasoningOnlyClause wording, with and without finish', () => {
    expect(reasoningOnlyClause({ reasoning: 40332, output: 1, finish: 'stop' }))
      .toBe(" — it answered only in its reasoning channel (40332 reasoning / 1 output tokens, finish 'stop'), which is not a review");
    expect(reasoningOnlyClause({ reasoning: 7, output: 0, finish: null }))
      .toBe(' — it answered only in its reasoning channel (7 reasoning / 0 output tokens), which is not a review');
  });

  /**
   * Council r2: the `(<r> reasoning / <o> output tokens[, finish '<f>'])`
   * parenthetical had TWO hand-written homes — this module's clause and
   * chair-fallback.js's chair reason — so a wording change had to be made twice
   * or the two drifted silently. One fragment, two callers.
   */
  test('tokenSplit is the ONE token fragment, with and without finish', () => {
    expect(tokenSplit({ reasoning: 40332, output: 1, finish: 'stop' }))
      .toBe("40332 reasoning / 1 output tokens, finish 'stop'");
    expect(tokenSplit({ reasoning: 7, output: 0, finish: null })).toBe('7 reasoning / 0 output tokens');
    for (const x of [null, undefined, '', 0, false, [], 'facts']) { expect(tokenSplit(x)).toBe(''); }
  });

  /**
   * IDENTITY, not equivalence: the clause is COMPOSED from tokenSplit, so a
   * second copy of the parenthetical anywhere in the clause fails here even
   * while it still reads correctly today. The byte-for-byte wording itself
   * stays pinned by the wording test above and by every caller's clause pin.
   */
  test('reasoningOnlyClause is composed from tokenSplit, never a second copy of it', () => {
    for (const f of [{ reasoning: 40332, output: 1, finish: 'stop' }, { reasoning: 7, output: 0, finish: null }]) {
      expect(reasoningOnlyClause(f))
        .toBe(` — it answered only in its reasoning channel (${tokenSplit(f)}), which is not a review`);
    }
  });

  test('the module is a LEAF: it requires nothing', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/council/promoted.js'), 'utf8');
    expect(src.match(/require\(/g)).toBeNull();
  });
});

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

  /**
   * R-X44 (council round 4, D2 major, both Confirmed 3-0): a count that was not
   * REPORTED reads `null`, never a fabricated `0` — a leg whose usage the engine
   * never recorded is not the same fact as a leg that genuinely used zero
   * tokens. A REPORTED zero (an integer >= 0) stays `0`, because a reported
   * zero is a fact, not a floor. Named mutant ZEROFABRICATED: restore `: 0` in
   * place of `: null` in both ternaries — the absent-usage assertions below go
   * red.
   */
  test('promotedFacts reads the leg usage tokens and finish; an unreported count is null, never a fabricated 0 (R-X44)', () => {
    expect(promotedFacts({ promoted: true, usage: { tokens: { reasoning: 40332, output: 1 } }, finish: 'stop' }))
      .toEqual({ reasoning: 40332, output: 1, finish: 'stop' });
    // No usage at all.
    expect(promotedFacts({ promoted: true })).toEqual({ reasoning: null, output: null, finish: null });
    // `usage` present but not usable, and a `finish` of the wrong type.
    expect(promotedFacts({ promoted: true, usage: null, finish: 42 })).toEqual({ reasoning: null, output: null, finish: null });
    // `usage.tokens` present but empty.
    expect(promotedFacts({ promoted: true, usage: { tokens: {} } })).toEqual({ reasoning: null, output: null, finish: null });
    // Only one side reported.
    expect(promotedFacts({ promoted: true, usage: { tokens: { reasoning: 40332 } } }))
      .toEqual({ reasoning: 40332, output: null, finish: null });
    // A REPORTED zero on both sides stays zero — it is a fact, not a floor.
    expect(promotedFacts({ promoted: true, usage: { tokens: { reasoning: 0, output: 0 } } }))
      .toEqual({ reasoning: 0, output: 0, finish: null });
    // Not a non-negative integer (negative, non-integer) is not a report either.
    expect(promotedFacts({ promoted: true, usage: { tokens: { reasoning: -1, output: 1.5 } } }))
      .toEqual({ reasoning: null, output: null, finish: null });
  });

  test('promotedFacts is null for a leg that is not promoted', () => {
    expect(promotedFacts({ status: 'complete', summary: 'x' })).toBeNull();
    expect(promotedFacts(null)).toBeNull();
  });

  /**
   * Council r1 (Nit, repo rule #219): `finish` is PROVIDER text and every reader
   * interpolates it RAW into prose — the five Stage-1 announcements, the
   * `Notice:` lines on stderr, the text carried in run.json / verdict.json, and
   * the MARKDOWN REPORT, where report-md.js :: renderMd renders each degrade
   * record as a LIST ITEM (`- ` + formatDegrade(d)) — written to stdout by
   * `amicus council report` and handed to a client by the MCP `report` tool.
   * That list item is the surface where a Markdown-active character would
   * actually render (the on-disk artifact is report.html, which is escaped).
   * It is bounded HERE, at the one producer, so no reader has to remember to.
   * Named mutant FINISHUNBOUNDED: return the raw string. Red set: the length
   * assertion below.
   *
   * NOT the sticky PR comment, which council r3 measured: .github/workflows/
   * council-review.yml composes that comment from the verdict line, the tier
   * table, the five findings sections, the street-cred table and a status/cost
   * footer carrying the seat census — `seatLoss` and `degrades` are
   * interpolated NOWHERE in that step, so no degrade prose reaches it whatever
   * a run was asked for. Rounds 1 and 2 named it; the Markdown report is the
   * surface.
   *
   * Council r2 made that bound an ALLOWLIST. A printable-ASCII strip keeps every
   * Markdown-active character, so a provider-controlled `finish` of
   * `[click](http://x)` would reach that report as a LINK. Only the characters a
   * finish is actually spelled with survive now: A-Z a-z 0-9 and `_ . : -`.
   * Named mutant FINISHMARKDOWN: restore the strip. Red set: the Markdown
   * assertions below.
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
    // open a link, a code span, emphasis, a tag or a table cell in the report.
    expect(finishOf('[stop](http://x)')).toBe('stophttp:x');
    // `*` and `~` are outside the allowlist; the `_` is left LONE by that drop
    // and the intraword rule below then takes it, so nothing survives at all.
    expect(finishOf('*_~`')).toBeNull();
    expect(finishOf('`code`')).toBe('code');
    expect(finishOf('<b>stop</b>')).toBe('bstopb');
    expect(finishOf('stop now')).toBe('stopnow');
    expect(finishOf('stop\nnow')).toBe('stopnow');
    // One character at a time, so a widened allowlist cannot slip through on a
    // compound fixture. `- . :` are deliberately absent from this list: they are
    // IN the allowlist, because real provider values are spelled with them. So
    // is `_`, but only BETWEEN two alphanumerics — `a_b` survives the fixture
    // shape this sweep uses, so the truth table below owns it instead.
    for (const ch of ['[', ']', '(', ')', '*', '~', '`', '<', '>', ' ', '!', '#', '|', '\\', '/', '\n', "'", '"', '&', ';']) {
      expect(finishOf(`a${ch}b`)).toBe('ab');
    }
    // Nothing survived — indistinguishable from an absent finish.
    expect(finishOf('\x00\x07\x7f')).toBeNull();
    expect(finishOf('\u202e\u4f60')).toBeNull();
    expect(finishOf('[](){}')).toBeNull();
    expect(finishOf('')).toBeNull();
  });

  /**
   * Council r3 (C1, major): the allowlist KEEPS `_`, and an underscore is only
   * inert where it sits between two alphanumerics. CommonMark's flanking rules
   * let a LEADING, TRAILING or DOUBLED underscore open emphasis — `_x_` renders
   * as <em>x</em> and `__x__` as <strong>x</strong> in the Markdown report's
   * degrade list item — while an intraword one (`end_turn`, the shape every real provider
   * value has) can neither open nor close it. So the bound is two steps: the
   * allowlist, then every underscore WITHOUT an alphanumeric on both sides is
   * dropped. The old pin asserted `finishOf('*_~`') === '_'` under a comment
   * saying a hostile finish "cannot open … emphasis" — the comment was false and
   * the test proved the loophole.
   *
   * Named mutant UNDERSCOREEMPHASIS: remove the intraword step from
   * promotedFacts. Red set: this test.
   */
  test('a finish keeps an underscore only INSIDE a word (CommonMark flanking, #257 r3)', () => {
    const finishOf = f => promotedFacts({ promoted: true, finish: f }).finish;
    const table = [
      // An alphanumeric on BOTH sides: kept, because it is inert.
      ['end_turn', 'end_turn'],
      ['tool_calls', 'tool_calls'],
      ['a_b-c.d:e', 'a_b-c.d:e'],
      // Leading, trailing or doubled: emphasis-capable, so dropped.
      ['_x_', 'x'],
      ['__x__', 'x'],
      ['x_', 'x'],
      ['_x', 'x'],
      ['a__b', 'ab'],
      ['stop_', 'stop'],
      // Next to another allowlisted punctuation character is not "inside a word".
      ['-_-', '--'],
      ['a_.b', 'a.b'],
      // Nothing survived — indistinguishable from an absent finish.
      ['_', null],
      ['*_~`', null],
    ];
    for (const [input, want] of table) {
      expect([input, finishOf(input)]).toEqual([input, want]);
    }
    // The 40-char ceiling is applied BEFORE the intraword rule, so the CUT
    // itself cannot strand a trailing `_` that the rule never saw: this input's
    // 40th character is an underscore, and the result stops at 39.
    expect(finishOf(`${'a'.repeat(39)}_${'b'.repeat(5)}`)).toBe('a'.repeat(39));
  });

  test('reasoningOnlyClause is the EMPTY STRING for anything but a facts object or the bare true (byte-identity guard)', () => {
    for (const x of [null, undefined, '', 0, false, [], 'facts', 'true', 1]) { expect(reasoningOnlyClause(x)).toBe(''); }
  });

  /**
   * Council r3 (C3, HQ2): `promoted` has TWO documented shapes. The Stage-1
   * still-dead RECORDS carry the facts object on `data.promoted`; leg documents
   * and run rows carry the literal `true` (`isPromotedLeg` reads exactly that).
   * The readers spell `reasoningOnlyClause(ff && ff.promoted)` and
   * `reasoningOnlyClause(criticLeg.data.promoted)` without knowing which shape
   * they hold, so a producer that stamped the boolean on a record used to lose
   * the CAUSE silently — the R-X14 regression, one guard away. The boolean now
   * names the cause; it just has no numbers to quote, so there is no
   * parenthetical (and `tokenSplit` is never called with it).
   *
   * Named mutant BAREPROMOTEDSWALLOWED: restore the old guard so `true` returns
   * ''. Red set: this test.
   */
  test('reasoningOnlyClause(true) names the cause without the parenthetical', () => {
    expect(reasoningOnlyClause(true))
      .toBe(' — it answered only in its reasoning channel, which is not a review');
    // The facts shape is untouched: same sentence, with the numbers.
    expect(reasoningOnlyClause(promotedFacts({ promoted: true, finish: 'stop', usage: { tokens: { reasoning: 40332, output: 1 } } })))
      .toBe(" — it answered only in its reasoning channel (40332 reasoning / 1 output tokens, finish 'stop'), which is not a review");
    // An object without the fields is a facts object per the guard, today and
    // still: it keeps the parenthetical rather than falling to the boolean arm.
    expect(reasoningOnlyClause({}))
      .toBe(` — it answered only in its reasoning channel (${tokenSplit({})}), which is not a review`);
    expect(reasoningOnlyClause({})).not.toBe(reasoningOnlyClause(true));
  });

  /**
   * R-X44 (Chair HQ2): `reasoningOnlyClause({})` used to render the fabricated
   * `(0 reasoning / 0 output tokens)` for a leg whose usage was never recorded.
   * R-X39 (round 3) already ruled that a truthy value in the `promoted` slot
   * names the cause and is never swallowed — so the clause is NOT the empty
   * string here, and it is not `reasoningOnlyClause(true)`'s bare sentence
   * either (that would misreport a facts object as the boolean shape). What
   * changes is only the NUMBER: the parenthetical now says the counts were
   * never reported.
   */
  test('reasoningOnlyClause names the cause with "token usage not reported" when the facts carry no counts (R-X44)', () => {
    expect(reasoningOnlyClause({}))
      .toBe(' — it answered only in its reasoning channel (token usage not reported), which is not a review');
    // A promoted leg with no usage at all — the real shape a caller passes.
    expect(reasoningOnlyClause(promotedFacts({ promoted: true })))
      .toBe(' — it answered only in its reasoning channel (token usage not reported), which is not a review');
    expect(reasoningOnlyClause(true))
      .toBe(' — it answered only in its reasoning channel, which is not a review');
    for (const x of [null, undefined, '', 0, false, [], 'true']) { expect(reasoningOnlyClause(x)).toBe(''); }
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
   * R-X44: `tokenSplit` renders the counts only when BOTH are integers —
   * otherwise the literal `token usage not reported`, never `null reasoning /
   * null output tokens`. The finish clause is unchanged and still appends in
   * both cases — a missing token count says nothing about whether the provider
   * reported a finish reason. A REPORTED zero on both sides still renders the
   * numbers: a reported zero is a fact.
   */
  test('tokenSplit renders "token usage not reported" when a count is missing, not a fabricated number (R-X44)', () => {
    expect(tokenSplit({ reasoning: null, output: null, finish: 'stop' }))
      .toBe("token usage not reported, finish 'stop'");
    expect(tokenSplit({ reasoning: 40332, output: null, finish: null }))
      .toBe('token usage not reported');
    expect(tokenSplit({ reasoning: null, output: 0, finish: null }))
      .toBe('token usage not reported');
    expect(tokenSplit({ reasoning: 0, output: 0, finish: null }))
      .toBe('0 reasoning / 0 output tokens');
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

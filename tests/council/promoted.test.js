// tests/council/promoted.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const { isPromotedLeg, promotedFacts, reasoningOnlyClause } = require('../../src/council/promoted');

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
   */
  test('promotedFacts BOUNDS the provider finish before anyone interpolates it (#219)', () => {
    const finishOf = f => promotedFacts({ promoted: true, finish: f }).finish;
    // The shipped value is untouched — the bound is a ceiling, not a rewrite.
    expect(finishOf('stop')).toBe('stop');
    expect(finishOf('length')).toBe('length');
    // 40 characters, the same ceiling schemas/run.schema.json puts on `backstop.status`.
    expect(finishOf('x'.repeat(200))).toBe('x'.repeat(40));
    expect(finishOf('x'.repeat(200)).length).toBe(40);
    // Anything outside printable ASCII is DROPPED: C0 controls, DEL, an ANSI
    // escape's introducer, a bidi override, and non-ASCII letters.
    expect(finishOf('sto\x00p')).toBe('stop');
    expect(finishOf('sto\x7fp')).toBe('stop');
    expect(finishOf('\x1b[31mstop\x1b[0m')).toBe('[31mstop[0m');
    expect(finishOf('\u202estop')).toBe('stop');
    expect(finishOf('stop\u00e9\u4f60')).toBe('stop');
    // Nothing printable survived — indistinguishable from an absent finish.
    expect(finishOf('\x00\x07\x7f')).toBeNull();
    expect(finishOf('\u202e\u4f60')).toBeNull();
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

  test('the module is a LEAF: it requires nothing', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/council/promoted.js'), 'utf8');
    expect(src.match(/require\(/g)).toBeNull();
  });
});

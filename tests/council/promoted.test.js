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

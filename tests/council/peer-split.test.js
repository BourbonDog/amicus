// tests/council/peer-split.test.js
'use strict';

const fs = require('fs');
const path = require('path');

const { peersOf } = require('../../src/council/peer-split');

describe('peer-split — extraction pins (v4.8 Phase 2 T-B1)', () => {
  test('P3 — the module is REQUIRE-FREE, so a DI-free consumer (debate.js) can import it', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../src/council/peer-split.js'), 'utf8');
    expect(src.match(/require\(/g)).toBeNull();
  });

  test('no raiser: votes pass through completely unfiltered (same array, not a copy)', () => {
    const f = { id: 'F1' };
    const votes = [{ judge: 'x', verdict: 'agree' }, { judge: 'y', verdict: 'dispute' }];
    expect(peersOf(f, votes)).toBe(votes);
  });

  test('raiser known, no seats anywhere: excludes by alias (v.judge !== f.raiser)', () => {
    const f = { id: 'F1', raiser: 'gpt' };
    const votes = [{ judge: 'gpt', verdict: 'agree' }, { judge: 'claude', verdict: 'agree' }];
    expect(peersOf(f, votes)).toEqual([{ judge: 'claude', verdict: 'agree' }]);
  });

  test('raiser has a seat, vote has none: falls to the alias branch (T1 shape, #137)', () => {
    const f = { id: 'F1', raiser: 'deepseek', raiserSeat: 'deepseek#1' };
    const votes = [{ judge: 'deepseek', verdict: 'agree' }];
    expect(peersOf(f, votes)).toEqual([]); // alias matches the raiser -> excluded
  });

  test('raiser and vote share the SAME seat: excluded (the raiser\'s own vote, #137)', () => {
    const f = { id: 'F1', raiser: 'deepseek', raiserSeat: 'deepseek#1' };
    const votes = [{ judge: 'deepseek', verdict: 'agree', seat: 'deepseek#1' }];
    expect(peersOf(f, votes)).toEqual([]);
  });

  test('raiser and vote share the alias but DIFFERENT seats: a real peer (T3 shape, #137)', () => {
    const f = { id: 'F1', raiser: 'deepseek', raiserSeat: 'deepseek#1' };
    const votes = [{ judge: 'deepseek', verdict: 'agree', seat: 'deepseek#2' }];
    expect(peersOf(f, votes)).toEqual(votes);
  });

  // SPLITDROP witnesses (v4.8 Phase 2 T-B1, task-1-report.md). Named mutant
  // "SPLITDROP": delete the outer `f.raiser ? … :` condition so the filter
  // in peer-split.js runs UNCONDITIONALLY. Neither witness below goes through
  // tally() — no test elsewhere in the suite happens to put a vote's `judge`
  // or `seat` in a position that collides with a falsy `f.raiser`/`f.raiserSeat`,
  // so these two are this module's OWN, direct pin on the outer branch. Both
  // are RED under SPLITDROP — see task-1-report.md for the measured run.
  test('SPLITDROP witness A: no raiser, a vote with no judge field, still survives', () => {
    // GUARDED: f.raiser is falsy, so peers = votes verbatim and the judge
    // compare never runs. SPLITDROP: the filter runs anyway, and
    // v.judge !== f.raiser reads undefined !== undefined -> false -> dropped.
    const f = { id: 'F1' };
    const votes = [{ verdict: 'agree' }];
    expect(peersOf(f, votes)).toHaveLength(1);
  });

  test('SPLITDROP witness B: no raiser, a vote whose seat equals raiserSeat, still survives', () => {
    // GUARDED: f.raiser is falsy, so the outer branch short-circuits before
    // the seat compare ever runs. SPLITDROP: the seat branch runs anyway,
    // and v.seat !== f.raiserSeat reads 'x#1' !== 'x#1' -> false -> dropped.
    const f = { id: 'F1', raiserSeat: 'x#1' };
    const votes = [{ judge: 'x', verdict: 'agree', seat: 'x#1' }];
    expect(peersOf(f, votes)).toHaveLength(1);
  });
});

// tests/council/peer-split.test.js
'use strict';

const fs = require('fs');
const path = require('path');

const { peersOf, unattributedPeerDrops } = require('../../src/council/peer-split');

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

// v4.8 Phase 2 T-B2 — `unattributedPeerDrops`, the mark BOTH documents carry.
//
// It counts the adjudications `peersOf` excluded on its ALIAS branch while
// exactly ONE side of the pair carried a seat id (the finding has a
// `raiserSeat` and the vote has no `seat`, or the reverse). tally.js and
// debate.js both call this same function, so tally.json's mark and the defense
// brief's mark agree by construction rather than by two parallel spellings.
//
// Each pin below drives ONE conjunct of the predicate, asserted in the
// expression itself, never inferred from a branch.
//
// ⚠️ `!(v.seat && f.raiserSeat)` deliberately has NO pin. The XOR beside it
// already implies it (exactly one side truthy => their AND is falsy), so no
// fixture can make it the deciding conjunct — measured over the 1296-case
// truthiness cross-product, dropping it flips ZERO cases while the other three
// flip 64 / 32 / 160. A test titled as if it pinned that conjunct would be
// green against its own mutant, which is the failure this note exists to
// prevent someone from adding.
describe('unattributedPeerDrops — the unattributable-drop mark (v4.8 Phase 2 T-B2)', () => {
  test('SI-22.2 shape, the PEER leg orphaned: finding HAS raiserSeat, vote is seatless => 1', () => {
    const f = { id: 'F1', raiser: 'deepseek', raiserSeat: 'deepseek#1' };
    const votes = [{ judge: 'deepseek', verdict: 'agree' }];
    expect(unattributedPeerDrops(f, votes)).toBe(1);
    expect(peersOf(f, votes)).toEqual([]);   // and it really is a drop, not a keep
  });

  test('SI-22.1 shape, the RAISER OWN leg orphaned: no raiserSeat, vote HAS a seat => 1', () => {
    const f = { id: 'F1', raiser: 'deepseek' };
    const votes = [{ judge: 'deepseek', verdict: 'agree', seat: 'deepseek#2' }];
    expect(unattributedPeerDrops(f, votes)).toBe(1);
    expect(peersOf(f, votes)).toEqual([]);
  });

  test('symmetric twin seats: BOTH sides seated, so the seat branch ran and nothing is ambiguous => 0', () => {
    const f = { id: 'F1', raiser: 'deepseek', raiserSeat: 'deepseek#1' };
    const votes = [
      { judge: 'deepseek', verdict: 'agree', seat: 'deepseek#1' },   // the raiser's OWN vote
      { judge: 'deepseek', verdict: 'agree', seat: 'deepseek#2' },   // its twin — a real peer
      { judge: 'gpt', verdict: 'agree', seat: 'gpt' },
    ];
    expect(unattributedPeerDrops(f, votes)).toBe(0);
  });

  test('unique-alias bench, no seats ANYWHERE: no seat asymmetry to be ambiguous about => 0', () => {
    const f = { id: 'F1', raiser: 'gemini' };
    const votes = [{ judge: 'gpt', verdict: 'agree' }, { judge: 'gemini', verdict: 'agree' }];
    expect(unattributedPeerDrops(f, votes)).toBe(0);
  });

  // Conjunct 1 of 4 — `f.raiser &&`. Two witnesses, one per engine path.
  // Named mutant: delete `f.raiser &&`. Measured: flips 64 of the 1296
  // cross-product cases, and both fixtures below are among them (each would
  // report 1 instead of 0). `peersOf` returns `votes` WHOLE on a falsy raiser,
  // so a non-zero count here would announce a drop that never happened.
  test('the `f.raiser &&` conjunct: raiser and judge both `undefined` (CLI path) => 0, not 1', () => {
    // cli-handlers-council.js is a raw JSON.parse with no schema at all.
    const f = { id: 'F1', raiserSeat: 'deepseek#1' };
    const votes = [{ verdict: 'agree' }];
    expect(unattributedPeerDrops(f, votes)).toBe(0);
    expect(peersOf(f, votes)).toBe(votes);   // nothing was dropped, so nothing is countable
  });

  test('the `f.raiser &&` conjunct: raiser and judge both the EMPTY STRING (MCP path) => 0, not 1', () => {
    // mcp-tools.js makes raiser/judge required z.string(), which ACCEPTS ''.
    const f = { id: 'F1', raiser: '', raiserSeat: 'deepseek#1' };
    const votes = [{ judge: '', verdict: 'agree' }];
    expect(unattributedPeerDrops(f, votes)).toBe(0);
    expect(peersOf(f, votes)).toBe(votes);
  });

  // Conjunct 2 of 4 — the XOR `(!!v.seat !== !!f.raiserSeat)`.
  // Named mutant: delete it. Measured: flips 32 of the 1296 cases, this
  // fixture among them (it would report 1). The raiser's own vote IS dropped
  // here, but with no seat on either side the drop is fully ATTRIBUTABLE —
  // that is the ordinary alias exclusion, not an ambiguous one.
  test('the XOR conjunct: the raiser OWN vote dropped by alias with NO seats anywhere => 0, not 1', () => {
    const f = { id: 'F1', raiser: 'gemini' };
    const votes = [{ judge: 'gemini', verdict: 'agree' }];
    expect(peersOf(f, votes)).toEqual([]);   // it really was dropped
    expect(unattributedPeerDrops(f, votes)).toBe(0);   // just not unattributably
  });

  // Conjunct 3 of 4 — `v.judge === f.raiser`.
  // Named mutant: delete it. Measured: flips 160 of the 1296 cases, this
  // fixture among them (it would report 1 for a vote `peersOf` KEEPS).
  test('the `v.judge === f.raiser` conjunct: a DIFFERENT model on a one-sided finding => 0', () => {
    const f = { id: 'F1', raiser: 'deepseek', raiserSeat: 'deepseek#1' };
    const votes = [{ judge: 'gpt', verdict: 'agree' }];
    expect(peersOf(f, votes)).toEqual(votes);   // kept — it is a real peer
    expect(unattributedPeerDrops(f, votes)).toBe(0);
  });

  // The property that makes the mark meaningful, carried as a PROBE rather
  // than an argument: sweep the truthiness cross-product and assert against
  // the real `peersOf` on every single case. `counted > 0` at the end is the
  // anti-vacuity guard — a function that always returned 0 would satisfy the
  // inequality on all 256 cases and fail this line.
  test('every vote it counts is one peersOf ACTUALLY dropped (exhaustive cross-product)', () => {
    const SEATS = [undefined, '', 'a', 'b'];
    const NAMES = [undefined, '', 'x', 'y'];
    let counted = 0, cases = 0;
    for (const raiserSeat of SEATS) {
      for (const seat of SEATS) {
        for (const raiser of NAMES) {
          for (const judge of NAMES) {
            const f = { raiser, raiserSeat };
            const votes = [{ judge, seat, verdict: 'agree' }];
            const n = unattributedPeerDrops(f, votes);
            const dropped = votes.length - peersOf(f, votes).length;
            expect(n).toBeLessThanOrEqual(dropped);
            counted += n;
            cases += 1;
          }
        }
      }
    }
    expect(cases).toBe(256);
    expect(counted).toBeGreaterThan(0);
  });
});

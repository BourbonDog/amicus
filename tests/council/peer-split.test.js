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

  // ⚠️ REWRITTEN by v4.8 T-B4 (council C1). This test used to read
  // `expect(peersOf(f, votes)).toBe(votes)` — the SAME array object, because a
  // falsy raiser skipped the filter outright. It no longer does: the
  // falsy-raiser arm now drops the votes nobody can attribute, so the array
  // identity is gone even on a fixture where nothing is dropped. What survives
  // is the half of L8 that was ever load-bearing — no NAMED peer is lost.
  test('no raiser, every judge NAMED: all of them still count (L8)', () => {
    const f = { id: 'F1' };
    const votes = [{ judge: 'x', verdict: 'agree' }, { judge: 'y', verdict: 'dispute' }];
    expect(peersOf(f, votes)).toEqual(votes);
    expect(unattributedPeerDrops(f, votes)).toBe(0);
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

  // SPLITDROP witnesses (v4.8 Phase 2 T-B1; witness A REPLACED by T-B4). Named
  // mutant "SPLITDROP": delete the outer `f.raiser ? … :` condition so the
  // NAMED-RAISER filter runs UNCONDITIONALLY — which deletes the falsy-raiser
  // arm along with the condition. Neither witness below goes through tally() —
  // no test elsewhere in the suite happens to put a vote's `judge` or `seat` in
  // a position that collides with a falsy `f.raiser`/`f.raiserSeat`, so these
  // two are this module's OWN, direct pin on the outer branch. Both are RED
  // under SPLITDROP — MEASURED red set beside the mutation itself,
  // peer-split.js :: peersOf.
  //
  // ⚠️ Witness A had to be REPLACED, not re-valued, and that is the sharpest
  // lesson of T-B4. Its old fixture (no raiser, a vote with NO judge field)
  // asserted that vote SURVIVES. T-B4 drops it — and SPLITDROP drops it too,
  // reading `undefined !== undefined` -> false — so the old witness stopped
  // separating the two spellings at all and would have gone GREEN against its
  // own mutant. A hardening disarmed the pin that guarded it. The MIXED-falsy
  // fixture below separates them in the opposite direction: GUARDED drops the
  // '' judge as unattributable, SPLITDROP KEEPS it because `'' !== undefined`.
  test('SPLITDROP witness A: no raiser, an EMPTY-STRING judge, dropped as unattributable', () => {
    const f = { id: 'F1' };                            // raiser `undefined`
    const votes = [{ judge: '', verdict: 'agree' }];
    expect(peersOf(f, votes)).toHaveLength(0);
    expect(unattributedPeerDrops(f, votes)).toBe(1);
  });

  test('SPLITDROP witness B: no raiser, a NAMED judge whose seat equals raiserSeat, still survives', () => {
    // GUARDED: f.raiser is falsy, so the falsy-raiser arm runs and keeps every
    // NAMED judge (L8); the seat compare is never reached. SPLITDROP: the
    // named-raiser filter runs anyway, takes its seat branch, and
    // v.seat !== f.raiserSeat reads 'x#1' !== 'x#1' -> false -> dropped.
    //
    // ⚠️ Read this fixture honestly. The surviving vote carries the raiser's OWN
    // seat id, so it is provably the raiser's own vote and it is still counted.
    // That is the measured RESIDUAL of T-B4's property 2 — "a vote with a NAMED
    // judge is provably not the unnamed raiser" is false exactly when the seats
    // say otherwise. It is UNCHANGED from HEAD (T-B4 closed the alias-space
    // hole, not this seat-space one) and it is filed, not fixed. The count and
    // the reachability argument live on peer-split.js :: peersOf.
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
// v4.8 T-B4 widened it: on a finding whose raiser is FALSY it now also counts
// every vote whose `judge` is falsy, because such a vote may be the unnamed
// raiser's own and `peersOf` no longer keeps it.
//
// Each pin below drives ONE conjunct of the predicate, asserted in the
// expression itself, never inferred from a branch.
//
// ⚠️ `!(v.seat && f.raiserSeat)` deliberately has NO pin. The XOR beside it
// already implies it (exactly one side truthy => their AND is falsy), so no
// fixture can make it the deciding conjunct. RE-MEASURED at T-B4 against the
// widened predicate, over the 1296-case truthiness cross-product of
// (f.raiser, f.raiserSeat, v.judge, v.seat) with 6 values apiece — three falsy
// (`undefined`, `null`, `''`) and three truthy: dropping it still flips ZERO,
// while collapsing the ternary to its named arm flips 270 and to its falsy arm
// 378, dropping the XOR flips 27, dropping `v.judge === f.raiser` flips 270 and
// weakening `!v.judge` to `true` flips 324. A test titled as if it pinned that
// one conjunct would be green against its own mutant, which is the failure this
// note exists to prevent someone from adding.
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

  // Conjunct 1 of 4 — the ternary condition `f.raiser ? … : !v.judge`.
  //
  // ⚠️ REWRITTEN by v4.8 T-B4, expected values INVERTED, and the rewrite is not
  // cosmetic. These two used to pin a leading `f.raiser &&` and assert **0**,
  // because `peersOf` returned `votes` WHOLE on a falsy raiser and a non-zero
  // count would have announced a drop that never happened. T-B4 makes those
  // drops REAL, so the same fixtures must now announce them: **1**, not 0. Both
  // fixtures also assert the drop itself, so neither can pass on a count alone.
  // Named mutant on this conjunct: collapse the ternary to its named-raiser arm
  // — both fixtures then read `(!!undefined !== !!'deepseek#1')` -> false -> 0.
  test('the falsy-raiser arm: raiser and judge both `undefined` (CLI path) => 1', () => {
    // cli-handlers-council.js is a raw JSON.parse with no schema at all.
    const f = { id: 'F1', raiserSeat: 'deepseek#1' };
    const votes = [{ verdict: 'agree' }];
    expect(peersOf(f, votes)).toEqual([]);    // unattributable: it may be the raiser's own
    expect(unattributedPeerDrops(f, votes)).toBe(1);
  });

  test('the falsy-raiser arm: raiser and judge both the EMPTY STRING (MCP path) => 1', () => {
    // mcp-tools.js makes raiser/judge required z.string(), which ACCEPTS ''.
    const f = { id: 'F1', raiser: '', raiserSeat: 'deepseek#1' };
    const votes = [{ judge: '', verdict: 'agree' }];
    expect(peersOf(f, votes)).toEqual([]);
    expect(unattributedPeerDrops(f, votes)).toBe(1);
  });

  // Conjunct 1b — `!v.judge` inside that same falsy-raiser arm. Named mutant:
  // replace it with `true`, so the arm counts every vote on a raiser-less
  // finding. This fixture then reports 1 for a vote `peersOf` KEEPS.
  test('the `!v.judge` conjunct: a NAMED judge beside a falsy raiser is a real peer => 0', () => {
    const f = { id: 'F1', raiser: '' };
    const votes = [{ judge: 'gpt', verdict: 'agree' }];
    expect(peersOf(f, votes)).toEqual(votes);   // kept — L8, no real peer dropped
    expect(unattributedPeerDrops(f, votes)).toBe(0);
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

// v4.8 T-B4 — council C1: an unnamed raiser must not corroborate itself.
//
// `''` and `undefined` are not identities (ruling R2), so on a finding whose
// raiser is falsy a vote whose `judge` is ALSO falsy cannot be told apart from
// the raiser's own. Until T-B4 `peersOf` handed every such vote back as peer
// signal: measured on the council's own fixture — `raiser:''`, votes
// `['' agree, 'gpt' agree]` — the tally read `basis {a:2}` **Confirmed** where
// the named-raiser control reads `{a:1}`, with no mark emitted at all. R2
// governs: mark explicitly, attribute nothing.
//
// ⚠️ The pair is judged by TRUTHINESS, not by `===`. `raiser:''` beside
// `judge:undefined` is the same unattributable pair as `''`/`''`, and a
// `v.judge === f.raiser` spelling — the one the named-raiser arm uses — would
// keep it. Both mixed directions are pinned: `''`/`undefined` here, and
// `undefined`/`''` as SPLITDROP witness A above.
describe('peersOf — an unnamed raiser cannot corroborate itself (v4.8 T-B4, C1)', () => {
  test('C1a: the council fixture — the `` vote is dropped and marked, `gpt` still counts', () => {
    const f = { id: 'A1', raiser: '' };
    const votes = [{ judge: '', verdict: 'agree' }, { judge: 'gpt', verdict: 'agree' }];
    expect(peersOf(f, votes)).toEqual([{ judge: 'gpt', verdict: 'agree' }]);
    expect(unattributedPeerDrops(f, votes)).toBe(1);
  });

  test('C1b: raiser and judge both `undefined` (CLI path) — dropped and marked', () => {
    const f = { id: 'A1' };
    const votes = [{ verdict: 'agree' }];
    expect(peersOf(f, votes)).toEqual([]);
    expect(unattributedPeerDrops(f, votes)).toBe(1);
  });

  test('C1c: MIXED — raiser `` beside a judge `undefined` is the same unattributable pair', () => {
    const f = { id: 'A1', raiser: '' };
    const votes = [{ verdict: 'agree' }];
    expect(peersOf(f, votes)).toEqual([]);
    expect(unattributedPeerDrops(f, votes)).toBe(1);
  });

  test('C1d: two unattributable votes are both dropped and BOTH counted', () => {
    const f = { id: 'A1', raiser: '' };
    const votes = [{ judge: '', verdict: 'dispute' }, { judge: '', verdict: 'dispute' }];
    expect(peersOf(f, votes)).toEqual([]);
    expect(unattributedPeerDrops(f, votes)).toBe(2);
  });
});

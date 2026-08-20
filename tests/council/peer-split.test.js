// tests/council/peer-split.test.js
'use strict';

const fs = require('fs');
const path = require('path');

const { peersOf, unattributedPeerDrops } = require('../../src/council/peer-split');

/**
 * The EXECUTABLE text of a JS source: line and block comments removed, string
 * literals kept intact. Written as an explicit scan rather than a regex
 * alternation because the two get different answers on the case that matters —
 * a `//` inside a string literal. Regex literals are not modelled; the file this
 * scans contains none.
 * ⚠️ THIS FUNCTION IS PINNED DIRECTLY, by the describe block immediately below.
 * That is what keeps the require-ban below it from passing vacuously: a scanner
 * that returned '' — or that ate a string literal — fails those unit tests
 * before the ban is ever consulted. Guard the extractor, not the text it reads.
 * @param {string} src
 * @returns {string}
 */
function executableText(src) {
  let out = '', i = 0;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    if (c === '/' && d === '/') {
      while (i < src.length && src[i] !== '\n') { i += 1; }
      continue;
    }
    if (c === '"' || c === '\'' || c === '`') {
      out += c; i += 1;
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\') { out += src[i]; i += 1; }
        out += src[i]; i += 1;
      }
      out += src[i] || ''; i += 1;
      continue;
    }
    out += c; i += 1;
  }
  return out;
}

// ⚠️ THE ANTI-VACUITY GUARD, v4.8 T-B5 fix round 3 (council C2). It used to be a
// line-count assertion on peer-split.js's executable text — `toHaveLength(14)`.
// That closed the vacuity risk but bolted the guard to the SUBJECT FILE, so it
// fired on any edit rewriting that text, including every MUTATION: three named
// mutants gained a red test that caught a reformat rather than a behaviour
// change, and every red set recorded before it existed went stale. The property
// was right and the attachment point was wrong.
// These tests guard the EXTRACTOR itself. A scanner that ate everything, or that
// stripped inside a string literal, fails here immediately — so the ban below
// cannot pass for the wrong reason — and nothing here moves when peer-split.js
// is reformatted, remeasured or mutated.
describe('executableText — the extractor the require-ban rests on', () => {
  test('a whole-line // comment is removed', () => {
    expect(executableText('// gone\nconst a = 1;').trim()).toBe('const a = 1;');
  });

  test('a TRAILING // comment goes, the code before it stays', () => {
    expect(executableText('const a = 1; // gone').trim()).toBe('const a = 1;');
  });

  test('a /* block */ comment is removed', () => {
    expect(executableText('const a = /* gone */ 1;')).toBe('const a =  1;');
  });

  test('a JSDoc block is removed, and code after it survives', () => {
    expect(executableText('/**\n * gone\n */\nconst a = 1;').trim()).toBe('const a = 1;');
  });

  test('a // INSIDE a string literal is NOT a comment — the decisive case', () => {
    // A naive regex strip truncates here, which would let a real call on the
    // same line hide behind the URL. This is why the scan is explicit.
    const src = 'const u = \'http://x\'; const os = require("os");';
    expect(executableText(src)).toBe(src);
  });

  test('a /* inside a string literal is NOT a comment either', () => {
    const src = 'const s = "/* not a comment */";';
    expect(executableText(src)).toBe(src);
  });

  test('all three quote styles survive intact', () => {
    const src = 'const a = \'x\'; const b = "y"; const c = `z`;';
    expect(executableText(src)).toBe(src);
  });

  test('comment-free code is returned unchanged', () => {
    const src = 'const a = 1;\nmodule.exports = { a };';
    expect(executableText(src)).toBe(src);
  });

  test('it does NOT eat the code it is given (the vacuity case, stated directly)', () => {
    const src = '// header\nfunction f() { return 1; }\nmodule.exports = { f };';
    const out = executableText(src);
    expect(out).toContain('function f()');
    expect(out).toContain('module.exports');
    expect(out).not.toContain('header');
  });
});

describe('peer-split — extraction pins (v4.8 Phase 2 T-B1)', () => {
  // ⚠️ v4.8 T-B5 (council C3) narrowed this scan to EXECUTABLE TEXT. It used to
  // match the RAW file, so the banned sequence fired from inside a comment or a
  // string as readily as from a real call — it caught its own author during
  // T-B1, who had to avoid writing the token while documenting the ban on it,
  // and it silently constrained what this comment-heavy module was allowed to
  // say about itself. The BAN is exactly as strong: a real call is still caught
  // wherever it hides, because only commentary is removed and string literals
  // are kept.
  // Vacuity is closed by the describe block ABOVE, which pins executableText()
  // against synthetic inputs, so this test asserts the BAN and nothing else. It
  // deliberately makes no claim about peer-split.js's size, shape or line count.
  // Proven in BOTH directions by execution at T-B5: a real `require(` added to
  // peer-split.js turns this test RED, and the same token written into one of
  // its comments leaves it GREEN.
  // ⚠️ HISTORY, kept because it cost three rounds to learn. Fix round 1 closed
  // vacuity with `toHaveLength(14)` on peer-split.js's executable text. It
  // worked, and it coupled this pin to the subject file: any edit rewriting that
  // text tripped it, INCLUDING a mutation, so three named mutants each gained a
  // red test that caught a reformat rather than a behaviour change, and every
  // red set recorded before it went stale by construction. Fix round 3 moved the
  // guard onto the extractor and re-ran all six mutants to confirm the coupling
  // is gone. ⇒ Guard the tool, not the text it reads. A pin that names a
  // property of the file under test will fire on every honest change to it.
  test('P3 — the module is REQUIRE-FREE, so a DI-free consumer (debate.js) can import it', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../src/council/peer-split.js'), 'utf8');
    const code = executableText(src);
    // One structural sanity check that every CommonJS module satisfies, so it
    // does not couple to this predicate's shape; the extractor's own tests above
    // are what actually close vacuity.
    expect(code).toContain('module.exports');
    expect(code.match(/require\(/g)).toBeNull();
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

  // SPLITDROP witnesses (v4.8 Phase 2 T-B1; witness A REPLACED and witness B
  // RETIRED by T-B4). Named mutant "SPLITDROP": delete the `f.raiser ? … :`
  // condition in the FALLBACK arm so the ALIAS compare runs for every finding,
  // raiser or not — which deletes the named-judge arm along with the condition.
  // Witness A below and C1c at the end of this file are its two witnesses;
  // neither goes through tally(), so they are this module's OWN, direct pin on
  // that branch. MEASURED red set with the mutation record itself, in
  // peer-split-mutants.js :: SPLITDROP.
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

  // ⚠️ WHAT WAS "SPLITDROP witness B" IS RETIRED, and the honest reason is worth
  // more than the test was. It asserted that a raiser-less finding KEEPS a vote
  // carrying a NAMED judge and the raiser's OWN seat id — measured at T-B4
  // round 1 as a 36-case residual and filed as such. Round 2's corrected
  // specification says that vote IS the raiser's own and must be EXCLUDED (P0),
  // so the assertion inverted; and because the seat compare now decides before
  // the fallback, the shipped form and SPLITDROP now agree on it, so it no
  // longer separates them either. It is not deleted — the fixture moved to the
  // P0 block at the end of this file, where it pins the corrected behaviour
  // instead of a disclosed residual. SPLITDROP's second witness is now C1c.
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
// raiser's own and `peersOf` no longer keeps it. Round 2 then NARROWED it at the
// other end — a drop the SEAT ids decided is attributed, not ambiguous, so it is
// never counted here.
//
// Each pin below drives ONE conjunct of the predicate, asserted in the
// expression itself, never inferred from a branch.
//
// ⚠️ `!(v.seat && f.raiserSeat)` USED TO HAVE NO PIN, and the note saying so is
// retired rather than deleted, because how it stopped being true is the lesson.
// While it sat inside the named-raiser arm the XOR beside it already implied it
// (exactly one side truthy => their AND is falsy), so no fixture could make it
// the deciding conjunct and a test claiming to pin it would have been green
// against its own mutant. Round 2 HOISTED it in front of the ternary, where the
// falsy-raiser arm has no XOR to imply it — so it decides, and P0b and P0c at
// the end of this file pin it.
// RE-MEASURED at round 2 over the 1296-case truthiness cross-product of
// (f.raiser, f.raiserSeat, v.judge, v.seat) with 6 values apiece — three falsy
// (`undefined`, `null`, `''`) and three truthy: dropping the hoisted conjunct
// flips 81 cases, ALL 81 with a falsy raiser and ZERO with a named one — and
// dropping it turns 5 tests red, MEASURED against the full suite: P0b, P0c and
// the exhaustive cross-product invariant here, plus tally.test.js's T7b and
// T7d. (An earlier draft named only P0b and P0c, understating it by three.);
// collapsing the ternary to its named arm flips 189 and to its falsy arm 297;
// dropping the XOR flips 27; dropping `v.judge === f.raiser` flips 270; and
// weakening `!v.judge` to `true` flips 243.
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

// v4.8 T-B4 round 2 (P0) — SEATS DECIDE FIRST, whatever `f.raiser` says.
//
// Round 1 shipped the seat compare inside the named-raiser arm and disclosed a
// measured 36-case residual: a falsy raiser whose vote carried a NAMED judge
// and the raiser's OWN seat id was still counted as peer signal. The owner
// ruled that residual closed, and corrected the specification that produced it:
// the "provably not the raiser" clause is the load-bearing half of the
// named-judge rule, and a vote bearing the raiser's own seat id is provably the
// raiser's own vote whatever its `judge` field says.
//
// One principle — attribute when you can, mark only when you cannot (R2):
//   P0  both sides carry a seat id  ⇒ the SEATS decide, for ANY raiser.
//       equal  ⇒ the raiser's own vote ⇒ excluded, and NOT marked: we know
//                what it is, so nothing about it is unattributable.
//       differ ⇒ a real peer ⇒ counted.
//   P1  else, falsy raiser + falsy judge ⇒ unattributable ⇒ excluded AND marked.
//   P2  else, falsy raiser + named judge ⇒ counted.
//   P3  else (named raiser) ⇒ byte-identical to 64b835b8.
//
// ⚠️ Every one of the four candidate spellings was scored against P0-P3 over the
// 1875-case truthiness cross-product of (raiser, raiserSeat, judge, seat,
// verdict) before this one was written — 5 values for each of the four IDENTITY
// fields times the 3 verdicts, 5^4 x 3 = 1875. Only this one
// reaches zero: 64b835b8 violates P0 in 90 cases and P1 in 567; round 1's form
// violates P0's peer rule in 90 and P0's no-mark rule in 108; the
// "named judge AND not the raiser's own seat" variant violates them in 54 and
// 108. Numbers re-derived against the CORRECTED properties, not carried over.
describe('peersOf — the seats decide first, for any raiser (v4.8 T-B4 round 2, P0)', () => {
  test('P0a: no raiser, a NAMED judge whose seat EQUALS raiserSeat — the raiser\'s own vote, excluded', () => {
    // This is round 1's disclosed residual, inverted. It is the fixture that was
    // "SPLITDROP witness B" and asserted the opposite.
    const f = { id: 'F1', raiserSeat: 'x#1' };
    const votes = [{ judge: 'x', verdict: 'agree', seat: 'x#1' }];
    expect(peersOf(f, votes)).toEqual([]);
    // ⚠️ NOT marked. The seats attributed it, so nothing here is ambiguous —
    // marking it would make one number mean two different things.
    expect(unattributedPeerDrops(f, votes)).toBe(0);
  });

  test('P0b: no raiser, NO judge, but the seats DIFFER — provably a real peer, counted', () => {
    // The mirror, and the case round 1 got wrong in the other direction: it
    // dropped this vote for having no judge and MARKED it, when the seat ids
    // already prove it is not the raiser's. Nothing is unattributable here.
    const f = { id: 'F1', raiserSeat: 'x#1' };
    const votes = [{ verdict: 'agree', seat: 'x#2' }];
    expect(peersOf(f, votes)).toEqual(votes);
    expect(unattributedPeerDrops(f, votes)).toBe(0);
  });

  test('P0c: an EMPTY-STRING raiser and judge (MCP path), seats DIFFER — counted, not marked', () => {
    const f = { id: 'F1', raiser: '', raiserSeat: 'deepseek#1' };
    const votes = [{ judge: '', verdict: 'agree', seat: 'deepseek#2' }];
    expect(peersOf(f, votes)).toEqual(votes);
    expect(unattributedPeerDrops(f, votes)).toBe(0);
  });

  test('P0d: an empty-string SEAT is not a seat id — the pair does not decide, so P1 does', () => {
    // `adjudications[].seat` is `z.string().nullable().optional()`, so '' and
    // null both reach here. Neither is an identity, so neither can attribute a
    // vote: the truthiness guard `(v.seat && f.raiserSeat)` is what keeps them
    // out of the seat branch, and the vote falls through to the falsy-judge rule.
    const f = { id: 'F1', raiserSeat: 'x#1' };
    const votes = [{ judge: '', verdict: 'agree', seat: '' }];
    expect(peersOf(f, votes)).toEqual([]);
    expect(unattributedPeerDrops(f, votes)).toBe(1);
  });
});

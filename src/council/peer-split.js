// src/council/peer-split.js
'use strict';

/**
 * @module council/peer-split
 * The peer-split predicate: which adjudications on a finding count as PEER
 * signal, excluding the raiser's own vote — and, since v4.8 T-B4, excluding
 * every vote that CANNOT BE TOLD APART from the raiser's own. Extracted
 * verbatim from tally.js@115bc861:93-112 (v4.8 Phase 2 T-B1, zero behavior
 * change); T-B4 is the first change to what it computes. BOTH consumers call
 * it: tally.js since T-B1, debate.js since
 * T-B2 — which is this module's whole reason to exist, because the tally the
 * chair reads and the defense brief the raiser reads must be ONE computation,
 * not two spellings of it. The exact tally.js comment split this extraction
 * made is recorded in task-1-report.md
 * (.superpowers/sdd/2026-08-19-v48-t23-peer-split/, gitignored). SPLITDROP's
 * own mutation record no longer lives there — it is beside the predicate
 * below, in the tree, the way NAIVESPLIT's and ZEROEMIT's already are.
 *
 * ⚠️ REQUIRE-FREE by design, like ./seats and ./run-stats-entry: debate.js's
 * own docblock declares it DI-free, so any module it requires must itself
 * pull in nothing else. Do not add a `require` call here — a pin
 * (tests/council/peer-split.test.js) scans this file's raw text for the word
 * `require` immediately followed by an opening parenthesis, so it fires on
 * that sequence ANYWHERE, including inside a comment, not only inside a real
 * statement.
 */

/**
 * Peer votes for one finding: every adjudication in `votes` EXCEPT the
 * raiser's own, when a raiser is known (`f.raiser` truthy); when it is not,
 * every vote whose `judge` is NAMED — a vote with no judge could be the
 * unnamed raiser's own, so it is dropped and counted by
 * `unattributedPeerDrops` below (v4.8 T-B4).
 * @param {{raiser?: string, raiserSeat?: string}} f - the finding
 * @param {Array<{judge?: string, seat?: string, verdict?: string}>} votes - its adjudications
 * @returns {Array} the peer-filtered votes
 */
function peersOf(f, votes) {
  // Only exclude the raiser's own vote BY NAME when a raiser is known; the
  // raiser is populated by the orchestrator (not the reviewer JSON), so an
  // unset raiser must not silently drop a real peer vote (L8).
  //
  // v4.8 PR4c §3.3 (#137): compare SEATS when both sides carry one, aliases
  // otherwise. On a twin bench the alias compare drops a twin's real vote —
  // measured on ['deepseek','deepseek','gpt'], one corroborating peer reported
  // as `Singleton {a:0,d:0}`; on three deepseeks the whole cross-review was
  // discarded. The guard is NOT the naive `v.seat !== f.raiserSeat`: both
  // producers are `X && X.id !== alias` over independent bind operations
  // (anonymize.js's raiserSeat over Stage 1, run-assemble.js's adjudication
  // seat over Stage 2), each `|| null` by design, so exactly one side carrying
  // a seat id is ENGINE-reachable in both directions whenever bindSeats
  // orphans a twin leg — and there the naive form reads `undefined !== 'x#1'`
  // and silently promotes a Singleton to Confirmed on the raiser's own vote.
  // debate.js :: debateTargets CALLS this function as of v4.8 T-B2, so the
  // defense brief's peer split can no longer disagree with the tally.
  //
  // Named mutant "SPLITDROP": delete this ternary's outer `f.raiser ? … :`
  // condition so the NAMED-RAISER filter runs UNCONDITIONALLY on every finding,
  // raiser or not — which since T-B4 also deletes the falsy-raiser arm rather
  // than a bare `: votes`. Never shipped — applied, run against the FULL suite,
  // reverted by hand, byte-verified against `git show HEAD:`. RE-MEASURED at
  // T-B4 against the tree that ships. MEASURED red set: 2 suites / 6 tests, out
  // of 541 / 7662. By suite: peer-split 4 · tally 2.
  // ⚠️ That red set MOVED, and the movement is the point rather than a
  // bookkeeping detail: at 64b835b8 it was 2 suites / 9 tests (peer-split 5 ·
  // debate 4), and T-B4 SHRANK it by moving the shipped behaviour toward this
  // mutant's on the plain shapes. Deleting the outer condition now differs from
  // the shipped form only where the two arms disagree — a MIXED-falsy
  // raiser/judge pair (`''` vs `undefined`, where SPLITDROP's
  // `v.judge !== f.raiser` is true and `!!v.judge` is false), and any
  // seat-carrying vote on a raiser-less finding. debate.test.js's T5 block no
  // longer separates them at all, and tally.test.js's T7b/T7d newly do. Do not
  // read a smaller red set as a weaker pin here: it is a narrower TRUE one.
  //
  // Named mutant "NAIVESPLIT" (v4.8 T-B2): replace the whole INNER ternary
  // with the unguarded, seat-valued `v.seat !== f.raiserSeat`, keeping the
  // outer `f.raiser ?` condition (that one is SPLITDROP's). Never shipped —
  // applied, run against the FULL suite, reverted by hand, byte-verified
  // against `git show HEAD:`. RE-MEASURED at T-B4 against the tree that ships —
  // re-run, never renumbered, because editing a recorded number ASSERTS the red
  // set still holds and that assertion is what produced T-B3's Critical.
  // MEASURED red set: 17 suites / 98 tests, out of 541 / 7662. By suite:
  //   run-debate 50 · tally 11 · debate 5 · peer-split 5 ·
  //   seat-parity-ondisk 5 · report 4 · report-claude-column 4 ·
  //   report-debate 2 · run-claude-review 2 · run-no-cost-gate 2 ·
  //   seat-matrix 2 · cli-handlers-council 1 · council-events 1 · ledger 1 ·
  //   mcp-server 1 · run-assemble 1 · run-cost-bijection 1.
  // The one moved count is tally 10 -> 11: T-B4's new T8b CONTROL names a
  // raiser on a unique-alias bench, which is exactly where NAIVE reads
  // `undefined !== undefined` and drops a real peer.
  // ⚠️ That measurement RETIRES a claim this repo carried in three places —
  // "T1 and T2 are the ONLY tests separating GUARDED from NAIVE". They are
  // not, and not even within their own file: 9 of tally.test.js's 11 reds are
  // neither (8 of 10 at the first reading; T-B4's T8b CONTROL is the 9th). NAIVE breaks the ORDINARY unique-alias bench, where it reads
  // `undefined !== undefined` and drops a real peer, so most of this suite
  // separates the two spellings. T1/T2 remain the only tests pinning the
  // one-side-seated TWIN directions, which is the narrower true statement.
  //
  // v4.8 T-B4 (council C1 on PR #174, chair verdict "fix these first") changed
  // the FALSY-raiser arm, which until then handed `votes` back whole. `''` and
  // `undefined` are not identities (ruling R2), so a vote whose `judge` is also
  // falsy may be the unnamed raiser's own — and it was being counted as peer
  // signal. Measured on the council's fixture: `raiser:''` with votes
  // `['' agree, 'gpt' agree]` gave `basis {a:2}` Confirmed SOLID where the
  // named-raiser control gives `{a:1}` thin, with nothing emitted to say so.
  // Reachable in production: mcp-tools.js:416 declares a bare `z.string()` for
  // `raiser`, so '' validates, and that path reaches the append-only ledger.
  // The defect is PRE-EXISTING — measured at base e7cf54b0, the tally read
  // `{a:2}` there too — so T-B2 propagated it to the brief rather than causing
  // it. R2 governs the fix: mark explicitly, attribute nothing.
  //
  // The arm keeps every NAMED judge, which is what L8's rationale actually
  // protects — a named judge is not the unnamed raiser, so no real peer is
  // dropped for want of a raiser. What stops is the silent self-corroboration.
  //
  // ⚠️ The seat compare deliberately stays INSIDE the named-raiser arm. Both
  // placements were built and enumerated over the 1875-case truthiness
  // cross-product of (raiser, raiserSeat, judge, seat, verdict), 5 values
  // apiece: running the seat compare first for a falsy raiser costs 54 cases
  // where a vote the seats prove is NOT the raiser's is dropped for having no
  // judge (violating T-B4 property 1) and 36 where a NAMED judge is dropped
  // because its seat matches (violating property 2, L8's own concern). The
  // shipped form violates neither, and buys those 36 back as a KNOWN RESIDUAL:
  // a falsy raiser plus a named judge whose `seat` EQUALS `f.raiserSeat` is
  // provably the raiser's own vote and is still counted. That residual is
  // UNCHANGED from `64b835b8` — T-B4 closed the alias-space hole, not the seat-
  // space one — it is the same class R2 defers (SI-22.1 / SI-22.2), and
  // tests/council/peer-split.test.js's SPLITDROP witness B pins it in the open
  // rather than leaving it undescribed.
  //
  // Named mutant "SELFCORROB" (v4.8 T-B4), guarding exactly that arm: revert it
  // to `: votes`, i.e. pre-T-B4 behaviour, so an unnamed raiser corroborates
  // itself again. Never shipped — applied, run against the FULL suite, reverted
  // by hand, byte-verified against `git show HEAD:`. MEASURED red set: 3 suites
  // / 15 tests, out of 541 / 7662. By suite: peer-split 8 · debate 4 · tally 3.
  // Note what the 8 in peer-split are: the four C1 pins, both rewritten
  // falsy-arm drop pins, SPLITDROP witness A, and the exhaustive cross-product
  // invariant — which fires because reverting `peersOf` without reverting
  // `unattributedPeerDrops` makes the mark count votes the filter KEPT. The
  // three in tally.test.js are T8a and the two R8-stamp shapes T7b/T7d, whose
  // `basis`/mark assertions exist for exactly this reason.
  const peers = f.raiser
    ? votes.filter(v => (v.seat && f.raiserSeat) ? v.seat !== f.raiserSeat : v.judge !== f.raiser)
    : votes.filter(v => !!v.judge);
  // The filter above still has THREE branches: the OUTER `f.raiser ? … : …`
  // picks between the named-raiser filter and the falsy-raiser one, and inside
  // the named-raiser filter the seat branch and the alias branch. `peers` can
  // still hold seat-carrying votes with the seat branch never having run — a
  // falsy raiser reaches them through the NAMED-judge arm now, not through an
  // unfiltered pass-through. What CHANGED for tally.js's `sameModelCorroboration`
  // stamp is that every such vote now has a NAMED judge, so its
  // `v.judge === f.raiser` can no longer read `undefined === undefined` on the
  // CLI path (cli-handlers-council.js parses raw JSON with no schema) or
  // `'' === ''` on the MCP path (whose z.string() accepts the empty string).
  // That is why the stamp's own `f.raiser &&` guard is now defense in depth
  // rather than a decider — measured at its site, not inferred here.
  return peers;
}

/**
 * How many of `votes` `peersOf` excluded WITHOUT being able to attribute them.
 * Two families, one per arm of `peersOf`:
 *   - raiser NAMED: the drop happened on the ALIAS branch while exactly ONE
 *     side of the pair carried a seat id — the finding has a `raiserSeat` and
 *     the vote has no `seat`, or the reverse. A seat-less `deepseek` vote
 *     cannot be told apart from the raiser's own, so dropping it is the safe
 *     call AND may be discarding a real twin's signal (SI-22.1 / SI-22.2).
 *   - raiser FALSY (v4.8 T-B4): the vote's `judge` is falsy too, so it may be
 *     the unnamed raiser's own. ⚠️ The test is `!v.judge`, NOT
 *     `v.judge === f.raiser` — the pair is judged by TRUTHINESS, so a
 *     `raiser:''` finding beside a `judge:undefined` vote is the same
 *     unattributable pair as `''`/`''` and an `===` spelling would miss it.
 * This number is what says so out loud instead of leaving the drop silently
 * correct.
 *
 * Both documents call THIS function rather than each spelling the count, so
 * tally.json's mark and the defense brief's mark agree by construction.
 * @param {{raiser?: string, raiserSeat?: string}} f - the finding
 * @param {Array<{judge?: string, seat?: string, verdict?: string}>} votes - its adjudications
 * @returns {number} how many exclusions nobody can attribute (0 when none)
 */
function unattributedPeerDrops(f, votes) {
  // ⚠️ `f.raiser` was a leading `&&` guard until v4.8 T-B4 and is now the
  // TERNARY CONDITION, because the two arms of `peersOf` drop for two different
  // reasons and this function must count both. The guard existed because a
  // falsy raiser used to drop nothing at all, so any non-zero count would have
  // announced a drop that never happened; T-B4 made those drops real, and the
  // same fixtures that pinned 0 now pin 1.
  //
  // ⚠️ `!(v.seat && f.raiserSeat)` is DOCUMENTATION, not a live test, and is
  // deliberately left unpinned: it names the `peersOf` branch this counts, but
  // the XOR beside it already implies it (exactly one side truthy ⇒ their AND
  // is falsy). RE-MEASURED at T-B4 against the widened predicate, over the
  // 1296-case truthiness cross-product of (f.raiser, f.raiserSeat, v.judge,
  // v.seat) with 6 values apiece, three falsy and three truthy: dropping
  // `!(v.seat && f.raiserSeat)` still flips ZERO — so no fixture can make that
  // conjunct the deciding one, and a test claiming to pin it would be green
  // against its own mutant. Collapsing the ternary to its named arm flips 270
  // and to its falsy arm 378; dropping the XOR flips 27; dropping
  // `v.judge === f.raiser` flips 270; weakening `!v.judge` to `true` flips 324.
  // Those four ARE pinned, one apiece, in tests/council/peer-split.test.js.
  //
  // Named mutant "ZEROEMIT" (v4.8 T-B2), guarding the EMIT rule both callers
  // share — present only when > 0, so a run that does not orphan one side of a
  // twin pair is byte-for-byte unchanged. Mutation: emit unconditionally at
  // both sites (`unattributedPeerDrops: drops`, zero included). Never shipped —
  // applied, run against the FULL suite, reverted by hand, byte-verified.
  // MEASURED red set, re-taken at T-B4 against the tree that ships:
  // 4 suites / 6 tests, out of 541 / 7662.
  //   BEHAVIOURAL — the three absence pins written for this change, plus one
  //   T-B4 added:
  //     tally.test.js T3b · debate.test.js T6b · debate.test.js T6c ·
  //     tally.test.js T8b (the C1 control, which asserts the key is ABSENT on a
  //     named raiser and so notices a stray zero for free).
  //   SCHEMA-MEDIATED — both caused by `"minimum": 1` on
  //   council-tally.schema.json's `findings[].unattributedPeerDrops`, which
  //   rejects a present-and-zero key:
  //     run-schema-debate.test.js "a document that does not orphan a twin leg
  //     omits the key and still validates" · schemas.test.js
  //     "council-tally.schema.json accepts tally() output" — the PRE-EXISTING
  //     whole-family check, which nobody wrote for this field.
  //
  // ⚠️ THIS RECORD WAS WRONG BETWEEN e23e56cd AND ITS CORRECTION, and how it
  // went wrong matters more than the number. It read "exactly 3 tests … nothing
  // else in 541 suites notices a stray zero-valued key … that byte-identity
  // property rests on those three pins and nothing else." That was TRUE when
  // written. Then c2e1f9d0 — the SAME task's own fix round — added the schema
  // declaration with `minimum: 1`, which silently made it false, and nothing
  // re-measured the record against the final tree. A number that lives in
  // `src/` is reachable by no gate; only a re-run reaches it. Re-run any mutant
  // record in this file whose guarded expression OR its consumers changed.
  //
  // The correction runs in the SAFE direction, which is why it had to be made
  // rather than left: an engineer reading "rests on those three pins and
  // nothing else" would conclude `minimum: 1` is removable decoration. It is
  // not — it is the fourth and fifth guard. run-schema-debate.test.js says the
  // same thing from its own side and defers the count to here.
  return votes.filter(v => (f.raiser
    ? (!(v.seat && f.raiserSeat) && (!!v.seat !== !!f.raiserSeat) && v.judge === f.raiser)
    : !v.judge)).length;
}

module.exports = { peersOf, unattributedPeerDrops };

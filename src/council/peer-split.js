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
 * Peer votes for one finding: every adjudication in `votes` except the ones
 * that are, or might be, the raiser's own. One principle — attribute when you
 * can, mark only when you cannot (ruling R2) — in three branches:
 *   P0  the vote AND the finding both carry a seat id ⇒ the SEATS decide, for
 *       ANY raiser. Equal ⇒ the raiser's own vote, excluded and NOT marked
 *       (we know what it is). Different ⇒ a real peer, counted.
 *   P3  else, a NAMED raiser ⇒ exclude by alias, exactly as before v4.8 T-B4.
 *   P1/P2  else (falsy raiser) ⇒ keep every NAMED judge, because a named judge
 *       is provably not the unnamed raiser; drop every falsy one, because it
 *       may be the raiser's own, and count it in `unattributedPeerDrops`.
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
  // Named mutant "SPLITDROP": delete the `f.raiser ? … :` condition in the
  // FALLBACK arm so the ALIAS compare runs for every finding, raiser or not —
  // which deletes the named-judge arm along with the condition. ⚠️ Its MEANING
  // moved twice inside T-B4, and this record says so rather than reading as if
  // it never had: at 64b835b8 the condition was the OUTER `f.raiser ? … : votes`;
  // round 1 kept it outer over a filtering arm; round 2 lifted the seat compare
  // above it, so what is left to delete is the fallback's own condition. The
  // mutation is one idea throughout — make the alias compare unconditional — and
  // it is what the witnesses in tests/council/peer-split.test.js are named for.
  // Never shipped — applied, run against the FULL suite, reverted by hand,
  // byte-verified against `git show HEAD:`.
  // MEASURED red set: 1 suite / 4 tests, out of 541 / 7665. By suite:
  // peer-split 4 — witness A, C1c, P0d, and the exhaustive cross-product
  // invariant.
  // ⚠️ It has SHRUNK at every step (2 suites / 9 tests at 64b835b8 — peer-split 5
  // · debate 4; 2 / 6 after round 1 — peer-split 4 · tally 2; 1 / 4 now —
  // peer-split only), because each round moved the shipped behaviour closer to
  // this mutant's on the shapes the other tests use. ROUND 1 took debate.test.js
  // away: its T5 block stopped separating the two once the shipped falsy arm
  // began dropping same-falsy pairs, exactly as this mutant does. ROUND 2 took
  // tally.test.js away: T7b/T7d reach the SEAT compare, and P0 settles that
  // before the fallback this mutant edits. What still
  // separates them is a MIXED-falsy raiser/judge pair — `''` beside `undefined`,
  // where the alias compare reads true and `!!v.judge` reads false. Do not read
  // a smaller red set as a weaker pin: it is a narrower TRUE one.
  //
  // Named mutant "NAIVESPLIT" (v4.8 T-B2): replace the whole seat-guarded
  // ternary with the unguarded, seat-valued `v.seat !== f.raiserSeat`, i.e. drop
  // both the `(v.seat && f.raiserSeat)` guard and every fallback branch. (The
  // `f.raiser ?` condition inside the fallback is SPLITDROP's, not this one's.) Never shipped —
  // applied, run against the FULL suite, reverted by hand, byte-verified
  // against `git show HEAD:`. RE-MEASURED at T-B4 against the tree that ships —
  // re-run, never renumbered, because editing a recorded number ASSERTS the red
  // set still holds and that assertion is what produced T-B3's Critical.
  // MEASURED red set: 17 suites / 109 tests, out of 541 / 7665. By suite:
  //   run-debate 50 · tally 13 · peer-split 11 · debate 8 ·
  //   seat-parity-ondisk 5 · report 4 · report-claude-column 4 ·
  //   report-debate 2 · run-claude-review 2 · run-no-cost-gate 2 ·
  //   seat-matrix 2 · cli-handlers-council 1 · council-events 1 · ledger 1 ·
  //   mcp-server 1 · run-assemble 1 · run-cost-bijection 1.
  // It has GROWN across T-B4 (97 at 64b835b8, 98 after round 1, 109 now) purely
  // because T-B4 added tests in the files NAIVE already broke — the suite list
  // is unchanged at 17.
  // ⚠️ That measurement RETIRES a claim this repo carried in three places —
  // "T1 and T2 are the ONLY tests separating GUARDED from NAIVE". They are
  // not, and not even within their own file: 11 of tally.test.js's 13 reds are
  // neither (8 of 10 at the first reading, 9 of 11 after T-B4 round 1). NAIVE breaks the ORDINARY unique-alias bench, where it reads
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
  // The falsy-raiser branch keeps every NAMED judge, which is what L8's
  // rationale actually protects — a named judge is provably not the unnamed
  // raiser, so no real peer is dropped for want of a raiser. What stops is the
  // silent self-corroboration.
  //
  // ⚠️ WHY THE SEAT COMPARE RUNS FIRST, FOR ANY RAISER, AND NOT INSIDE THE
  // NAMED-RAISER BRANCH. T-B4 round 1 put it inside, on the reading that a
  // NAMED judge always counts beside a falsy raiser. Measured, that left 36
  // cases where a vote carrying the raiser's OWN seat id was counted as its own
  // peer signal — self-corroboration through a second door, the same defect the
  // council raised one layer down. The clause that matters is "provably not the
  // raiser", and a seat id is the strongest proof either way: it decides FIRST,
  // and only when it cannot decide does the judge field get a say.
  //
  // Four spellings were enumerated over the 1875-case truthiness cross-product
  // of (raiser, raiserSeat, judge, seat, verdict) — 5 values for each of the
  // four IDENTITY fields (`undefined`, `null`, `''` and two distinct names or
  // seat ids) times the 3 verdicts, so 5^4 x 3 = 1875, not 5^5 — and scored
  // against P0-P3 above. Only this one reaches zero violations. `64b835b8`
  // breaks P0 in 90 cases and P1 in 567; T-B4 round 1's form breaks P0's peer
  // rule in 90 and its no-mark rule in 108; a "named judge AND not the raiser's
  // own seat" variant breaks them in 54 and 108. The 36-case residual round 1
  // disclosed is measured at ZERO here.
  //
  // Named mutant "SELFCORROB" (v4.8 T-B4): restore `64b835b8`'s whole predicate
  // — `f.raiser ? <the inner ternary> : votes` — so an unnamed raiser
  // corroborates itself again. It is the "T-B4 never happened" mutant and its
  // red set is the whole T-B4 pin surface. Never shipped — applied, run against
  // the FULL suite, reverted by hand, byte-verified against `git show HEAD:`.
  // MEASURED red set: 3 suites / 15 tests, out of 541 / 7665. By suite:
  // peer-split 10 · debate 4 · tally 1.
  // ⚠️ The TOTAL is identical to round 1's reading and the COMPOSITION is not
  // (peer-split 8 -> 10, tally 3 -> 1), which is why it was re-run rather than
  // carried: T7b and T7d stopped separating this mutant, because reverting to
  // `: votes` also keeps the seat-DIFFER vote those two fixtures assert is
  // counted. Two matching totals are not evidence of a matching red set.
  //
  // Named mutant "SEATBLIND" (v4.8 T-B4 round 2), guarding P0's reach: restore
  // round 1's placement — `f.raiser ? <the inner ternary> : votes.filter(v =>
  // !!v.judge)` — so the seat compare runs only for a NAMED raiser. It differs
  // from the shipped form on exactly the shapes P0 was added for, and it is a
  // separate mutant from SELFCORROB because it keeps the C1 fix while dropping
  // the correction to it. Never shipped, same application/revert/verify
  // discipline. MEASURED red set: 2 suites / 5 tests, out of 541 / 7665. By
  // suite: peer-split 3 (P0a, P0b, P0c) · tally 2 (T7b, T7d) — which is exactly
  // the set that was RED before round 2's source change and GREEN after it.
  const peers = votes.filter(v => (v.seat && f.raiserSeat)
    ? v.seat !== f.raiserSeat                       // P0 — the seats decide
    : f.raiser ? v.judge !== f.raiser               // P3 — the alias compare
      : !!v.judge);                                 // P1/P2 — named, or nothing
  // The filter above has THREE branches and they are ORDERED: the seat compare
  // decides first and does not consult `f.raiser` at all, so `peers` never
  // holds a vote carrying the raiser's own seat id, whatever its `judge` says.
  // It CAN hold a seat-carrying vote whose judge is falsy — that is P0
  // admitting a provable peer — which is why tally.js's `sameModelCorroboration`
  // guard still has to reckon with `v.judge === f.raiser` reading
  // `undefined === undefined` on the CLI path (cli-handlers-council.js parses
  // raw JSON with no schema) and `'' === ''` on the MCP path (whose z.string()
  // accepts the empty string). Measured at that guard's own site, its leading
  // `f.raiser &&` is a DECIDER again after round 2.
  return peers;
}

/**
 * How many of `votes` `peersOf` excluded WITHOUT being able to attribute them.
 * Two families, one per FALLBACK arm of `peersOf` (never a seat-decided drop):
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
 * ⚠️ NEITHER family includes a drop the SEATS decided (P0). When the vote and
 * the finding both carry a seat id the engine knows whose vote it is, so
 * excluding it ATTRIBUTES it rather than losing it, and it is not counted here.
 * That is what the leading `!(v.seat && f.raiserSeat)` says. Marking an
 * attributed drop would make one number mean two different things.
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
  // TERNARY CONDITION, because the two FALLBACK arms of `peersOf` drop for two
  // different reasons and this function must count both. The guard existed
  // because a falsy raiser used to drop nothing at all, so any non-zero count
  // would have announced a drop that never happened; T-B4 made those drops real,
  // and the same fixtures that pinned 0 now pin 1.
  //
  // ⚠️ `!(v.seat && f.raiserSeat)` IS NOW A DECIDER AND IS NOW PINNED — retiring
  // a claim this file carried from T-B2 through T-B4 round 1, which read
  // "DOCUMENTATION, not a live test … dropping it flips ZERO … a test claiming
  // to pin it would be green against its own mutant." That was true while it sat
  // inside the named-raiser arm, where the XOR beside it already implied it
  // (exactly one side truthy ⇒ their AND is falsy). Round 2 HOISTED it in front
  // of the ternary to state what P0 requires — a seat-decided exclusion is
  // attributed, so it is never marked — and in the falsy-raiser arm there is no
  // XOR to imply it.
  // RE-MEASURED at round 2 over the 1296-case truthiness cross-product of
  // (f.raiser, f.raiserSeat, v.judge, v.seat), 6 values apiece, three falsy and
  // three truthy: dropping the hoisted conjunct flips 81 cases — ALL 81 in the
  // falsy-raiser arm and ZERO in the named one, so the retired sentence was
  // right about where the conjunct WAS and wrong the moment it moved.
  // Collapsing the ternary to its named arm flips 189 and to its falsy arm 297;
  // dropping the XOR flips 27; dropping `v.judge === f.raiser` flips 270;
  // weakening `!v.judge` to `true` flips 243. All five ARE pinned. The hoisted
  // conjunct's own MEASURED red set, taken by dropping it and running the FULL
  // suite: 2 suites / 5 tests, out of 541 / 7665 — peer-split 3 (P0b, P0c and
  // the exhaustive cross-product invariant) and tally 2 (T7b, T7d). An earlier
  // draft of this line said "P0b and P0c", which UNDERSTATED it by three; the
  // count is measured now rather than named from the tests written for it.
  //
  // Named mutant "ZEROEMIT" (v4.8 T-B2), guarding the EMIT rule both callers
  // share — present only when > 0, so a run that does not orphan one side of a
  // twin pair is byte-for-byte unchanged. Mutation: emit unconditionally at
  // both sites (`unattributedPeerDrops: drops`, zero included). Never shipped —
  // applied, run against the FULL suite, reverted by hand, byte-verified.
  // MEASURED red set, re-taken at T-B4 round 2 against the tree that ships:
  // 4 suites / 8 tests, out of 541 / 7665.
  //   BEHAVIOURAL — the three absence pins written for this change, plus three
  //   T-B4 added:
  //     tally.test.js T3b · debate.test.js T6b · debate.test.js T6c ·
  //     tally.test.js T8b (the C1 control) · tally.test.js T7b · T7d (the two
  //     P0 shapes, which assert the key is ABSENT on a seat-decided vote — a
  //     drop nobody made, so a zero there would be doubly wrong).
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
  return votes.filter(v => !(v.seat && f.raiserSeat) && (f.raiser
    ? ((!!v.seat !== !!f.raiserSeat) && v.judge === f.raiser)
    : !v.judge)).length;
}

module.exports = { peersOf, unattributedPeerDrops };

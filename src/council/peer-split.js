// src/council/peer-split.js
'use strict';

/**
 * @module council/peer-split
 * The peer-split predicate: which adjudications on a finding count as PEER
 * signal, excluding the raiser's own vote when a raiser is known. Extracted
 * verbatim from tally.js@115bc861:93-112 (v4.8 Phase 2 T-B1, zero behavior
 * change). BOTH consumers now call it: tally.js since T-B1, debate.js since
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
 * raiser's own, when a raiser is known (`f.raiser` truthy); `votes`
 * unfiltered when it is not.
 * @param {{raiser?: string, raiserSeat?: string}} f - the finding
 * @param {Array<{judge?: string, seat?: string, verdict?: string}>} votes - its adjudications
 * @returns {Array} the peer-filtered votes
 */
function peersOf(f, votes) {
  // Only exclude the raiser's own vote when a raiser is known; the raiser is
  // populated by the orchestrator (not the reviewer JSON), so an unset raiser
  // must not silently drop a real peer vote (L8).
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
  // condition so the filter runs UNCONDITIONALLY on every finding, raiser or
  // not. Never shipped — applied, run against the FULL suite, reverted by
  // hand, byte-verified (v4.8 T-B3, 2026-08-19). MEASURED red set: 2 suites /
  // 9 tests, out of 541 / 7655. By suite: peer-split 5 · debate 4.
  //
  // Named mutant "NAIVESPLIT" (v4.8 T-B2): replace the whole INNER ternary
  // with the unguarded, seat-valued `v.seat !== f.raiserSeat`, keeping the
  // outer `f.raiser ?` condition (that one is SPLITDROP's). Never shipped —
  // applied, run against the FULL suite, reverted by hand, byte-verified.
  // MEASURED red set: 17 suites / 97 tests, out of 541 / 7652. By suite:
  //   run-debate 50 · tally 10 · seat-parity-ondisk 5 · peer-split 5 ·
  //   debate 5 · report 4 · report-claude-column 4 · seat-matrix 2 ·
  //   run-no-cost-gate 2 · run-claude-review 2 · report-debate 2 ·
  //   council-events 1 · mcp-server 1 · run-cost-bijection 1 ·
  //   run-assemble 1 · ledger 1 · cli-handlers-council 1.
  // ⚠️ That measurement RETIRES a claim this repo carried in three places —
  // "T1 and T2 are the ONLY tests separating GUARDED from NAIVE". They are
  // not, and not even within their own file: 8 of tally.test.js's 10 reds are
  // neither. NAIVE breaks the ORDINARY unique-alias bench, where it reads
  // `undefined !== undefined` and drops a real peer, so most of this suite
  // separates the two spellings. T1/T2 remain the only tests pinning the
  // one-side-seated TWIN directions, which is the narrower true statement.
  const peers = f.raiser
    ? votes.filter(v => (v.seat && f.raiserSeat) ? v.seat !== f.raiserSeat : v.judge !== f.raiser)
    : votes;
  // The filter above has THREE branches: the OUTER `f.raiser ? … : votes`
  // skips it entirely, so `peers` can hold seat-carrying votes with the seat
  // branch never having run, and `v.judge === f.raiser` is then
  // `undefined === undefined` on a hand-assembled document that names no
  // models (cli-handlers-council.js parses raw JSON with no schema), and
  // `'' === ''` on the MCP path, whose z.string() accepts the empty string and
  // whose output reaches the append-only ledger.
  return peers;
}

/**
 * How many of `votes` `peersOf` excluded on its ALIAS branch while exactly ONE
 * side of the pair carried a seat id — the finding has a `raiserSeat` and the
 * vote has no `seat`, or the reverse. Those exclusions are the ones nobody can
 * attribute: a seat-less `deepseek` vote cannot be told apart from the raiser's
 * own, so dropping it is the safe call AND may be discarding a real twin's
 * signal. This number is what says so out loud instead of leaving the drop
 * silently correct (SI-22.1 / SI-22.2).
 *
 * Both documents call THIS function rather than each spelling the count, so
 * tally.json's mark and the defense brief's mark agree by construction.
 * @param {{raiser?: string, raiserSeat?: string}} f - the finding
 * @param {Array<{judge?: string, seat?: string, verdict?: string}>} votes - its adjudications
 * @returns {number} how many the one-sided alias fallback excluded (0 when none)
 */
function unattributedPeerDrops(f, votes) {
  // ⚠️ The leading `f.raiser &&` is LOAD-BEARING, not decoration. When
  // `f.raiser` is falsy `peersOf` returns `votes` WHOLE and excludes nothing,
  // so this count must be 0. Without the guard `v.judge === f.raiser` reads
  // `undefined === undefined` on the CLI path (cli-handlers-council.js is a raw
  // JSON.parse with no schema) and `'' === ''` on the MCP path (mcp-tools.js's
  // z.string() accepts the empty string), and the mark would announce drops
  // that never happened. Same shape as tally.js's sameModelCorroboration guard.
  //
  // ⚠️ `!(v.seat && f.raiserSeat)` is DOCUMENTATION, not a live test, and is
  // deliberately left unpinned: it names the `peersOf` branch this counts, but
  // the XOR beside it already implies it (exactly one side truthy ⇒ their AND
  // is falsy). Measured over the 1296-case truthiness cross-product of
  // (f.raiser, f.raiserSeat, v.judge, v.seat): dropping `f.raiser &&` flips 64
  // cases, dropping the XOR flips 32, dropping `v.judge === f.raiser` flips
  // 160, and dropping `!(v.seat && f.raiserSeat)` flips ZERO — so no fixture
  // can make that conjunct the deciding one, and a test claiming to pin it
  // would be green against its own mutant. The other three ARE pinned one
  // apiece in tests/council/peer-split.test.js.
  //
  // Named mutant "ZEROEMIT" (v4.8 T-B2), guarding the EMIT rule both callers
  // share — present only when > 0, so a run that does not orphan one side of a
  // twin pair is byte-for-byte unchanged. Mutation: emit unconditionally at
  // both sites (`unattributedPeerDrops: drops`, zero included). MEASURED red
  // set: exactly 3 tests, and all three are the absence pins written for this
  // change — tally.test.js T3b, debate.test.js T6b and T6c. Nothing else in
  // 541 suites notices a stray zero-valued key, on disk or in memory, so that
  // byte-identity property rests on those three pins and nothing else.
  return votes.filter(v => f.raiser && !(v.seat && f.raiserSeat)
    && (!!v.seat !== !!f.raiserSeat) && v.judge === f.raiser).length;
}

module.exports = { peersOf, unattributedPeerDrops };

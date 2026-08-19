// src/council/peer-split.js
'use strict';

/**
 * @module council/peer-split
 * The peer-split predicate: which adjudications on a finding count as PEER
 * signal, excluding the raiser's own vote when a raiser is known. Extracted
 * verbatim from tally.js@115bc861:93-112 (v4.8 Phase 2 T-B1, zero behavior
 * change) — tally.js now requires and calls it. T-B2 gives debate.js its own
 * matching require, in a separate commit. The exact tally.js comment split
 * and the SPLITDROP mutation record are in task-1-report.md
 * (.superpowers/sdd/2026-08-19-v48-t23-peer-split/).
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
  // debate.js's peerVerdicts moves with this in the SAME commit, or the
  // defense brief's peer split disagrees with the tally the chair reads.
  //
  // Named mutant "SPLITDROP": delete this ternary's outer `f.raiser ? … :`
  // condition so the filter runs UNCONDITIONALLY on every finding, raiser or
  // not. Never shipped — applied post-commit, measured, then reverted by
  // hand; the measured red set is recorded in task-1-report.md.
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

module.exports = { peersOf };

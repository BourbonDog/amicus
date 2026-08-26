'use strict';
// v4.8 PR5c: deadSeats, split out of live-seats.js for the 300-line gate — the FOURTH
// extraction this renderer's load-order list has absorbed. Moved verbatim from
// live-seats.js (which was itself split out of live-model.js in PR0), then seat-keyed.
// Self-contained: it reads only its four arguments and owns its own isReviewing.
(function () {
  /**
   * The kind/channel admission rule, v4.9 W9 (SI-02). ⚠️ MIRROR — this rule is spelled a
   * second time at `workspace-seats.js :: retriedSeats`, and the two MUST move together
   * (two spellings of one rule is PR5a council finding B1; the mirror is declared in that
   * function's docblock). A renderer module cannot `require` src/ and this file cannot
   * `require` its sibling, so the mirror is enforced behaviourally instead: the drift pin
   * in `tests/workspace/workspace-seats.test.js` drives BOTH consumers with one fixture set.
   *
   * ⚠️ A kind-LESS record IS a degrade (W9 fix round, council C4). Both renderers read
   * `run.json`/`verdict.json` off DISK — `workspace-seats.js :: renderSeatsPanel` even falls back
   * to `verdict.degrades` — i.e. exactly the documents `report.js`'s LEGACYDROP note is about:
   * they can PREDATE kinds, and `utils/degrade.js :: formatDegrade` still serves such a record as
   * 'Notice'. A positive `kind === 'degrade'` silently dropped every one of them.
   *
   * `dead-leg`/`dead-wave` are admitted unconditionally — the skipped-LEG note (`run-stages.js`,
   * fired when the once-only retry never attempted the seat) carries no retry-family field and
   * must still render, with the plain phrasing.
   *
   * `seat-unbound` is admitted GATED, never raw: it is a SHARED channel with SEVEN emit sites
   * (re-counted 2026-08-26 — FOUR arms of `run-retry-notes.js`, one in each of `stage1-bind.js`,
   * `run-debate-revote.js` and `run-stage2.js`) that do NOT mean the same thing. `orphanLegNote`
   * and `reVoteUnboundNote` mean "a leg LANDED but names no seat/judge" — a review that was paid
   * for and rendered, not a lost seat; `run-stage2.js`'s judge-side note names a seat that DID
   * review and merely failed to judge. None of the three carries `retryWaveId` or `firstFailure`
   * (measured), so the retry-family test excludes all three and the BACKLOG's proposed
   * `data.legId` discriminator is subsumed rather than duplicated.
   *
   * ⚠️ The seat conjunct is HONESTLY belt-and-braces HERE and load-bearing in the third twin.
   * Measured: dropping it from this function reds nothing, because `add()` already refuses a
   * candidate with no alias; dropping it from `verdict-seat-loss.js :: deriveSeatLoss` puts an
   * `undefined` into `deadBenchSeats`, which every reader of that list treats as a seat. It is
   * kept in all three so one rule has one spelling — pinned on the verdict side.
   *
   * ⚠️ R-W9a is CLOSED at the PRODUCER (W9 fix round, council A1/C1): `run-retry-notes.js ::
   * skippedWaveNote` emits the `firstFailure` fact its record already carried, so this gate
   * admits that real loss UNCHANGED and the three controls above still fail it.
   */
  function isSeatLoss(d) {
    if (!d || (d.kind !== undefined && d.kind !== 'degrade')) { return false; }
    if (d.channel === 'dead-leg' || d.channel === 'dead-wave') { return true; }
    if (d.channel !== 'seat-unbound') { return false; }
    var data = d.data || {};
    return !!((data.retryWaveId || data.firstFailure) && (data.seatId || data.seat));
  }

  /**
   * D6 (v4.6.2 PR4 Task 2, "dead-seat rows"): announced-dead seats, unioned from the run's own
   * `degrades[]` (the loss channels `isSeatLoss` above admits — the live announcement; shapes
   * verified against src/council/run-retry-notes.js, which since the W9 fix round owns the
   * skipped-path WAVE note too, plus the `retry.skippedDeadLegs` loop still in run-stages.js —
   * anchored BY SYMBOL at v4.9 W9, the old `:155-174` having rotted onto the materialize/repair
   * block) and the verdict's derived `seatLoss` (verdict-seat-loss.js's summarizeSeatLoss /
   * deriveSeatLoss — the critic-loss backstop, kept for verdicts written before `degrades[]`
   * existed, v4.5.2 precedent). De-duped by seat model: `degrades` is scanned FIRST, so a real
   * record's retry marker always beats the backstop's no-data guess for the same seat.
   *
   * `retried` reads `data.retryWaveId` ALONE — narrowed in the W9 fix round, named mutant
   * SKIPRETRIED. That field exists if and only if a retry wave was actually LAUNCHED for the
   * seat: every still-dead-after-retry builder emits it, and both skipped-path notes (the retry
   * never attempted the seat — an unmappable lens loss, an out-of-range index, a zero-model
   * unit, or `overBudget()`) emit none, so they keep the plain phrasing. ⚠️ `firstFailure` is
   * NOT a retry marker: `skippedWaveNote` (the sole `firstFailure`-without-`retryWaveId`
   * producer) describes a seat never retried; every RETRIED seat's builder emits the former.
   *
   * D6 filter (zero usable legs ONLY, "no ghost when a live row already exists"): a candidate
   * already present in `liveSeats` is dropped. Two different things can put it there and both
   * are reasons to suppress: an SL-2 retry actually healed it (a real recovered review), OR
   * (owner-ruled, v4.7 CA-4 dead-seat convergence) the seat never recovered at all but the
   * row-per-launch machinery still gives its dead leg an honest primary ERROR row (every billed
   * leg gets a row now, including failures — run-stages.js/run-assemble.js), so "it has a cost
   * row" no longer implies "it healed". Either way that live row IS the seat's record, and a
   * second "did not review" ghost beside it is a duplicate, not new information — so suppressing
   * here is the ACCEPTED terminal-path behavior: exactly one row per seat, whatever its status.
   * It is the one thing standing between a recovered (or honestly-erred) seat and a duplicate
   * row — the F37 debate-role and RN-11 keyed-row family (seatsFromRunStats, seatCells): an
   * identity that is not carefully matched silently duplicates or overwrites instead of failing.
   *
   * Role-aware D6 (v4.6.3 PR2, spec D3): a bare model match used to suppress regardless of what
   * the LIVE row's role was — so a model that died as critic but whose chair-fallback walk
   * happened to land on that same alias (and succeeded, producing a live `role: 'chair'` cost
   * row) silently erased the dead-critic row it was never a replacement for (spec §5, the PR 102
   * rider). Candidates now carry a `role` — `'critic'` or `null`, decided by `roleOf` below,
   * which since v4.9 W9 (R4) keys on SEAT identity whenever the record and the run can both
   * spell it and falls back to alias equality otherwise (so it no longer mirrors
   * verdict-seat-loss.js :: deriveSeatLoss, which stays alias-keyed on purpose) — and only
   * REVIEWING-role live legs (`seat`/`critic`/`lens:*`) suppress at all; a `'critic'` candidate
   * is cleared only by a live CRITIC-role leg for that seat (alias where no seat id exists),
   * never by a chair/judge/rebuttal/revote row landing on the same model. Hidden dependency: the
   * recovered-critic suppression below (`byRole[key + '|critic']`) relies on `roleFor`'s critic
   * branch (src/council/run-stages.js), which only fires when lenses are absent — safe today
   * only because --critic and --lenses are mutually exclusive (src/cli-handlers-council-run.js's
   * `critic && lenses` check); if that exclusion ever loosens, a healed critic on a lens run
   * would carry role 'seat' and this suppression would render a ghost dead row for it.
   *
   * Old-run resilience (v4.6.3 PR2, spec D4): pre-`degrades[]` runs (v4.5.2) carry the BENCH
   * half of a seat loss only in `seatLoss.deadBenchSeats` (string[] of aliases, deriveSeatLoss)
   * — `degrades[]` never existed on either doc for these runs. Consumed after the critic
   * backstop, candidates get `role: null` (deadBenchSeats carries no critic/bench distinction
   * beyond what `criticRequested` already covers above) and flow through the same dedup and
   * role-aware suppression as every other candidate.
   *
   * ⚠️ v4.8 PR5c corrected HOW that dedup works, and the old description here was
   * wrong once seats were keyed. Candidates arrive in FOUR identity flavours, and the
   * flavour decides both the dedup key and whether the candidate may be absorbed:
   *   'keyed'      a real seat id -> dedup on it; two dead twins are two rows.
   *   'unid'       a wave slot the producer could not name (`seats[i] === null`). A
   *                DISTINCT seat we cannot spell, so it takes a private token; keying
   *                it on the alias is what collapsed two dead twins into one row.
   *   'legacy'     a pre-PR5c record with no seat id anywhere -> dedup on the alias,
   *                which still collapses twins. Disclosed residual R2.
   *   'derivative' seatLoss-sourced. `verdict-seat-loss.js :: deriveSeatLoss` (by SYMBOL — the
   *                old `verdict.js:86` rotted in v4.9 W9, and the function has since left
   *                verdict.js entirely) builds deadBenchSeats FROM the same
   *                dead legs that emit degrades[], so it is always a duplicate and is
   *                the ONLY flavour that may be absorbed by an alias already covered.
   *                Absorbing a real degrade instead would erase an unidentified twin.
   *
   * @param {Array<object>} degrades  run.json's `degrades[]` (may be absent)
   * @param {?object} seatLoss  verdict.json's `seatLoss` (may be absent) —
   *   `criticRequested`/`criticSeated` back the critic candidate above,
   *   `deadBenchSeats` (string[] of aliases) feeds the bench candidates below
   * @param {Array<{model: string}>} liveSeats  seatsFromRunStats(...)'s output
   *   (or any seat list keyed the same way — the live seat map)
   * @param {?{critic: ?string, criticSeat: ?string}} runMeta  run.critic (alias) and
   *   run.criticSeat (the seat id `seats.js :: preflightSeats` resolved for it), each
   *   null/absent when no critic was requested — degrade records carry no role field, so
   *   this is the ONLY way a degrade-sourced candidate is identified as critic
   * @returns {Array<{model: string, seat: ?string, statusText: string, role: ?string}>}
   *   `model` is the ALIAS (what the row displays, what labelOf keys on); `seat` is
   *   the seat id when the record named one, else null.
   */
  function deadSeats(degrades, seatLoss, liveSeats, runMeta) {
    var critic = runMeta && runMeta.critic ? runMeta.critic : null;
    var criticSeat = runMeta && runMeta.criticSeat ? runMeta.criticSeat : null;
    // R4 (v4.9 W9). The old rule was `alias === critic`, which on a bench where one alias holds
    // a critic seat AND a bench seat tagged the WRONG candidate 'critic' — and critic candidates
    // suppress through `byRole`, a map PR5c's seat-keying never reached, so a dead bench twin
    // beside a live critic twin rendered NOTHING. Seat identity decides whenever BOTH sides can
    // spell it; a record with no seat id, or a run with no resolved critic seat (pre-`criticSeat`
    // run.json), keeps the legacy alias rule rather than guessing.
    // ⚠️ W9 fix round (council C3): a truthy key is NOT necessarily seat-space. On the INEXACT
    // twin branch `run-retry-group.js :: recordFailure` keys `firstFailure.seatId` by the ALIAS
    // (residual R3), so the critic's OWN record can arrive keyed 'gpt' against a criticSeat of
    // 'gpt#1' and came back role null — while `verdict-seat-loss.js :: deriveSeatLoss`, comparing
    // `data.seat` to the alias, called that same record a critic loss. The alias arm of the
    // disjunct IS that legacy rule, so the two surfaces agree; it cannot re-open R4, since a real
    // bench-twin id ('gpt#2') equals neither operand.
    function roleOf(key, alias) {
      if (key && criticSeat) { return (key === criticSeat || key === critic) ? 'critic' : null; }
      return critic && alias === critic ? 'critic' : null;
    }
    // ⚠️ Object.create(null) throughout this family (also workspace-render.js's `existing`/`seen`
    // and workspace-app.js's `labelByModel`): a model literally named `toString` is truthy off a
    // bare object, so it was dropped here and — worse — crashed workspace-render.js:212 reading
    // `.children` off an inherited function, killing the seats repaint and every tick after it.
    var seen = Object.create(null);
    var covered = Object.create(null);
    var seenUnid = Object.create(null);
    var order = [];
    // `src` is the candidate's identity flavour — see the four-flavour table in the
    // docblock above, which is what decides the key and the absorb rule.
    function add(key, alias, retried, role, src, slotOf) {
      if (!alias) { return; }
      // ⛔ An 'unid' candidate was originally given NO dedup at all, on the grounds that it is one
      // wave slot and distinct by construction. That holds WITHIN a record's seats[]; it does NOT
      // hold across records, and the same dead-wave record appearing twice rendered four rows for
      // two seats. Deduped on (waveId, slot) instead — its own namespace, never `seen`, so an
      // invented key can never collide with a real alias. (The seat literally named `toString` is
      // why this family refuses keys that share the alias keyspace.)
      if (src === 'unid') {
        var uk = ((slotOf && slotOf.waveId) || '') + '#' + (slotOf ? slotOf.i : 0);
        if (seenUnid[uk]) { return; }
        seenUnid[uk] = true;
      }
      if (src !== 'unid') {
        var k = src === 'keyed' ? key : alias;
        if (seen[k]) { return; }
        if (src === 'derivative' && covered[alias]) { return; }
        seen[k] = true;
      }
      // Covered either way: this alias HAS been announced, so a later seatLoss-derived
      // duplicate naming it must still be absorbed.
      covered[alias] = true;
      var row = {
        model: alias,
        seat: src === 'keyed' ? key : null,
        role: role || null,
        statusText: retried ? 'did not review — retried once' : 'did not review',
      };
      // Set only when true, so every other row's shape is byte-identical to before —
      // several suites assert these rows with an exact toEqual.
      if (src === 'unid') { row.unnamed = true; }
      order.push(row);
    }
    (degrades || []).forEach(function (d) {
      if (!isSeatLoss(d)) { return; }
      var data = d.data || {};
      var retried = !!data.retryWaveId;   // NOT firstFailure — docblock above, mutant SKIPRETRIED
      // ONE shape, TWO channels: `dead-leg` and every admitted `seat-unbound` arm name a
      // single seat through `data.seat` (alias) plus an optional seat id — the partial arm's
      // `data.seatId` (v4.9 W9 P1) or the two missing-leg arms' `firstFailure.seatId`. Only
      // `dead-wave` is a LIST, which is why the branch tests for it rather than for dead-leg.
      if (d.channel !== 'dead-wave') {
        var lk = (data.firstFailure && data.firstFailure.seatId) || data.seatId || null;
        add(lk, data.seat, retried, roleOf(lk, data.seat), lk ? 'keyed' : 'legacy');
      } else {
        // `seats[]` is index-parallel with `models[]` (PR5c Task 1). Its ABSENCE means a
        // legacy record; a null ELEMENT means an unidentified seat. Different statements.
        var hasSeats = Array.isArray(data.seats);
        (data.models || []).forEach(function (m, i) {
          var wk = hasSeats ? data.seats[i] : null;
          add(wk, m, retried, roleOf(wk, m),
            wk ? 'keyed' : (hasSeats ? 'unid' : 'legacy'), { waveId: data.waveId, i: i });
        });
      }
    });
    if (seatLoss && seatLoss.criticRequested && !seatLoss.criticSeated) {
      add(null, seatLoss.criticRequested, false, 'critic', 'derivative');
    }
    if (seatLoss) {
      // Pre-degrades[] era (v4.5.2): the bench half of a seat loss lives only here. Alias
      // strings; deriveSeatLoss does not dedup — `seen` absorbs repeats and degrade-sourced
      // duplicates.
      (seatLoss.deadBenchSeats || []).forEach(function (m) { add(null, m, false, null, 'derivative'); });
    }
    // Role-aware D6 (v4.6.3 PR2): only REVIEWING-role live legs suppress — a chair/judge/
    // rebuttal/revote row must not hide a dead reviewer, and a dead-critic candidate is cleared
    // only by a live CRITIC leg. A null role is NOT reviewing: counting it would suppress
    // silently, the exact class the announcement invariant forbids.
    // Role 'claude' is deliberately absent: it is emitted only by claudeRunStatsRow
    // (src/council/run-assemble.js:129-132) for a seat that never launches a leg, and
    // preflightClaudeReview (run-assemble.js:86-102) rejects 'claude' as chair/critic/
    // bench — so no 'claude' leg can die. If that reservation ever loosens, this
    // allowlist is the single place to extend.
    function isReviewing(role) {
      return role === 'seat' || role === 'critic' ||
        (typeof role === 'string' && role.indexOf('lens:') === 0);
    }
    var reviewing = Object.create(null);
    var byRole = Object.create(null);
    var byRoleUnseated = Object.create(null);   // alias|role, live legs that named NO seat id
    // ⚠️ Fable review (PR4b fix wave): same F34/F36 alias-selection seatCells already uses
    // (`seat.modelInput || seat.model`, above) — a LIVE payload seat's `model` is the RESOLVED
    // executable id, not the alias a degrade record names; `modelInput` carries the alias.
    // Keying this map on `s.model` alone meant a dead-leg seat whose errored roster row was
    // still in the active stage's `liveSeats` never matched its alias-keyed degrade candidate,
    // so D6 failed to suppress it — both rows rendered until the stage boundary dropped the
    // errored row. Terminal-path cost rows (seatsFromRunStats) carry no `modelInput` at all and
    // are already alias-only, so `|| s.model` leaves that path unchanged.
    (liveSeats || []).forEach(function (s) {
      if (!isReviewing(s.role)) { return; }
      var alias = s.modelInput || s.model; // F36: alias space, never resolved ids
      reviewing[alias] = true;
      // Both spaces. The alias arm keeps legacy/alias-only candidates suppressible; the seat
      // arm is what lets a dead twin survive beside a live one. Guarded: `s.seat` is null on a
      // unique-alias bench on BOTH paths — the terminal one (run-stats-entry.js ::
      // buildRunStatsEntry) and, since v4.8 R5, the live tick (live-normalize.js :: seatOf).
      // Both spell the same emit-when-DIFFERENT predicate, `seat.id !== seat.alias`, so the two
      // producers cannot disagree. A bare insert would write a STRING key for every such seat.
      if (s.seat) { reviewing[s.seat] = true; }
      byRole[alias + '|' + s.role] = true;
      // R4 (v4.9 W9): the seat arm, exactly mirroring `reviewing` two lines up. Without it a
      // critic candidate carrying a seat id has no seat-keyed entry to match and the lookup
      // below would fall through to a ghost row on every twin bench.
      // ⚠️ The ELSE arm is the W9 fix round's (council C2): a live leg that named NO seat id can
      // only write the alias key, so a seat-KEYED candidate had nothing to match and the read
      // below rendered a ghost 'critic did not review' row the pre-W9 alias read suppressed.
      // Kept OUT of `byRole` on purpose — an alias entry written by a SEATED leg must not clear
      // a different seat's candidate, which is the erasure R4 exists to have fixed.
      if (s.seat) { byRole[s.seat + '|' + s.role] = true; } else { byRoleUnseated[alias + '|' + s.role] = true; }
    });
    return order.filter(function (s) {
      // Seat where the candidate has one, alias otherwise — the same key `reviewing` uses
      // below, so the two suppression maps cannot disagree about what a candidate IS. The
      // second disjunct reads the alias keyspace the WRITE also lands in (C2, above): it is
      // consulted only for live legs that named no seat, so it cannot re-open R4's erasure.
      if (s.role === 'critic') {
        return !(byRole[(s.seat || s.model) + '|critic'] || byRoleUnseated[s.model + '|critic']);
      }
      // An UNNAMED dead seat is never suppressed by alias evidence. The producer emitted
      // `null` rather than the alias precisely because "unidentified" and "the alias" are
      // different statements; falling back to the alias here would re-assert the equivalence
      // that emission removed. A live d#1 does not prove the dead seat was d#1 — and a degrade
      // record means it stayed dead after its retry, so any live seat sharing the alias is a
      // DIFFERENT seat. Suppressing would be a silent loss on no evidence.
      if (s.unnamed) { return true; }
      return !reviewing[s.seat || s.model];
    });
  }

  var api = { deadSeats: deadSeats };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (typeof window !== 'undefined') { window.AmicusDeadSeats = api; }
})();

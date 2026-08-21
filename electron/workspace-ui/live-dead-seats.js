'use strict';
// v4.8 PR5c: deadSeats, split out of live-seats.js for the 300-line gate — the FOURTH
// extraction this renderer's load-order list has absorbed. Moved verbatim from
// live-seats.js (which was itself split out of live-model.js in PR0), then seat-keyed.
// Self-contained: it reads only its four arguments and owns its own isReviewing.
(function () {
  /**
   * D6 (v4.6.2 PR4 Task 2, "dead-seat rows"): announced-dead seats, unioned
   * from the run's own `degrades[]` (dead-leg/dead-wave channels — the live
   * announcement; shapes verified against src/council/run-retry-notes.js and
   * the skipped-path notes at src/council/run-stages.js:155-174) and the
   * verdict's derived `seatLoss` (verdict.js summarizeSeatLoss/deriveSeatLoss
   * — the critic-loss backstop, kept for verdicts written before `degrades[]`
   * existed, v4.5.2 precedent). De-duped by seat model: `degrades` is scanned
   * FIRST, so a real record's retry marker always beats the backstop's
   * no-data guess for the same seat.
   *
   * `retried` reads `data.retryWaveId` / `data.firstFailure`: every
   * still-dead-after-retry note (run-retry-notes.js's four builders) carries
   * `retryWaveId`; the two run-stages.js skipped-path notes (fired when the
   * once-only retry pass never even attempted the seat — an unmappable lens
   * loss, an out-of-range index, or a zero-model unit) carry neither, so they
   * correctly fall back to the plain phrasing.
   *
   * D6 filter (zero usable legs ONLY, "no ghost when a live row already
   * exists"): a candidate already present in `liveSeats` is dropped. Two
   * different things can put it there, and both are reasons to suppress:
   * an SL-2 retry actually healed it (a real recovered review), OR
   * (owner-ruled, v4.7 CA-4 dead-seat convergence) the seat never recovered
   * at all but the row-per-launch machinery still gives its dead leg an
   * honest primary ERROR row (every billed leg gets a row now, including
   * failures — run-stages.js/run-assemble.js) — so "it has a cost row" no
   * longer implies "it healed". Either way that live row IS the seat's
   * record; rendering a second "did not review" ghost row beside it would
   * be a duplicate, not new information, so suppressing it here is the
   * ACCEPTED terminal-path behavior: exactly one row per seat, whatever its
   * status. This is the one thing standing between a recovered (or
   * honestly-erred) seat and a duplicate/ghost row — same failure family as
   * the F37 debate-role collision and the RN-11 keyed-row lessons just above
   * (seatsFromRunStats, seatCells): an identity that is not carefully
   * matched silently duplicates or overwrites instead of failing loud.
   *
   * Role-aware D6 (v4.6.3 PR2, spec D3): a bare model match used to suppress
   * regardless of what the LIVE row's role was — so a model that died as
   * critic but whose chair-fallback walk happened to land on that same alias
   * (and succeeded, producing a live `role: 'chair'` cost row) silently
   * erased the dead-critic row it was never a replacement for (spec §5, the
   * PR 102 rider). Candidates now carry a `role` (`'critic'` via alias equality
   * with `runMeta.critic` — mirroring `deriveSeatLoss`, verdict.js:72 — or
   * `null`), and only REVIEWING-role live legs (`seat`/`critic`/`lens:*`)
   * suppress at all; a `'critic'` candidate is cleared only by a live
   * CRITIC-role leg for that alias, never by a chair/judge/rebuttal/revote
   * row landing on the same model. Hidden dependency: the recovered-critic
   * suppression below (`byRole[alias + '|critic']`) relies on `roleFor`'s
   * critic branch (src/council/run-stages.js), which only fires when lenses
   * are absent — safe today only because --critic and --lenses are mutually
   * exclusive (src/cli-handlers-council-run.js's `critic && lenses` check); if
   * that exclusion ever loosens, a healed critic on a lens run would carry
   * role 'seat' and this suppression would render a ghost dead row for it.
   *
   * Old-run resilience (v4.6.3 PR2, spec D4): pre-`degrades[]` runs (v4.5.2)
   * carry the BENCH half of a seat loss only in `seatLoss.deadBenchSeats`
   * (string[] of aliases, verdict.js deriveSeatLoss) — `degrades[]` never
   * existed on either doc for these runs. Consumed after the critic backstop,
   * candidates get `role: null` (deadBenchSeats carries no critic/bench
   * distinction beyond what `criticRequested` already covers above) and flow
   * through the same dedup and role-aware suppression as every other candidate.
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
   *   'derivative' seatLoss-sourced. verdict.js:86 builds deadBenchSeats FROM the same
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
   * @param {?{critic: ?string}} runMeta  run.critic (alias, or null/absent
   *   when no critic was requested) — degrade records carry no role field, so
   *   this is the ONLY way a degrade-sourced candidate is identified as critic
   * @returns {Array<{model: string, seat: ?string, statusText: string, role: ?string}>}
   *   `model` is the ALIAS (what the row displays, what labelOf keys on); `seat` is
   *   the seat id when the record named one, else null.
   */
  function deadSeats(degrades, seatLoss, liveSeats, runMeta) {
    var critic = runMeta && runMeta.critic ? runMeta.critic : null;
    // ⚠️ Object.create(null) throughout this family (also workspace-render.js's
    // `existing`/`seen` and workspace-app.js's `labelByModel`): a model literally
    // named `toString` is truthy off a bare object, so it was dropped here and —
    // worse — crashed workspace-render.js:212 reading `.children` off an inherited
    // function, killing the seats repaint and every tick after it.
    var seen = Object.create(null);
    var covered = Object.create(null);
    var seenUnid = Object.create(null);
    var order = [];
    // `src` is the candidate's identity flavour — see the four-flavour table in the
    // docblock above, which is what decides the key and the absorb rule.
    function add(key, alias, retried, role, src, slotOf) {
      if (!alias) { return; }
      // ⛔ An 'unid' candidate was originally given NO dedup at all, on the grounds that it is
      // one wave slot and distinct by construction. That holds WITHIN a record's seats[]; it
      // does NOT hold across records, and the same dead-wave record appearing twice rendered
      // four rows for two seats. Deduped on (waveId, slot) instead — its own namespace, never
      // `seen`, so an invented key can never collide with a real alias. (The seat literally
      // named `toString` is why this family refuses keys that share the alias keyspace.)
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
      if (!d || d.kind !== 'degrade') { return; }
      if (d.channel !== 'dead-leg' && d.channel !== 'dead-wave') { return; }
      var data = d.data || {};
      var retried = !!(data.retryWaveId || data.firstFailure);
      // Critic identification mirrors deriveSeatLoss (verdict.js): alias
      // equality with run.critic — degrade records carry no role field.
      if (d.channel === 'dead-leg') {
        var lk = (data.firstFailure && data.firstFailure.seatId) || data.seatId || null;
        add(lk, data.seat, retried, critic && data.seat === critic ? 'critic' : null,
          lk ? 'keyed' : 'legacy');
      } else {
        // `seats[]` is index-parallel with `models[]` (PR5c Task 1). Its ABSENCE means a
        // legacy record; a null ELEMENT means an unidentified seat. Different statements.
        var hasSeats = Array.isArray(data.seats);
        (data.models || []).forEach(function (m, i) {
          var wk = hasSeats ? data.seats[i] : null;
          add(wk, m, retried, critic && m === critic ? 'critic' : null,
            wk ? 'keyed' : (hasSeats ? 'unid' : 'legacy'), { waveId: data.waveId, i: i });
        });
      }
    });
    if (seatLoss && seatLoss.criticRequested && !seatLoss.criticSeated) {
      add(null, seatLoss.criticRequested, false, 'critic', 'derivative');
    }
    if (seatLoss) {
      // Pre-degrades[] era (v4.5.2): the bench half of a seat loss lives
      // only here. Alias strings; deriveSeatLoss does not dedup — `seen`
      // absorbs repeats and degrade-sourced duplicates.
      (seatLoss.deadBenchSeats || []).forEach(function (m) {
        add(null, m, false, null, 'derivative');
      });
    }
    // Role-aware D6 (v4.6.3 PR2): only REVIEWING-role live legs suppress —
    // a chair/judge/rebuttal/revote row must not hide a dead reviewer, and
    // a dead-critic candidate is cleared only by a live CRITIC leg. A null
    // role is NOT reviewing: counting it would suppress silently, the exact
    // class the announcement invariant forbids.
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
    });
    return order.filter(function (s) {
      if (s.role === 'critic') { return !byRole[s.model + '|critic']; }
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

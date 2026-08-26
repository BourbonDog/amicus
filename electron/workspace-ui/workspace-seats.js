/**
 * Council Workspace — seats panel painter (v4.4 §5). D8 extraction (Task 1,
 * v4.6.2 PR4): moved verbatim out of workspace-panels.js, which was pressed
 * up against the 300-line size gate — this file is where Task 2 adds
 * dead-seat rows. Loads immediately before workspace-panels.js (index.html),
 * which keeps a thin delegate; reads `window.AmicusApp` at CALL time, same
 * discipline as every sibling renderer file (workspace-app.js boots last and
 * owns `state`).
 *
 * Task 2 ("dead-seat rows"): `state.detail.run` and `state.detail.verdict`
 * are the raw run.json/verdict.json docs (src/workspace/run-detail.js —
 * `getRunDetail` returns them wholesale, unfiltered), so `run.degrades` and
 * `verdict.seatLoss` are already on `state.detail` today; no data-layer
 * threading was needed. Only the derivation (window.AmicusLive.deadSeats,
 * live-seats.js) and this file's painting are new.
 *
 * NOTE (scope, matches the plan's file list): renderSeatsPanel() (below) is reached from
 * renderDetail() — called both from openRun() (a fresh run open) and from the blind toggle
 * (workspace-app.js:197-227), which must repaint dead rows too so the mask flip reaches
 * them. A dead-leg/dead-wave degrade is checkpointed to run.json as soon as Stage 1's
 * once-only retry pass resolves for that seat — which can be well before the rest of the run
 * reaches a terminal status, so a seat CAN be "announced dead" in the data while the run is
 * still live-polling.
 *
 * HISTORY: dead rows first shipped gated on terminal status (Task 2's fix wave, task
 * review, controller ruling) — appended ONLY when window.AmicusLive.TERMINAL_STATUSES
 * matched d.run.status, the same predicate startLiveLoop() uses at workspace-verbs.js:69 to
 * decide whether a run is even worth polling. Reason at the time: renderDetail()'s
 * unconditional V.startLiveLoop() call (workspace-app.js:151) schedules a
 * setTimeout(tick, 0) on any still-running run; that tick's first resolution repainted
 * #seats-body via applyLive's direct renderSeats() call (workspace-verbs.js:130), whose own
 * leaver-removal (workspace-render.js:220-222) immediately deleted the `dead:`-keyed row
 * renderSeatsPanel had just appended — a one-frame flash-then-vanish that read as a glitch,
 * not a feature — so gating on terminal simply hid dead rows until no further tick could
 * un-paint them. PR4b (Christian's mid-poll ruling on PR 102) replaced that gate with tick
 * re-append: applyLive() now calls appendDeadRows() (below) immediately after every
 * renderSeats() repaint (workspace-verbs.js:130-131), restoring the row the SAME tick that
 * just wiped it instead of leaving it hidden. renderSeatsPanel() below no longer checks
 * TERMINAL_STATUSES at all — dead rows paint unconditionally, on a live run or a done one.
 */
(function () {
  'use strict';

  /**
   * Keys — seat id where a record supplies one, alias otherwise — of seats whose degrade record
   * says they were retried. PR1F-4 (v4.7 PR7); re-keyed in v4.8 PR5b, renamed from
   * `retriedAliases` because the keys are no longer uniformly aliases.
   *
   * ⚠️ THE MIRROR IS RESTORED (v4.8 PR5c). It went partial in PR5b, when this side was
   * seat-keyed and deadSeats still dedup'd on the alias; PR5c seat-keyed the other side too,
   * so both now key on "seat id where the record supplies one, alias otherwise". The
   * kind/channel FILTER still mirrors window.AmicusLive.deadSeats — now at
   * live-dead-seats.js, where PR5c's size-gate split put it and v4.9 W9 named it `isSeatLoss` —
   * and must keep doing so; the two moved together in W9's one commit. Two spellings of one rule
   * is PR5a council finding B1; only the behavioural drift pin in workspace-seats.test.js holds it.
   *
   * ⚠️ The two sides are NOT identical, and the difference is deliberate: deadSeats decides
   * whether a seat is RENDERED, so it fails toward showing a row; this decides whether a
   * badge is PAINTED, so an unidentified record falls back to the alias and marks every seat
   * sharing it. Over-badging is visible and self-correcting; a missing badge is silent.
   *
   * The kind/channel filter is load-bearing: run.degrades[] also carries
   * kind:'heal' / channel:'stage1-retry' records with the SAME retryWaveId/firstFailure fields
   * for seats that RECOVERED, and a field-only scan would tag a recovered seat "retried once".
   *
   * ⚠️ firstFailure is TRUTHINESS ONLY. Two shapes, both built in
   * run-retry-group.js :: groupStage1Losses — its deadLegs loop emits {seat, class:'leg',
   * status, reason}; its deadWaves loop emits {seat, class: lossClass(w), waveId, reason}
   * at THREE sites (lens/critic/bench), none carrying a status key, where
   * `const lossClass = w => (w.partial ? 'missing' : 'wave')` — so firstFailure.status is
   * undefined on every wave-origin seat. ⚠️ T-A8 DROPPED five line numbers here: re-opened
   * 2026-08-17 they had all rotted a uniform +31 (T-A3 +15, T-A6 +16), and "now 235" is 266.
   */
  function retriedSeats(degrades) {
    var out = Object.create(null);
    (degrades || []).forEach(function (d) {
      if (!d || d.kind !== 'degrade') { return; }
      var data = d.data || {};
      // Hoisted ABOVE the channel test (behaviour-preserving — the two loss channels already
      // required it) because it is ALSO the `seat-unbound` gate v4.9 W9 admits that shared
      // channel through: orphan-leg, re-vote and Stage-2 judge notes ride it, are not retried
      // seats, and none of the three carries a retry-family field. One test excludes all.
      if (!(data.retryWaveId || data.firstFailure)) { return; }
      if (d.channel !== 'dead-leg' && d.channel !== 'dead-wave'
        && !(d.channel === 'seat-unbound' && (data.seatId || data.seat))) { return; }
      if (d.channel !== 'dead-wave') {
        // ⚠️ Prefer the SEAT ID when the record names one. TWO mechanisms now supply it, not
        // one: retryLegStillDeadNote and missingLegStillDeadNote via `firstFailure.seatId`
        // (pinned by tests/council/run-retry.test.js:628 on a twin bench), and — since
        // v4.8 PR5c — srcLegStillDeadNote via its own `data.seatId`, joined on that same key
        // by waveStillDeadNote's partial `seat-unbound` arm in v4.9 W9. Reading only the first
        // meant a srcLeg record keyed by ALIAS and badged the live twin "retried once" while
        // the seat that was actually retried showed nothing.
        // `data.seat` remains the last fallback for pre-PR5c records (residual R6).
        var key = (data.firstFailure && data.firstFailure.seatId) || data.seatId || data.seat;
        if (key) { out[key] = true; }
      } else {
        // v4.8 PR5c: dead-wave now carries `seats[]`, index-parallel with `models[]`, whose
        // elements are seat ids or `null` for a slot the producer could not identify. A null
        // slot falls back to the alias and therefore badges every seat sharing it — the loud
        // direction, disclosed. A pre-PR5c record has no `seats` at all and is alias-only.
        var ws = data.seats;
        (data.models || []).forEach(function (m, i) {
          var k = (Array.isArray(ws) ? ws[i] : null) || m;
          if (k) { out[k] = true; }
        });
      }
    });
    return out;
  }

  // Mirrors isReviewing at live-dead-seats.js (moved there by PR5c's size-gate split) —
  // a chair/judge/rebuttal/revote row must not
  // carry a reviewer's retry marker.
  function isReviewingRole(role) {
    return role === 'seat' || role === 'critic' ||
      (typeof role === 'string' && role.indexOf('lens:') === 0);
  }

  function renderSeatsPanel() {
    var A = window.AmicusApp;
    var d = A.state.detail;
    var seats = window.AmicusLive.seatsFromRunStats(d.derived.cost.rows);
    var tbody = A.$('seats-body');
    window.AmicusRender.renderSeats(tbody, seats, A.state.blind, A.labelOf);
    var seatLoss = d.verdict && d.verdict.seatLoss;
    // `criticSeat` (v4.9 W9 / R4): run.json's resolved critic SEAT id (run-state.js ::
    // initCouncilRun seeds it, seats.js :: preflightSeats supplies it) — what lets deadSeats
    // tag the critic by seat identity. Null with no critic, and on pre-field run.json.
    var runMeta = { critic: (d.run && d.run.critic) || null,
      criticSeat: (d.run && d.run.criticSeat) || null };
    // Source-selection (v4.6.3 PR2, spec D4): run-degrade.js swallows checkpoint failures, so
    // verdict.json can carry degrade records run.json's own checkpoint lost — fall back to it
    // ONLY when run.degrades is empty/absent. A fallback, never a union: both docs can carry
    // records for the SAME run, and the persisted run.json copy is authoritative when present.
    var deg = (d.run && d.run.degrades && d.run.degrades.length) ? d.run.degrades
      : ((d.verdict && d.verdict.degrades) || []);
    var retried = retriedSeats(deg);
    // ⚠️ Look rows up by data-key, NEVER by position. renderSeats (workspace-render.js:179-216)
    // keys every row on String(seat.id || seat.model) and RN-11 made it REORDER rows to match the
    // composed doc's leg order — so tbody.children[i] is not seats[i]. Build the key exactly the
    // way renderSeats does or the lookup silently misses.
    var rowsByKey = Object.create(null);
    Array.prototype.slice.call(tbody.children).forEach(function (row) {
      rowsByKey[row.dataset.key] = row;
    });
    seats.forEach(function (s) {
      var row = rowsByKey[String(s.id || s.model)];
      if (!row || !row.children[8]) { return; }
      // Column 8 is the table's unlabeled trailing flag cell (index.html:51's final <th></th>).
      // It carries '⏳ stalled' on the LIVE path; on this terminal path seatsFromRunStats
      // hardcodes stalled:false (live-seats.js, seatsFromRunStats), so it is always empty here and free to use.
      // If that ever changes, this is the collision site.
      // Fix wave (whole-branch review, finding 2): this pass must be SYMMETRIC. renderSeats
      // reuses rows keyed on `model:role` across calls — including across two different
      // terminal runs opened in sequence that happen to share an alias+role — and never resets
      // row.className itself. An add-only write here both duplicates the token on every repaint
      // of the SAME run and leaves a stale 'seat-retried' class on a row that belonged to a
      // PREVIOUS run's non-retried seat. classList.add/remove (not string concatenation) so a
      // repeat add never duplicates the token and a seat that is no longer retried gets cleared.
      // ⚠️ v4.8 PR5b: DUAL lookup, and both arms are load-bearing. `s.seat` (PR5b Task 1, null
      // on a unique bench) matches the one emitter arm that names a seat; `s.model` matches the
      // four that carry only an alias — srcLegStillDeadNote and every dead-wave record. Pairing
      // this map's dual key with a seat-id-ONLY lookup badges NOTHING for those four arms: a
      // silent false negative replacing a visible false positive, which is strictly worse.
      // On a twin bench an alias-only record still badges BOTH seats. That is not a defect — the
      // record does not say which seat failed, so no consumer can attribute it. Over-badging is
      // the deliberate direction: visible beats silent.
      //
      // ⚠️ NAMING HAZARD (council A1): `seat` means TWO different things three lines apart.
      // `s.seat` is a SEAT ID (`alias#N`, from src/council/run-stats-entry.js :: buildRunStatsEntry
      // via the cost row). The degrade records keyed into `retried` above use `data.seat`,
      // which is an ALIAS and stays one
      // deliberately (run-retry-notes.js :: waveStillDeadNote's `data` comment;
      // `verdict-seat-loss.js :: deriveSeatLoss`'s `criticLeg` compares it to `o.critic` —
      // both by SYMBOL since W9).
      // Reading one as the other is precisely how an earlier revision of this fix paired an
      // alias-keyed map with a seat-id lookup and dropped every badge. When touching either
      // side, say which space you are in.
      //
      // ⚠️ The pre-PR expression was `retried[s.modelInput || s.model]` (council B1). The
      // `modelInput` arm is dropped on purpose: this loop only ever iterates
      // `seatsFromRunStats(...)` output (assigned in workspace-seats.js :: renderSeatsPanel), and
      // that projection emits no `modelInput` at all — live payload seats, which DO carry it,
      // reach `deadSeats` in workspace-seats.js :: appendDeadRows and never reach here. The
      // invariant is pinned by test (12) in workspace-seats.test.js;
      // if that test ever fails, restore the `s.modelInput` arm rather than deleting the test.
      // ⚠️ `s.seat &&` is LOAD-BEARING (council A1). `s.seat` is null on a unique bench, and a
      // bare `retried[s.seat]` coerces null to the STRING key 'null' — so a seat with no seat id
      // would match a degrade record whose alias is literally `null`. Measured: with
      // `m = Object.create(null); m['null'] = true`, `m[null]` is `true`. Contrived, but this
      // module already guards the same class elsewhere — live-dead-seats.js, deadSeats' Object.create(null) note, records a model
      // named `toString` crashing the seats repaint, which is why Object.create(null) is used
      // throughout. The guard costs nothing and closes it.
      //
      // ⚠️ KEYSPACE (council B1): `retried` deliberately mixes seat ids (`alias#N`) and bare
      // aliases as keys, because only one of five emitter arms supplies a seat id. That is a
      // real collision surface and a KNOWN one — src/council/seats.js:236 already records that
      // a literal alias containing '#' collides with a minted #N id, and preflightSeats refuses
      // exactly that shape. This map inherits that guarantee rather than re-deriving it; if
      // preflightSeats ever stops refusing it, this lookup becomes ambiguous.
      var isRetried = isReviewingRole(s.role)
        && !!((s.seat && retried[s.seat]) || retried[s.model]);
      if (isRetried) {
        row.classList.add('seat-retried');
        row.children[8].textContent = '↻ retried once';
      } else {
        row.classList.remove('seat-retried');
        row.children[8].textContent = '';
      }
    });
    var dead = window.AmicusLive.deadSeats(deg, seatLoss, seats, runMeta);
    renderDeadSeatRows(tbody, dead, A.state.blind, A.labelOf);
  }

  /**
   * Paints the dead-seat rows appended after live rows. Deliberately NOT
   * folded into workspace-render.js's renderSeats (293/300 — must not grow)
   * and NOT run through its keyed diff: dead rows carry no per-tick-changing
   * field, so a full rebuild every call is correct and cheap, and renderSeats
   * just above already self-cleans any PRIOR dead row as an unrecognized
   * `data-key` (its own seen-set only knows about the live `seats` it was
   * just given), so nothing here needs to track dead rows across calls.
   *
   * Cells route through window.AmicusLive.seatCells(...) — the SAME function
   * live rows use — so name masking (and every other column's blank/em-dash
   * convention) matches exactly, not a reimplementation. Two overrides after
   * the call: index 0 (name, blind-ON-and-unlabeled dead seats only — see the
   * comment at that line) and index 6 (cost). seatCells would dash() a
   * missing costDisplay to '—', indistinguishable from a seat that ran but
   * whose cost is merely unmeasured (see cost-unknown-display.test.js) — a
   * dead seat has no cost concept at all, so that cell renders empty instead
   * (D6: "no cost cell").
   */
  function renderDeadSeatRows(tbody, dead, blindOn, labelOf) {
    (dead || []).forEach(function (seat) {
      var cells = window.AmicusLive.seatCells(
        { model: seat.model, role: seat.role, status: seat.statusText, stalled: false }, blindOn, labelOf);
      // Fix wave 2 (smoke-caught, GUI smoke on real degraded run 12c96b6b): dead seats never
      // produce a review, so state.labelByModel (built from the run's names derivation — models
      // that DID review) never carries them; seatCells' own `blindOn && label ? label : alias`
      // fallback is LOAD-BEARING for LIVE rows (RN-9/F36, live-seats.js) and stays untouched, but
      // for a dead seat that fallback leaks the raw model name under blind — precisely the seat
      // blind mode most needs to hide. Placeholder ONLY when blind is on AND no label resolved;
      // a label that DOES resolve (possible in principle) still wins via seatCells' own cell.
      if (blindOn && !(labelOf && labelOf(seat.model))) { cells[0] = '(masked)'; }
      cells[6] = '';
      // v4.8 PR5c: key on the SEAT, not the alias — two dead twins are two rows and must
      // not share a dataset.key. ⚠️ Honest scope: unlike the live path, this collision has
      // NO measured symptom today. renderSeats removes leavers per ROW
      // (workspace-render.js:231 tests each child's own key), so colliding rows are both
      // removed rather than one leaking, and dead rows are always appended fresh so the
      // reuse path at :197 — where last-wins froze a live row in PR5b — is never reached.
      // It is fixed because :188 still builds a last-wins `existing` map that any future
      // reuse would hit, and because rows for different seats having one key is a landmine.
      // Plain concatenation is injective here (ONE field, and 'dead:' cannot collide with a
      // live key, which is a JSON array starting '['); the live path needs JSON.stringify
      // only because it joins TWO fields.
      var row = window.AmicusRender.el('tr',
        { className: 'seat-dead', dataset: { key: 'dead:' + (seat.seat || seat.model) } },
        cells.map(function (c, i) {
          return window.AmicusRender.el('td',
            { className: window.AmicusRender.seatCellClass(i) }, [c]);
        }));
      tbody.appendChild(row);
    });
  }

  /**
   * Live-tick twin of renderSeatsPanel's dead block (PR4b, Christian's mid-poll
   * ruling on PR 102): applyLive's renderSeats repaint wipes dead:-keyed rows
   * (leaver-removal), so every tick re-appends from the tick's own payload.
   * seatLoss comes from state.detail (absent mid-run — the critic's own
   * dead-leg degrade covers it live; the terminal refresh unions the rest).
   */
  function appendDeadRows(live) {
    var A = window.AmicusApp;
    var d = A.state.detail;
    var seatLoss = d && d.verdict ? d.verdict.seatLoss : null;
    var runMeta = { critic: (d && d.run && d.run.critic) || null,
      criticSeat: (d && d.run && d.run.criticSeat) || null };
    // Source-selection (v4.6.3 PR2, spec D4), live-path twin of renderSeatsPanel's fallback
    // above: the tick's own live.degrades wins when non-empty; state.detail.verdict.degrades is
    // usually absent mid-run (verdict.json doesn't exist until the run finishes) — fine, this
    // branch only matters for the rare same-run reopen where a prior terminal fetch already
    // populated state.detail.verdict.
    var deg = (live.degrades && live.degrades.length) ? live.degrades
      : ((d && d.verdict && d.verdict.degrades) || []);
    var dead = window.AmicusLive.deadSeats(deg, seatLoss, live.seats || [], runMeta);
    renderDeadSeatRows(A.$('seats-body'), dead, A.state.blind, A.labelOf);
  }

  window.AmicusSeats = {
    renderSeatsPanel: renderSeatsPanel,
    renderDeadSeatRows: renderDeadSeatRows,
    appendDeadRows: appendDeadRows,
  };
})();

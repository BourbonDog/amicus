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
 * live-model.js) and this file's painting are new.
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

  function renderSeatsPanel() {
    var A = window.AmicusApp;
    var d = A.state.detail;
    var seats = window.AmicusLive.seatsFromRunStats(d.derived.cost.rows);
    var tbody = A.$('seats-body');
    window.AmicusRender.renderSeats(tbody, seats, A.state.blind, A.labelOf);
    var seatLoss = d.verdict && d.verdict.seatLoss;
    var runMeta = { critic: (d.run && d.run.critic) || null };
    // Source-selection (v4.6.3 PR2, spec D4): run-degrade.js swallows checkpoint failures, so
    // verdict.json can carry degrade records run.json's own checkpoint lost — fall back to it
    // ONLY when run.degrades is empty/absent. A fallback, never a union: both docs can carry
    // records for the SAME run, and the persisted run.json copy is authoritative when present.
    var deg = (d.run.degrades && d.run.degrades.length) ? d.run.degrades
      : ((d.verdict && d.verdict.degrades) || []);
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
      // fallback is LOAD-BEARING for LIVE rows (RN-9/F36, live-model.js) and stays untouched, but
      // for a dead seat that fallback leaks the raw model name under blind — precisely the seat
      // blind mode most needs to hide. Placeholder ONLY when blind is on AND no label resolved;
      // a label that DOES resolve (possible in principle) still wins via seatCells' own cell.
      if (blindOn && !(labelOf && labelOf(seat.model))) { cells[0] = '(masked)'; }
      cells[6] = '';
      var row = window.AmicusRender.el('tr',
        { className: 'seat-dead', dataset: { key: 'dead:' + seat.model } },
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
    var runMeta = { critic: (d && d.run && d.run.critic) || null };
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

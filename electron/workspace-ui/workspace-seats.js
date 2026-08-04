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
 * NOTE (scope, matches the plan's file list): the LIVE poll loop
 * (workspace-verbs.js's applyLive) repaints #seats-body directly via
 * AmicusRender.renderSeats(), bypassing renderSeatsPanel() entirely — dead
 * rows appear once the run reaches a terminal status and openRun() runs
 * renderDetail() again. This is also the right boundary semantically: a
 * dead-leg/dead-wave degrade is only checkpointed to run.json once Stage 1's
 * once-only retry pass has resolved for that seat, so there is no mid-poll
 * instant where a seat is both "announced dead" and still live-polling.
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
    var dead = window.AmicusLive.deadSeats(d.run.degrades, seatLoss, seats);
    renderDeadSeatRows(tbody, dead, A.state.blind, A.labelOf);
  }

  /**
   * Paints the dead-seat rows appended after live rows. Deliberately NOT
   * folded into workspace-render.js's renderSeats (287/300 — must not grow)
   * and NOT run through its keyed diff: dead rows carry no per-tick-changing
   * field, so a full rebuild every call is correct and cheap, and renderSeats
   * just above already self-cleans any PRIOR dead row as an unrecognized
   * `data-key` (its own seen-set only knows about the live `seats` it was
   * just given), so nothing here needs to track dead rows across calls.
   *
   * Cells route through window.AmicusLive.seatCells(...) — the SAME function
   * live rows use — so name masking (and every other column's blank/em-dash
   * convention) matches exactly, not a reimplementation. Exactly one
   * override: index 6 (cost). seatCells would dash() a missing costDisplay
   * to '—', indistinguishable from a seat that ran but whose cost is merely
   * unmeasured (see cost-unknown-display.test.js) — a dead seat has no cost
   * concept at all, so that cell renders empty instead (D6: "no cost cell").
   */
  function renderDeadSeatRows(tbody, dead, blindOn, labelOf) {
    (dead || []).forEach(function (seat) {
      var cells = window.AmicusLive.seatCells(
        { model: seat.model, status: seat.statusText, stalled: false }, blindOn, labelOf);
      cells[6] = '';
      var row = window.AmicusRender.el('tr',
        { className: 'seat-dead', dataset: { key: 'dead:' + seat.model } },
        cells.map(function (c, i) {
          return window.AmicusRender.el('td',
            { className: i >= 4 && i <= 6 ? 'num' : (i === 8 ? 'stalled-flag' : '') }, [c]);
        }));
      tbody.appendChild(row);
    });
  }

  window.AmicusSeats = {
    renderSeatsPanel: renderSeatsPanel,
    renderDeadSeatRows: renderDeadSeatRows,
  };
})();

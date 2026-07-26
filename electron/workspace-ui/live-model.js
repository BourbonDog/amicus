/**
 * Council Workspace — pure renderer-side view logic (poll cadence, seat row
 * cells, blind default). No DOM here: node-tested via the module guard.
 * TERMINAL_STATUSES mirrors src/workspace/run-detail.js (the renderer cannot
 * require across the sandbox; keep the two lists in sync).
 */
(function () {
  'use strict';

  // ⚠️ DE-ROT (F26): was a 5-name list — missing 'crashed' and 'idle-timeout', so a crashed
  // or idle-timed-out run would poll forever and never flip to its terminal rendering.
  // Must stay byte-identical to src/workspace/run-detail.js TERMINAL_STATUSES, which itself
  // mirrors the shipped src/observe/live-doc.js TERMINAL set. A drift pin asserts this.
  var TERMINAL_STATUSES = ['complete', 'partial', 'error', 'crashed', 'aborted', 'timeout', 'idle-timeout'];

  // ⚠️ DE-ROT (F41): STAGE_LABELS must be mirrored here too. The live loop labels stages that
  // START AFTER the run was opened, and those names are absent from the frozen derived.stageRail,
  // so without this table every post-open stage renders its raw name ("tally-final", "debate-revote").
  var STAGE_LABELS = {
    stage1: 'Stage 1 — independent review',
    stage2: 'Stage 2 — peer cross-review',
    'debate-defense': 'Debate — defense',
    'debate-revote': 'Debate — re-vote',
    'tally-provisional': 'Tally (provisional)',
    tally: 'Tally',
    'tally-final': 'Tally (final)',
    chair: 'Chair synthesis',
    verdict: 'Verdict',
  };

  /** Poll cadence per spec §4.3: 1.5s visible+focused, 5s otherwise, stop at terminal. */
  function pollDelay(state) {
    if (state.terminal) { return null; }
    return (state.visible && state.focused) ? 1500 : 5000;
  }

  /** Blind default per spec resolved Q2: ON live, OFF terminal. */
  function defaultBlind(status) {
    return TERMINAL_STATUSES.indexOf(status) === -1;
  }

  function dash(v) {
    return (v === null || v === undefined || v === '') ? '—' : String(v);
  }

  /**
   * Display cells for one seat row, in the seats-table column order:
   * [name, role, status, stage, msgs, tokens in/out, cost, last activity, stalled]
   */
  function seatCells(seat, blindOn, labelOf) {
    // ⚠️ DE-ROT (F36): key the lookup on the council ALIAS, never on `seat.model`. labelMap's
    // values are aliases; a LIVE leg's `model` is the resolved executable id, so labelOf(model)
    // misses and Blind ON renders the real model. `modelInput` is the alias Task 0.5 stamps per
    // leg (terminal rows from runStats are already alias-only, so the fallback is exact there).
    var alias = seat.modelInput || seat.model;
    var label = labelOf ? labelOf(alias) : null;
    var name = blindOn && label ? label : alias;
    var tokens = (seat.tokensIn === null || seat.tokensIn === undefined) &&
                 (seat.tokensOut === null || seat.tokensOut === undefined)
      ? '—'
      : dash(seat.tokensIn) + '/' + dash(seat.tokensOut);
    return [
      dash(name),
      dash(seat.role),
      dash(seat.status),
      dash(seat.stage),
      dash(seat.messages),
      tokens,
      dash(seat.costDisplay),
      // ⚠️ DE-ROT (F35): pass-through of an ISO timestamp, NOT a relative string. renderSeats
      // formats it with relTime() before calling in — live-model.js is node-tested and loads
      // before workspace-render.js, so it cannot reach relTime itself.
      dash(seat.lastActivity),
      seat.stalled ? '⏳ stalled' : '',
    ];
  }

  /** Terminal fallback: derive seat-shaped rows from tally runStats cost rows. */
  function seatsFromRunStats(costRows) {
    return (costRows || []).map(function (r) {
      return {
        // ⚠️ DE-ROT (F37): composite id — a v4.1 `--debate` run emits extra runStats rows for
        // the SAME bench alias (role 'rebuttal'/'revote', src/council/debate.js:88-96). With no
        // id, renderSeats keys on model and the re-vote row silently overwrites the seat row.
        // (If the panel is meant to be bench-only, filter to seat/critic/lens:* instead and
        // leave rebuttal/revote spend to the cost table — but say which; do not leave it implied.)
        id: r.model + ':' + (r.role || 'seat'),
        model: r.model, role: r.role || null, status: r.status || null,
        stage: null, messages: null, tokensIn: null, tokensOut: null,
        costDisplay: r.costDisplay || null, lastActivity: null, latestPreview: null,
        stalled: false,
      };
    });
  }

  // ⚠️ DE-ROT (F41): STAGE_LABELS is exported so applyLive() can label post-open stages.
  var api = { pollDelay: pollDelay, seatCells: seatCells, seatsFromRunStats: seatsFromRunStats,
    defaultBlind: defaultBlind, dash: dash, TERMINAL_STATUSES: TERMINAL_STATUSES, STAGE_LABELS: STAGE_LABELS };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (typeof window !== 'undefined') { window.AmicusLive = api; }
})();

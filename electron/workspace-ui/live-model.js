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
  // ⚠️ v4.4.1 A1: 'timed-out' added alongside 'timeout'. Both spellings are real and are written
  // by different producers — see src/observe/live-doc.js:18. Inert for the workspace (a council
  // run.json's status vocabulary is aborted|complete|error|partial), carried for byte-identity.
  var TERMINAL_STATUSES = ['complete', 'partial', 'error', 'crashed', 'aborted', 'timeout', 'timed-out', 'idle-timeout'];

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

  /** True when `status` is a terminal run status. The single consumption
   * point for TERMINAL_STATUSES membership (v4.6.3 PR2 dedup) — the array
   * itself stays exported and byte-identical to src/workspace/run-detail.js
   * (drift-pinned). */
  function isTerminal(status) {
    return TERMINAL_STATUSES.indexOf(status) !== -1;
  }

  /** Blind default per spec resolved Q2: ON live, OFF terminal. */
  function defaultBlind(status) {
    return !isTerminal(status);
  }

  // Seats surface lives in ./live-seats (v4.8 PR0 size-gate split), which
  // loads first; re-exported on window.AmicusLive below so consumers are
  // unchanged. In jest, require resolves it; in the renderer, the script
  // load order guarantees window.AmicusLiveSeats exists.
  var seats = (typeof module !== 'undefined' && module.exports)
    ? require('./live-seats')
    : window.AmicusLiveSeats;

  // ⚠️ DE-ROT (F41): STAGE_LABELS is exported so applyLive() can label post-open stages.
  var api = { pollDelay: pollDelay, seatCells: seats.seatCells, seatsFromRunStats: seats.seatsFromRunStats,
    deadSeats: seats.deadSeats,
    defaultBlind: defaultBlind, isTerminal: isTerminal, dash: seats.dash,
    TERMINAL_STATUSES: TERMINAL_STATUSES, STAGE_LABELS: STAGE_LABELS };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (typeof window !== 'undefined') { window.AmicusLive = api; }
})();

// electron/workspace-ui/live-seats.js
// Seats surface: dash, seatCells, SEATS_PANEL_EXCLUDED_ROLES,
// seatsFromRunStats, deadSeats. Moved verbatim from live-model.js@ac7e7e12:53-285
// (v4.8 PR0 size-gate split, zero behavior). Loads BEFORE live-model.js,
// which re-exports these on window.AmicusLive so no consumer changes.
// ES5 IIFE, dual export, strict-CSP <script> loading — same shape as
// every renderer module. Comments write "PR 102", never the hash-number
// form (electron-token-drift HEX_RE trips on it — this file is scanned).
(function () {
  'use strict';

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
    // ⚠️ v4.4.1 RN-9: this hand-rolled flip is LOAD-BEARING — do NOT "fix" it into
    // AmicusRender.display({model: seat.model, label: label}, blindOn). The other two copies
    // (workspace-panels.js's review/judge titles) were routed through display() because their
    // pair's `model` IS the identity they must print. Here it is not: the seat's printable
    // identity is the council ALIAS resolved on the line above (F36 — a live leg's `seat.model`
    // is the RESOLVED executable id, e.g. `google/gemini-2.5-pro`, which labelMap never keys on),
    // so display()'s blind-OFF arm would print the resolved id and undo F36. This module is also
    // node-tested with NO DOM and no window.AmicusRender to call. Deliberate third copy.
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

  // v4.7 D6/E1: three row-per-launch producer roles added alongside the
  // existing chair-attempt (run-chair.js), repair (run-stages.js/
  // run-stage2.js/run-chair.js) and superseded (run-stages.js + debate.js)
  // rows — launch-accounting extras, not seats, and unlike rebuttal/revote
  // (F37, kept rendering on purpose below) they have no seats-panel meaning
  // of their own. There is no pre-existing allowlist in this function (E1) —
  // this is a plain exclusion added on top of the untouched id/shape logic.
  // Object.create(null): a plain `{...}` literal inherits Object.prototype, so a role
  // literally named 'constructor'/'toString'/etc would resolve to an inherited (truthy)
  // function via bracket lookup instead of `undefined` — silently mis-excluding (or
  // mis-including) that seat. A null-prototype object has no inherited keys to collide with.
  var SEATS_PANEL_EXCLUDED_ROLES = Object.create(null);
  SEATS_PANEL_EXCLUDED_ROLES['chair-attempt'] = true;
  SEATS_PANEL_EXCLUDED_ROLES.repair = true;
  SEATS_PANEL_EXCLUDED_ROLES.superseded = true;

  /** Terminal fallback: derive seat-shaped rows from tally runStats cost rows. */
  function seatsFromRunStats(costRows) {
    return (costRows || []).filter(function (r) {
      return !SEATS_PANEL_EXCLUDED_ROLES[r.role];
    }).map(function (r) {
      return {
        // ⚠️ DE-ROT (F37) + v4.8 PR5b: composite id over the SEAT, not the alias.
        // ROLE half: a v4.1 `--debate` run emits extra runStats rows for the SAME bench alias
        // (role 'rebuttal'/'revote', src/council/debate.js :: debateRunStatsRows, merged at
        // run-finish.js:43-48). Without it, renderSeats keys on model and the re-vote row
        // silently overwrites the seat row.
        // SEAT half: PR1 made a bench that repeats an alias produce distinct seats, and two of
        // them collided on the alias. Measured at HEAD across two ticks: renderSeats appended
        // BOTH rows on tick one, then froze the first forever — `existing` is snapshotted
        // before the loop, so both seats resolved to the LAST row and the first was never
        // re-matched, while `seen[key]` kept it from being removed.
        // `r.seat` is emit-when-set upstream (src/council/run-stats-entry.js :: buildRunStatsEntry
        // stamps it only when seat.id differs from seat.alias, which seats.js:67 makes true
        // exactly for a repeated alias), so `|| r.model` is load-bearing — it keeps a unique
        // bench byte-identical.
        // JSON.stringify, not concatenation: an alias may contain ':' and roles include
        // 'lens:*', so a concatenated key is NOT injective — ('a','lens:x') and ('a:lens','x')
        // both spell 'a:lens:x'. Never displayed; it is only ever a dataset.key, and
        // workspace-render.js:186 uses a plain object lookup so quotes are already safe.
        id: JSON.stringify([r.seat || r.model, r.role || 'seat']),
        // Carried for workspace-seats.js's retry-badge join (PR5b Task 2). Null on a unique
        // bench, matching the upstream payload exactly.
        seat: r.seat || null,
        model: r.model, role: r.role || null, status: r.status || null,
        stage: null, messages: null, tokensIn: null, tokensOut: null,
        costDisplay: r.costDisplay || null, lastActivity: null, latestPreview: null,
        stalled: false,
      };
    });
  }


  // deadSeats lives in ./live-dead-seats (v4.8 PR5c size-gate split), which loads first;
  // re-exported here so every consumer — including window.AmicusLive's own bridge in
  // live-model.js — is unchanged. In jest require resolves it; in the renderer the script
  // load order guarantees window.AmicusDeadSeats exists.
  var dead = (typeof module !== 'undefined' && module.exports)
    ? require('./live-dead-seats')
    : window.AmicusDeadSeats;

  var api = {
    dash: dash,
    seatCells: seatCells,
    SEATS_PANEL_EXCLUDED_ROLES: SEATS_PANEL_EXCLUDED_ROLES,
    seatsFromRunStats: seatsFromRunStats,
    deadSeats: dead.deadSeats,
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (typeof window !== 'undefined') { window.AmicusLiveSeats = api; }
})();

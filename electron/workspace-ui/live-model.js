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
  var SEATS_PANEL_EXCLUDED_ROLES = { 'chair-attempt': true, repair: true, superseded: true };

  /** Terminal fallback: derive seat-shaped rows from tally runStats cost rows. */
  function seatsFromRunStats(costRows) {
    return (costRows || []).filter(function (r) {
      return !SEATS_PANEL_EXCLUDED_ROLES[r.role];
    }).map(function (r) {
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
   * D6 filter (zero usable legs ONLY, "no ghost when a retry succeeded"): a
   * candidate already present in `liveSeats` (it has a cost row — SL-2 healed
   * it) is dropped. This is the one thing standing between a recovered seat
   * and a duplicate/ghost row — same failure family as the F37 debate-role
   * collision and the RN-11 keyed-row lessons just above (seatsFromRunStats,
   * seatCells): an identity that is not carefully matched silently
   * duplicates or overwrites instead of failing loud.
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
   * exclusive (cli-handlers-council-run.js:196); if that exclusion ever
   * loosens, a healed critic on a lens run would carry role 'seat' and this
   * suppression would render a ghost dead row for it.
   *
   * Old-run resilience (v4.6.3 PR2, spec D4): pre-`degrades[]` runs (v4.5.2)
   * carry the BENCH half of a seat loss only in `seatLoss.deadBenchSeats`
   * (string[] of aliases, verdict.js deriveSeatLoss) — `degrades[]` never
   * existed on either doc for these runs. Consumed after the critic backstop,
   * candidates get `role: null` (deadBenchSeats carries no critic/bench
   * distinction beyond what `criticRequested` already covers above) and flow
   * through the same `seen`-keyed dedup and role-aware suppression as every
   * other candidate — deriveSeatLoss does not dedup its own array, so `seen`
   * is what keeps a repeated alias (or one also named by a real degrade
   * record) from rendering twice.
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
   * @returns {Array<{model: string, statusText: string, role: ?string}>}
   */
  function deadSeats(degrades, seatLoss, liveSeats, runMeta) {
    var critic = runMeta && runMeta.critic ? runMeta.critic : null;
    var seen = {};
    var order = [];
    function add(model, retried, role) {
      if (!model || seen[model]) { return; }
      seen[model] = true;
      order.push({
        model: model,
        role: role || null,
        statusText: retried ? 'did not review — retried once' : 'did not review',
      });
    }
    (degrades || []).forEach(function (d) {
      if (!d || d.kind !== 'degrade') { return; }
      if (d.channel !== 'dead-leg' && d.channel !== 'dead-wave') { return; }
      var data = d.data || {};
      var retried = !!(data.retryWaveId || data.firstFailure);
      // Critic identification mirrors deriveSeatLoss (verdict.js): alias
      // equality with run.critic — degrade records carry no role field.
      if (d.channel === 'dead-leg') {
        add(data.seat, retried, critic && data.seat === critic ? 'critic' : null);
      } else {
        (data.models || []).forEach(function (m) {
          add(m, retried, critic && m === critic ? 'critic' : null);
        });
      }
    });
    if (seatLoss && seatLoss.criticRequested && !seatLoss.criticSeated) {
      add(seatLoss.criticRequested, false, 'critic');
    }
    if (seatLoss) {
      // Pre-degrades[] era (v4.5.2): the bench half of a seat loss lives
      // only here. Alias strings; deriveSeatLoss does not dedup — `seen`
      // absorbs repeats and degrade-sourced duplicates.
      (seatLoss.deadBenchSeats || []).forEach(function (m) { add(m, false, null); });
    }
    // Role-aware D6 (v4.6.3 PR2): only REVIEWING-role live legs suppress —
    // a chair/judge/rebuttal/revote row must not hide a dead reviewer, and
    // a dead-critic candidate is cleared only by a live CRITIC leg. A null
    // role is NOT reviewing: counting it would suppress silently, the exact
    // class the announcement invariant forbids.
    function isReviewing(role) {
      return role === 'seat' || role === 'critic' ||
        (typeof role === 'string' && role.indexOf('lens:') === 0);
    }
    var reviewing = {};
    var byRole = {};
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
      byRole[alias + '|' + s.role] = true;
    });
    return order.filter(function (s) {
      if (s.role === 'critic') { return !byRole[s.model + '|critic']; }
      return !reviewing[s.model];
    });
  }

  // ⚠️ DE-ROT (F41): STAGE_LABELS is exported so applyLive() can label post-open stages.
  var api = { pollDelay: pollDelay, seatCells: seatCells, seatsFromRunStats: seatsFromRunStats,
    deadSeats: deadSeats,
    defaultBlind: defaultBlind, isTerminal: isTerminal, dash: dash,
    TERMINAL_STATUSES: TERMINAL_STATUSES, STAGE_LABELS: STAGE_LABELS };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (typeof window !== 'undefined') { window.AmicusLive = api; }
})();

/**
 * Council Workspace — application state + wiring (v4.4 §5).
 * Historical rendering in this task; Task 15 adds the live poll loop into
 * the seams marked LIVE; Task 16/17 flip the Abort button + confirm dialog.
 *
 * ⚠️ DE-ROT (F05) / PRE-FLIGHT (P2): this file is the last of the three-way
 * split (workspace-app.js / workspace-panels.js / workspace-verbs.js). It
 * loads LAST (md-lite → live-model → workspace-render → workspace-matrix →
 * workspace-panels → workspace-verbs → workspace-app), so panels/verbs
 * already exist and may be captured once, here, at load time.
 */
(function () {
  'use strict';

  var P = window.AmicusPanels;
  var V = window.AmicusVerbs;

  var invoke = function (ch) {
    var args = Array.prototype.slice.call(arguments, 1);
    return window.amicusWorkspace.invoke.apply(null, [ch].concat(args));
  };

  var state = {
    runId: null,
    detail: null,
    debate: null,   // ⚠️ DE-ROT (F38): parsed debate.json, fetched once per run-open; stays
                     // null on a non-debate run, an aborted/skipped debate, or a parse failure —
                     // drillIntoJudge's judge-*.md fallback covers all three.
    blind: false,
    labelByModel: {},
    listTimer: null,
    liveTimer: null, // LIVE (Task 15)
    liveEpoch: 0,    // LIVE (Task 15): bumped by stopLiveLoop() to invalidate in-flight ticks
  };

  function labelOf(model) { return state.labelByModel[model] || null; }
  function isBlind() { return state.blind; }

  function $(id) { return document.getElementById(id); }

  // ---- run list ----------------------------------------------------------
  function refreshList() {
    return invoke('workspace:list-runs').then(function (rows) {
      window.AmicusRender.renderRunList($('run-list'), rows, state.runId, openRun);
    });
  }

  function startListLoop() {
    if (state.listTimer) { clearInterval(state.listTimer); }
    state.listTimer = setInterval(refreshList, 5000); // spec §4.3
    window.addEventListener('focus', refreshList);
  }

  // ---- run detail --------------------------------------------------------
  function openRun(runId) {
    state.runId = runId;
    state.debate = null;
    return invoke('workspace:get-run', runId).then(function (detail) {
      state.detail = detail;
      // ⚠️ DE-ROT (F38): debate.json is the re-vote index the matrix drill-in needs — fetched
      // once per run-open (never per render), fire-and-forget. An aborted or cost-ceiling
      // -skipped debate never writes it; a parse failure leaves state.debate null either way,
      // which drillIntoJudge treats as "no re-vote for this (judge, id)" and falls back to
      // today's judge-*.md path.
      // ⚠️ CODE REVIEW (round 2, finding 1): this fire-and-forget fetch is exactly the F09
      // class of bug if left unguarded — a stale response from a run the user has since
      // navigated away from must never overwrite the run now open. Capture `runId` and check
      // it's still `state.runId` before writing; a rejection (dead channel, closed window) is
      // caught too, so it never surfaces as an unhandled rejection in the renderer.
      if (detail && detail.run && detail.run.debate) {
        invoke('workspace:read-artifact', runId, 'debate.json').then(function (res) {
          if (state.runId !== runId) { return; }
          try { state.debate = JSON.parse(res.text); } catch (err) { state.debate = null; }
        }).catch(function () {
          if (state.runId !== runId) { return; }
          state.debate = null;
        });
      }
      renderDetail();
      refreshList();
    });
  }

  function renderDetail() {
    var d = state.detail;
    $('empty-state').hidden = true;
    $('run-view').hidden = false;
    var R = window.AmicusRender;

    if (!d || d.error || !d.derived) {
      $('run-title').textContent = (d && d.runId) || 'run';
      R.renderBanner($('banner'),
        'Run unreadable: ' + ((d && d.error) || (d && d.run && d.run.parseError) || 'unknown') +
        (d && d.runDir ? ' — ' + d.runDir : ''), '');
      return;
    }

    // blind default: computed ONCE per run-open from status (resolution 9)
    state.blind = window.AmicusLive.defaultBlind(d.run.status);
    $('blind-toggle').checked = state.blind;
    state.labelByModel = {};
    d.derived.names.forEach(function (p) { state.labelByModel[p.model] = p.label; });

    $('run-title').textContent = d.runId;
    R.renderHeaderChips($('run-chips'), d.run);
    R.renderGauge($('cost-gauge-fill'), $('cost-gauge-text'),
      d.derived.cost.costAmount, d.derived.cost.maxCost, d.derived.cost.totalDisplay);
    R.renderStageRail($('stage-rail'), d.derived.stageRail);

    renderBanners();
    P.renderSeatsPanel();
    P.renderMatrixPanel();
    P.renderVerdictPanel();
    R.renderCost($('cost-body'), d.derived.cost, state.blind, labelOf);
    P.wireLazyPanels();
    var isTerminal = window.AmicusLive.TERMINAL_STATUSES.indexOf(d.run.status) !== -1;
    $('abort-btn').hidden = isTerminal;
    V.startLiveLoop();
  }

  function renderBanners() {
    var d = state.detail;
    var R = window.AmicusRender;
    if (!d.derived.schemaSupported) {
      R.renderBanner($('banner'), 'This run was written by a different amicus version (schemaVersion ' +
        d.run.schemaVersion + ') — artifacts: ' + d.runDir, 'warn');
      return;
    }
    // ⚠️ PRE-FLIGHT (P3), caught live by the CDP e2e (Task 18): gating on `d.run.error` ALONE
    // never shows this banner for a `status:'partial'` run — `finalize()` only ever sets
    // `run.error` on the exit-1 path (src/council/run.js:98-100); the exit-2 "degraded" path
    // leaves it null (run-detail.js:83-91). `verdictPanel.reason` (degradedReason()) already
    // covers BOTH cases — exit-1's {code, message} and the partial-run stage-failure/skip
    // sentence — so check for either signal, not run.error alone.
    if (d.run.error || d.derived.verdictPanel.reason) {
      // ⚠️ Code review round 2, finding 2: `d.run.error` is a structured {code, message} object
      // (never a string) — passing it straight to renderBanner set `textContent = <object>`,
      // which coerces to the literal string "[object Object]". `d.derived.verdictPanel.reason`
      // is already the correctly-formatted string (run-detail.js's degradedReason(): "CODE:
      // message" on the exit-1 path, or a stage-failure/skip sentence otherwise) — reuse it
      // rather than re-deriving the same formatting a second time here.
      R.renderBanner($('banner'), d.derived.verdictPanel.reason || 'Run reported an error',
        d.run.status === 'error' ? '' : 'warn');
      return;
    }
    R.renderBanner($('banner'), null);
  }

  // ---- blind toggle + keyboard ------------------------------------------
  $('blind-toggle').addEventListener('change', function (e) {
    state.blind = !!e.target.checked;
    renderDetail_preserveBlind();
  });

  function renderDetail_preserveBlind() {
    var keep = state.blind;
    renderDetail();
    state.blind = keep;
    $('blind-toggle').checked = keep;
    P.renderSeatsPanel();
    P.renderMatrixPanel();
    P.renderVerdictPanel();
    window.AmicusRender.renderCost($('cost-body'), state.detail.derived.cost, state.blind, labelOf);
  }

  $('run-list').addEventListener('keydown', function (e) {
    var items = Array.prototype.slice.call($('run-list').querySelectorAll('li[data-run-id]'));
    if (!items.length) { return; }
    var idx = items.findIndex(function (li) { return li.dataset.runId === state.runId; });
    if (e.key === 'ArrowDown') { e.preventDefault(); openRun(items[Math.min(items.length - 1, idx + 1)].dataset.runId); }
    if (e.key === 'ArrowUp') { e.preventDefault(); openRun(items[Math.max(0, idx - 1)].dataset.runId); }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { $('dialog-abort').hidden = true; }
  });

  // ---- boot --------------------------------------------------------------
  // ⚠️ PRE-FLIGHT (P2): publish the namespace BEFORE anything can call into panels/verbs — they
  // read `window.AmicusApp.*` at call time and this file loads last.
  window.AmicusApp = {
    state: state, invoke: invoke, $: $, labelOf: labelOf,
    isBlind: isBlind, openRun: openRun, renderDetail: renderDetail, renderBanners: renderBanners,
  };

  // ⚠️ PRE-FLIGHT (P4) + DE-ROT (F09): register the three prose `toggle` listeners exactly ONCE,
  // here at boot. wireLazyPanels() (called from renderDetail, on every run-open and blind-toggle)
  // only rewrites the per-run `loaders` spec map from now on — it never adds a listener.
  P.proseLoader('reviews-panel');
  P.proseLoader('bundle-panel');
  P.proseLoader('judges-panel');

  var boot = new URLSearchParams(window.location.search).get('runId');
  refreshList().then(function () {
    if (boot) { openRun(boot); }
  });
  startListLoop();
})();

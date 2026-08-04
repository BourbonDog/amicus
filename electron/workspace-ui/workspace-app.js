/**
 * Council Workspace — application state + wiring (v4.4 §5).
 * Historical rendering in this task; Task 15 adds the live poll loop into
 * the seams marked LIVE; Task 16/17 flip the Abort button + confirm dialog.
 *
 * ⚠️ DE-ROT (F05) / PRE-FLIGHT (P2): this file is the last of the three-way
 * split (workspace-app.js / workspace-panels.js / workspace-verbs.js). It
 * loads LAST (md-lite → live-model → workspace-render → workspace-matrix →
 * workspace-seats → workspace-panels → workspace-verbs → workspace-app), so
 * panels/verbs already exist and may be captured once, here, at load time.
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
    // Task 19 (RN-5) + fix-wave (RN-5 amendment): the (run id, status) pair renderDetail() last
    // computed state.blind's default for. Together they gate the recompute (in renderDetail(),
    // below) to a run CHANGE or a STATUS change only: a same-run/same-status re-render (the
    // blind toggle) keeps the user's own choice, while a same-run/CHANGED-status re-render (the
    // live loop's running -> terminal refresh, or the abort-confirm re-read) still auto-reveals.
    detailRunId: null,
    detailRunStatus: null,
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
      // ⚠️ R4 COUNCIL REVIEW (fourth live paid council, major, unanimous): thread the
      // CURRENTLY-open run's blind state + label lookup through. labelOf only resolves a
      // label for models that belong to the currently open run, so other rows' chair chips
      // degrade gracefully to the raw id — see renderRunList's own note in workspace-render.js.
      window.AmicusRender.renderRunList($('run-list'), rows, state.runId, openRun, state.blind, labelOf);
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
      // ⚠️ Fix-wave item 1: an unreadable run has no derived model behind it, so the Abort
      // button — otherwise left however the PREVIOUS (possibly live, non-terminal) run set it
      // — must not stay enabled here pointed at a run whose detail can't back an abort.
      $('abort-btn').hidden = true;
      R.renderBanner($('banner'),
        'Run unreadable: ' + ((d && d.error) || (d && d.run && d.run.parseError) || 'unknown') +
        (d && d.runDir ? ' — ' + d.runDir : ''), '');
      return;
    }

    // blind default: computed from status (resolution 9) — only on a run CHANGE or a STATUS
    // change for the same run. Task 19 (RN-5): a same-run/same-status re-render
    // (renderDetail_preserveBlind, below, calls straight back in here on every blind toggle)
    // must keep the user's own choice instead of recomputing the default every call —
    // recomputing unconditionally is what forced the old code to paint twice and, via
    // wireLazyPanels() a few lines down, collapse any lazy panel the user had open.
    // ⚠️ Fix-wave (RN-5 amendment, controller ruling): run id ALONE also suppressed the
    // pre-existing running -> terminal auto-reveal, since the live loop's terminal refresh
    // (workspace-verbs.js's startLiveLoop tick) and the abort-confirm re-read both call
    // openRun() on the SAME run id — same run, but a real status transition. Keying on run id
    // AND status recomputes (auto-reveals) on that transition while still preserving a same-
    // run/same-status call (the blind toggle).
    if (state.detailRunId !== d.runId || state.detailRunStatus !== d.run.status) {
      state.blind = window.AmicusLive.defaultBlind(d.run.status);
      state.detailRunId = d.runId;
      state.detailRunStatus = d.run.status;
    }
    $('blind-toggle').checked = state.blind;
    state.labelByModel = {};
    d.derived.names.forEach(function (p) { state.labelByModel[p.model] = p.label; });

    $('run-title').textContent = d.runId;
    R.renderHeaderChips($('run-chips'), d.run, state.blind, labelOf);
    // v4.4 §8: 6th arg = costExact. A run with an unpriced seat draws an
    // indeterminate gauge and a `≥` readout instead of a confident percentage.
    R.renderGauge($('cost-gauge-fill'), $('cost-gauge-text'),
      d.derived.cost.costAmount, d.derived.cost.maxCost, d.derived.cost.totalDisplay,
      d.derived.cost.costExact !== false);
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
    // ⚠️ R4 COUNCIL REVIEW (fourth live paid council, major, unanimous): two distinct bench
    // entries that sanitize to the same artifact name (src/workspace/artifact-guard.js's
    // artifactAllowlist) mean this run directory cannot hold both models' review/judge files
    // under distinct names — drillIntoJudge's artifact lookup would otherwise silently
    // misattribute one model's prose to the other. This is a run-integrity defect the user
    // must see, not a display quirk to smooth over — surfaced ahead of the run.error/reason
    // banner below since it calls into question every judges-panel section's attribution.
    if (d.derived.artifactCollisions && d.derived.artifactCollisions.length) {
      var c = d.derived.artifactCollisions[0];
      R.renderBanner($('banner'),
        'Run integrity error: bench entries ' + c.models.join(' and ') + ' both sanitize to "' + c.sanitized +
        '" — this run directory cannot distinguish their artifacts, so prose below may be misattributed.', '');
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
    // ⚠️ Fix-wave item 1: renderDetail() itself early-returns safely for an unreadable run
    // (!d || d.error || !d.derived) — but this wrapper used to run past that guard
    // unconditionally, dereferencing the (nonexistent) derived model via renderSeatsPanel()
    // and again on the last line below. Reachable from a typo on the primary documented
    // entry point: `amicus watch <badId> --ui` -> ?runId= boot -> getRunDetail -> error ->
    // the error branch unhides #run-view before the derived-model guard, so the Blind
    // checkbox is live with nothing behind it.
    if (!state.detail || state.detail.error || !state.detail.derived) {
      $('blind-toggle').checked = state.blind;
      return;
    }
    // ⚠️ Task 19 (RN-5): this used to call renderDetail() (which unconditionally stomped
    // state.blind back to the run's status default), restore the user's pre-call value,
    // and then re-paint header chips/seats/matrix/verdict/cost a SECOND time to compensate
    // for the first call having painted with the wrong (default) blind state — a double
    // paint, and (via wireLazyPanels(), called inside that first renderDetail()) a collapse
    // of any lazy panel the user had open. Fixed at the root instead of compensated for:
    // renderDetail() now recomputes the blind default only on a run CHANGE or a STATUS change
    // (state.detailRunId/state.detailRunStatus, above) — this call changes neither, so it
    // keeps state.blind exactly as the change listener above just set it, and
    // workspace-panels.js's wireLazyPanels() (its own same-run guard, `lastWiredRunId`)
    // refreshes any open panel in place rather than collapsing it (fix-wave, Fix 1). One
    // renderDetail() call now paints correctly the first time — nothing left to restore.
    renderDetail();
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
  // rewrites the per-run `loaders` spec map every call and — fix-wave, Fix 1 — refreshes any
  // already-open lazy panel in place on a same-run call; it never adds a listener.
  P.proseLoader('reviews-panel');
  P.proseLoader('bundle-panel');
  P.proseLoader('judges-panel');

  var boot = new URLSearchParams(window.location.search).get('runId');
  refreshList().then(function () {
    if (boot) { openRun(boot); }
  });
  startListLoop();
})();

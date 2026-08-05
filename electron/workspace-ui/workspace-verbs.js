/**
 * Council Workspace — action verbs (v4.4 §5, ⚠️ DE-ROT F05 split of
 * workspace-app.js). `doFold` is the only verb live in this task; Task 15
 * adds the live poll loop (startLiveLoop/stopLiveLoop/applyLive) and Task 16
 * adds the abort confirm dialog (openAbortDialog) into the seams below.
 *
 * Loads BEFORE workspace-app.js, so every function here reads
 * `window.AmicusApp` at CALL time — never captured at this file's own load
 * time, since AmicusApp does not exist until workspace-app.js (last in load
 * order) publishes it.
 */
(function () {
  'use strict';

  // Task 16: a LOCAL `$` for the one-time, module-load-time abort-dialog wiring below —
  // the DOM (unlike window.AmicusApp) already exists at this file's load time, since
  // index.html's script tags sit after all the markup. Never used to read AmicusApp state.
  function $(id) { return document.getElementById(id); }

  function doFold() {
    var A = window.AmicusApp;
    var btn = A.$('fold-btn');
    // ⚠️ v4.4.1 LC-8: this chain had NO rejection handler. workspace:fold's IPC handler catches
    // its own errors and answers {ok:false, error}, so a REJECTION means the channel itself failed
    // — and the user saw the Fold button sitting in its pre-click state with no explanation, while
    // the renderer logged an unhandled rejection (which jest-circus fails the running test on).
    // Two-argument .then(onFulfilled, onRejected), NOT .then().catch() — see the long note in
    // startLiveLoop below: with a trailing .catch, a THROW inside onFulfilled would be routed here
    // too and misreported as a channel failure.
    A.invoke('workspace:fold', A.state.runId).then(function (res) {
      if (res.ok) {
        btn.textContent = 'Folded ✓';
        btn.disabled = true;
        btn.title = res.already ? 'Already folded this session' : 'Fold written to the launching terminal';
      } else {
        btn.title = res.error || 'fold failed';
      }
    }, function (err) {
      console.error('workspace fold: workspace:fold failed', err);
      btn.title = 'fold failed — the workspace channel is unavailable' + (err && err.message ? ': ' + err.message : '');
    });
  }

  // ---- live loop (spec §4.3; Task 15) -----------------------------------
  // ⚠️ DE-ROT (F42): stopLiveLoop can only clearTimeout a SCHEDULED tick — it cannot cancel an
  // invoke() already in flight, and the visibilitychange/blur/focus listeners at the bottom of
  // this file re-enter startLiveLoop freely. Without a generation guard those forked chains
  // outlive stopLiveLoop, reassign state.liveTimer (orphaning the timer the event just
  // scheduled), and paint run A's legs into run B after openRun() swaps state.detail underneath
  // them. The epoch + PER-TICK runId pin below are mandatory, not optional hardening.
  function stopLiveLoop() {
    var A = window.AmicusApp;
    A.state.liveEpoch = (A.state.liveEpoch || 0) + 1; // invalidates any in-flight tick
    if (A.state.liveTimer) { clearTimeout(A.state.liveTimer); A.state.liveTimer = null; }
  }

  function liveState(terminal) {
    return {
      terminal: terminal,
      visible: document.visibilityState === 'visible',
      focused: document.hasFocus(),
    };
  }

  function startLiveLoop() {
    var A = window.AmicusApp;
    stopLiveLoop();
    var d = A.state.detail;
    if (!d || !d.run || window.AmicusLive.TERMINAL_STATUSES.indexOf(d.run.status) !== -1) { return; }
    var epoch = A.state.liveEpoch; // F42: stopLiveLoop() above just bumped it; this chain owns it
    var tick = function () {
      // F42: pin the id PER TICK and SEND the pinned id — matching the reply against
      // state.runId while the request carried state.runId would still let a post-switch
      // request hit run B.
      var runId = A.state.runId;
      // ⚠️ Code review round 2, finding 3: this MUST be `.then(onFulfilled, onRejected)`, not
      // `.then(onFulfilled).catch(onRejected)`. The two look equivalent but are not: with a
      // trailing `.catch`, a THROW inside onFulfilled (e.g. applyLive dereferencing a malformed
      // payload, or a missing DOM id) is itself routed to the same catch and silently rescheduled
      // — the loop keeps polling at full cadence, paints nothing, and logs nothing, indistinguishable
      // from a healthy live view. With the two-argument form, onRejected only ever sees a
      // REJECTED invoke() (a real IPC/network failure); a throw inside onFulfilled propagates as
      // its own unhandled rejection instead, which surfaces (devtools/console) rather than being
      // absorbed.
      A.invoke('workspace:get-live', runId).then(function (live) {
        if (epoch !== A.state.liveEpoch || runId !== A.state.runId) { return; } // stale chain
        applyLive(live);
        var terminal = !!(live && live.ok && live.terminal);
        if (terminal) {
          stopLiveLoop();
          // ⚠️ Code review round 2, minor: openRun() is fire-and-forget here with no consumer —
          // a rejected final refresh (e.g. the run folder vanished mid-read) must not strand the
          // transient "refreshing…" banner forever, since the loop has already stopped and no
          // later tick will ever repaint it.
          A.openRun(runId).catch(function (err) {
            console.error('workspace live loop: final get-run refresh failed', err);
            window.AmicusRender.renderBanner(A.$('banner'),
              'Run ended, but refreshing the final details failed — reopen the run to retry.', '');
          });
          return;
        }
        A.state.liveTimer = setTimeout(tick, window.AmicusLive.pollDelay(liveState(false)));
      }, function (err) {
        // A genuinely rejected invoke() (IPC/network failure) — reschedule unless superseded,
        // but log it; silently retrying forever with no trace was the code-review finding.
        if (epoch !== A.state.liveEpoch || runId !== A.state.runId) { return; }
        console.error('workspace live loop: workspace:get-live failed', err);
        A.state.liveTimer = setTimeout(tick, window.AmicusLive.pollDelay(liveState(false)));
      });
    };
    A.state.liveTimer = setTimeout(tick, 0);
  }

  function applyLive(live) {
    var A = window.AmicusApp;
    var R = window.AmicusRender;
    if (!live || !live.ok) {
      // A1 failure: keep last-known panels; flag the live layer only (spec §9)
      // 'live' (alongside 'info') is a marker class, not a style — see the clear-arm note below.
      R.renderBanner(A.$('banner'), 'live data unavailable' + (live && live.error ? ' — ' + live.error : ''), 'info live');
      return;
    }
    // ⚠️ Code review round 2, minor: was `if (live.seats.length)`, which skips renderSeats
    // entirely for an empty array — so a roster that shrinks to zero between stages (the
    // composed doc's `legs` is only populated while a stage is active) leaves the PREVIOUS
    // stage's rows frozen on screen forever, since renderSeats' own leaver-removal never runs.
    // `live.seats` is always an array per the LiveModel contract (never undefined/null) when
    // `live.ok` is true, so this is simply "always paint," empty roster included.
    if (live.seats) {
      R.renderSeats(A.$('seats-body'), live.seats, A.state.blind, A.labelOf);
      window.AmicusSeats.appendDeadRows(live);
    }
    // F42: state.detail can be swapped/absent under a tick — never deref .derived unguarded.
    var derived = A.state.detail && A.state.detail.derived ? A.state.detail.derived : null;
    if (live.stages) {
      // ⚠️ DE-ROT (F41): a raw-name fallback would show the RAW stage name for every stage that
      // starts AFTER run-open (most of them — state.detail is a frozen run-open snapshot).
      // STAGE_LABELS is mirrored onto window.AmicusLive (Task 12/14) for exactly this reason;
      // label from the mirror, not the snapshot.
      // ⚠️ DE-ROT (F40): live stage entries carry no startedAt/completedAt, so reading them off
      // `s` wipes the durable times already on screen on the very first tick. Merge onto the
      // run-open snapshot row instead (a stage that begins mid-session shows no times until the
      // terminal openRun() refresh — status still updates every tick).
      R.renderStageRail(A.$('stage-rail'), live.stages.map(function (s) {
        var prior = (derived ? derived.stageRail.find(function (r) { return r.name === s.name; }) : null) || {};
        return {
          name: s.name,
          label: window.AmicusLive.STAGE_LABELS[s.name] || s.name,
          status: s.status || 'pending',
          startedAt: prior.startedAt || null,
          completedAt: prior.completedAt || null,
        };
      }));
    }
    // ⚠️ DE-ROT (F39): guard on costAmount ALONE. costDisplay is raw formatCost output and can be
    // '?' (source 'unknown') or '—' (null cost); letting either string fall through would
    // overwrite the durable total with a stage-scoped placeholder. The value is ACTIVE-STAGE
    // spend, not a run total — labelled, never sold as one. The durable total returns on the
    // terminal openRun() refresh.
    if (live.costAmount !== null) {
      // v4.4 §8: 6th arg = costExact. A stage carrying an unpriced leg draws the
      // indeterminate gauge + `≥` readout rather than a confident percentage.
      R.renderGauge(A.$('cost-gauge-fill'), A.$('cost-gauge-text'),
        live.costAmount, derived ? derived.cost.maxCost : null,
        (live.costDisplay || '—') + ' (this stage)',
        live.costExact !== false);
    }
    // Dead-run banner: DATA-LAYER flags only (A4) — never GUI heuristics.
    // ⚠️ Task 14 review: flags.crashed really means "errored with a reason" — finalize() maps
    // ANY exit code 1 to status:'error' with run.error set, including a clean, zero-spend,
    // no-legs-ever-launched validation failure. "No leg activity — may be dead, abort to
    // reclaim it" is dishonest there on two counts: leg activity may be irrelevant to why it
    // failed, and status:'error' is already TERMINAL — the process has already exited, so
    // there is nothing left to abort. Give crashed its own, honest copy with no abort claim;
    // it is terminal, so this same tick's terminal branch (above) immediately calls openRun(),
    // which repaints the banner with the real run.error text via renderBanners() — one tick of
    // blast radius. Only `stalled` (a still-running, no-activity heuristic) gets the abort
    // remedy, since only a non-terminal run can plausibly still be aborted.
    if (live.flags.crashed) {
      R.renderBanner(A.$('banner'), 'Run reported an error — refreshing with the final result…', '');
    } else if (live.flags.stalled) {
      var mins = live.flags.stalledForSeconds ? Math.round(live.flags.stalledForSeconds / 60) : null;
      // ⚠️ Code review round 2, finding 1: tagged 'live' (a marker class, no CSS of its own —
      // see workspace.css, which styles only 'warn'/'info') so the clear arm below can find it.
      // `stalled` is recomputed per read and simply omitted once activity resumes
      // (src/mcp-council-awareness.js), so this banner is expected to be transient — but the OLD
      // clear arm only ever matched the 'info' class, so a `''`-kind stalled banner painted here
      // could never be cleared again: `renderBanner(el, text, '')` sets `className = 'banner '`,
      // permanently failing `classList.contains('info')` from that point on, for the rest of the
      // session, even once `flags.stalled` goes back to false on the very next tick.
      R.renderBanner(A.$('banner'),
        'No leg activity' + (mins ? ' for ' + mins + 'm' : '') + ' — the run may be dead. Abort to reclaim it; everything on disk stays browsable.',
        'live');
      // ⚠️ v4.4.1 RN-6 — ARBITRATED, and deliberately NOT fixed as the backlog proposed. RN-6
      // asked for a matching `hidden = true` in the clearing arm below, believing this line is
      // what puts the Abort button on screen. It is not: workspace-app.js's renderDetail already
      // sets `$('abort-btn').hidden = isTerminal` on every run-open (:128), and startLiveLoop only
      // runs on a non-terminal run — so the button is ALREADY visible for the whole life of a live
      // run, by design, and this assignment is a no-op on every path that reaches it. The proposed
      // clearing-arm write would HIDE the button the moment a momentary stall recovered, leaving a
      // healthy, still-running council with no way to abort it: the inverse defect, and worse.
      // Full reasoning + the regression pin: "the Abort button survives a stall -> recover cycle"
      // in tests/workspace/live-loop.test.js.
      //
      // v4.4.1 M4: this line is NOT "the remedy" (that framing, from Task 16, is what this note
      // corrects) — it is redundant on every path except one: a run that dies WHILE stalled,
      // whose terminal openRun() refresh then rejects. On THAT path it leaves Abort visible on a
      // run that is already dead — a false affordance, not a working safety net. Kept anyway
      // because it is harmless: aborting a dead run is a no-op.
      A.$('abort-btn').hidden = false;
    } else if (A.$('banner').classList.contains('live')) {
      // Restores whatever the DURABLE banner actually says (nothing, a schemaVersion mismatch,
      // run.error, …) instead of just blanking it — a live-layer banner (info-unavailable or
      // stalled) must hand back to the true state once neither condition holds, not stomp a
      // real warning that predates it.
      A.renderBanners();
    }
  }

  // ---- abort (Task 16; spec §8) -----------------------------------------
  // Confirm-gated: the dialog only ever shows/hides; workspace:abort-run is invoked
  // solely from the confirm button below, never from opening the dialog itself.
  function openAbortDialog() {
    var A = window.AmicusApp;
    A.$('dialog-abort').hidden = false;
    A.$('dialog-abort-cancel').focus(); // Esc/Enter both land on Cancel — the safe default
  }

  $('abort-btn').addEventListener('click', openAbortDialog);
  $('dialog-abort-cancel').addEventListener('click', function () {
    $('dialog-abort').hidden = true;
  });
  $('dialog-abort-confirm').addEventListener('click', function () {
    var A = window.AmicusApp;
    var btn = $('dialog-abort-confirm');
    if (btn.disabled) { return; } // a rapid second click while the first is in flight: no-op
    btn.disabled = true;
    A.invoke('workspace:abort-run', A.state.runId).then(function (res) {
      btn.disabled = false;
      $('dialog-abort').hidden = true;
      if (!res.ok) {
        window.AmicusRender.renderBanner(A.$('banner'), 'Abort failed: ' + (res.error || res.detail || 'unknown'), '');
        return;
      }
      stopLiveLoop();
      // ⚠️ v4.4.1 LC-8: the re-read was fire-and-forget (wsgate01 C5) — inconsistent with the
      // live loop's terminal branch above, which was explicitly given this same handler for this
      // same reason. If the re-read fails, the status chip never leaves 'running' and the UI shows
      // a live run that isn't. `.catch` (not the two-argument form) is EXACTLY equivalent here and
      // matches the sibling at the terminal branch above: there is no onFulfilled for a trailing
      // .catch to swallow a throw out of, which is the only thing the two-argument form buys.
      A.openRun(A.state.runId).catch(function (err) { // re-read: status flips to aborted, grey chip, no live poll
        console.error('workspace abort: post-abort get-run refresh failed', err);
        window.AmicusRender.renderBanner(A.$('banner'),
          'Abort succeeded, but refreshing the run failed — reopen the run to see its final state.', '');
      });
    }, function (err) {
      // ⚠️ v4.4.1 LC-8 (same handler, same class): a REJECTED invoke() left `btn.disabled = true`
      // and the dialog open forever — the confirm button wedged with no way back — plus an
      // unhandled rejection. workspace:abort-run's IPC handler answers {ok:false} on its own
      // errors, so reaching here means the channel failed, not the abort.
      console.error('workspace abort: workspace:abort-run failed', err);
      btn.disabled = false;
      $('dialog-abort').hidden = true;
      window.AmicusRender.renderBanner(A.$('banner'),
        'Abort failed: the workspace channel is unavailable' + (err && err.message ? ' — ' + err.message : ''), '');
    });
  });

  // ⚠️ DE-ROT (F42): these three re-enter startLiveLoop on every focus/blur/visibility flip.
  // That is only safe because startLiveLoop() calls stopLiveLoop() first, which bumps
  // state.liveEpoch — any tick already awaiting invoke() sees the mismatch and drops instead of
  // rescheduling itself. Without the epoch bump each flip forks a second poll chain that no stop
  // can reach. Registered once at this file's load time (verbs.js loads before workspace-app.js,
  // so window.AmicusApp does not exist yet — the callback bodies read it at call time via
  // startLiveLoop/stopLiveLoop, never here).
  document.addEventListener('visibilitychange', function () {
    var A = window.AmicusApp;
    if (A.state.liveTimer) { startLiveLoop(); }
  });
  window.addEventListener('blur', function () {
    var A = window.AmicusApp;
    if (A.state.liveTimer) { startLiveLoop(); }
  });
  window.addEventListener('focus', function () {
    var A = window.AmicusApp;
    if (A.state.liveTimer) { startLiveLoop(); }
  });

  window.AmicusVerbs = {
    doFold: doFold, startLiveLoop: startLiveLoop, stopLiveLoop: stopLiveLoop, applyLive: applyLive,
    openAbortDialog: openAbortDialog,
  };
})();

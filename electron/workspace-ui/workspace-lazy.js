/**
 * Council Workspace — lazy prose-panel loading (v4.4 §5.2). v4.7 PR7 extraction of the
 * loading machinery out of workspace-panels.js, which was at 294/300 with the T19 stale-paint
 * fixes still to land; the same treatment workspace-seats.js got in v4.6.2 PR4 (D8).
 *
 * Split line: this file owns WHEN and WHETHER an artifact read is issued and which reply is
 * allowed to paint (the `loading` promise cache, the run/issue staleness fences).
 * workspace-panels.js keeps NAME RESOLUTION (sanitizeName / resolveArtifactName — the RN-1
 * disambiguation pair, pinned by tests/electron/workspace-ui-static.test.js) and the panel
 * adapters. Cross-calls resolve `window.Amicus*` at CALL time, never at this file's load time
 * — the house discipline for every renderer script.
 *
 * Loads AFTER workspace-seats.js and BEFORE workspace-panels.js (index.html), whose
 * wireLazyPanels/proseLoader are thin delegates into this namespace.
 */
(function () {
  'use strict';

  // ---- lazy prose panels (spec §5.2: load on first open; NOT cached across a same-run rewire
  // — a blind flip or the live loop's terminal refresh both drop it, T19-m1) -----------------
  // ⚠️ DE-ROT (F09): a NEW toggle listener stacking on every renderDetail() call is the bug this
  // shape exists to avoid — see wireLazyPanels()/proseLoader() below. Register the three
  // listeners ONCE at boot (workspace-app.js's boot block calls proseLoader per panel id) and
  // dispatch through this module-level `loaders` map, which renderDetail (via wireLazyPanels)
  // overwrites per run.
  //
  // ⚠️ PRE-FLIGHT (P4): the load is AWAITABLE — drillIntoJudge needs to know when it has
  // settled (the old code guessed with setTimeout(render, 300), which could fire before an
  // unbounded N-artifact IPC round trip finished and silently render nothing). loadPanel()
  // is idempotent per panel id and returns its in-flight promise; the promise cache
  // (`loading`) and the per-run spec (`loaders`) are both keyed by panel id. `loading` is
  // dropped by wireLazyPanels() on BOTH a run CHANGE and a same-run rewire (T19-m1, Task 3) —
  // the run-change drop is what stops F09's stale-run artifact requests; the same-run drop is
  // what T19-m1's `issue` token (below) fences against repainting a superseded same-run wave.
  var loaders = {};  // panelId -> {bodyId, files}  (rewritten per run by wireLazyPanels)
  var loading = {};  // panelId -> Promise           (dropped on every run CHANGE or same-run rewire)
  // Task 19 (RN-5): the run wireLazyPanels() last reset panels/loading for — gates the reset
  // below to run CHANGES only. A same-run call (renderDetail() runs this on every blind toggle
  // too, and on the live loop's terminal refresh) instead drops the cached load for EVERY
  // tracked panel — open or closed (T19-m1, Task 3) — and reissues a fetch for whichever panel
  // is currently open (Fix 1).
  var lastWiredRunId = null;
  // ⚠️ T19-m1 (v4.7 PR7): the only staleness fence used to be the runId captured at issue time,
  // which cannot distinguish two requests issued for the SAME run — a blind flip, a manifest that
  // grew, or any same-run rewire issues a second load while the first is still in flight, and
  // whichever settles LAST won the paint. Monotonic per-panel issue number: the completion handler
  // paints only if it is still the newest issue. Keys are the three fixed panel-id literals (never
  // a model name), so a bare object is safe here — unlike the model-keyed maps in live-model.js.
  var issue = {};    // panelId -> monotonically increasing issue number

  function loadPanel(panelId, bodyId, files) {
    var A = window.AmicusApp;
    if (loading[panelId]) { return loading[panelId]; }
    // ⚠️ R4 COUNCIL REVIEW (fourth live paid council, major, unanimous): this is the third
    // instance of the F09 class of bug (a stale async response overwriting shared DOM after
    // the user has navigated away) — already fixed once for the toggle-listener stack (F09
    // itself) and once for the fire-and-forget debate.json fetch in workspace-app.js (guards
    // with `if (state.runId !== runId) return;`). wireLazyPanels() clearing `loading[panelId]`
    // on every run switch permits a NEW request to be issued, but never fenced the PRIOR
    // request's eventual resolution — open reviews-panel on run A, switch to run B (which
    // issues its own request), and A's response — however late — used to overwrite whatever
    // B had just rendered. Capture the runId this request was issued for, and guard as the
    // FIRST statement of the completion handler, exactly like the debate.json fix.
    var runId = A.state.runId;
    // ⚠️ T19-m1 (v4.7 PR7): captured the same way as `runId` above — read once, at issue time —
    // so the completion guard below compares against the value in force when THIS request was
    // issued, not whatever `issue[panelId]` has become by the time it resolves.
    var token = (issue[panelId] = (issue[panelId] || 0) + 1);
    var pending = Promise.all(files().map(function (f) {
      return A.invoke('workspace:read-artifact', runId, f.name).then(function (res) {
        return { name: f.name, title: f.title, text: res.text || '', truncated: res.truncated, error: res.error };
      });
    })).then(function (sections) {
      if (A.state.runId !== runId || issue[panelId] !== token) { return; } // stale: superseded
      window.AmicusRender.renderProseSections(A.$(bodyId), sections.map(function (s) {
        return s.error ? { name: s.name, title: s.title, error: s.name + ' — ' + s.error } : s;
      }));
      A.$(panelId).dataset.loaded = '1';   // display/debug marker only — `loading` is the real gate
    }, function (err) {
      // ⚠️ T19-m2 (v4.7 PR7). Two-argument .then(onFulfilled, onRejected) — NOT a trailing
      // .catch. workspace-verbs.js:76-84 already ruled on this exact construct: with a trailing
      // .catch a THROW inside onFulfilled is routed here too, so a painter bug would be absorbed
      // into a silent blank panel that ALSO evicts its own cache and therefore retries forever.
      // With the two-argument form this handler only ever sees a genuinely rejected invoke().
      // The `=== pending` self-check is load-bearing: without it a late rejection can evict a
      // NEWER in-flight promise and strand the panel. And the log is not optional — a silent
      // eviction is the correct-but-silent degrade the product principle rejects.
      if (loading[panelId] === pending) { delete loading[panelId]; }
      console.error('workspace lazy panel: read-artifact failed for ' + panelId, err);
    });
    loading[panelId] = pending;
    return pending;
  }

  /** Registered ONCE at boot (per panel id); reads the current run's spec off `loaders`. */
  function proseLoader(panelId) {
    var A = window.AmicusApp;
    var panel = A.$(panelId);
    panel.addEventListener('toggle', function () {
      if (!panel.open) { return; }
      var spec = loaders[panelId];
      if (spec) { loadPanel(panelId, spec.bodyId, spec.files); }
    });
  }

  /**
   * Rewrites the per-run spec map on every call. On a run CHANGE (tracked via the module-level
   * `lastWiredRunId`, above), resets panel open/loaded state and drops the previous run's
   * cached load promises — exactly what F09's stale-run protection needs. On a SAME-run call
   * (Task 19, RN-5: renderDetail() calls this on every blind toggle too, and the live loop's
   * terminal refresh) any panel the user already has open is instead refreshed in place — see
   * Fix 1 below — never left showing stale-blind content, never collapsed. Registers no
   * listeners itself.
   */
  function wireLazyPanels() {
    var A = window.AmicusApp;
    // ⚠️ Fix-wave (Fix 4): keyed off `A.state.detail.runId`, not `A.state.runId` — the latter is
    // set synchronously at the top of openRun(), before its workspace:get-run reply lands, so an
    // out-of-order reply could make the two diverge. workspace-app.js's own run-change gate
    // (renderDetail(), above `d.runId`) reads off the SAME `state.detail.runId`, so the two
    // provably agree on whether this is a run change.
    var sameRun = A.state.detail.runId === lastWiredRunId;
    if (!sameRun) {
      ['reviews-panel', 'bundle-panel', 'judges-panel'].forEach(function (id) {
        var p = A.$(id);
        p.dataset.loaded = '0';
        p.open = false;
        delete loading[id];
      });
      lastWiredRunId = A.state.detail.runId;
    }
    var bench = A.state.detail.run.bench || [];
    var debated = !!A.state.detail.run.debate;
    // ⚠️ CODE REVIEW (round 2, finding 2): readRunArtifact's error for a genuinely-missing
    // artifact is NOT translated into a friendly "not written yet" note anywhere in this
    // read path — it lands in the panel verbatim, absolute host path and all. `run.debate` is
    // seeded on run.json's FIRST write, so it's truthy on every --debate run, including ones
    // where the re-vote wave never actually ran (no contested findings, cost ceiling, abort) —
    // requesting revote-<model>.md speculatively in that (near-certain) case means one ugly
    // error row per bench model for a condition that isn't an error at all. run-detail.js
    // already computes a presence manifest (state.detail.artifacts) for exactly these
    // allowlisted names via fs.statSync — filter on it instead of requesting known-absent
    // files. Applies to review-/judge- too (the same latent gap, just plan-mandated rather
    // than new).
    var artifacts = A.state.detail.artifacts || {};
    function present(name) { return !!(artifacts[name] && artifacts[name].present); }
    // ⚠️ v4.4.1 RN-9: these two titles used to hand-roll `A.state.blind && label ? label : m`
    // inline. Both now go through AmicusRender.display() — the single blind-flip definition the
    // re-vote title below already used — so the next blind-mode ruling lands in one place instead
    // of being re-applied by hand in every file that happens to render an identity.
    loaders['reviews-panel'] = { bodyId: 'reviews-body', files: function () {
      return bench.map(function (m) {
        var label = A.state.labelByModel[m];
        return { name: window.AmicusPanels.resolveArtifactName(m, 'review'), title: window.AmicusRender.display({ model: m, label: label }, A.state.blind) };
      }).filter(function (f) { return present(f.name); });
    } };
    loaders['bundle-panel'] = { bodyId: 'bundle-body', files: function () {
      // ⚠️ v4.4.1 RN-4: the presence filter is NOT optional here either. Without it, a run whose
      // Stage 2 never ran (a one-seat bench, an abort before the cross-review, a cost ceiling)
      // requested a file the manifest already knows is absent and rendered readRunArtifact's raw
      // error string in the panel — "absolute host path and all", per this file's own round-2
      // note above `present()`. reviews-panel and judges-panel have always filtered; this was the
      // odd one out.
      return [{ name: 'bundle-stage2.md', title: 'bundle-stage2.md (verbatim)' }]
        .filter(function (f) { return present(f.name); });
    } };
    loaders['judges-panel'] = { bodyId: 'judges-body', files: function () {
      var files = bench.map(function (m) {
        var label = A.state.labelByModel[m];
        return { name: window.AmicusPanels.resolveArtifactName(m, 'judge'), title: 'Judge ' + window.AmicusRender.display({ model: m, label: label }, A.state.blind) };
      });
      if (debated) {
        // ⚠️ DE-ROT (F38): on a --debate run, a matrix dispute cell can be a RE-VOTE whose
        // prose lives in revote-<model>.md (not judge-<model>.md). Included per bench model
        // like judge-*.md above, but — per the presence filter — only when the manifest
        // confirms the file actually exists (see the code-review note above `present()`).
        // ⚠️ CODE REVIEW (round 2, finding 3): this title is new code (unlike the review-/
        // judge- titles above, which mirror the brief verbatim), so it goes through
        // AmicusRender.display() — the single blind-flip definition — rather than adding a
        // fourth hand-rolled copy of the same ternary.
        // ⚠️ Task 18 fix-wave (RN-1, review finding 1): this name used to be recomputed via a
        // bare sanitizeName(m) call, ignoring the disambiguation map entirely — for a colliding
        // pair BOTH models resolved to the same bare revote-<sanitized>.md name, reintroducing
        // for re-votes the exact cross-match bug Task 18 fixed for review-/judge-. Routed
        // through resolveArtifactName(m, 'revote') like the other three sites; its built-in
        // legacy fallback keeps older detail payloads (no artifactsByModel map) correct too.
        files = files.concat(bench.map(function (m) {
          var label = A.state.labelByModel[m];
          return { name: window.AmicusPanels.resolveArtifactName(m, 'revote'), title: 'Re-vote ' + window.AmicusRender.display({ model: m, label: label }, A.state.blind) };
        }));
      }
      return files.filter(function (f) { return present(f.name); });
    } };
    // ⚠️ Fix-wave (Fix 1, RN-9): a same-run call (the blind toggle, or the live loop's
    // running -> terminal refresh) must re-render any panel the user already has open, or it
    // keeps showing content painted under the PREVIOUS blind state. renderProseSections()
    // (workspace-render.js) clears its container before repainting, so this replaces sections
    // in place rather than appending duplicates. Drop the cached promise first so loadPanel()
    // actually re-fetches instead of returning its already-settled one.
    if (sameRun) {
      ['reviews-panel', 'bundle-panel', 'judges-panel'].forEach(function (id) {
        var p = A.$(id);
        // ⚠️ T19-m1 (v4.7 PR7): the cache drop used to be INSIDE the `p.open` guard, so a panel
        // the user had collapsed kept its settled promise across a blind flip — reopening it
        // returned that promise and repainted the previous blind state with no new fetch (recon
        // path A). Dropping unconditionally closes path A — but by itself it only CONVERTS path D
        // (collapse mid-flight) into a race: it drops the cache entry even while that panel's
        // fetch is still outstanding, so a reopen before it settles issues a SECOND concurrent
        // fetch, and the orphaned first one has no fence but `runId` (unchanged for a same-run
        // rewire). `issue` (declared above) and loadPanel()'s completion guard are what actually
        // close D. Unconditional drop costs a re-read of that panel's artifacts on the next open;
        // renderDetail fires on run open, blind toggle, and the live loop's terminal refresh only
        // (the tick calls applyLive, not renderDetail), so this is not a per-poll storm.
        delete loading[id];
        if (p.open) { loadPanel(id, loaders[id].bodyId, loaders[id].files); }
      });
    }
  }

  // `loaders` stays module-private; drillIntoJudge (still in workspace-panels.js) needs to ask
  // whether this run has a spec for a panel, and nothing else needs the map itself.
  function panelSpec(panelId) { return loaders[panelId] || null; }

  window.AmicusLazy = {
    loadPanel: loadPanel,
    proseLoader: proseLoader,
    wireLazyPanels: wireLazyPanels,
    panelSpec: panelSpec,
  };
})();

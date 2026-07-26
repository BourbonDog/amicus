/**
 * Council Workspace — lazy/prose panels + the matrix/verdict panel adapters
 * (v4.4 §5, ⚠️ DE-ROT F05 split of workspace-app.js).
 *
 * Loads BEFORE workspace-app.js (md-lite → live-model → workspace-render →
 * workspace-matrix → workspace-panels → workspace-verbs → workspace-app), so
 * every function here reads `window.AmicusApp` / `window.AmicusVerbs` at CALL
 * time (never captured at this file's own load time — neither namespace
 * exists yet when this IIFE runs). window.AmicusApp publishes its namespace
 * at the top of its own boot, before calling into this file, so by the time
 * any function below actually executes, both are present.
 */
(function () {
  'use strict';

  // ⚠️ DE-ROT (F61): keep this local mirror of the shipped sanitizeName (src/council/run-launch.js:92-94)
  // — pinned with an equality assert in tests/electron/workspace-ui-static.test.js. Do NOT rebuild
  // the lists from Object.keys(state.detail.artifacts): filenames carry the SANITIZED id, which cannot be
  // inverted back to the model id that keys state.labelByModel, so blind labels would break.
  function sanitizeName(model) { return String(model).replace(/[^a-zA-Z0-9._-]/g, '-'); }

  function renderSeatsPanel() {
    var A = window.AmicusApp;
    var d = A.state.detail;
    var seats = window.AmicusLive.seatsFromRunStats(d.derived.cost.rows);
    window.AmicusRender.renderSeats(A.$('seats-body'), seats, A.state.blind, A.labelOf);
  }

  function renderMatrixPanel() {
    var A = window.AmicusApp;
    window.AmicusMatrix.renderMatrix(A.$('matrix-body'), A.state.detail.derived.matrix, drillIntoJudge);
  }

  function renderVerdictPanel() {
    var A = window.AmicusApp;
    var d = A.state.detail;
    var chairHost = window.AmicusMatrix.renderVerdict(A.$('verdict-body'), d.derived.verdictPanel, {
      labelOf: A.labelOf,
      isBlind: A.isBlind,
      reportPresent: !!(d.artifacts['report.html'] && d.artifacts['report.html'].present),
      onFold: function () { window.AmicusVerbs.doFold(); },
      onOpenReport: function () { A.invoke('workspace:open-report', A.state.runId); },
    });
    if (d.artifacts['chair-output.md'] && d.artifacts['chair-output.md'].present) {
      A.invoke('workspace:read-artifact', A.state.runId, 'chair-output.md').then(function (res) {
        if (res.text) { window.AmicusMd.renderMdLite(chairHost, res.text, document); }
      });
    } else {
      chairHost.appendChild(window.AmicusRender.el('p', { className: 'empty-note' }, ['chair-output.md not written yet']));
    }
  }

  // ---- lazy prose panels (spec §5.2: load on first open, cache) ---------
  // ⚠️ DE-ROT (F09): a NEW toggle listener stacking on every renderDetail() call is the bug this
  // shape exists to avoid — see wireLazyPanels()/proseLoader() below. Register the three
  // listeners ONCE at boot (workspace-app.js's boot block calls proseLoader per panel id) and
  // dispatch through this module-level `loaders` map, which renderDetail (via wireLazyPanels)
  // overwrites per run.
  //
  // ⚠️ PRE-FLIGHT (P4): the load is AWAITABLE — drillIntoJudge needs to know when it has
  // settled (the old code guessed with setTimeout(render, 300), which could fire before an
  // unbounded N-artifact IPC round trip finished and silently render nothing). loadPanel()
  // is idempotent per panel id and returns its in-flight promise; both the promise cache
  // (`loading`) and the per-run spec (`loaders`) are keyed by panel id and cleared/overwritten
  // by wireLazyPanels() on every run-open — that clearing is what stops F09's stale-run
  // artifact requests.
  var loaders = {};  // panelId -> {bodyId, files}  (rewritten per run by wireLazyPanels)
  var loading = {};  // panelId -> Promise           (cleared per run by wireLazyPanels)

  function loadPanel(panelId, bodyId, files) {
    var A = window.AmicusApp;
    if (loading[panelId]) { return loading[panelId]; }
    loading[panelId] = Promise.all(files().map(function (f) {
      return A.invoke('workspace:read-artifact', A.state.runId, f.name).then(function (res) {
        return { name: f.name, title: f.title, text: res.text || '', truncated: res.truncated, error: res.error };
      });
    })).then(function (sections) {
      window.AmicusRender.renderProseSections(A.$(bodyId), sections.map(function (s) {
        return s.error ? { name: s.name, title: s.title, error: s.name + ' — ' + s.error } : s;
      }));
      A.$(panelId).dataset.loaded = '1';   // display/debug marker only — `loading` is the real gate
    });
    return loading[panelId];
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
   * Rewrites the per-run spec map and drops the previous run's cached load promises — this
   * is precisely what stops F09's stale-run artifact requests. Safe to call on every
   * renderDetail() (run-open and blind-toggle alike); it registers no listeners itself.
   */
  function wireLazyPanels() {
    var A = window.AmicusApp;
    ['reviews-panel', 'bundle-panel', 'judges-panel'].forEach(function (id) {
      var p = A.$(id);
      p.dataset.loaded = '0';
      p.open = false;
      delete loading[id];
    });
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
    loaders['reviews-panel'] = { bodyId: 'reviews-body', files: function () {
      return bench.map(function (m) {
        var label = A.state.labelByModel[m];
        return { name: 'review-' + sanitizeName(m) + '.md', title: (A.state.blind && label ? label : m) };
      }).filter(function (f) { return present(f.name); });
    } };
    loaders['bundle-panel'] = { bodyId: 'bundle-body', files: function () {
      return [{ name: 'bundle-stage2.md', title: 'bundle-stage2.md (verbatim)' }];
    } };
    loaders['judges-panel'] = { bodyId: 'judges-body', files: function () {
      var files = bench.map(function (m) {
        var label = A.state.labelByModel[m];
        return { name: 'judge-' + sanitizeName(m) + '.md', title: 'Judge ' + (A.state.blind && label ? label : m) };
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
        files = files.concat(bench.map(function (m) {
          var label = A.state.labelByModel[m];
          return { name: 'revote-' + sanitizeName(m) + '.md', title: 'Re-vote ' + window.AmicusRender.display({ model: m, label: label }, A.state.blind) };
        }));
      }
      return files.filter(function (f) { return present(f.name); });
    } };
  }

  // ⚠️ DE-ROT (F38): on a --debate run the FINAL tally.json is rebuilt from the debate's
  // replaced adjudications, so a matrix `dispute` cell can be a re-vote — gate per
  // (judge, findingId), not per run: a judge gets ONE re-vote leg covering only the ids it
  // actually re-voted; every other dispute cell still belongs to judge-*.md. debate.json's
  // `revotes[]` is keyed on the bench ALIAS (same key revote-*.md and state.labelByModel use),
  // so no filename inversion is needed. Returns the settle promise so callers (and tests) can
  // await the highlight instead of guessing when it lands.
  function drillIntoJudge(judgePair, findingId) {
    var A = window.AmicusApp;
    var panel = A.$('judges-panel');
    panel.open = true;
    var spec = loaders['judges-panel'];
    if (!spec) { return Promise.resolve(); }
    return loadPanel('judges-panel', spec.bodyId, spec.files).then(function () {
      var rv = ((A.state.debate && A.state.debate.revotes) || []).find(function (r) {
        return r.judge === judgePair.model && r.id === findingId;
      });
      var artifactName = rv
        ? 'revote-' + sanitizeName(judgePair.model) + '.md'
        : 'judge-' + sanitizeName(judgePair.model) + '.md';
      var section = A.$('judges-body').querySelector('[data-artifact="' + artifactName + '"]');
      // A genuinely absent artifact is not an error here — the panel renders its own
      // "<file> not written yet" empty state (spec §9, last row).
      if (!section) { return; }
      // ⚠️ CODE REVIEW (round 2, finding 4): loadPanel() is cached per panel id, so a repeat
      // drill into the SAME (judge, findingId) re-enters this .then() against the SAME DOM
      // section every time — but the mutations below were not idempotent: a second click
      // duplicated the reason paragraph and, since highlightText's tree-walk descends into a
      // <mark> it already created, nested a second <mark> inside the first. Guard both on
      // whether this section has already been annotated.
      if (rv && rv.reason && !section.querySelector('.revote-reason')) {
        section.insertBefore(window.AmicusRender.el('p', { className: 'mono revote-reason' }, [rv.reason]), section.children[1] || null);
      }
      if (!section.querySelector('mark')) {
        window.AmicusMatrix.highlightText(section, findingId);
      }
      section.scrollIntoView({ block: 'start' });
    });
  }

  window.AmicusPanels = {
    renderSeatsPanel: renderSeatsPanel,
    renderMatrixPanel: renderMatrixPanel,
    renderVerdictPanel: renderVerdictPanel,
    wireLazyPanels: wireLazyPanels,
    proseLoader: proseLoader,
    drillIntoJudge: drillIntoJudge,
    sanitizeName: sanitizeName,
  };
})();

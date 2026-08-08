/**
 * Council Workspace — name resolution + the matrix/verdict/seats panel adapters
 * (v4.4 §5, ⚠️ DE-ROT F05 split of workspace-app.js). v4.7 PR7 (Task 1) moved the lazy
 * prose-panel loading machinery (loaders/loading/lastWiredRunId state, loadPanel,
 * proseLoader, wireLazyPanels) out to workspace-lazy.js — this file was pressed up against
 * the 300-line size gate with the T19 stale-paint fixes still to land, the same treatment
 * workspace-seats.js got in v4.6.2 PR4 (D8).
 *
 * Split line: this file owns NAME RESOLUTION (sanitizeName / resolveArtifactName — the RN-1
 * disambiguation pair, pinned by tests/electron/workspace-ui-static.test.js) and the panel
 * adapters; workspace-lazy.js owns WHEN and WHETHER an artifact read is issued and which
 * reply is allowed to paint.
 *
 * Loads BEFORE workspace-app.js (md-lite → live-model → workspace-render →
 * workspace-matrix → workspace-seats → workspace-lazy → workspace-panels →
 * workspace-verbs → workspace-app), so every function here reads `window.AmicusApp` /
 * `window.AmicusVerbs` / `window.AmicusLazy` at CALL time (never captured at this file's
 * own load time — none of those namespaces exist yet when this IIFE runs). window.AmicusApp
 * publishes its namespace at the top of its own boot, before calling into this file, so by
 * the time any function below actually executes, all three are present.
 */
(function () {
  'use strict';

  // ⚠️ DE-ROT (F61): keep this local mirror of the shipped sanitizeName (src/council/run-launch.js:92-94)
  // — pinned with an equality assert in tests/electron/workspace-ui-static.test.js. Do NOT rebuild
  // the lists from Object.keys(state.detail.artifacts): filenames carry the SANITIZED id, which cannot be
  // inverted back to the model id that keys state.labelByModel, so blind labels would break.
  function sanitizeName(model) { return String(model).replace(/[^a-zA-Z0-9._-]/g, '-'); }

  // ⚠️ Task 18 (RN-1): review-/judge- filenames used to be recomputed here via a bare
  // sanitizeName(model) call, which is NOT injective — two distinct bench models that sanitize
  // to the same name would both resolve to the SAME filename, so drillIntoJudge's
  // `[data-artifact="..."]` lookup handed back whichever section matched first (model A's prose
  // rendered under model B's name). derived.artifactsByModel (src/workspace/artifact-guard.js's
  // artifactAllowlist, threaded through by run-detail.js) already carries the disambiguated
  // (possibly `~2`/`~3`-suffixed) name per raw model — consult it FIRST. Fall back to the legacy
  // computation only when the map itself is absent: older detail payloads (pre-v4.5 runs,
  // live-doc consumers not yet updated to build the map) never carry it, and re-deriving via
  // sanitizeName is exactly what those payloads always did, so it stays correct for them too.
  function resolveArtifactName(model, kind) {
    var A = window.AmicusApp;
    var map = A.state.detail.derived && A.state.detail.derived.artifactsByModel;
    var entry = map && map[model];
    if (entry && entry[kind]) { return entry[kind]; }
    return kind + '-' + sanitizeName(model) + '.md';
  }

  // ⚠️ D8 extraction (Task 1): body moved verbatim to workspace-seats.js
  // (window.AmicusSeats), which loads immediately before this file.
  function renderSeatsPanel() {
    window.AmicusSeats.renderSeatsPanel();
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

  // ⚠️ v4.7 PR7 extraction: bodies moved verbatim to workspace-lazy.js
  // (window.AmicusLazy), which loads immediately before this file.
  function proseLoader(panelId) { window.AmicusLazy.proseLoader(panelId); }
  function wireLazyPanels() { window.AmicusLazy.wireLazyPanels(); }

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
    var spec = window.AmicusLazy.panelSpec('judges-panel');
    if (!spec) { return Promise.resolve(); }
    return window.AmicusLazy.loadPanel('judges-panel', spec.bodyId, spec.files).then(function () {
      var rv = ((A.state.debate && A.state.debate.revotes) || []).find(function (r) {
        return r.judge === judgePair.model && r.id === findingId;
      });
      // ⚠️ Task 18 fix-wave (RN-1, review finding 1): this branch used to recompute the name via
      // bare sanitizeName(judgePair.model), independently of the (already-fixed) judge branch
      // right below it — for a colliding pair, drilling a re-vote on the SECOND model resolved
      // to the bare name and cross-matched the FIRST model's genuine revote section. Both arms
      // of this ternary now go through the same disambiguation-aware helper.
      var artifactName = rv
        ? resolveArtifactName(judgePair.model, 'revote')
        : resolveArtifactName(judgePair.model, 'judge');
      var section = A.$('judges-body').querySelector('[data-artifact="' + artifactName + '"]');
      // A genuinely absent artifact is not an error here — the panel renders its own
      // "<file> not written yet" empty state (spec §9, last row).
      if (!section) { return; }
      // ⚠️ CODE REVIEW (round 2, finding 4) + ⚠️ R4 COUNCIL REVIEW (fourth live paid council,
      // major, unanimous): loadPanel() is cached per panel id, so this DOM section is built
      // once and never rebuilt — every drill into this judge re-enters this .then() against
      // the SAME section. The original guard ("skip if the section already has a <mark> /
      // .revote-reason ANYWHERE") stopped a repeat drill into the SAME finding from
      // duplicating the reason paragraph / nesting a second <mark> — but it also permanently
      // wedged a LATER drill into a DIFFERENT finding on the same judge, since the stale
      // mark from the first finding trips the same "already annotated" check forever.
      // Track which finding is CURRENTLY highlighted on this section instead: a repeat drill
      // on that same finding is a no-op (idempotent), while a drill into any other finding
      // clears the previous mark/reason before applying the new one.
      if (section.dataset.drilledFinding === findingId) { return; }
      var staleReason = section.querySelector('.revote-reason');
      if (staleReason) { staleReason.remove(); }
      window.AmicusMatrix.clearHighlight(section);
      if (rv && rv.reason) {
        section.insertBefore(window.AmicusRender.el('p', { className: 'mono revote-reason' }, [rv.reason]), section.children[1] || null);
      }
      window.AmicusMatrix.highlightText(section, findingId);
      section.dataset.drilledFinding = findingId;
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
    resolveArtifactName: resolveArtifactName,
  };
})();

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

  function doFold() {
    var A = window.AmicusApp;
    var btn = A.$('fold-btn');
    A.invoke('workspace:fold', A.state.runId).then(function (res) {
      if (res.ok) {
        btn.textContent = 'Folded ✓';
        btn.disabled = true;
        btn.title = res.already ? 'Already folded this session' : 'Fold written to the launching terminal';
      } else {
        btn.title = res.error || 'fold failed';
      }
    });
  }

  // LIVE (Task 15): function startLiveLoop() { ... } / function stopLiveLoop() { ... } / function applyLive(doc) { ... }
  // ABORT (Task 16): function openAbortDialog() { ... }

  window.AmicusVerbs = { doFold: doFold };
})();

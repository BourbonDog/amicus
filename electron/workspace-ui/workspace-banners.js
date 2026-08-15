/**
 * Council Workspace — the run-detail banner ladder (v4.4 §9, spec's "graceful when present").
 *
 * v4.8 PR5a fix-wave 3 extraction of renderBanners out of workspace-app.js, which hit
 * 310/300 when the orphan-collision and rejected-seat-table banners landed. Exactly the
 * treatment workspace-panels.js got in v4.7 PR7 (workspace-lazy.js) and v4.6.2 PR4
 * (workspace-seats.js), on the same gate and the same kind of seam.
 *
 * Split line: this file decides WHICH single banner a run shows and what it says.
 * workspace-app.js keeps `state`, the IPC calls and the render orchestration;
 * workspace-render.js keeps renderBanner(), the DOM write itself.
 *
 * ⚠️ ONE banner, first match wins — every branch returns. That is not incidental: the
 * element is a single node (workspace-render.js sets `textContent`), so a second call would
 * overwrite the first. The ORDER is therefore the ranking, most-alarming first, and each
 * branch below states why it sits where it does. Cross-calls resolve `window.Amicus*` at
 * CALL time, never at this file's load time — the house discipline for every renderer script.
 */
(function () {
  'use strict';

  function render() {
    var A = window.AmicusApp;
    var d = A.state.detail;
    var R = window.AmicusRender;
    var el = A.$('banner');
    if (!d.derived.schemaSupported) {
      R.renderBanner(el, 'This run was written by a different amicus version (schemaVersion ' +
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
    // ⚠️ Fix-wave 3 (council-3 A1): TWO DIFFERENT FACTS, two sentences. The orphan case is
    // not a sanitize collision and must not borrow its wording — `a#1` and `a-1` do NOT
    // sanitize to the same name; an orphaned leg wrote a file under its own alias whose stem
    // happens to BE another seat's artifact name. PR5a added the `orphan` flag
    // (artifact-names.js) and shipped no consumer, so every orphan collision rendered a
    // sentence that was simply untrue about the run.
    // ⚠️ And EVERY entry is rendered, not `[0]`. One stem can legitimately produce two
    // entries — MEASURED on a legacy bench: ['vendor/a','vendor?a'] with a 'vendor?a' orphan
    // emits a sanitize entry AND an orphan entry for stem 'vendor-a'. Different causes, same
    // consequence, so both are stated rather than merged: a merge has to drop one cause.
    if (d.derived.artifactCollisions && d.derived.artifactCollisions.length) {
      var clauses = d.derived.artifactCollisions.map(function (c) {
        // `models` on an orphan entry is [owning entity, orphan alias] — both CLAIMANTS of
        // the stem (artifact-names.js states why the orphan half is not projected into
        // entity space). On a sanitize entry it is the two raw bench values.
        return c.orphan
          ? 'the artifact name "' + c.sanitized + '" is claimed by both ' + c.models.join(' and ') +
            ' — an orphaned leg wrote a file under its own alias and run.json cannot say which owns it'
          : 'bench entries ' + c.models.join(' and ') + ' both sanitize to "' + c.sanitized + '"';
      });
      R.renderBanner(el, 'Run integrity error: ' + clauses.join('; ') +
        '. This run directory cannot distinguish those artifacts, so prose below may be misattributed.', '');
      return;
    }
    // ⚠️ Fix-wave 3 (council-3 C2): seats[] was present but malformed, so the whole run fell
    // back to alias space — two seats running one model are indistinguishable in every panel
    // below. Fail-safe, but SILENT until now, which the product principle rejects as hard as
    // a crash. Ranked AFTER the collision banner (that one says prose may be misattributed,
    // strictly worse) and BEFORE run.error, since it qualifies how to read every panel.
    if (d.derived.seatTableRejected) {
      R.renderBanner(el, 'This run\'s seat table could not be read (a malformed entry), so ' +
        'artifacts are shown by model alias instead of per seat — two seats running the same ' +
        'model cannot be told apart below. Artifacts: ' + d.runDir, 'warn');
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
      R.renderBanner(el, d.derived.verdictPanel.reason || 'Run reported an error',
        d.run.status === 'error' ? '' : 'warn');
      return;
    }
    R.renderBanner(el, null);
  }

  window.AmicusBanners = { render: render };
})();

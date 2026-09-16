/**
 * @module electron/setup-ui-alias-review-load
 * Setup UI - the "Needs review" section's fetch lifecycle (issue 238 D9)
 * A page-script sub-fragment concatenated AFTER setup-ui-alias-review.js's
 * fragment: when the section's ONE document (`sidecar:get-alias-review`) is
 * fetched, which response may render, and what the refresh control does.
 *
 * Fetched on FIRST entry to the Routing step, never at page load — the
 * Workspace's Settings child window must not network on open (main.js) —
 * and chained AFTER the memoized catalog load (setup-ui.js ::
 * ensureCatalogLoaded) because the handler reads the catalog at the default
 * age too (a stale cache refreshes inline in main) and model-catalog.js has
 * no in-flight dedupe: the memo dedupes get-catalog callers, the chain
 * serializes the two different reads.
 *
 * Every request carries a generation number and only the LATEST response
 * renders or settles the loaded latch. An entry fetch and a ↻ refresh can
 * overlap after a failed first fetch (the banner shows ↻ while re-entering
 * the step retries), and without the guard the older document could land
 * after the refreshed one and overwrite it — stale banner, disabled buttons
 * (council round 2 of PR 253, B1/A1). The ↻ control is also disabled while
 * an entry fetch is in flight, so the two never refresh the catalog
 * concurrently.
 */

'use strict';

/**
 * @returns {string} JavaScript source (no <script> tags) declaring
 *   `loadAliasReview`, `settleAliasReview` and `ensureAliasReviewLoaded`,
 *   plus the ↻ click handler
 */
function buildAliasReviewLoadScript() {
  return `
  var aliasReviewGen = 0;          // the latest request; an older response landing later is dropped (never rendered, never settles the latch)
  var aliasReviewLoaded = false;   // set synchronously when an entry fetch starts (no second in-flight fetch), then FOLLOWS the latest outcome
  var aliasReviewRefresh = $('alias-review-refresh');

  // Resolves true when a usable document rendered, false on a rejection or an
  // error document, null when a newer request superseded this one.
  function loadAliasReview() {
    var gen = ++aliasReviewGen;
    return window.sidecarSetup.invoke('sidecar:get-alias-review')
      .then(function(view) { if (gen !== aliasReviewGen) { return null; } renderAliasReview(view); return !(view && view.error); })
      .catch(function(err) {
        if (gen !== aliasReviewGen) { return null; }
        renderAliasReview({ proposals: [], catalogAvailable: false, fetchedAt: null, fresh: false, freshUntil: null, gatedIds: [], error: String((err && err.message) || err || 'unknown error') });
        return false;
      });
  }

  // The latch follows the LATEST request only: a superseded one (null) says nothing.
  function settleAliasReview(ok) {
    if (ok !== null) { aliasReviewLoaded = !!ok; }
  }

  if (aliasReviewRefresh) {
    aliasReviewRefresh.addEventListener('click', async function() {
      aliasReviewRefresh.disabled = true;
      try {
        try {
          var info = await window.sidecarSetup.invoke('sidecar:refresh-catalog');
          applyCatalog(info);                     // Step 2's meta line and Step 3's picker see the refresh too
        } catch (_e) { /* the re-fetch below reports whatever the cache now holds */ }
        settleAliasReview(await loadAliasReview());
      } finally { aliasReviewRefresh.disabled = false; }   // re-enable even if the re-fetch above somehow throws
    });
  }

  // Council review of PR 253, C3/D2: "fetched on first entry" must not mean
  // "fetched once, ever" -- the latch is set synchronously (a second entry while
  // in flight must not race a second fetch) and then follows the outcome, so a
  // failed fetch (rejection or an error document) is retried on the next
  // Routing-step entry; the banner points at the refresh button, and
  // re-entering the step is the other way back.
  function ensureAliasReviewLoaded() {
    if (aliasReviewLoaded) { return Promise.resolve(); }
    aliasReviewLoaded = true;
    if (aliasReviewRefresh) { aliasReviewRefresh.disabled = true; }
    return Promise.resolve(typeof ensureCatalogLoaded === 'function' ? ensureCatalogLoaded() : null)
      .then(loadAliasReview)
      .then(function(ok) { settleAliasReview(ok); if (aliasReviewRefresh) { aliasReviewRefresh.disabled = false; } });
  }`;
}

module.exports = { buildAliasReviewLoadScript };

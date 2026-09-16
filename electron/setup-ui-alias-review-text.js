/**
 * @module electron/setup-ui-alias-review-text
 * Setup UI - the words and the freshness rule of the "Needs review" section (issue 238 D9)
 * A page-script SUB-FRAGMENT: the pure helpers of the wizard's "Needs review"
 * section, concatenated into `buildAliasReviewScript`'s output
 * (setup-ui-alias-review.js) so they can be read and tested apart from the
 * section's DOM layer. Nothing here touches the document: `viewIsFresh` is
 * the §5 write gate evaluated at ACTION time, `reviewBanner` says why the
 * section cannot be acted on, `candidateText` / `proposalWhy` are the CLI
 * picker's words (src/sidecar/aliases-review-render.js :: menuFor).
 *
 * Freshness (council review of PR 253, A4): the IPC document's `fresh` is
 * the verdict at FETCH time; its `freshUntil` (electron/ipc-aliases.js) says
 * how long that holds, so a wizard left open past the 24 h gate re-checks
 * before it stages a catalog-vouched id instead of trusting a frozen flag.
 * Split out of setup-ui-alias-review.js at the 300-line ceiling.
 */

'use strict';

/**
 * @returns {string} JavaScript source (no <script> tags); declares
 *   viewIsFresh, reviewBanner, candidateText, proposalWhy at two-space indent
 */
function buildAliasReviewTextScript() {
  return `
  // The section 5 write gate at ACTION time: the document's fresh flag was the
  // verdict when it was fetched; freshUntil says how long that holds. A wizard
  // left open past the gate must not stage a catalog-vouched id on a stale
  // flag (council review of PR 253, A4). Follow never needs the catalog.
  function viewIsFresh(view, now) {
    return !!view && !!view.fresh && typeof view.freshUntil === 'number' && now <= view.freshUntil;
  }

  // Why the section cannot be acted on, or null when it can. Mirrors the CLI's
  // staleCatalogBanner (aliases-review-gate.js): error and unavailability
  // first, then the write gate's age.
  function reviewBanner(view, now) {
    if (view.error) { return 'could not check for updates \\u2014 ' + view.error; }
    if (!view.catalogAvailable) { return 'catalog unavailable \\u2014 cannot check for updates (\\u21bb to retry)'; }
    if (viewIsFresh(view, now)) { return null; }
    var tail = ' \\u2014 accepting is disabled until \\u21bb succeeds (following the shipped pin is always allowed)';
    if (typeof view.fetchedAt !== 'number') { return 'no catalog timestamp' + tail; }
    if (view.fetchedAt > now) { return 'catalog timestamp is in the future (clock skew?)' + tail; }
    var ms = now - view.fetchedAt;
    var days = Math.floor(ms / 86400000);
    var hours = Math.max(1, Math.floor(ms / 3600000));
    var age = days >= 1 ? days + ' day' + (days === 1 ? '' : 's') : hours + ' hour' + (hours === 1 ? '' : 's');
    // fresh when fetched, aged past the gate in an open window: nothing has
    // tried to refresh it yet, so say what to do, not that a refresh failed.
    if (view.fresh) { return 'catalog is ' + age + ' old \\u2014 \\u21bb to refresh; accepting is disabled until it succeeds (following the shipped pin is always allowed)'; }
    return 'catalog is ' + age + ' old and could not be refreshed' + tail;
  }

  // The CLI menu's words for one candidate (aliases-review-render.js :: menuFor).
  function candidateText(p, c) {
    if (c.why === 'follow') { return 'follow the shipped pin (' + c.id + ')'; }
    if (c.why === 'notable') { return 'add ' + p.alias + ' \\u2192 ' + c.id; }
    if (c.why === 'replacement') { return 'use ' + c.id; }
    return 'accept ' + c.id;
  }

  // One line on the top candidate (the CLI's "proposed" line).
  function proposalWhy(p) {
    var top = p.candidates && p.candidates[0];
    if (!top) { return (p.reasons || []).join(', '); }
    if (top.why === 'newer-sibling') { return 'newer: ' + top.id + ' \\u00b7 newer sibling, same tier'; }
    if (top.why === 'follow') { return 'differs from the shipped pin ' + top.id; }
    if (top.why === 'replacement') { return 'gone from the catalog \\u00b7 replacement: ' + top.id; }
    return (top.evidence && top.evidence.note) || 'notable model';
  }
`;
}

module.exports = { buildAliasReviewTextScript };

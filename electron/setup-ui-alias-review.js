/**
 * @module electron/setup-ui-alias-review
 * Setup UI - Alias Review section (issue 238 D9)
 * The wizard's "Needs review" section: the review engine's
 * proposals rendered ABOVE the Model Routing list, so a proposal is never
 * buried in a collapsed vendor group. `buildAliasReviewHTML` is the
 * server-rendered skeleton (no data in it); `buildAliasReviewScript` is the
 * page script that fetches ONE document over IPC (`sidecar:get-alias-review`,
 * electron/ipc-aliases.js — the same `collectAliasView` the CLI list and
 * picker use) and renders it with createElement/textContent only, never
 * innerHTML: alias names, ids, notes and error text are data.
 *
 * Controls per proposal are the CLI picker's menu items (src/sidecar/
 * aliases-review-render.js :: menuFor): one button per candidate — "accept
 * <id>" (newer sibling), "follow the shipped pin (<id>)", "use <id>"
 * (replacement), "add <alias> → <id>" (notable) — then "choose…" (a <select>
 * over the §5-gated catalog ids the IPC supplies, plus the candidates, the
 * current id and the shipped id) and "dismiss" (never ask again for that
 * alias@id pair). No "skip": a proposal left alone is skipped. Every action
 * is STAGED (`aliasEdits` / `stagedDismissals`, setup-ui-alias-state.js) and
 * written by Finish through sidecar:save-config, the wizard's one sink, so
 * closing the window writes nothing.
 *
 * The §5 WRITE gate rides the document's `fresh` flag: when the catalog is
 * older than 24 h and the inline refresh failed, every candidate but "follow"
 * and the "choose…" control are disabled and the banner says why — "follow"
 * removes a key and needs no catalog. An unavailable catalog or a handler error
 * renders the section with the banner alone — never a silent "nothing to
 * review". A proposal for an alias the user already edited this session is not
 * rendered: the engine reads DISK, the page's staged edit wins.
 */

'use strict';

/**
 * @returns {string} the section's HTML skeleton, inserted by
 *   setup-ui-aliases.js between the "How it works" box and the editor
 */
function buildAliasReviewHTML() {
  return `<section class="alias-review" id="alias-review" hidden>
        <div class="alias-review-head">
          <span class="alias-review-title">Needs review</span>
          <span class="alias-review-count" id="alias-review-count"></span>
          <button type="button" class="alias-review-refresh" id="alias-review-refresh" title="Refresh the model catalog and check again">&#x21bb;</button>
        </div>
        <div class="alias-review-banner" id="alias-review-banner" hidden></div>
        <div class="alias-review-list" id="alias-review-list"></div>
      </section>`;
}

/**
 * @returns {string} JavaScript source (no <script> tags)
 */
function buildAliasReviewScript() {
  return `
  var aliasReviewView = null;                     // the last sidecar:get-alias-review document
  var aliasReviewRows = Object.create(null);      // alias -> the proposal row on screen

  // Why the section cannot be acted on, or null when it can. Mirrors the CLI's
  // staleCatalogBanner (aliases-review-gate.js): error and unavailability
  // first, then the write gate's age.
  function reviewBanner(view, now) {
    if (view.error) { return 'could not check for updates \\u2014 ' + view.error; }
    if (!view.catalogAvailable) { return 'catalog unavailable \\u2014 cannot check for updates (\\u21bb to retry)'; }
    if (view.fresh) { return null; }
    var tail = ' \\u2014 accepting is disabled until \\u21bb succeeds (following the shipped pin is always allowed)';
    if (typeof view.fetchedAt !== 'number') { return 'no catalog timestamp' + tail; }
    if (view.fetchedAt > now) { return 'catalog timestamp is in the future (clock skew?)' + tail; }
    var ms = now - view.fetchedAt;
    var days = Math.floor(ms / 86400000);
    var hours = Math.max(1, Math.floor(ms / 3600000));
    var age = days >= 1 ? days + ' day' + (days === 1 ? '' : 's') : hours + ' hour' + (hours === 1 ? '' : 's');
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

  // A free name for a notable's suggested alias: the CLI's numeric-suffix
  // rule (aliases-review.js :: freeSuffix) over the rows on screen plus the
  // names staged this session.
  function freeAliasName(base) {
    var taken = Object.create(null);
    document.querySelectorAll('.alias-row').forEach(function(r) { var a = r.getAttribute('data-alias'); if (a) { taken[a] = true; } });
    Object.keys(aliasEdits).forEach(function(a) { if (aliasEdits[a] !== null) { taken[a] = true; } });
    if (!taken[base]) { return base; }
    var n = 2;
    while (taken[base + '-' + n]) { n += 1; }
    return base + '-' + n;
  }

  // A committed list row for an alias added by "add" (notable) -- in the
  // client-side "New routes" group, like the add-custom flow's rows.
  function appendStagedRow(name, id) {
    var row = document.createElement('div');
    row.className = 'alias-row';
    row.setAttribute('data-alias', name);
    row.setAttribute('data-state', 'pinned');
    var ns = document.createElement('span'); ns.className = 'alias-name'; ns.textContent = name;
    var arrow = document.createElement('span'); arrow.className = 'alias-arrow'; arrow.textContent = '\\u2192';
    var ms = document.createElement('span'); ms.className = 'alias-model'; ms.textContent = id;
    var st = document.createElement('span'); st.className = 'alias-state alias-state-pinned'; st.textContent = 'pinned';
    var del = document.createElement('button');
    del.type = 'button'; del.className = 'alias-delete'; del.textContent = '\\u00d7';
    del.setAttribute('data-alias', name); del.setAttribute('data-kind', 'delete'); del.title = 'Delete this alias';
    row.appendChild(ns); row.appendChild(arrow); row.appendChild(ms); row.appendChild(st); row.appendChild(del);
    placeRowInNewRoutesGroup(row);
  }

  function removeProposalRow(alias) {
    var row = aliasReviewRows[alias];
    if (row) { row.remove(); delete aliasReviewRows[alias]; }
    var left = Object.keys(aliasReviewRows).length;
    var count = $('alias-review-count');
    if (count) { count.textContent = '(' + left + ')'; }
    var section = $('alias-review');
    var banner = $('alias-review-banner');
    if (section && left === 0 && (!banner || banner.hidden)) { section.hidden = true; }
  }

  // Accept \`id\` for proposal \`p\`: an unmapped (notable) proposal ADDS a pinned
  // alias under a free name; anything else stages the write for the alias
  // (the shipped id folds to follow -- stageAliasWrite).
  function acceptProposal(p, id) {
    if (p.state === 'unmapped') {
      var name = freeAliasName(p.alias);
      aliasEdits[name] = id;
      appendStagedRow(name, id);
    } else {
      stageAliasWrite(p.alias, id);
    }
    removeProposalRow(p.alias);
  }

  function dismissProposal(p) {
    if (p.dismissKey && stagedDismissals.indexOf(p.dismissKey) === -1) { stagedDismissals.push(p.dismissKey); }
    removeProposalRow(p.alias);
  }

  // "choose…": buildModelSelect (the Step 3 picker) filtered by the alias
  // keyword, pruned to the §5-gated ids (the same set the CLI checks a typed
  // id against), keeping the candidates, the current id and -- for a curated
  // alias -- the shipped id (Q4's follow, allowed even when the catalog lacks
  // it). The candidates lead in their own group. Picking the current id cancels.
  function chooseForProposal(p, chooseBtn) {
    var select = buildModelSelect(p.current || '', 'alias-review-select', p.alias);
    var keep = Object.create(null);
    (p.candidates || []).forEach(function(c) { keep[c.id] = true; });
    if (p.current) { keep[p.current] = true; }
    if (p.curated && p.shipped) { keep[p.shipped] = true; }
    var gated = Object.create(null);
    ((aliasReviewView && aliasReviewView.gatedIds) || []).forEach(function(id) { gated[id] = true; });
    select.querySelectorAll('option').forEach(function(opt) { if (!keep[opt.value] && !gated[opt.value]) { opt.remove(); } });
    select.querySelectorAll('optgroup').forEach(function(g) { if (g.querySelectorAll('option').length === 0) { g.remove(); } });
    var proposed = document.createElement('optgroup');
    proposed.label = 'Proposed';
    (p.candidates || []).forEach(function(c) {
      var opt = document.createElement('option');
      opt.value = c.id; opt.textContent = candidateText(p, c);
      proposed.appendChild(opt);
    });
    if (proposed.children.length > 0) {
      select.insertBefore(proposed, select.firstChild);
      var proposedIds = Object.create(null);
      (p.candidates || []).forEach(function(c) { proposedIds[c.id] = true; });
      // the candidates already lead in Proposed -- drop the now-duplicate copy elsewhere.
      select.querySelectorAll('option').forEach(function(opt) { if (opt.parentNode !== proposed && proposedIds[opt.value]) { opt.remove(); } });
      select.querySelectorAll('optgroup').forEach(function(g) { if (g.querySelectorAll('option').length === 0) { g.remove(); } });
    }
    select.value = p.current || '';
    chooseBtn.replaceWith(select);
    select.focus();
    select.addEventListener('change', function() {
      var id = select.value;
      if (!id || id === p.current) { select.replaceWith(chooseBtn); return; }
      acceptProposal(p, id);
    });
    select.addEventListener('blur', function() { if (select.parentNode) { select.replaceWith(chooseBtn); } });
  }

  function renderProposalRow(p, view) {
    var row = document.createElement('div');
    row.className = 'alias-review-row';
    row.setAttribute('data-alias', p.alias);
    var line = document.createElement('div');
    line.className = 'alias-review-line';
    var name = document.createElement('span'); name.className = 'alias-name'; name.textContent = p.alias;
    line.appendChild(name);
    if (p.current) {
      var arrow = document.createElement('span'); arrow.className = 'alias-arrow'; arrow.textContent = '\\u2192';
      var cur = document.createElement('span'); cur.className = 'alias-model'; cur.textContent = p.current;
      line.appendChild(arrow); line.appendChild(cur);
    }
    var why = document.createElement('span'); why.className = 'alias-review-why'; why.textContent = proposalWhy(p);
    line.appendChild(why);
    var actions = document.createElement('div');
    actions.className = 'alias-review-actions';
    var stale = !view.fresh;
    var staleTitle = stale ? (reviewBanner(view, Date.now()) || '') : '';
    (p.candidates || []).forEach(function(c) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'alias-review-accept';
      b.setAttribute('data-id', c.id); b.setAttribute('data-why', c.why);
      b.textContent = (c.why === 'follow' ? '\\u21a9 ' : '\\u2713 ') + candidateText(p, c);
      if (stale && c.why !== 'follow') { b.disabled = true; b.title = staleTitle; }
      b.addEventListener('click', function() { acceptProposal(p, c.id); });
      actions.appendChild(b);
    });
    var choose = document.createElement('button');
    choose.type = 'button'; choose.className = 'alias-review-choose'; choose.textContent = '\\u2304 choose\\u2026';
    if (stale) { choose.disabled = true; choose.title = staleTitle; }
    choose.addEventListener('click', function() { chooseForProposal(p, choose); });
    actions.appendChild(choose);
    var dismiss = document.createElement('button');
    dismiss.type = 'button'; dismiss.className = 'alias-review-dismiss'; dismiss.textContent = '\\u00d7 dismiss';
    dismiss.title = 'Never ask again about ' + (p.dismissKey || p.alias);
    dismiss.addEventListener('click', function() { dismissProposal(p); });
    actions.appendChild(dismiss);
    row.appendChild(line); row.appendChild(actions);
    return row;
  }

  // Render one document. Hidden when there is nothing to show AND nothing to say.
  function renderAliasReview(view) {
    aliasReviewView = view;
    aliasReviewRows = Object.create(null);
    var section = $('alias-review'), list = $('alias-review-list'), count = $('alias-review-count'), banner = $('alias-review-banner');
    if (!section || !list) { return; }
    while (list.firstChild) { list.firstChild.remove(); }
    var text = reviewBanner(view, Date.now());
    if (banner) { banner.textContent = text || ''; banner.hidden = !text; }
    var shown = 0;
    (view.proposals || []).forEach(function(p) {
      if (!p || typeof p.alias !== 'string') { return; }
      if (Object.prototype.hasOwnProperty.call(aliasEdits, p.alias)) { return; }   // staged this session: the page wins
      if (p.dismissKey && stagedDismissals.indexOf(p.dismissKey) !== -1) { return; }   // dismissed this session: staged, not on disk yet
      if (p.state === 'unmapped' && (p.candidates || []).some(function(c) { return Object.keys(aliasEdits).some(function(k) { return aliasEdits[k] === c.id; }); })) { return; }   // already added this session under a free name (an undo via × deletes that key, so the proposal returns)
      var row = renderProposalRow(p, view);
      aliasReviewRows[p.alias] = row;
      list.appendChild(row);
      shown += 1;
    });
    if (count) { count.textContent = '(' + shown + ')'; }
    section.hidden = shown === 0 && !text;
  }

  function loadAliasReview() {
    return window.sidecarSetup.invoke('sidecar:get-alias-review')
      .then(renderAliasReview)
      .catch(function(err) {
        renderAliasReview({ proposals: [], catalogAvailable: false, fetchedAt: null, fresh: false, gatedIds: [], error: String((err && err.message) || err || 'unknown error') });
      });
  }

  var aliasReviewRefresh = $('alias-review-refresh');
  if (aliasReviewRefresh) {
    aliasReviewRefresh.addEventListener('click', async function() {
      aliasReviewRefresh.disabled = true;
      try {
        try {
          var info = await window.sidecarSetup.invoke('sidecar:refresh-catalog');
          applyCatalog(info);                     // Step 2's meta line and Step 3's picker see the refresh too
        } catch (_e) { /* the re-fetch below reports whatever the cache now holds */ }
        await loadAliasReview();
      } finally { aliasReviewRefresh.disabled = false; }   // re-enable even if the re-fetch above somehow throws
    });
  }

  // issue 238 D9: fetched on FIRST entry to the Routing step, never at page load --
  // the Workspace's Settings child window must not network on open (main.js).
  // ensureCatalogLoaded (issue 238) memoizes its in-flight request, so this call
  // and showStep(3)'s direct call share ONE fetch instead of racing two. The review
  // fetch is chained AFTER the catalog load because sidecar:get-alias-review reads
  // the catalog at the default age too (a stale cache refreshes inline in main)
  // and model-catalog.js has no in-flight dedupe -- the memo in setup-ui.js dedupes
  // get-catalog callers; the chain serializes the two different reads.
  var aliasReviewLoaded = false;
  function ensureAliasReviewLoaded() {
    if (aliasReviewLoaded) { return Promise.resolve(); }
    aliasReviewLoaded = true;
    return Promise.resolve(typeof ensureCatalogLoaded === 'function' ? ensureCatalogLoaded() : null).then(loadAliasReview);
  }`;
}

module.exports = { buildAliasReviewHTML, buildAliasReviewScript };

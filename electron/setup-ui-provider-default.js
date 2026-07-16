/**
 * Setup UI — Per-provider default model picker (Part 2, Task 8).
 *
 * Rendered inline in the key step (Step 1), beneath the just-saved key, once
 * `sidecar:save-key` (ipc-setup.js) returns a non-null `providerDefault` for a
 * DIRECT provider (google/openai/anthropic/deepseek — never the openrouter
 * gateway; see ipc-setup.js's own isDirectProvider guard, mirroring the skip
 * rule in provider-default-prompt.js's runProviderDefaultFlow).
 *
 * Split into its own file (rather than growing setup-ui-keys.js /
 * setup-ui-keys-script.js) per the existing setup-ui-* convention (see
 * setup-ui-council.js, another Step-content add-on with its own HTML +
 * script pair).
 *
 * Row data (from src/utils/provider-default-picker.js's
 * buildProviderDefaultChoices): { preselectedId, rows: [{id, name,
 * contextLength, pricePerMInput, isPreselected}] }. Row name/pricing come
 * straight from the live model catalog, so the runtime script below builds
 * rows via createElement/textContent (never innerHTML string interpolation)
 * — the same convention Step 2's renderSearchResults uses for catalog rows.
 */
'use strict';

/** Static (initially hidden) container the key step's picker renders into. */
function buildProviderDefaultSectionHTML() {
  return `<div class="provider-default-section" id="provider-default-section" style="display:none">
      <div class="provider-default-label" id="provider-default-label">Default model</div>
      <div class="provider-default-list" id="provider-default-list"></div>
    </div>`;
}

/**
 * Browser-only JS: exposes window.renderProviderDefaultPicker(provider,
 * providerName, providerDefault) and window.hideProviderDefaultPicker(),
 * wired to apply the pick via sidecar:set-provider-default
 * (src/utils/provider-default-picker.js's applyProviderDefault,
 * read-modify-write, no-clobber — see ipc-setup.js). Selecting a row (or
 * leaving the preselection untouched) both apply the same way: the
 * preselected id is applied immediately on render, and a change event
 * re-applies whichever row the user picks instead.
 * @returns {string} JavaScript source (no <script> tags)
 */
function buildProviderDefaultScript() {
  return `
  // Task 8: per-provider default picker, inline in the key step.
  (function() {
    var section = document.getElementById('provider-default-section');
    var label = document.getElementById('provider-default-label');
    var list = document.getElementById('provider-default-list');

    function fmtPrice(p) { return (p === null || p === undefined) ? 'n/a' : '$' + Number(p).toFixed(2) + '/M in'; }
    function fmtCtx(n) { return (n === null || n === undefined) ? '' : ' \\u00b7 ctx ' + n; }

    function applyChoice(provider, chosenId) {
      if (!provider || !chosenId) { return; }
      window.sidecarSetup.invoke('sidecar:set-provider-default', provider, chosenId).catch(function() {});
    }

    function buildRow(provider, row) {
      var rowEl = document.createElement('label');
      rowEl.className = 'provider-default-row';
      var radio = document.createElement('input');
      radio.type = 'radio'; radio.name = 'provider-default-' + provider;
      radio.value = row.id; radio.checked = !!row.isPreselected;
      var text = document.createElement('span');
      text.className = 'provider-default-text';
      text.textContent = row.name + fmtCtx(row.contextLength) + ' \\u00b7 ' + fmtPrice(row.pricePerMInput);
      rowEl.appendChild(radio); rowEl.appendChild(text);
      if (row.isPreselected) {
        var badge = document.createElement('span');
        badge.className = 'pick-badge'; badge.textContent = 'recommended';
        rowEl.appendChild(badge);
      }
      radio.addEventListener('change', function() { if (radio.checked) { applyChoice(provider, row.id); } });
      return rowEl;
    }

    window.hideProviderDefaultPicker = function() {
      if (!section) { return; }
      section.style.display = 'none';
      if (list) { list.innerHTML = ''; }
    };

    window.renderProviderDefaultPicker = function(provider, providerName, providerDefault) {
      if (!section || !list) { return; }
      if (!providerDefault || !Array.isArray(providerDefault.rows) || providerDefault.rows.length === 0) {
        window.hideProviderDefaultPicker(); return;
      }
      if (label) { label.textContent = 'Default model for ' + (providerName || provider); }
      list.innerHTML = '';
      providerDefault.rows.forEach(function(row) { list.appendChild(buildRow(provider, row)); });
      section.style.display = '';
      // No-selection case: the preselected row is already checked above, so
      // applying it immediately covers "advance without touching the list".
      applyChoice(provider, providerDefault.preselectedId);
    };
  })();
  `;
}

module.exports = { buildProviderDefaultSectionHTML, buildProviderDefaultScript };

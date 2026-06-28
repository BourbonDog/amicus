/**
 * Setup UI — Free OpenRouter council picker (mounted on the Models step).
 * Collapsible section: a checkbox list of free models fetched via IPC. Gated
 * on the OpenRouter key (recomputed on Step-2 entry by the orchestrator).
 * window.collectCouncilPicks() returns the checked ids for the save payload.
 */
'use strict';

function buildCouncilSectionHTML() {
  return `<div id="free-council-section" class="council-section">
      <label class="council-toggle"><input type="checkbox" id="free-council-toggle">
        <span>Set up a free OpenRouter council (zero-cost)</span></label>
      <div id="free-council-body" style="display:none">
        <div id="free-council-meta" class="search-meta"></div>
        <div id="free-council-results" class="council-results"></div>
        <div class="council-note">Free tier: rate-limited &amp; quality-variable; some models need
          data-sharing enabled at openrouter.ai/settings/privacy.</div>
      </div>
    </div>`;
}

function buildCouncilScript() {
  return `
  (function() {
    var toggle = document.getElementById('free-council-toggle');
    var body = document.getElementById('free-council-body');
    var results = document.getElementById('free-council-results');
    var meta = document.getElementById('free-council-meta');
    var loaded = false;

    function hasOpenRouterKey() { return !!(window.configuredKeys && window.configuredKeys.openrouter); }

    window.refreshCouncilGating = function() {
      if (!toggle) { return; }
      var ok = hasOpenRouterKey();
      toggle.disabled = !ok;
      if (meta && !ok) { meta.textContent = 'Add an OpenRouter API key (step 1) to enable a free council.'; }
      else if (meta && !loaded) { meta.textContent = ''; }
    };

    async function loadFree() {
      if (loaded) { return; }
      try {
        var rows = await window.sidecarSetup.invoke('sidecar:fetch-free-models');
        loaded = true;
        results.innerHTML = '';
        (rows || []).forEach(function(r, i) {
          var id = 'fc-' + i;
          var row = document.createElement('label');
          row.className = 'council-row';
          var cb = document.createElement('input');
          cb.type = 'checkbox'; cb.value = r.id; cb.id = id; cb.checked = !!r.suggested;
          var span = document.createElement('span'); span.textContent = r.id;
          row.appendChild(cb); row.appendChild(span);
          results.appendChild(row);
        });
        if (meta) { meta.textContent = (rows || []).length + ' free models'; }
      } catch (_e) { if (meta) { meta.textContent = 'Could not load free models.'; } }
    }

    if (toggle) {
      toggle.addEventListener('change', function() {
        body.style.display = toggle.checked ? '' : 'none';
        if (toggle.checked) { loadFree(); }
      });
    }

    window.collectCouncilPicks = function() {
      if (!toggle || !toggle.checked) { return []; }
      return Array.prototype.slice.call(results.querySelectorAll('input[type=checkbox]:checked'))
        .map(function(cb) { return cb.value; });
    };
  })();
  `;
}

module.exports = { buildCouncilSectionHTML, buildCouncilScript };

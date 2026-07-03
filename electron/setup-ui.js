/** Setup UI - Wizard Orchestrator: API Keys → Models → Aliases → Review */
const { buildKeysStepHTML, PROVIDERS } = require('./setup-ui-keys');
const { buildModelStepHTML, PROVIDER_NAMES } = require('./setup-ui-model');
const { buildAliasEditorHTML } = require('./setup-ui-aliases');
const { buildWizardCSS } = require('./setup-ui-styles');
const { buildKeysScript } = require('./setup-ui-keys-script');
const { buildAliasScript } = require('./setup-ui-alias-script');
const { buildCouncilSectionHTML, buildCouncilScript } = require('./setup-ui-council');
const { getDefaultAliases } = require('../src/utils/config');
const { getBrandName } = require('./toolbar');
const { resolveQuickPicks } = require('../src/utils/quick-picks');
const { PROVIDER_FAMILY_NAMES } = require('../src/utils/model-fetcher');

/**
 * @param {object} [options={}]
 * @param {string} [options.client='code-local'] - Client type for branding
 * @param {Array} [options.quickPicks] - Resolved quick-pick rows from resolveQuickPicks(catalog).
 *   Defaults to pinned fallbacks when not provided.
 */
function buildSetupHTML(options = {}) {
  const {
    client = 'code-local',
    quickPicks = resolveQuickPicks([]),          // pinned fallbacks when not provided
  } = options;
  const brandName = getBrandName(client);
  const keysHtml = buildKeysStepHTML(PROVIDERS);
  const modelHtml = buildModelStepHTML(quickPicks);
  const aliasHtml = buildAliasEditorHTML(getDefaultAliases());
  const css = buildWizardCSS();
  const providersJson = JSON.stringify(PROVIDERS);
  const modelChoicesJson = JSON.stringify(quickPicks);
  const providerNamesJson = JSON.stringify(PROVIDER_NAMES);
  const defaultAliasesJson = JSON.stringify(getDefaultAliases());
  const familyNamesJson = JSON.stringify(PROVIDER_FAMILY_NAMES);
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Amicus Setup</title>
<style>${css}</style></head><body>
  <div class="header"><svg width="18" height="18" viewBox="0 0 32 32" fill="none"><path d="M4 8H19"/><path d="M4 11H14L19 8"/><path d="M4 14H13L19 8"/><path d="M4 17H12L19 8"/><path d="M4 20H11L19 8"/><path d="M4 23H10L19 8"/><path class="brand-main" d="M19 8H28"/></svg><span class="header-title">${brandName} Setup</span></div>
  <div class="progress-bar"><div class="progress-step active" id="step-1"><span class="progress-dot">1</span><span>API Keys</span></div><div class="progress-connector"></div><div class="progress-step" id="step-2"><span class="progress-dot">2</span><span>Models</span></div><div class="progress-connector"></div><div class="progress-step" id="step-3"><span class="progress-dot">3</span><span>Routing</span></div><div class="progress-connector"></div><div class="progress-step" id="step-4"><span class="progress-dot">4</span><span>Review</span></div></div>
  <div class="content">
    <div class="wizard-step visible" id="wizard-step-1"><div id="import-notice"></div>${keysHtml}</div>
    <div class="wizard-step" id="wizard-step-2">${modelHtml}${buildCouncilSectionHTML()}</div>
    <div class="wizard-step" id="wizard-step-3">${aliasHtml}</div>
    <div class="wizard-step" id="wizard-step-4">
      <div class="step-content">
        <h1>Setup Complete</h1>
        <p class="subtitle">Review your configuration before saving.</p>
        <div class="review-section"><div class="review-label">API Keys</div><div class="review-value" id="review-keys">None configured</div></div>
        <div class="review-section"><div class="review-label">Default Model</div><div class="review-value" id="review-model">Not selected</div></div>
        <div class="review-section"><div class="review-label">Routing</div><div class="review-value" id="review-routing">&mdash;</div></div>
        <div class="review-section"><div class="review-label">Aliases</div><div class="review-value" id="review-aliases">&mdash;</div></div>
      </div>
    </div>
  </div>
  <div class="footer"><div class="footer-brand"><svg width="15" height="15" viewBox="0 0 32 32" fill="none"><path d="M4 8H19"/><path d="M4 11H14L19 8"/><path d="M4 14H13L19 8"/><path d="M4 17H12L19 8"/><path d="M4 20H11L19 8"/><path d="M4 23H10L19 8"/><path class="brand-main" d="M19 8H28"/></svg> ${brandName}</div><div class="footer-nav"><button class="nav-btn" id="back-btn" style="display:none">Back</button><button class="nav-btn primary" id="next-btn" disabled>Next</button><button class="nav-btn primary" id="finish-btn" style="display:none">Finish</button></div></div>
${buildWizardScript(providersJson, modelChoicesJson, providerNamesJson, defaultAliasesJson, familyNamesJson)}
</body></html>`;
}

function buildWizardScript(providersJson, modelChoicesJson, providerNamesJson, defaultAliasesJson, familyNamesJson) {
  const keysJs = buildKeysScript();
  const aliasJs = buildAliasScript();
  const councilJs = buildCouncilScript();
  return `<script>
  window.onerror = function(msg, src, line, col, err) { console.error('WIZARD ERROR:', msg, 'at', src, line, col, err); };
  window.onunhandledrejection = function(e) { console.error('WIZARD UNHANDLED REJECTION:', e.reason); };

  var providers = ${providersJson};
  var currentStep = 1, configuredKeys = {}, keyHints = {};
  var selectedProvider = null;
  var modelChoicesData = ${modelChoicesJson};
  var providerNamesData = ${providerNamesJson};
  var defaultAliases = ${defaultAliasesJson};
  var PROVIDER_FAMILY_NAMES = ${familyNamesJson};
  var routingChoices = {};
  var aliasEdits = {};
  var aliasDisplay = {};
  window.availableModels = null;
  var keyValid = false, validatedKey = '';
  var $ = function(id) { return document.getElementById(id); };
  var keyInput = $('api-key-input'), testBtn = $('test-btn'), eyeBtn = $('eye-btn');
  var removeBtn = $('remove-btn'), nextBtn = $('next-btn'), backBtn = $('back-btn');
  var finishBtn = $('finish-btn'), statusMsg = $('status-msg');
  var keySection = $('key-section'), keyLabel = $('key-label'), helpLink = $('help-link');

  // Init: load existing keys
  (async function() {
    try {
      var data = await window.sidecarSetup.invoke('sidecar:get-api-keys');
      if (data && data.status) {
        Object.keys(data.status).forEach(function(p) {
          if (data.status[p]) {
            configuredKeys[p] = true;
            var c = document.getElementById('check-' + p);
            if (c) { c.textContent = '\\u2713'; }
          }
        });
        if (data.hints) { keyHints = data.hints; }
        window.configuredKeys = configuredKeys;
        window.refreshCouncilGating && window.refreshCouncilGating();
        updateNextState();
        if (data.imported && data.imported.length > 0) {
          var notice = document.getElementById('import-notice');
          if (notice) {
            var noticeDiv = document.createElement('div');
            noticeDiv.className = 'import-notice';
            noticeDiv.textContent = 'Imported ' + data.imported.length + ' key(s) from OpenCode: ' + data.imported.join(', ');
            var dismissBtn = document.createElement('span');
            dismissBtn.className = 'dismiss';
            dismissBtn.textContent = String.fromCharCode(0xD7);
            dismissBtn.addEventListener('click', function() { notice.removeChild(noticeDiv); });
            noticeDiv.appendChild(dismissBtn);
            notice.appendChild(noticeDiv);
          }
        }
      }
    } catch (_e) {}
  })();

  // Init: load existing config for model pre-selection and alias edits
  (async function() {
    try {
      var cfg = await window.sidecarSetup.invoke('sidecar:get-config');
      if (cfg && cfg.default) {
        document.querySelectorAll('input[name="default-model"]').forEach(function(r) {
          r.checked = (r.value === cfg.default);
        });
      }
      if (cfg && cfg.default && cfg.default.indexOf('/') !== -1) {
        // F5: a search-picked full model id matches no radio — restore it so
        // reopening setup and clicking Finish never silently reverts the default.
        window.customDefaultModel = cfg.default;
      }
      if (cfg && cfg.aliases) {
        modelChoicesData.forEach(function(mc) {
          var currentModel = cfg.aliases[mc.alias];
          if (currentModel) {
            var provs = Object.keys(mc.routes);
            for (var i = 0; i < provs.length; i++) {
              if (mc.routes[provs[i]] === currentModel) { routingChoices[mc.alias] = provs[i]; break; }
            }
          }
        });
        Object.keys(cfg.aliases).forEach(function(k) {
          if (cfg.aliases[k] !== defaultAliases[k]) { aliasDisplay[k] = cfg.aliases[k]; }
        });
        applyAliasEditsToUI();
      }
    } catch (_e) {}
  })();

  function applyAliasEditsToUI() {
    Object.keys(aliasDisplay).forEach(function(k) {
      var row = document.querySelector('.alias-row[data-alias="' + k + '"]');
      if (!row) { return; }
      var modelSpan = row.querySelector('.alias-model');
      if (modelSpan) { modelSpan.textContent = aliasDisplay[k]; }
    });
    Object.keys(aliasEdits).forEach(function(k) {
      var row = document.querySelector('.alias-row[data-alias="' + k + '"]');
      if (!row) { return; }
      if (aliasEdits[k] === null) { row.classList.add('alias-deleted'); return; }
      var modelSpan = row.querySelector('.alias-model');
      if (modelSpan) { modelSpan.textContent = aliasEdits[k]; }
    });
  }

  function showStep(step) {
    currentStep = step;
    [1, 2, 3, 4].forEach(function(s) {
      document.getElementById('wizard-step-' + s).classList.toggle('visible', s === step);
      var prog = document.getElementById('step-' + s);
      prog.classList.remove('active', 'done');
      if (s < step) { prog.classList.add('done'); }
      if (s === step) { prog.classList.add('active'); }
    });
    backBtn.style.display = step > 1 ? '' : 'none';
    nextBtn.style.display = step < 4 ? '' : 'none';
    finishBtn.style.display = step === 4 ? '' : 'none';
    if (step === 4) { buildReview(); }
    if (step === 2) { updateRoutingPills(); ensureCatalogLoaded(); window.refreshCouncilGating && window.refreshCouncilGating(); }
    if (step === 3) {
      updateAliasRoutes();
      // B33 / #12: Step 3 shares Step 2's TTL-cached catalog load (single
      // in-page cache: ensureCatalogLoaded no-ops if Step 2 already loaded
      // it) instead of a separate live sidecar:fetch-models round-trip.
      ensureCatalogLoaded();
    }
    updateNextState();
  }

  function updateNextState() {
    if (currentStep === 1) {
      nextBtn.disabled = !Object.values(configuredKeys).some(function(v) { return v; });
    } else { nextBtn.disabled = false; }
  }

  // Single source of the route choice for a quick-pick row: explicit pill
  // choice if its key still exists, else first provider with a key, else
  // the row's first route. Returns the full model id or null.
  function pickRouteFor(mc) {
    if (!mc) { return null; }
    var provs = Object.keys(mc.routes);
    var prov = routingChoices[mc.alias];
    if (!prov || !mc.routes[prov]) {
      prov = null;
      for (var i = 0; i < provs.length; i++) {
        if (configuredKeys[provs[i]]) { prov = provs[i]; break; }
      }
      if (!prov) { prov = provs[0]; }
    }
    return mc.routes[prov] || null;
  }

  function updateRoutingPills() {
    var hasAnyKey = Object.values(configuredKeys).some(function(v) { return v; });
    var firstAvailableAlias = null;
    modelChoicesData.forEach(function(mc) {
      var provs = Object.keys(mc.routes);
      var available = provs.filter(function(p) { return configuredKeys[p]; });
      var card = document.querySelector('.model-card input[value="' + mc.alias + '"]');
      var cardLabel = card ? card.closest('.model-card') : null;
      var isAvailable = !hasAnyKey || available.length > 0;

      // Enable/disable the model card
      if (card) {
        card.disabled = !isAvailable;
        if (cardLabel) {
          cardLabel.classList.toggle('model-unavailable', !isAvailable);
        }
      }
      if (isAvailable && !firstAvailableAlias) { firstAvailableAlias = mc.alias; }

      // Update "no key" hint visibility
      var noKeyHint = cardLabel ? cardLabel.querySelector('.no-key-hint') : null;
      if (!isAvailable && !noKeyHint && cardLabel) {
        var hint = document.createElement('span');
        hint.className = 'no-key-hint';
        hint.textContent = 'No API key configured';
        cardLabel.appendChild(hint);
      } else if (isAvailable && noKeyHint) {
        noKeyHint.remove();
      }

      // Auto-switch routing if selected provider's key was removed
      var currentRoute = routingChoices[mc.alias];
      if (currentRoute && !configuredKeys[currentRoute] && available.length > 0) {
        routingChoices[mc.alias] = available[0];
      }

      // Update route toggle/static/pills
      if (provs.length < 2) { return; }
      var bestProvider = available.length > 0 ? available[0] : provs[0];
      var toggle = document.querySelector('.route-toggle[data-alias="' + mc.alias + '"]');
      var staticEl = document.querySelector('.route-static[data-alias="' + mc.alias + '"]');
      if (!toggle) { return; }
      if (available.length >= 2) {
        toggle.style.display = 'flex';
        if (staticEl) { staticEl.style.display = 'none'; }
      } else {
        toggle.style.display = 'none';
        if (staticEl) {
          staticEl.style.display = '';
          staticEl.textContent = 'via ' + (providerNamesData[bestProvider] || bestProvider);
        }
      }
      var selected = routingChoices[mc.alias] || bestProvider;
      toggle.querySelectorAll('.route-pill').forEach(function(pill) {
        pill.classList.toggle('active', pill.getAttribute('data-provider') === selected);
      });
    });

    // Auto-select first available model if current selection is disabled
    var checkedRadio = document.querySelector('input[name="default-model"]:checked');
    if (checkedRadio && checkedRadio.disabled && firstAvailableAlias) {
      var newRadio = document.querySelector('input[name="default-model"][value="' + firstAvailableAlias + '"]');
      if (newRadio) { newRadio.checked = true; }
    }
    if (!checkedRadio && firstAvailableAlias) {
      var fallback = document.querySelector('input[name="default-model"][value="' + firstAvailableAlias + '"]');
      if (fallback) { fallback.checked = true; }
    }
    updateWritePreviews();
  }

  function updateAliasRoutes() {
    var hasAnyKey = Object.values(configuredKeys).some(function(v) { return v; });
    if (!hasAnyKey) { return; }
    // Build lookup: alias → best model string, only using providers with keys
    var routedModels = {};
    modelChoicesData.forEach(function(mc) {
      var prov = routingChoices[mc.alias];
      // Only use cached routing choice if that provider's key still exists
      if (prov && mc.routes[prov] && configuredKeys[prov]) {
        routedModels[mc.alias] = mc.routes[prov];
      } else {
        // Pick first provider with a configured key
        var provs = Object.keys(mc.routes);
        for (var i = 0; i < provs.length; i++) {
          if (configuredKeys[provs[i]]) {
            routedModels[mc.alias] = mc.routes[provs[i]];
            routingChoices[mc.alias] = provs[i]; // Update cached choice
            break;
          }
        }
      }
    });
    // Update the example box
    var exampleModel = document.querySelector('.example-model');
    if (exampleModel && routedModels.gemini) {
      exampleModel.textContent = routedModels.gemini;
    }
    document.querySelectorAll('.alias-row').forEach(function(row) {
      var alias = row.getAttribute('data-alias');
      if (!alias || row.classList.contains('alias-deleted')) { return; }
      if (row.querySelector('.alias-model-select')) { return; }
      var modelSpan = row.querySelector('.alias-model');
      if (!modelSpan) { return; }
      // Check if the model's provider has a configured key
      var model = aliasEdits[alias] || aliasDisplay[alias] || modelSpan.textContent;
      var prefix = model.split('/')[0];
      var noKey = false;
      if (prefix === 'openrouter') {
        noKey = !configuredKeys.openrouter;
      } else if (configuredKeys.hasOwnProperty(prefix)) {
        noKey = !configuredKeys[prefix];
      }
      row.classList.toggle('alias-no-key', noKey);
    });
  }

  function buildReview() {
    var kn = Object.keys(configuredKeys).filter(function(k) { return configuredKeys[k]; });
    document.getElementById('review-keys').textContent =
      kn.length > 0 ? kn.map(function(k) { return k + ' \\u2713'; }).join(', ') : 'None';
    var r = document.querySelector('input[name="default-model"]:checked');
    document.getElementById('review-model').textContent = window.customDefaultModel || (r ? r.value : 'Not selected');
    var writes = [];
    var r2 = document.querySelector('input[name="default-model"]:checked');
    if (!window.customDefaultModel && r2) {
      var mc2 = null;
      for (var i2 = 0; i2 < modelChoicesData.length; i2++) {
        if (modelChoicesData[i2].alias === r2.value) { mc2 = modelChoicesData[i2]; break; }
      }
      if (mc2) {
        var routeId2 = pickRouteFor(mc2);
        if (routeId2) { writes.push(mc2.alias + ' \\u2192 ' + routeId2); }
      }
    }
    document.getElementById('review-routing').textContent =
      writes.length > 0 ? writes.join(', ') : 'No alias changes';
    var editCount = Object.keys(aliasEdits).length;
    var reviewAliases = document.getElementById('review-aliases');
    if (reviewAliases) {
      reviewAliases.textContent = editCount > 0 ? editCount + ' alias(es) modified' : 'No changes';
    }
  }

  nextBtn.addEventListener('click', function() { if (currentStep < 4) { showStep(currentStep + 1); } });
  backBtn.addEventListener('click', function() { if (currentStep > 1) { showStep(currentStep - 1); } });

  // Route pill click handler
  document.addEventListener('click', function(e) {
    var pill = e.target.closest('.route-pill');
    if (!pill) { return; }
    var alias = pill.getAttribute('data-alias');
    var provider = pill.getAttribute('data-provider');
    if (!alias || !provider) { return; }
    routingChoices[alias] = provider;
    var toggle = pill.parentElement;
    toggle.querySelectorAll('.route-pill').forEach(function(p) { p.classList.toggle('active', p === pill); });
    updateWritePreviews();
  });

  finishBtn.addEventListener('click', async function() {
    finishBtn.disabled = true; finishBtn.textContent = 'Saving...';
    try {
      var r = document.querySelector('input[name="default-model"]:checked');
      var dm = window.customDefaultModel || (r ? r.value : null);
      var aliasWrites = {};
      Object.keys(aliasEdits).forEach(function(k) {
        aliasWrites[k] = aliasEdits[k];
      });
      if (!window.customDefaultModel && r) {
        // Selecting a quick pick = explicit touch: upgrade that ONE alias
        // to the resolved id via the chosen route (user-locked decision #2).
        var mc = null;
        for (var i = 0; i < modelChoicesData.length; i++) {
          if (modelChoicesData[i].alias === r.value) { mc = modelChoicesData[i]; break; }
        }
        if (mc) {
          var routeId = pickRouteFor(mc);
          if (routeId) { aliasWrites[mc.alias] = routeId; }
        }
      }
      await window.sidecarSetup.invoke('sidecar:save-config', dm, aliasWrites, (window.collectCouncilPicks && window.collectCouncilPicks()) || []);
      var kc = Object.values(configuredKeys).filter(function(v) { return v; }).length;
      await window.sidecarSetup.invoke('sidecar:setup-done', dm, kc);
    } catch (_e) { finishBtn.disabled = false; finishBtn.textContent = 'Finish'; }
  });

  // ===== F5: searchable catalog picker (Step 2) + B33/#12: shared with Step 3 =====
  var catalogRows = null, catalogFetchedAt = null;
  // #13: last-refresh outcome, so a stale cache (refresh keeps failing) is
  // shown honestly instead of looking current.
  var catalogLastRefreshAttempt = null, catalogLastRefreshError = null;
  window.customDefaultModel = null;

  async function ensureCatalogLoaded() {
    if (catalogRows) { return; }
    try {
      var info = await window.sidecarSetup.invoke('sidecar:get-catalog');
      applyCatalog(info);
    } catch (_e) {}
  }

  // Re-derive Step 3's grouped {family, models} shape from the flat catalog
  // rows client-side (mirrors src/utils/model-fetcher.js groupModelsByFamily
  // keying: family name from the id prefix, falling back to the prefix
  // itself for any provider not in PROVIDER_FAMILY_NAMES).
  function groupCatalogByFamily(rows) {
    if (!rows || rows.length === 0) { return []; }
    var order = [], byFamily = {};
    rows.forEach(function(m) {
      var prefix = m.id.split('/')[0];
      var family = PROVIDER_FAMILY_NAMES[prefix] || prefix;
      if (!byFamily[family]) { byFamily[family] = []; order.push(family); }
      byFamily[family].push(m);
    });
    return order.map(function(family) { return { family: family, models: byFamily[family] }; });
  }

  function applyCatalog(info) {
    catalogRows = (info && info.models) || [];
    catalogFetchedAt = info && info.fetchedAt;
    catalogLastRefreshAttempt = info && info.lastRefreshAttempt;
    catalogLastRefreshError = info && info.lastRefreshError;
    // Single shared in-page cache: Step 3's alias dropdown (buildModelSelect)
    // reads window.availableModels, re-derived from the same catalog load
    // Step 2 uses — no second get-catalog round-trip, and the refresh
    // button (Step 2) re-applying here keeps Step 3's dropdown data current.
    window.availableModels = groupCatalogByFamily(catalogRows);
    renderSearchMeta();
    renderSearchResults();
    if (catalogRows.length === 0) {
      var meta = $('model-search-meta');
      if (meta) { meta.textContent = 'Catalog unavailable (offline?) \\u2014 use \\u21bb to retry.'; }
    }
  }

  function renderSearchMeta() {
    var meta = $('model-search-meta');
    if (!meta) { return; }
    var when = catalogFetchedAt ? new Date(catalogFetchedAt).toLocaleString() : 'never';
    var text = catalogRows.length + ' models \\u00b7 catalog fetched ' + when;
    // #13: one-line stale hint when the last refresh attempt failed AFTER
    // the data currently shown was fetched (don't redesign Step 2 for this).
    if (catalogLastRefreshError && catalogLastRefreshAttempt &&
        (!catalogFetchedAt || catalogLastRefreshAttempt > catalogFetchedAt)) {
      text += ' \\u2014 \\u26a0 refresh failed, showing last-known data';
    }
    meta.textContent = text;
  }

  function fmtCtx(n) { return n == null ? '' : ' \\u00b7 ctx ' + n; }
  function fmtPrice(p) {
    if (!p || p.prompt == null) { return ''; }
    var x = Number(p.prompt) * 1e6;
    return isNaN(x) ? '' : ' \\u00b7 $' + x.toFixed(2) + '/M in';
  }

  function renderSearchResults() {
    var box = $('model-search-results');
    if (!box) { return; }
    var q = ($('model-search-input').value || '').toLowerCase();
    var rows = !q ? [] : catalogRows.filter(function(m) {
      return m.id.toLowerCase().indexOf(q) !== -1 || (m.name || '').toLowerCase().indexOf(q) !== -1;
    }).slice(0, 50);
    box.innerHTML = '';
    rows.forEach(function(m) {
      var div = document.createElement('div');
      div.className = 'search-row' + (window.customDefaultModel === m.id ? ' selected' : '');
      div.setAttribute('data-model-id', m.id);
      var title = document.createElement('div');
      title.className = 'search-row-id';
      title.textContent = m.id;
      var sub = document.createElement('div');
      sub.className = 'search-row-sub';
      sub.textContent = (m.name || '') + fmtCtx(m.contextLength) + fmtPrice(m.pricing);
      div.appendChild(title); div.appendChild(sub);
      div.addEventListener('click', function() { selectCustomModel(m.id); });
      box.appendChild(div);
    });
    if (q && rows.length === 0) {
      box.textContent = 'No models match "' + q + '"';
    }
  }

  function selectCustomModel(id) {
    window.customDefaultModel = id;
    document.querySelectorAll('input[name="default-model"]').forEach(function(r) { r.checked = false; });
    var box = $('model-search-results');
    var keep = box ? box.scrollTop : 0;
    renderSearchResults();
    if (box) { box.scrollTop = keep; }
    updateWritePreviews();
  }

  function updateWritePreviews() {
    var r = document.querySelector('input[name="default-model"]:checked');
    var sel = (!window.customDefaultModel && r) ? r.value : null;
    document.querySelectorAll('.write-preview').forEach(function(el) {
      var alias = el.getAttribute('data-alias');
      el.classList.toggle('write-preview-active', alias === sel);
      if (alias !== sel) { return; }
      var mc = null;
      for (var i = 0; i < modelChoicesData.length; i++) {
        if (modelChoicesData[i].alias === alias) { mc = modelChoicesData[i]; break; }
      }
      if (!mc) { return; }
      var routeId = pickRouteFor(mc);
      var idEl = el.querySelector('.write-preview-id');
      if (idEl && routeId) { idEl.textContent = routeId; }
    });
  }

  document.addEventListener('input', function(e) {
    if (e.target && e.target.id === 'model-search-input') { renderSearchResults(); }
  });
  document.addEventListener('change', function(e) {
    if (e.target && e.target.name === 'default-model' && e.target.checked) {
      window.customDefaultModel = null;
      renderSearchResults();
      updateWritePreviews();
    }
  });
  document.addEventListener('click', async function(e) {
    if (e.target && e.target.id === 'model-search-refresh') {
      e.target.disabled = true;
      try {
        var info = await window.sidecarSetup.invoke('sidecar:refresh-catalog');
        applyCatalog(info);
      } catch (_e2) {}
      e.target.disabled = false;
    }
  });

  ${aliasJs}

  ${keysJs}

  ${councilJs}
</script>`;
}

module.exports = { buildSetupHTML, PROVIDERS };

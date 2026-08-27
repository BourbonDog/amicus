/** Setup UI - Wizard Orchestrator: API Keys → Models → Aliases → Review */
const { buildKeysStepHTML, PROVIDERS } = require('./setup-ui-keys');
const { buildModelStepHTML, PROVIDER_NAMES } = require('./setup-ui-model');
const { buildAliasEditorHTML } = require('./setup-ui-aliases');
const { buildWizardCSS } = require('./setup-ui-styles');
const { buildKeysScript } = require('./setup-ui-keys-script');
const { buildAliasScript } = require('./setup-ui-alias-script');
const { buildCouncilSectionHTML, buildCouncilScript } = require('./setup-ui-council');
const { buildProviderDefaultSectionHTML, buildProviderDefaultScript } = require('./setup-ui-provider-default');
const { buildLocalSectionHTML } = require('./setup-ui-local');
const { buildLocalScript } = require('./setup-ui-local-script');
const { getDefaultAliases } = require('../src/utils/config');
const { getBrandName } = require('./toolbar');
const { resolveQuickPicks } = require('../src/utils/quick-picks');
const { PROVIDER_FAMILY_NAMES } = require('../src/utils/model-fetcher');

/**
 * @param {object} [options={}]
 * @param {string} [options.client='code-local'] - Client type for branding
 * @param {Array} [options.quickPicks] - Resolved quick-pick rows from resolveQuickPicks(catalog).
 *   Defaults to pinned fallbacks when not provided.
 * @param {Object<string,object>} [options.shortlists] - issue 138: per-alias vendor
 *   shortlist from buildModelShortlist(), passed through to buildModelStepHTML
 *   for the model-level <select>. Defaults to {} (no drill-down rendered).
 */
function buildSetupHTML(options = {}) {
  const {
    client = 'code-local',
    quickPicks = resolveQuickPicks([]),          // pinned fallbacks when not provided
    shortlists = {},
  } = options;
  const brandName = getBrandName(client);
  const keysHtml = buildKeysStepHTML(PROVIDERS);
  const modelHtml = buildModelStepHTML(quickPicks, undefined, undefined, shortlists);
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
    <div class="wizard-step visible" id="wizard-step-1"><div id="import-notice"></div>${keysHtml}${buildProviderDefaultSectionHTML()}${buildLocalSectionHTML()}</div>
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
  const providerDefaultJs = buildProviderDefaultScript();
  const localJs = buildLocalScript();
  return `<script>
  window.onerror = function(msg, src, line, col, err) { console.error('WIZARD ERROR:', msg, 'at', src, line, col, err); };
  window.onunhandledrejection = function(e) { console.error('WIZARD UNHANDLED REJECTION:', e.reason); };

  var providers = ${providersJson};
  var currentStep = 1, configuredKeys = {}, keyHints = {};
  var selectedProvider = null;
  var modelChoicesData = ${modelChoicesJson};
  var providerNamesData = ${providerNamesJson};
  var defaultAliases = Object.assign(Object.create(null), ${defaultAliasesJson});
  var PROVIDER_FAMILY_NAMES = ${familyNamesJson};
  var routingChoices = {};
  var explicitRouteChoices = {};
  // issue 138: alias -> a SPECIFIC model id the user drilled down to. Empty
  // means "use the family flagship", i.e. today's behavior.
  var modelChoiceIds = {};
  var modelOpenrouterIds = {};
  // T3 (PR 199): every table keyed by USER-controlled alias names is seeded
  // null-prototype, same as defaultAliases above -- an alias literally named
  // __proto__ on a plain {} hits the Object.prototype setter (silent no-op
  // write) and reads back Object.prototype, which then throws on .split('/')
  // in updateAliasesForConfiguredKeys.
  var aliasEdits = Object.create(null);
  var aliasDisplay = Object.create(null);
  // N1: the alias map as loaded from disk (init below), so buildReview can
  // tell an actual change from a value-identical re-write. Stays empty until
  // init resolves (a fresh/offline config has nothing saved yet, so every
  // computed write IS new).
  var savedAliases = Object.create(null);
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
        // N-a (council review, PR 196): a defensive copy, not the live cfg.aliases
        // reference. Nothing in this file currently mutates cfg.aliases after
        // this point (checked: every '.aliases[' site below is a read), so
        // buildReview's N1 diff is not measured to be wrong today -- but the
        // copy is one line and removes a fragile "never mutate this" invariant
        // future edits would otherwise have to remember.
        // T3: null-prototype target -- Object.assign onto a plain {} would
        // route a literal __proto__ alias key through the prototype setter
        // instead of landing it as an own key.
        savedAliases = Object.assign(Object.create(null), cfg.aliases); // N1: buildReview diffs against this
        modelChoicesData.forEach(function(mc) {
          var currentModel = cfg.aliases[mc.alias];
          if (currentModel) {
            var provs = Object.keys(mc.routes);
            for (var i = 0; i < provs.length; i++) {
              if (mc.routes[provs[i]] === currentModel) { routingChoices[mc.alias] = provs[i]; break; }
            }
            // F3: the shortlist <select> is server-rendered with its OWN
            // recommendedId-derived "selected" option and never consults
            // modelChoiceIds at init -- so a saved drill-down pick silently
            // reverted to the family flagship on every reopen (Step 3's
            // alias table showed the saved value while Step 2 showed a
            // different one). Mirror the customDefaultModel restore just
            // above: when the saved alias value names one of THIS card's
            // shortlist rows, seed modelChoiceIds (the .model-pick change
            // handler's own state) and push the same value into the DOM
            // <select> so a no-op reopen-and-Finish round-trips cleanly.
            var sel = document.querySelector('.model-pick[data-alias="' + mc.alias + '"]');
            if (sel) {
              var matchedByValue = false;
              for (var j = 0; j < sel.options.length; j++) {
                if (sel.options[j].value === currentModel) {
                  sel.value = currentModel;
                  modelChoiceIds[mc.alias] = currentModel;
                  modelOpenrouterIds[mc.alias] = sel.options[j].getAttribute('data-or') || null;
                  matchedByValue = true;
                  break;
                }
              }
              // F3-OR (council review, issue 138): an explicit-OpenRouter
              // drilled pick is saved as "openrouter/<vendor>/<model>"
              // (pickRouteFor's explicit-OR branch below) -- that form
              // matches no option's bare 'value', only its 'data-or'. Every
              // option carries 'data-or' (CONTROLLER RULING R1, issue 138 --
              // see buildModelPickHTML's docstring in setup-ui-model.js), so
              // search for THAT match when the bare-value search above
              // found nothing.
              // Restoring modelChoiceIds alone here would round-trip the
              // dropdown selection but make Finish write the BARE id back --
              // silently converting the user's explicit "via OpenRouter"
              // choice into direct-first policy routing on the very next
              // save, which is worse than the visible flagship-revert this
              // block exists to fix. So restore the WHOLE state pickRouteFor
              // needs to reproduce the OR form: the option's bare value (for
              // the <select> and modelChoiceIds), its data-or
              // (modelOpenrouterIds), and the two flags pickRouteFor's
              // explicit-OR branch checks -- routingChoices[alias] ===
              // 'openrouter' and explicitRouteChoices[alias] -- which are
              // exactly the flags the route-pill click handler sets, so the
              // rendered pill agrees with the restored state too.
              if (!matchedByValue) {
                for (var k = 0; k < sel.options.length; k++) {
                  if (sel.options[k].getAttribute('data-or') === currentModel) {
                    sel.value = sel.options[k].value;
                    modelChoiceIds[mc.alias] = sel.options[k].value;
                    modelOpenrouterIds[mc.alias] = currentModel;
                    routingChoices[mc.alias] = 'openrouter';
                    explicitRouteChoices[mc.alias] = true;
                    break;
                  }
                }
              }
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
    // issue 138: an explicit per-model choice overrides the family flagship.
    var picked = modelChoiceIds[mc.alias];
    if (picked) {
      // A drilled-down pick is returned VERBATIM -- never canonicalised (unlike
      // the auto-pick below): picked/modelOpenrouterIds come straight from the
      // shortlist's own id/data-or, which the picker already built through
      // directFormIfSafe. For a DIVERGENT_VENDOR (e.g. anthropic) that id can
      // already BE its only-callable openrouter/<vendor>/... form, so touching
      // the prefix here would fabricate a direct id nothing serves.
      if (routingChoices[mc.alias] === 'openrouter' && explicitRouteChoices[mc.alias]) {
        return modelOpenrouterIds[mc.alias] || picked;
      }
      return picked;
    }
    var provs = Object.keys(mc.routes);
    var prov = routingChoices[mc.alias];
    if (!prov || !mc.routes[prov]) {
      prov = null;
      for (var i = 0; i < provs.length; i++) {
        if (configuredKeys[provs[i]]) { prov = provs[i]; break; }
      }
      if (!prov) { prov = provs[0]; }
    }
    var route = mc.routes[prov] || null;
    // issue 214: the SAFE storable form is decided server-side (quick-picks.js
    // canonicalRoutesFor) and shipped with the pick. The page must not re-derive
    // it: its old hand-copy of toCanonicalDefault dropped both of that
    // primitive's guards. An explicit "via OpenRouter" pill stays unchanged.
    if (route && !explicitRouteChoices[mc.alias]) {
      route = (mc.canonicalRoutes && mc.canonicalRoutes[prov]) || route;
    }
    return route;
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
    // F4: mirror the EXACT call Finish makes (collectAliasWrites), not just
    // the checked radio, so Step 4 can never under-report what Finish is
    // about to write. Before this fix, buildReview re-derived "writes" from
    // the checked radio alone -- a drilled-down pick on a card that was NOT
    // the checked default (or any drilled pick at all, under a custom
    // default) was invisible here and fell through to the literal 'No
    // alias changes', even though Finish wrote it. sidecar:save-config has
    // no confirmation step, so this review IS the only gate.
    var aliasWritesPreview = collectAliasWrites(r ? r.value : null, !!window.customDefaultModel);
    // N1: aliasWritesPreview is EVERY alias Finish would write, including
    // ones whose value is already what's on disk -- after the F1 fix that
    // is the NORMAL case on a plain reopen (init below seeds modelChoiceIds
    // from cfg.aliases, so the drilled-down alias, the recommendedId, and
    // the saved value are now the same string by construction). Finish
    // still writes the full map (a value-identical write is harmless), but
    // this review must only SHOW entries that actually differ from
    // savedAliases -- otherwise a no-op reopen reports "N alias(es)
    // modified" on the one screen that has no confirmation step after it.
    // N-b (council review, PR 196): an alias that was NEVER in savedAliases
    // reads as undefined there, while a delete-write (Step 3's delete
    // button, for one of the five default aliases -- see aliasEdits[alias]
    // = null in setup-ui-alias-script.js) is null. null !== undefined is
    // true, so without this normalization a default alias that was never
    // explicitly saved (a config written by an older/partial flow that
    // skipped default-seeding -- addAlias() in src/sidecar/setup.js is one
    // such path) would show "alias -> (deleted)" for deleting something
    // that was never there. saveConfig() already drops falsy alias values
    // (src/utils/config.js), so that write is a true no-op on disk; the
    // review must agree. Reading savedAliases[alias] as null (not
    // undefined) when the key is absent makes "delete of an absent alias"
    // compare equal to "still absent" without changing any other case --
    // every other savedAliases value here is a non-empty string.
    // T3: keyed by user alias names -- null-prototype (see aliasEdits above)
    var changedWrites = Object.create(null);
    Object.keys(aliasWritesPreview).forEach(function(alias) {
      var oldVal = Object.prototype.hasOwnProperty.call(savedAliases, alias) ? savedAliases[alias] : null;
      if (aliasWritesPreview[alias] !== oldVal) {
        changedWrites[alias] = aliasWritesPreview[alias];
      }
    });
    var writes = Object.keys(changedWrites).map(function(alias) {
      var val = changedWrites[alias];
      return alias + ' \\u2192 ' + (val === null ? '(deleted)' : val);
    });
    document.getElementById('review-routing').textContent =
      writes.length > 0 ? writes.join(', ') : 'No alias changes';
    var editCount = Object.keys(changedWrites).length;
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
    explicitRouteChoices[alias] = true;
    var toggle = pill.parentElement;
    toggle.querySelectorAll('.route-pill').forEach(function(p) { p.classList.toggle('active', p === pill); });
    updateWritePreviews();
  });

  // issue 138: model-level drill-down <select> change handler.
  document.addEventListener('change', function(e) {
    var sel = e.target && e.target.closest ? e.target.closest('.model-pick') : null;
    if (!sel) { return; }
    var alias = sel.getAttribute('data-alias');
    if (!alias) { return; }
    modelChoiceIds[alias] = sel.value;
    var opt = sel.options[sel.selectedIndex];
    modelOpenrouterIds[alias] = (opt && opt.getAttribute('data-or')) || null;
    updateWritePreviews();
  });

  // issue 138 (fix round 1, Finding 1; precedence description corrected in
  // the F2/F6 fix wave; modelChoiceIds provenance corrected in the N2 fix
  // wave): assemble aliasWrites for Finish -- the aliasEdits (Step 3)
  // overlay first; THEN, only for a checked quick-pick default (not a
  // custom/searched one -- isCustomDefault skips this stage entirely), the
  // selected alias's resolved route; then every OTHER alias whose
  // drill-down <select> fired change -- "every OTHER" means every alias
  // but the selected one ONLY when that earlier stage ran, so under a
  // custom default the selected alias (if it has a drilled pick) is
  // handled by THIS stage instead, not skipped. Before the Task-3 dropdown
  // existed there was nothing to lose by writing only the selected alias;
  // now a drilled-down pick on a card that is NOT the checked default
  // would silently vanish without this. Precedence is NOT uniform across
  // the two groups, unlike an earlier version of this comment claimed:
  // only the selected alias clobbers its aliasEdits entry (the ONE place
  // that's permitted -- user-locked decision #2); every OTHER drilled-down
  // alias defers to aliasEdits and is written only when Step 3 left it
  // untouched (see the hasOwnProperty guard below and ruling R6a, which
  // already described the real behaviour correctly).
  //
  // modelChoiceIds is populated from TWO places, not one, unlike an
  // earlier version of this comment claimed: the change handler above
  // (a live drill-down pick), AND the init restore block (F3) -- which
  // seeds it from cfg.aliases for every card whose SAVED value already
  // names one of its shortlist rows, reading the id back out of that
  // card's own server-rendered <option> elements. After the F1 fix that is
  // the NORMAL case, not an edge case: a card the user never touched in
  // THIS session routinely lands in modelChoiceIds anyway, because its
  // saved value already matches its recommendedId. That is still correct
  // to iterate here -- collectAliasWrites' job is to compute what Finish
  // SHOULD write, and a value-identical write is harmless -- but it does
  // mean this function can no longer be read as "only ever fires for
  // aliases the user actually changed this session". buildReview is the
  // layer responsible for not SHOWING those value-identical entries as
  // changes (see its own N1 comment).
  function collectAliasWrites(selectedAlias, isCustomDefault) {
    // T3: keyed by user alias names -- null-prototype (see aliasEdits above)
    var aliasWrites = Object.create(null);
    Object.keys(aliasEdits).forEach(function(k) {
      aliasWrites[k] = aliasEdits[k];
    });
    function writeAliasRoute(alias) {
      var mc = null;
      for (var i = 0; i < modelChoicesData.length; i++) {
        if (modelChoicesData[i].alias === alias) { mc = modelChoicesData[i]; break; }
      }
      if (!mc) { return; }
      var routeId = pickRouteFor(mc);
      if (routeId) { aliasWrites[mc.alias] = routeId; }
    }
    if (!isCustomDefault && selectedAlias) {
      // Selecting a quick pick = explicit touch: upgrade that ONE alias
      // to the resolved id via the chosen route (user-locked decision #2).
      // This is the ONE place clobbering aliasEdits is permitted.
      writeAliasRoute(selectedAlias);
    }
    // issue 138 (fix round 2, ruling R6a): every OTHER drilled-down alias is
    // written ONLY when Step 3 left it untouched. hasOwnProperty.call, not
    // the in operator and not a truthiness/not-undefined check:
    // aliasEdits[alias] === null is a MEANINGFUL value here (ipc-setup.js:
    // string = set, null = delete), so a falsy/undefined check would
    // silently resurrect an alias the user explicitly deleted in Step 3,
    // and the in operator or a not-undefined check can be fooled by an
    // inherited Object.prototype property name (this codebase has been
    // bitten by that class of bug before -- see the proto:null guard in
    // src/sidecar/setup.js resolveChoice).
    Object.keys(modelChoiceIds).forEach(function(alias) {
      if (!isCustomDefault && alias === selectedAlias) { return; } // handled above, but only in that branch
      if (Object.prototype.hasOwnProperty.call(aliasEdits, alias)) { return; }
      writeAliasRoute(alias);
    });
    return aliasWrites;
  }

  finishBtn.addEventListener('click', async function() {
    finishBtn.disabled = true; finishBtn.textContent = 'Saving...';
    try {
      var r = document.querySelector('input[name="default-model"]:checked');
      var dm = window.customDefaultModel || (r ? r.value : null);
      var aliasWrites = collectAliasWrites(r ? r.value : null, !!window.customDefaultModel);
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
    // issue 138: keep the resolved-id line in step with the route/model choice.
    document.querySelectorAll('.model-resolved').forEach(function(el) {
      var alias = el.getAttribute('data-alias');
      var mc = null;
      for (var i = 0; i < modelChoicesData.length; i++) {
        if (modelChoicesData[i].alias === alias) { mc = modelChoicesData[i]; break; }
      }
      if (!mc) { return; }
      var id = pickRouteFor(mc);
      if (id) { el.textContent = id; }
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

  ${providerDefaultJs}

  ${localJs}
</script>`;
}

module.exports = { buildSetupHTML, PROVIDERS };

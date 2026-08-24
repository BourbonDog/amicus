/**
 * Setup UI - Step 2: Default Model Selection
 *
 * Builds the HTML for the model selection step of the wizard.
 * Renders radio card choices with provider routing, write-preview,
 * and offline-badge support.
 *
 * Choices are RESOLVED rows passed in at call time (see src/utils/quick-picks.js):
 *   { alias, label, blurb, source: 'live'|'fallback', routes: Object<string,string> }
 * No curated-models import — this module is pure builder/renderer.
 */

'use strict';

const PROVIDER_NAMES = {
  openrouter: 'OpenRouter',
  google: 'Google AI',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  deepseek: 'DeepSeek'
};

/**
 * Check if a model has at least one route with a configured key.
 * When no keys are configured at all (empty configuredKeys), all models are available
 * to allow the initial render before Step 1 completes.
 * @param {string[]} providers - Route provider IDs for this model
 * @param {Object<string,boolean>} configuredKeys - Which providers have keys
 * @returns {boolean}
 */
function isModelAvailable(providers, configuredKeys) {
  const hasAnyKey = Object.values(configuredKeys).some(v => v);
  if (!hasAnyKey) { return true; }
  return providers.some(p => configuredKeys[p]);
}

/**
 * Find the best available provider for a model's route display.
 * Prefers the first provider with a configured key; falls back to first provider.
 * @param {string[]} providers - Route provider IDs
 * @param {Object<string,boolean>} configuredKeys - Which providers have keys
 * @returns {string} Provider ID to display
 */
function bestAvailableProvider(providers, configuredKeys) {
  const withKey = providers.find(p => configuredKeys[p]);
  return withKey || providers[0];
}

/**
 * Search-over-catalog section. Always visible — no display:none gating.
 * Rows are rendered client-side from the get-catalog IPC response.
 * @returns {string} HTML fragment
 */
function buildModelSearchHTML() {
  return `<div id="model-search-section">
      <div class="search-label">&hellip;or pick any model from the catalog</div>
      <div class="search-head">
        <input type="text" id="model-search-input" placeholder="Search all models (id or name)..." autocomplete="off">
        <button class="icon-btn" id="model-search-refresh" title="Refresh catalog">&#x21bb;</button>
      </div>
      <div id="model-search-meta" class="search-meta"></div>
      <div id="model-search-results" class="search-results"></div>
    </div>`;
}

/**
 * issue 138: the family -> model second level for one card. Renders EVERY model
 * in one <select> (scrollable and type-ahead searchable, so nothing is
 * hidden), grouped "Suggested" / "All N models". Returns '' when no
 * shortlist was supplied (or its `total` is 0).
 *
 * That '' is NOT dropped by the caller — buildModelStepHTML always splices
 * it into the card template as its own line, so a card with no shortlist
 * gains one whitespace-only line versus the pre-issue-138 HTML string. It is NOT
 * byte-for-byte identical to that old output. It IS behaviorally identical:
 * no <select> is emitted, and whitespace-only text nodes are inert once
 * parsed as HTML, so the rendered card is unchanged.
 *
 * CONTROLLER RULING R1 (issue 138, 2026-08-24): every <option> carries
 * data-or="<openrouterId>" (empty string when the row has no OpenRouter
 * form), so a later task can read the user's chosen route without
 * re-deriving a gateway prefix from the value id.
 * @param {string} alias
 * @param {{recommendedId:string, suggested:Array<object>, rest:Array<object>, total:number}} [shortlist]
 * @returns {string} HTML fragment
 */
function buildModelPickHTML(alias, shortlist) {
  if (!shortlist || !shortlist.total) { return ''; }
  const opt = (r) => {
    const price = r.pricePerMInput === null ? '' : ` · $${r.pricePerMInput.toFixed(2)}/M`;
    const sel = r.isRecommended ? ' selected' : '';
    return `<option value="${r.id}" data-or="${r.openrouterId || ''}"${sel}>${r.id}${price}</option>`;
  };
  let html = `<select class="model-pick" data-alias="${alias}">`;
  html += `<optgroup label="Suggested">${shortlist.suggested.map(opt).join('')}</optgroup>`;
  if (shortlist.rest.length > 0) {
    html += `<optgroup label="All ${shortlist.total} models">${shortlist.rest.map(opt).join('')}</optgroup>`;
  }
  return html + '</select>';
}

/**
 * Build the HTML fragment for Step 2 (Model Selection).
 * @param {Array<{alias:string, label:string, blurb:string, source:string, routes:Object<string,string>}>} choices
 *   Resolved rows from resolveQuickPicks(). Each row has separate label + blurb fields.
 * @param {string} [selectedAlias] - Pre-selected alias; defaults to first available choice.
 * @param {Object<string,boolean>} [configuredKeys] - Provider IDs the user has keys for.
 * @param {Object<string,object>} [shortlists] - issue 138: per-alias vendor shortlist
 *   from buildModelShortlist(), used to render the model-level <select>.
 *   Defaults to {}; omitting it (or passing {}) is behaviorally identical to
 *   today's card (no <select> for that alias) but not byte-for-byte identical
 *   to the pre-issue-138 HTML string — see buildModelPickHTML's docstring.
 * @returns {string} HTML fragment
 */
function buildModelStepHTML(choices, selectedAlias, configuredKeys = {}, shortlists = {}) {
  // Determine availability for each model
  const availability = choices.map(c => {
    const providers = Object.keys(c.routes);
    return { alias: c.alias, available: isModelAvailable(providers, configuredKeys) };
  });

  // Select: prefer selectedAlias if available, else first available model
  const availableAliases = availability.filter(a => a.available).map(a => a.alias);
  let selected;
  if (selectedAlias && availableAliases.includes(selectedAlias)) {
    selected = selectedAlias;
  } else if (availableAliases.length > 0) {
    selected = availableAliases[0];
  } else {
    selected = choices[0].alias;
  }

  const cards = choices.map(c => {
    const providers = Object.keys(c.routes);
    const available = providers.filter(p => configuredKeys[p]);
    const modelAvailable = availability.find(a => a.alias === c.alias).available;
    const checked = (c.alias === selected && modelAvailable) ? 'checked' : '';
    const disabled = modelAvailable ? '' : ' disabled';
    const cardClass = modelAvailable ? 'model-card' : 'model-card model-unavailable';
    const hasMultipleRoutes = providers.length >= 2;
    const showToggle = available.length >= 2;
    const bestProvider = bestAvailableProvider(providers, configuredKeys);

    // Resolved id for the write-preview (prefer bestProvider route)
    const previewId = c.routes[bestProvider] || Object.values(c.routes)[0] || '';

    // Offline badge for fallback rows
    const badge = c.source === 'fallback'
      ? '<span class="pick-badge">offline list</span>' : '';

    let routeHtml = '';
    if (!modelAvailable) {
      routeHtml = '<span class="no-key-hint">No API key configured</span>';
    } else if (hasMultipleRoutes) {
      const pills = providers.map(p => {
        const isActive = p === bestProvider;
        const cls = isActive ? 'route-pill active' : 'route-pill';
        return `<button class="${cls}" data-alias="${c.alias}" data-provider="${p}">${PROVIDER_NAMES[p]}</button>`;
      }).join('');
      const toggleDisplay = showToggle ? '' : ' style="display:none"';
      const staticDisplay = showToggle ? ' style="display:none"' : '';
      routeHtml = `<span class="route-toggle" data-alias="${c.alias}"${toggleDisplay}>${pills}</span>`;
      routeHtml += `<span class="route-static" data-alias="${c.alias}"${staticDisplay}>via ${PROVIDER_NAMES[bestProvider]}</span>`;
    } else {
      routeHtml = `<span class="route-static">via ${PROVIDER_NAMES[bestProvider]}</span>`;
    }

    const modelPickHtml = buildModelPickHTML(c.alias, shortlists[c.alias]);

    return `<label class="${cardClass}">
        <input type="radio" name="default-model" value="${c.alias}" ${checked}${disabled}>
        <span class="model-alias">${c.alias}</span>
        <span class="model-label">${c.label} — ${c.blurb}</span>${badge}
        <span class="model-resolved">${previewId}</span>
        ${routeHtml}
        ${modelPickHtml}
        <span class="write-preview" data-alias="${c.alias}">will set <code>${c.alias}</code> → <code class="write-preview-id">${previewId}</code></span>
      </label>`;
  }).join('\n      ');

  return `<div class="step-content">
    <h1>Choose Default Model</h1>
    <p class="subtitle">Current models resolved from the live catalog. Pick the default used when no --model flag is given.</p>

    <div class="model-list" id="model-list">
      ${cards}
    </div>
    ${buildModelSearchHTML()}
  </div>`;
}

module.exports = { buildModelSearchHTML, buildModelStepHTML, buildModelPickHTML, PROVIDER_NAMES };

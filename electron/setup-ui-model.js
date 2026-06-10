/**
 * Setup UI - Step 2: Default Model Selection
 *
 * Builds the HTML for the model selection step of the wizard.
 * Renders radio card choices with provider routing and pre-selection support.
 * Models are disabled when no configured API key matches their routes.
 */

const { getCuratedModels } = require('../src/utils/curated-models');
/**
 * Wizard quick-pick cards \u2014 derived from curated-models (F5).
 * @type {Array<{alias: string, label: string, routes: Object<string,string>}>}
 */
const MODEL_CHOICES = getCuratedModels().map(c => ({
  alias: c.alias, label: `${c.label} \u2014 ${c.blurb}`, routes: c.routes
}));

const PROVIDER_NAMES = {
  openrouter: 'OpenRouter',
  google: 'Google AI',
  openai: 'OpenAI',
  anthropic: 'Anthropic'
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
 * Find the best available provider for a model's static route text.
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
 * Build the HTML fragment for Step 2 (Model Selection)
 * @param {Array<{alias: string, label: string, routes: Object<string,string>}>} choices
 * @param {string} [selectedAlias] - Pre-selected alias, defaults to first available choice
 * @param {Object<string,boolean>} [configuredKeys] - Provider IDs the user has keys for
 * @returns {string} HTML fragment
 */
function buildModelStepHTML(choices, selectedAlias, configuredKeys = {}) {
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

    let routeHtml = '';
    if (!modelAvailable) {
      routeHtml = '<span class="no-key-hint">No API key configured</span>';
    } else if (hasMultipleRoutes) {
      const pills = providers.map(p => {
        const isActive = (showToggle && p === bestProvider) || (!showToggle && p === bestProvider);
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
    return `<label class="${cardClass}">
        <input type="radio" name="default-model" value="${c.alias}" ${checked}${disabled}>
        <span class="model-alias">${c.alias}</span>
        <span class="model-label">${c.label}</span>
        ${routeHtml}
      </label>`;
  }).join('\n      ');

  return `<div class="step-content">
    <h1>Choose Default Model</h1>
    <p class="subtitle">Pick the model to use when no --model flag is given.</p>

    <div class="model-list" id="model-list">
      ${cards}
    </div>
  </div>`;
}

module.exports = { buildModelStepHTML, MODEL_CHOICES, PROVIDER_NAMES };

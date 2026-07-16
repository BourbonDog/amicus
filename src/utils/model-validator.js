/**
 * Model Validator
 *
 * Validates that a direct-API fallback model exists on the provider.
 * When a model is not found, prompts the user to pick an alternative
 * (interactive) or fails with available models (headless).
 */

const readline = require('readline');
const { loadConfig, saveConfig, getConfigPath } = require('./config');

/**
 * Normalize a model ID to include the provider prefix.
 * @param {string} provider - e.g. 'google', 'openai'
 * @param {string} id - Model ID, may or may not have provider prefix
 * @returns {string} Normalized ID with provider prefix
 */
function normalizeModelId(provider, id) {
  if (id.startsWith(provider + '/')) {
    return id;
  }
  return `${provider}/${id}`;
}

/** Alias-to-search-term mapping for filtering provider model lists */
const ALIAS_SEARCH_TERMS = {
  'gemini': 'gemini', 'gemini-pro': 'gemini',
  'gpt': 'gpt', 'gpt-pro': 'gpt', 'codex': 'gpt',
  'claude': 'claude', 'sonnet': 'claude', 'opus': 'claude', 'haiku': 'claude',
  'deepseek': 'deepseek',
};

/**
 * Filter models to those relevant to the alias
 * @param {Array<{id: string, name: string}>} models
 * @param {string} alias - e.g. 'gemini', 'gpt', 'opus'
 * @returns {Array<{id: string, name: string}>} Filtered, sorted, max 15
 */
function filterRelevantModels(models, alias) {
  const term = (ALIAS_SEARCH_TERMS[alias] || alias).toLowerCase();

  let filtered = models.filter(m =>
    m.id.toLowerCase().includes(term) ||
    m.name.toLowerCase().includes(term)
  );

  if (filtered.length === 0) { filtered = models; }

  filtered.sort((a, b) => a.name.localeCompare(b.name));
  return filtered.slice(0, 15);
}

/**
 * Interactive alternatives picker for a direct-model miss (#61 Task 6.3, spec
 * Decision 10). Presents `selectionResult.suggestions` (built upstream by
 * route-launch.js's buildSuggestions) as a labeled numbered menu and lets the
 * user pick one, or cancel. Uses the same readline + persist pattern (same
 * save-with-malformed-config guard) as other model pickers in this module,
 * adapted to the `{model, gateway, note}` suggestion shape instead of
 * provider `{id, name}` rows.
 *
 * Never auto-selects — even a single suggestion still requires an explicit
 * pick. Cancellation (empty input, an out-of-range number, or no suggestions
 * to offer) always throws; the caller (resolveLaunchModel) is expected to
 * catch and translate that into a "cancelled" stderr message + exit(1).
 *
 * @param {{requested: string, suggestions: Array<{model:string, gateway:string, note?:string}>}} selectionResult
 * @param {string|undefined} alias - alias to persist the choice under, if any
 * @returns {Promise<{model: string, gateway: string}>}
 */
async function promptRouteSelection(selectionResult, alias) {
  const suggestions = (selectionResult && Array.isArray(selectionResult.suggestions))
    ? selectionResult.suggestions : [];
  const requested = selectionResult && selectionResult.requested;

  process.stderr.write(`\n  Model '${requested}' isn't available on the direct API.\n`);

  if (suggestions.length === 0) {
    process.stderr.write('  No alternatives available.\n\n');
    throw new Error('Model selection cancelled.');
  }

  process.stderr.write('  Alternatives:\n');
  suggestions.forEach((s, i) => {
    const note = s && s.note ? ` — ${s.note}` : '';
    process.stderr.write(`    ${i + 1}. ${s && s.model}  [${s && s.gateway}]${note}\n`);
  });
  process.stderr.write('\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });

  const answer = await new Promise(resolve => {
    rl.question(`  Select (1-${suggestions.length}) or Enter to cancel: `, resolve);
  });
  rl.close();

  const idx = parseInt(answer, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= suggestions.length) {
    throw new Error('Model selection cancelled.');
  }

  const chosen = suggestions[idx];
  const newModel = chosen.model;

  if (alias) {
    let config = loadConfig();
    if (!config) {
      const fs = require('fs');
      const configPath = getConfigPath();
      if (fs.existsSync(configPath)) {
        throw new Error(
          `Cannot save model selection: config file at ${configPath} is malformed. ` +
          'Fix it manually or run \'amicus setup\'.'
        );
      }
      config = {};
    }
    if (!config.aliases) { config.aliases = {}; }
    config.aliases[alias] = newModel;
    try {
      saveConfig(config);
      process.stderr.write(`  Saved: ${alias} -> ${newModel}\n`);
    } catch (err) {
      process.stderr.write(`  Warning: Could not save selection (${err.message}). Using for this session only.\n`);
    }
  }
  process.stderr.write('\n');

  return { model: newModel, gateway: chosen.gateway };
}

/**
 * Validate an OpenRouter-resolved model against the cached catalog (F3 #18).
 * Only enforces for `openrouter/`-prefixed models (the catalog is authoritative
 * there). Graceful when the catalog is empty/unavailable. Fails fast with
 * suggestions when the model is genuinely absent.
 *
 * @param {string} resolvedModel
 * @param {string} [alias]
 * @returns {Promise<string>} the model (unchanged) when valid/unverifiable
 */
async function validateAgainstCatalog(resolvedModel, alias) {
  if (!resolvedModel.startsWith('openrouter/')) { return resolvedModel; }

  const { getCatalog } = require('./model-catalog');
  let catalog;
  try { catalog = await getCatalog(); } catch { return resolvedModel; }
  if (!catalog || catalog.length === 0) { return resolvedModel; }

  // Only enforce when the OpenRouter catalog is actually present. If the fetch
  // was unavailable (e.g. no key reached the fetcher) the catalog won't contain
  // any openrouter/* ids — degrade gracefully instead of false-rejecting.
  if (!catalog.some(m => m.id.startsWith('openrouter/'))) { return resolvedModel; }

  if (catalog.some(m => m.id === resolvedModel)) { return resolvedModel; }

  const relevant = filterRelevantModels(catalog, alias || resolvedModel.split('/').pop());
  const list = relevant.slice(0, 10).map(m => `  ${m.id}`).join('\n');
  throw new Error(
    `Model '${resolvedModel}' not found in the OpenRouter catalog.\n` +
    (list ? `Did you mean:\n${list}\n` : '') +
    `Fix: amicus setup --add-alias ${alias || '<alias>'}=${relevant[0] ? relevant[0].id : 'openrouter/provider/model'}\n` +
    'Run \'amicus models --refresh\' to update the catalog, or pass --no-validate-model to skip.'
  );
}

/**
 * Non-blocking advisory check for inherited models (F5: continue/resume).
 * Same catalog logic as validateAgainstCatalog, but warns on stderr instead
 * of throwing — a session that already ran with this model must stay openable.
 * @param {string} model
 */
async function warnIfNotInCatalog(model) {
  if (typeof model !== 'string' || !model) { return; }
  try {
    await validateAgainstCatalog(model);
  } catch (err) {
    process.stderr.write(
      `Warning: ${String(err.message).split('\n')[0]} ` +
      '(continuing anyway — run \'amicus models --check\' to review aliases)\n'
    );
  }
}

module.exports = {
  filterRelevantModels,
  normalizeModelId,
  validateAgainstCatalog,
  warnIfNotInCatalog,
  promptRouteSelection,
};
